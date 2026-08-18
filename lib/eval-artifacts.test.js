import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { excliCallsIn, climbTrace, retainCaseArtifacts, RUNG_BY_TOOL } from './eval-artifacts.js';

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
  assert.deepEqual(written.sort(), ['climb.json', 'evidence-manifest.json', 'hypothesis.json', 'ledger.md', 'verdict.json']);
  assert.equal(fs.existsSync(path.join(out, 'big.pcap')), false);
  const manifest = JSON.parse(fs.readFileSync(path.join(out, 'evidence-manifest.json'), 'utf8'));
  assert.ok(manifest.find((m) => m.file === path.join('packets', 'big.pcap') && m.bytes === 2048));
  assert.equal(JSON.parse(fs.readFileSync(path.join(out, 'climb.json'), 'utf8')).climbed_to_packets, true);
});

test('a missing workspace is survivable — instrumentation never fails the run', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'evout-'));
  const written = retainCaseArtifacts({ workspace: '/nonexistent/workspace', transcript: [], outDir: out });
  assert.deepEqual(written, ['climb.json', 'evidence-manifest.json']);
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
