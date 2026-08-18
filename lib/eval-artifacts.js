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
    if (name === 'read' && /skills\/[^/]+\/SKILL\.md$/.test(readPath)) {
      guidanceReads.push({ index: i, path: readPath, via: 'read' });
    }
    // A skill can also arrive without a file read: Claude Code exposes a Skill
    // tool, and a shell turn can cat the file. Counting only `read` reported
    // "guidance never loaded" for a run whose behaviour had visibly changed in
    // response to that guidance, so absence here means "not observed", never
    // "not loaded".
    if (name === 'skill') {
      const which = args.skill || args.name || args.skill_name;
      if (which) guidanceReads.push({ index: i, path: String(which), via: 'skill-tool' });
    }
    if (name !== 'bash' || typeof args.command !== 'string') return;
    for (const m of args.command.matchAll(/([\w./-]*skills\/[\w.-]+\/SKILL\.md)/g)) {
      guidanceReads.push({ index: i, path: m[1], via: 'shell' });
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
  return {
    status,
    // Spelled out so a reader of the artifact does not have to infer the rule.
    note: status === 'not_observed'
      ? 'Neither a fingerprint nor an observed load. This does NOT mean the guidance was absent — check tool_names_seen for a loading path this instrument does not recognise.'
      : 'Positive evidence only; absence is never asserted.',
    fingerprints,
    loads,
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
    fs.writeFileSync(
      path.join(outDir, 'evidence-manifest.json'),
      `${JSON.stringify(evidenceManifest(workspace), null, 2)}\n`,
    );
    written.push('evidence-manifest.json');
  } catch { /* best effort: never fail a run over its own instrumentation */ }
  return written;
}
