import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { excliCallsIn, climbTrace, retainCaseArtifacts, guidanceEvidence, RUNG_BY_TOOL, deadEndFilters, emptyEvidence, statedLimits, gapsReport } from './eval-artifacts.js';

const bash = (command) => ({ toolName: 'bash', args: { command } });
const say = (text) => ({ message: { role: 'assistant', content: [{ type: 'text', text }] } });

test('a chained command yields every excli call in order', () => {
  const calls = excliCallsIn([
    'mkdir -p evidence/records',
    "./excli-interface search_records -json '{\"limit\": 100}' > evidence/records/http.json",
    "./excli-interface execute_metric_query -json '{}'",
  ].join('\n'));
  assert.deepEqual(calls.map((c) => c.tool), ['search_records', 'execute_metric_query']);
  assert.deepEqual(calls.map((c) => c.rung), ['records', 'metrics']);
});

test('-listtools is a flag, not a tool', () => {
  assert.deepEqual(excliCallsIn('./excli-interface -listtools'), []);
});

test('reading a tool help page is flagged, so it cannot read as a climb', () => {
  const [c] = excliCallsIn('./excli-interface download_pcap -help 2>&1');
  assert.equal(c.rung, 'packets');
  assert.equal(c.help, true);
  assert.equal(climbTrace([bash('./excli-interface download_pcap -help')]).climbed_to_packets, false);
});

test('tshark counts as packet work only when reading a capture', () => {
  assert.equal(excliCallsIn('which tshark; tshark -v').length, 0);
  assert.deepEqual(excliCallsIn('tshark -r evidence/packets/a.pcap -V').map((c) => c.rung), ['packets']);
});

test('orientation calls are not scored as a rung', () => {
  assert.equal(RUNG_BY_TOOL.search_detections, undefined);
  const t = climbTrace([bash("./excli-interface search_detections -json '{}'")]);
  assert.equal(t.rung_reached, null);
  assert.equal(t.calls[0].rung, 'other');
});

test('the trace names the first packet call and quotes the reasoning before it', () => {
  const t = climbTrace([
    say('Framing the case first.'),
    bash("./excli-interface search_records -json '{}'"),
    say('Records settle this, but I want to be sure, so I will pull packets.'),
    bash("./excli-interface download_pcap -json '{}' > evidence/packets/a.pcap"),
    bash('tshark -r evidence/packets/a.pcap -V'),
  ]);
  assert.equal(t.climbed_to_packets, true);
  assert.equal(t.rung_reached, 'packets');
  assert.equal(t.first_packet_call.tool, 'download_pcap');
  assert.equal(t.calls_before_climb, 1);
  assert.match(t.reasoning_before_climb, /want to be sure/);
});

test('a run that stops at records reports no climb', () => {
  const t = climbTrace([bash("./excli-interface execute_metric_query -json '{}'"), bash("./excli-interface search_records -json '{}'")]);
  assert.equal(t.climbed_to_packets, false);
  assert.equal(t.rung_reached, 'records');
  assert.equal(t.first_packet_call, null);
});

test('skill reads are recorded, separating an ignored rule from an absent one', () => {
  const t = climbTrace([{ toolName: 'read', args: { path: '/ws/.pi/skills/evidence-ladder/SKILL.md' } }]);
  assert.equal(t.guidance_reads.length, 1);
  assert.match(t.guidance_reads[0].path, /evidence-ladder/);
});

test('retention copies the text artifacts, writes the trace, and manifests uncopied captures', () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'evart-'));
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'evout-'));
  fs.mkdirSync(path.join(ws, 'evidence', 'packets'), { recursive: true });
  fs.writeFileSync(path.join(ws, 'evidence', 'hypothesis.json'), '{"hypothesis":"h"}');
  fs.writeFileSync(path.join(ws, 'evidence', 'verdict.json'), '{"disposition":"benign"}');
  fs.writeFileSync(path.join(ws, 'evidence', 'ledger.md'), '# ledger');
  fs.writeFileSync(path.join(ws, 'evidence', 'packets', 'big.pcap'), Buffer.alloc(2048));

  const written = retainCaseArtifacts({ workspace: ws, transcript: [bash("./excli-interface download_pcap -json '{}'")], outDir: out });
  assert.deepEqual(written.sort(), ['climb.json', 'evidence-manifest.json', 'gaps.json', 'hypothesis.json', 'ledger.md', 'verdict.json']);
  assert.equal(fs.existsSync(path.join(out, 'big.pcap')), false);
  const manifest = JSON.parse(fs.readFileSync(path.join(out, 'evidence-manifest.json'), 'utf8'));
  assert.ok(manifest.find((m) => m.file === path.join('packets', 'big.pcap') && m.bytes === 2048));
  assert.equal(JSON.parse(fs.readFileSync(path.join(out, 'climb.json'), 'utf8')).climbed_to_packets, true);
});

test('a missing workspace is survivable — instrumentation never fails the run', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'evout-'));
  const written = retainCaseArtifacts({ workspace: '/nonexistent/workspace', transcript: [], outDir: out });
  assert.deepEqual(written, ['climb.json', 'evidence-manifest.json', 'gaps.json']);
});

// Backend parity. The first live run of this instrument returned an empty trace
// because it was written against the Pi backend's tool names and run on Claude.
test('the Claude backend spelling traces identically to the Pi backend', () => {
  const pi = climbTrace([
    { toolName: 'read', args: { path: '/ws/.pi/skills/evidence-ladder/SKILL.md' } },
    { toolName: 'bash', args: { command: "./excli-interface download_pcap -json '{}'" } },
  ]);
  const claude = climbTrace([
    { toolName: 'Read', args: { file_path: '/ws/.claude/skills/evidence-ladder/SKILL.md' } },
    { toolName: 'Bash', args: { command: "./excli-interface download_pcap -json '{}'" } },
  ]);
  assert.equal(claude.climbed_to_packets, true);
  assert.equal(claude.first_packet_call.tool, 'download_pcap');
  assert.equal(claude.guidance_reads.length, 1);
  assert.deepEqual(claude.calls.map((c) => c.tool), pi.calls.map((c) => c.tool));
  assert.equal(claude.rung_reached, pi.rung_reached);
});

test('guidance loading is counted however it arrives, and absence means not observed', () => {
  const t = climbTrace([
    { toolName: 'Skill', args: { skill: 'evidence-ladder' } },
    { toolName: 'Bash', args: { command: 'cat .claude/skills/evidence-ladder/SKILL.md' } },
    { toolName: 'Read', args: { file_path: '/ws/.claude/skills/extrahop-excli/SKILL.md' } },
  ]);
  assert.deepEqual(t.guidance_reads.map((g) => g.via), ['skill-tool', 'shell', 'read']);
  assert.equal(t.guidance_reads[0].path, 'evidence-ladder');
  assert.match(t.guidance_reads[1].path, /evidence-ladder\/SKILL\.md$/);
});

// Guidance evidence. Load-detection cannot be made reliable (see
// GUIDANCE_FINGERPRINTS), so these pin the one property that matters: the field
// reports positive evidence and never asserts absence.
function artifactDir(files = {}) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'evguid-'));
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(d, name), body);
  return d;
}

test('a fingerprint in the retained artifact proves the guidance was in context', () => {
  const dir = artifactDir({ 'hypothesis.json': JSON.stringify({ detection_window: '2026-06-09Z .. 2026-07-25Z' }) });
  const g = guidanceEvidence({ dir, trace: { guidance_reads: [] } });
  assert.equal(g.status, 'in_context');
  assert.equal(g.fingerprints[0].marker, 'detection_window');
  assert.match(g.note, /absence is never asserted/);
});

test('an observed load without a fingerprint is reported as exactly that', () => {
  const g = guidanceEvidence({ dir: artifactDir(), trace: { guidance_reads: [{ path: 'evidence-ladder', via: 'skill-tool' }] } });
  assert.equal(g.status, 'load_observed');
  assert.equal(g.fingerprints.length, 0);
});

test('nothing observed says so without claiming the guidance was absent', () => {
  const g = guidanceEvidence({ dir: artifactDir(), trace: { guidance_reads: [] } });
  assert.equal(g.status, 'not_observed');
  assert.equal(g.fingerprints.length, 0);
  assert.equal(g.loads.length, 0);
  // The note must carry the disclaimer, and the status must not be one of the
  // two that claim evidence. Asserting on the absence of the words "was absent"
  // would forbid the very sentence that disclaims it.
  assert.match(g.note, /does NOT mean the guidance was absent/);
  assert.match(g.note, /tool_names_seen/);
});

test('every tool the run used is recorded, so an unrecognised loading path is visible', () => {
  const t = climbTrace([
    { toolName: 'Bash', args: { command: "./excli-interface search_records -json '{}'" } },
    { toolName: 'Bash', args: { command: 'ls' } },
    { toolName: 'SomeFutureSkillLoader', args: { skillish: 'evidence-ladder' } },
  ]);
  assert.deepEqual(t.tool_names_seen, { Bash: 2, SomeFutureSkillLoader: 1 });
  assert.equal(t.guidance_reads.length, 0);
});

test('retention writes the guidance block into climb.json', () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'evart-'));
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'evout-'));
  fs.mkdirSync(path.join(ws, 'evidence'), { recursive: true });
  fs.writeFileSync(path.join(ws, 'evidence', 'hypothesis.json'), JSON.stringify({ detection_window: 'x .. y' }));
  retainCaseArtifacts({ workspace: ws, transcript: [], outDir: out });
  const climb = JSON.parse(fs.readFileSync(path.join(out, 'climb.json'), 'utf8'));
  assert.equal(climb.guidance.status, 'in_context');
});

// Reference tracking (#160). Guidance moved into references/, and both matchers
// were anchored to SKILL.md — so a reference the run had actually used reported
// as "not observed", which is indistinguishable from a routing failure.
test('a reference read is recorded and distinguished from a skill read', () => {
  const t = climbTrace([
    { toolName: 'Read', args: { file_path: '/ws/.claude/skills/extrahop-triage/references/wire-indicators-identity.md' } },
    { toolName: 'Read', args: { file_path: '/ws/.claude/skills/extrahop-triage/SKILL.md' } },
  ]);
  assert.deepEqual(t.guidance_reads.map((g) => g.kind), ['reference', 'skill']);
  assert.deepEqual(t.guidance_reads.map((g) => g.skill), ['extrahop-triage', 'extrahop-triage']);
});

test('a reference cat in a shell turn counts too', () => {
  const t = climbTrace([bash('cat .claude/skills/extrahop-triage/references/wire-indicators-c2-exfil.md')]);
  assert.equal(t.guidance_reads.length, 1);
  assert.equal(t.guidance_reads[0].kind, 'reference');
  assert.equal(t.guidance_reads[0].via, 'shell');
});

test('a non-guidance markdown read is not counted as guidance', () => {
  const t = climbTrace([
    { toolName: 'Read', args: { file_path: '/ws/evidence/notes.md' } },
    { toolName: 'Read', args: { file_path: '/ws/skills/extrahop-triage/references/deep/nested.md' } },
  ]);
  assert.equal(t.guidance_reads.length, 0);
});

test('guidance evidence lists skills and references separately', () => {
  const t = climbTrace([
    { toolName: 'Skill', args: { skill: 'extrahop-triage' } },
    { toolName: 'Read', args: { file_path: '/ws/skills/extrahop-triage/references/wire-indicators-ot.md' } },
  ]);
  const g = guidanceEvidence({ dir: artifactDir(), trace: t });
  assert.deepEqual(g.skills_loaded, ['extrahop-triage']);
  assert.deepEqual(g.references_loaded, ['/ws/skills/extrahop-triage/references/wire-indicators-ot.md']);
});

// gaps.json (#160). Post-hoc, derived, candidates-not-findings.
test('an identifier that cannot exist on the wire is flagged with where it does live', () => {
  const found = deadEndFilters([
    { index: 3, tool: 'search_records', command: `./excli-interface search_records -json '{"filter":"1131f6aa-9c07-11d1-f79f-00c04fc2dcd2"}'` },
  ]);
  assert.equal(found.length, 1);
  assert.match(found[0].term, /DS-Replication/);
  assert.match(found[0].why, /Event 4662/);
  assert.equal(found[0].index, 3);
});

test('dead-end terms are deduplicated, and a legitimate query trips nothing', () => {
  const repeated = deadEndFilters([
    { command: 'grep Sysmon notes' }, { command: 'echo Sysmon again' },
  ]);
  assert.equal(repeated.length, 1);
  assert.deepEqual(deadEndFilters([
    { command: `./excli-interface search_records -json '{"filter":{"field":"user","value":"svc-backup"}}'` },
  ]), []);
});

test('empty and near-empty evidence files are reported separately, as a proxy', () => {
  const e = emptyEvidence([
    { file: 'records/kerberos.json', bytes: 0 },
    { file: 'records/smb.json', bytes: 40 },
    { file: 'records/dns.json', bytes: 90000 },
  ]);
  assert.deepEqual(e.empty_files, ['records/kerberos.json']);
  assert.deepEqual(e.near_empty_files, ['records/smb.json']);
  assert.match(e.confidence, /proxy/);
});

test('stated limits are quoted from the retained artifacts and capped', () => {
  const dir = artifactDir({
    'verdict.json': JSON.stringify({ notes: 'Could not determine which account was used without endpoint telemetry.' }),
    'ledger.md': 'Packet capture would require a packetstore at this site.',
  });
  const limits = statedLimits(dir);
  assert.equal(limits.length, 2);
  assert.match(limits[0].quote, /Could not determine/);
  assert.equal(limits[1].file, 'ledger.md');
});

// Measured on the 10-case suite: 38 limit quotes split 3 ladder_stop / 35
// unclassified. The split does not rescue precision — it only removes the quotes
// the ladder itself licensed, so the rest stay a review queue, not a gap count.
test('a limitation stated because the next rung would not move the verdict is not a gap', () => {
  const dir = artifactDir({
    'verdict.json': JSON.stringify({
      a: 'Payload would require packet-level evidence, which would not change the disposition.',
      b: 'Could not determine the account without endpoint telemetry.',
    }),
  });
  const limits = statedLimits(dir);
  assert.deepEqual(limits.map((l) => l.classified), ['ladder_stop', 'unclassified']);
  const report = gapsReport({ dir, calls: [], manifest: [], guidance: null });
  assert.ok(report.signals.some((s) => /1 unclassified limitation/.test(s)), 'only the unclassified one is a signal');
  assert.equal(report.stated_limits.length, 2, 'both are still reported');
});

test('gaps.json summarizes the signals and never states a finding', () => {
  const dir = artifactDir({ 'verdict.json': JSON.stringify({ notes: 'unable to confirm the process name' }) });
  const report = gapsReport({
    dir,
    calls: [{ index: 1, tool: 'search_records', command: 'search for 0xC000006A' }],
    manifest: [{ file: 'records/a.json', bytes: 0 }],
    guidance: { status: 'load_observed', skills_loaded: ['extrahop-triage'], references_loaded: [] },
  });
  assert.equal(report.dead_end_filters.length, 1);
  assert.equal(report.empty_evidence.empty_files.length, 1);
  assert.equal(report.stated_limits.length, 1);
  assert.ok(report.signals.some((s) => /cannot exist on the wire/.test(s)));
  assert.ok(report.signals.some((s) => /no reference file was observed/.test(s)));
  assert.match(report.note, /Candidates for review, not findings/);
});

test('a clean run produces a gaps report with no signals', () => {
  const report = gapsReport({ dir: artifactDir(), calls: [], manifest: [{ file: 'r.json', bytes: 5000 }], guidance: null });
  assert.deepEqual(report.signals, []);
  assert.equal(report.guidance_loaded, null);
});

test('retention writes gaps.json beside climb.json', () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'evart-'));
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'evout-'));
  fs.mkdirSync(path.join(ws, 'evidence', 'records'), { recursive: true });
  fs.writeFileSync(path.join(ws, 'evidence', 'records', 'empty.json'), '');
  const written = retainCaseArtifacts({
    workspace: ws,
    transcript: [bash(`./excli-interface search_records -json '{"filter":"0xC0000234"}'`)],
    outDir: out,
  });
  assert.ok(written.includes('gaps.json'));
  const gaps = JSON.parse(fs.readFileSync(path.join(out, 'gaps.json'), 'utf8'));
  assert.equal(gaps.dead_end_filters.length, 1);
  assert.deepEqual(gaps.empty_evidence.empty_files, [path.join('records', 'empty.json')]);
});
