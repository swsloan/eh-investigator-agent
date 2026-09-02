// Keep the diagnostic remains of an eval case before its workspace is deleted (#128).
//
// The eval runner disposes every session it creates, and disposal rm -rf's the
// workspace (server.js disposeEvalSession). Only the scored aggregates survive,
// so a behavioural defect can be *measured* across runs and never *explained*:
// eight consecutive runs of plaintext-http-creds recorded false_climb=1 and left
// nothing behind that says which call climbed or what the agent said before it.
// hypothesis.json — the one file that would settle whether the framing licensed
// the climb — was written every time (framing_present: true) and deleted every
// time.
//
// This copies the small text artifacts out before disposal and derives a
// mechanical tool-call trace, so one run answers "did it climb, where, and on
// what stated reason" rather than only the first third of that.
import fs from 'node:fs';
import path from 'node:path';

// Rung-bearing tools, per skills/evidence-ladder/SKILL.md §3. Deliberately
// partial: orientation calls (search_detections, get_detection, search_devices,
// entity resolution) happen at every rung, so scoring them as a rung would
// report a climb that never occurred. Anything not listed is 'other' — the
// trace's job is to be checkable, not to guess.
export const RUNG_BY_TOOL = {
  execute_metric_query: 'metrics',
  search_metric_catalog: 'metrics',
  search_records: 'records',
  search_detectionlogs: 'records',
  download_pcap: 'packets',
};

const RUNG_ORDER = ['metrics', 'records', 'packets'];

/**
 * A guidance file: a skill body or one of its reference files.
 *
 * References were invisible to this instrument until #160 — both matchers were
 * anchored to `SKILL.md`, so a run that read
 * `skills/extrahop-triage/references/wire-indicators-identity.md` recorded no
 * load at all. That mattered as soon as guidance started living in references:
 * "not observed" would have been reported for a reference the run had actually
 * used, and the routing change could not be distinguished from a routing failure.
 *
 * `kind` separates the two, because they answer different questions: a skill load
 * says the agent entered that workflow, a reference load says it reached for a
 * specific lookup.
 */
const GUIDANCE_PATH = /skills\/([\w.-]+)\/(SKILL\.md|references\/[\w.-]+\.md)$/;
const GUIDANCE_IN_TEXT = /([\w./-]*skills\/[\w.-]+\/(?:SKILL\.md|references\/[\w.-]+\.md))/g;

/** Classify a guidance path into `{ skill, kind }`, or null when it is not one. */
export function guidancePath(p) {
  const m = GUIDANCE_PATH.exec(String(p || ''));
  if (!m) return null;
  return { skill: m[1], kind: m[2] === 'SKILL.md' ? 'skill' : 'reference' };
}

/**
 * The excli tools a shell command invokes, in order. Commands are multi-line and
 * routinely chain several calls, so this scans rather than parses a head token.
 *
 * `-help` invocations are flagged, not dropped: reading download_pcap's help is
 * not a climb to packets, and a trace that conflated the two would place the
 * climb several turns early.
 */
export function excliCallsIn(command) {
  const out = [];
  const text = String(command || '');
  const re = /\.\/excli-interface\s+(-?[A-Za-z_][A-Za-z0-9_-]*)([^\n;|&]*)/g;
  for (const m of text.matchAll(re)) {
    const tool = m[1];
    if (tool.startsWith('-')) continue;            // ./excli-interface -listtools
    out.push({ tool, rung: RUNG_BY_TOOL[tool] || 'other', help: /(^|\s)-help(\s|$)/.test(m[2]) });
  }
  // tshark reads a capture, so it is packet-tier work even though it is not an
  // excli tool. Counted only when a pcap is actually being read (-r).
  if (/\btshark\b[^\n]*\s-r\s/.test(text)) out.push({ tool: 'tshark', rung: 'packets', help: false });
  return out;
}

function textOf(message) {
  const c = message?.content;
  if (typeof c === 'string') return c;
  if (!Array.isArray(c)) return '';
  return c.filter((x) => x && x.type === 'text' && typeof x.text === 'string').map((x) => x.text).join('\n');
}

/**
 * A mechanical account of how far the run climbed and what it said first.
 *
 * `reasoning` is the assistant text immediately preceding the first packet-tier
 * call — the agent's own stated justification for the climb, which is the thing
 * a guidance change has to answer. `guidance_reads` records whether the ladder
 * skill was actually read in this run, which separates "ignored the stop rule"
 * from "never had it in context".
 */
export function climbTrace(transcript = []) {
  const calls = [];
  const toolNames = {};
  let lastText = '';
  let reasoning = '';
  let firstClimbAt = null;
  const guidanceReads = [];

  transcript.forEach((entry, i) => {
    const msg = entry?.message;
    if (msg && typeof msg === 'object') {
      const t = textOf(msg);
      if (t.trim() && msg.role === 'assistant') lastText = t;
      return;
    }
    // Tool names and argument keys are backend-specific: the Pi backend emits
    // `bash`/`read` with `path`, the Claude backend the SDK's `Bash`/`Read` with
    // `file_path`. Matching one spelling silently produced an empty trace on the
    // other backend, which is worse than no instrument — it reads as "no calls".
    const name = String(entry?.toolName || '').toLowerCase();
    if (!name) return;
    toolNames[entry.toolName] = (toolNames[entry.toolName] || 0) + 1;
    if (!entry.args) return;
    const args = entry.args;
    const readPath = typeof args.path === 'string' ? args.path
      : typeof args.file_path === 'string' ? args.file_path : '';
    const asGuidance = guidancePath(readPath);
    if (name === 'read' && asGuidance) {
      guidanceReads.push({ index: i, path: readPath, via: 'read', ...asGuidance });
    }
    // A skill can also arrive without a file read: Claude Code exposes a Skill
    // tool, and a shell turn can cat the file. Counting only `read` reported
    // "guidance never loaded" for a run whose behaviour had visibly changed in
    // response to that guidance, so absence here means "not observed", never
    // "not loaded".
    if (name === 'skill') {
      const which = args.skill || args.name || args.skill_name;
      // The Skill tool names a skill, never a reference — it has no path to
      // classify, so `kind` is asserted rather than parsed.
      if (which) guidanceReads.push({ index: i, path: String(which), via: 'skill-tool', skill: String(which), kind: 'skill' });
    }
    if (name !== 'bash' || typeof args.command !== 'string') return;
    for (const m of args.command.matchAll(GUIDANCE_IN_TEXT)) {
      guidanceReads.push({ index: i, path: m[1], via: 'shell', ...(guidancePath(m[1]) || {}) });
    }
    for (const c of excliCallsIn(args.command)) {
      calls.push({ index: i, ...c, command: args.command.slice(0, 400) });
      if (c.rung === 'packets' && !c.help && firstClimbAt === null) {
        firstClimbAt = calls.length - 1;
        reasoning = lastText.slice(-1500);
      }
    }
  });

  const reached = calls.filter((c) => !c.help && RUNG_ORDER.includes(c.rung)).map((c) => RUNG_ORDER.indexOf(c.rung));
  return {
    calls,
    // Every tool name the run used. Cheap, and it is what makes a *new* loading
    // path visible instead of silently missing: if guidance stops being observed,
    // this is where an unrecognised tool shows up.
    tool_names_seen: toolNames,
    rung_reached: reached.length ? RUNG_ORDER[Math.max(...reached)] : null,
    climbed_to_packets: firstClimbAt !== null,
    first_packet_call: firstClimbAt === null ? null : calls[firstClimbAt],
    calls_before_climb: firstClimbAt === null ? calls.length : firstClimbAt,
    reasoning_before_climb: reasoning,
    guidance_reads: guidanceReads,
  };
}

/**
 * Markers that only the *current* guidance could have produced. These exist
 * because load-detection cannot be made reliable: `settingSources: ['project']`
 * lets Claude Code discover the symlinked skills itself, and a run has been
 * observed writing `detection_window` — a field present in no other file than the
 * current evidence-ladder SKILL.md — with no load of that skill anywhere in its
 * transcript. The body was demonstrably in context via a path the transcript does
 * not show, so a tool-call scan can establish presence and must never be read as
 * establishing absence.
 *
 * Version-coupled by design: a marker is evidence that *this* revision of the
 * guidance was in context, so it has to be updated when the guidance changes.
 * `means` says what to re-point it at.
 */
export const GUIDANCE_FINGERPRINTS = [
  {
    marker: 'detection_window',
    file: 'hypothesis.json',
    means: 'the §2 framing template that introduced detection_window (#128)',
  },
];

/**
 * What can actually be said about whether the guidance was in context, from the
 * retained artifacts plus the trace.
 *
 * `status` is deliberately three-state and never says "absent":
 *   in_context   — a fingerprint matched: the run produced something only the
 *                  current guidance specifies. Direct evidence.
 *   load_observed — a skill load appears in the transcript but no fingerprint did.
 *   not_observed  — neither. Says nothing about whether the guidance was loaded;
 *                  `tool_names_seen` is where to look for an unhandled path.
 */
export function guidanceEvidence({ dir, trace }) {
  const fingerprints = [];
  for (const f of GUIDANCE_FINGERPRINTS) {
    try {
      if (fs.readFileSync(path.join(dir, f.file), 'utf8').includes(f.marker)) {
        fingerprints.push({ marker: f.marker, file: f.file, means: f.means });
      }
    } catch { /* artifact absent — not a fingerprint miss, just nothing to read */ }
  }
  const loads = trace?.guidance_reads || [];
  const status = fingerprints.length ? 'in_context' : loads.length ? 'load_observed' : 'not_observed';
  const uniq = (kind) => [...new Set(loads.filter((l) => l.kind === kind).map((l) => l.path))].sort();
  return {
    status,
    // Split out because they answer different questions, and because a reference
    // that is routed but never loaded is a routing problem, while one that is
    // loaded on every case may be worth promoting into the skill body.
    skills_loaded: uniq('skill'),
    references_loaded: uniq('reference'),
    // Spelled out so a reader of the artifact does not have to infer the rule.
    note: status === 'not_observed'
      ? 'Neither a fingerprint nor an observed load. This does NOT mean the guidance was absent — check tool_names_seen for a loading path this instrument does not recognise.'
      : 'Positive evidence only; absence is never asserted.',
    fingerprints,
    loads,
  };
}

/**
 * Identifiers that cannot appear in ExtraHop wire data, with where they actually
 * live. A run that filters records on one of these gets zero hits no matter what
 * happened on the network, so the empty result reads as "no attack" when it means
 * "wrong query" — a confident-wrong-answer path, which is the class of defect the
 * gate exists to catch.
 *
 * Deliberately high-precision. Bare Windows event IDs (4624, 4662) and AD access
 * masks (0x10000000) were considered and left out: they collide with legitimate
 * values, and an instrument that cries wolf is worse than no instrument. Each
 * entry here is an identifier with no plausible benign reason to appear in an
 * excli query. See skills/extrahop-triage/references/wire-indicators-identity.md.
 */
export const DEAD_END_TERMS = [
  {
    pattern: /1131f6a[ad]-9c07-11d1-f79f-00c04fc2dcd2|89e95b76-444d-4c62-991a-0facbeda640c/i,
    term: 'DS-Replication extended-right GUID',
    why: 'lives in Event 4662 and in security descriptors, not in DRSUAPI traffic; match the drsuapi interface UUID and opnum instead',
  },
  {
    pattern: /0xC0000(?:064|06A|071|072|193|234)\b/i,
    term: 'Windows NTSTATUS sub-status code',
    why: 'a host artifact, and encrypted on the wire wherever NLA or signing applies; use protocol status/error fields instead',
  },
  {
    pattern: /\b(?:EventID|Event_ID|EventCode)\b/i,
    term: 'Windows event-log field',
    why: 'ExtraHop has no event-log plane; if the deciding question needs one, say so and hand off to EDR/SIEM',
  },
  {
    pattern: /\bSysmon\b/i,
    term: 'Sysmon reference',
    why: 'endpoint telemetry, not wire data',
  },
];

/** Dead-end filters a run actually issued, deduplicated by term. */
export function deadEndFilters(calls = []) {
  const seen = new Map();
  for (const c of calls) {
    const cmd = String(c?.command || '');
    for (const d of DEAD_END_TERMS) {
      const m = d.pattern.exec(cmd);
      if (!m || seen.has(d.term)) continue;
      seen.set(d.term, { term: d.term, why: d.why, matched: m[0], index: c.index ?? null, tool: c.tool || null });
    }
  }
  return [...seen.values()];
}

/**
 * Evidence files that came back with nothing in them.
 *
 * The transcript carries tool *calls* but not tool *results*, so an empty query
 * is not directly visible. It is visible on disk: the agent redirects output to
 * evidence/, and an empty result set lands as a zero-byte or near-empty file.
 * That makes this a proxy, not a measurement — hence `confidence`, and hence the
 * small-file band is reported separately from the empty one.
 */
export function emptyEvidence(manifest = [], { smallBytes = 120 } = {}) {
  const rows = manifest.filter((m) => typeof m?.bytes === 'number');
  const empty = rows.filter((m) => m.bytes === 0).map((m) => m.file);
  const small = rows.filter((m) => m.bytes > 0 && m.bytes <= smallBytes).map((m) => m.file);
  return {
    empty_files: empty,
    near_empty_files: small,
    near_empty_threshold_bytes: smallBytes,
    confidence: 'proxy — a zero-byte evidence file usually means an empty result set, but a redirect that failed or a summary step looks the same',
  };
}

/**
 * Phrases in which the agent said, in its own words, that it could not answer
 * something. Candidate generator only: some of these are correct statements of a
 * real ExtraHop limit (the right output), and some mark a lookup it lacked. The
 * two are not separable mechanically, which is exactly why this is reviewed.
 */
const LIMIT_PHRASES = /\b(?:cannot|could not|unable to|no visibility into|not (?:visible|available|observable|exposed)|would require|insufficient (?:data|evidence)|not determinable)\b[^.\n]{0,160}/gi;
const MAX_LIMITS = 12;

/**
 * A limitation the agent stated *because the ladder told it to stop* is the rule
 * working, not a gap. Recognised by the ladder's own language (§3: the test is
 * "does the next rung change the verdict?", and remediation detail is gathered
 * after the disposition is set) rather than by anything fitted to a sample.
 *
 * Measured, not assumed: over the 10-case suite of eval-2026-09-02T16-42-11-087Z
 * this splits 38 quotes into 3 ladder_stop and 35 unclassified. So it does *not*
 * rescue precision — the remaining 35 are a mix of genuine ExtraHop limits,
 * retention boundaries, and possible missing lookups, and separating those is the
 * human judgement this artifact exists to support rather than replace. Treat the
 * unclassified count as a queue length, never as a gap count.
 */
const LADDER_STOP = /would not change the disposition|does not change the (?:verdict|disposition)|not a verdict question|remediation scoping|deliberately not pulled|no verdict-relevant/i;

export function statedLimits(dir, files = ['verdict.json', 'ledger.md']) {
  const out = [];
  for (const f of files) {
    let text = '';
    try { text = fs.readFileSync(path.join(dir, f), 'utf8'); } catch { continue; }
    for (const m of text.matchAll(LIMIT_PHRASES)) {
      if (out.length >= MAX_LIMITS) break;
      const quote = m[0].trim().replace(/\s+/g, ' ').slice(0, 200);
      out.push({
        file: f,
        quote,
        // 'ladder_stop'  — the agent stopped because the next rung would not move
        //                  the verdict. Expected behaviour; not a gap.
        // 'unclassified' — everything else. Could be a missing lookup, a real
        //                  ExtraHop limit, or a retention boundary. Needs a human.
        classified: LADDER_STOP.test(quote) ? 'ladder_stop' : 'unclassified',
      });
    }
  }
  return out;
}

/**
 * Where this run may have wanted guidance it did not have.
 *
 * Post-hoc and derived — it reads only what retention already captured, so it
 * costs nothing per run and changes no agent behaviour. Everything here is a
 * *candidate for review*, never a finding: the agent is not asked what it needed
 * (self-reported gap analysis confabulates), and a signal firing can equally mean
 * the reference is missing, the reference exists but was not routed, or ExtraHop
 * genuinely cannot answer the question and the handoff was correct. Separating
 * those three is a human judgement, and `guidance` is included so the reviewer
 * can tell the first two apart.
 */
export function gapsReport({ dir, calls = [], manifest = [], guidance = null }) {
  const dead = deadEndFilters(calls);
  const empties = emptyEvidence(manifest);
  const limits = statedLimits(dir);
  const review = limits.filter((l) => l.classified === 'unclassified');
  const signals = [];
  if (dead.length) signals.push(`queried ${dead.length} identifier(s) that cannot exist on the wire`);
  if (empties.empty_files.length) signals.push(`${empties.empty_files.length} evidence file(s) came back empty`);
  // Only the unclassified ones are a signal; a ladder_stop quote is the rule
  // working and would otherwise drown the report.
  if (review.length) signals.push(`stated ${review.length} unclassified limitation(s) in its own words`);
  if (guidance && guidance.references_loaded?.length === 0) signals.push('no reference file was observed loading');
  return {
    signals,
    dead_end_filters: dead,
    empty_evidence: empties,
    stated_limits: limits,
    guidance_loaded: guidance
      ? { skills: guidance.skills_loaded || [], references: guidance.references_loaded || [], status: guidance.status }
      : null,
    note: 'Candidates for review, not findings. A signal here can mean a reference is missing, a reference exists but was not routed, or ExtraHop genuinely cannot answer the question — the three need different fixes and only the last is not a gap.',
  };
}

// Text artifacts worth keeping. Copied whole, because the point is to read them.
const KEEP_FILES = ['evidence/hypothesis.json', 'evidence/verdict.json', 'evidence/ledger.md'];
const MAX_COPY_BYTES = 512 * 1024;

/** Every evidence file's name and size, so what was pulled stays visible even though pcaps are not copied. */
function evidenceManifest(workspace) {
  const root = path.join(workspace, 'evidence');
  const out = [];
  const walk = (dir) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else {
        let size = null;
        try { size = fs.statSync(p).size; } catch { /* raced with disposal */ }
        out.push({ file: path.relative(root, p), bytes: size });
      }
    }
  };
  walk(root);
  return out.sort((a, b) => a.file.localeCompare(b.file));
}

/**
 * Copy the small text artifacts of one case out of `workspace` into `outDir` and
 * write climb.json beside them. Best-effort by construction: a retention failure
 * must never fail the eval run it is observing.
 *
 * Captures are not copied (a pcap-heavy workspace runs to megabytes and the
 * bytes are not what a behavioural question needs); evidence-manifest.json
 * records that they existed.
 */
export function retainCaseArtifacts({ workspace, transcript = [], outDir }) {
  const written = [];
  try {
    fs.mkdirSync(outDir, { recursive: true });
    for (const rel of KEEP_FILES) {
      const src = path.join(workspace, rel);
      try {
        if (fs.statSync(src).size > MAX_COPY_BYTES) continue;
        fs.copyFileSync(src, path.join(outDir, path.basename(rel)));
        written.push(path.basename(rel));
      } catch { /* absent — an agent that wrote no verdict is itself the finding */ }
    }
    // After the copies, so fingerprints read the retained artifacts and the same
    // check works offline on any past run's directory.
    const trace = climbTrace(transcript);
    trace.guidance = guidanceEvidence({ dir: outDir, trace });
    fs.writeFileSync(path.join(outDir, 'climb.json'), `${JSON.stringify(trace, null, 2)}\n`);
    written.push('climb.json');
    const manifest = evidenceManifest(workspace);
    fs.writeFileSync(
      path.join(outDir, 'evidence-manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
    written.push('evidence-manifest.json');
    // Derived from what the two above already captured — no extra collection, so
    // a failure here costs the run nothing.
    fs.writeFileSync(
      path.join(outDir, 'gaps.json'),
      `${JSON.stringify(gapsReport({ dir: outDir, calls: trace.calls, manifest, guidance: trace.guidance }), null, 2)}\n`,
    );
    written.push('gaps.json');
  } catch { /* best effort: never fail a run over its own instrumentation */ }
  return written;
}
