// Audit capture coordinator (#30 Slice A). Run: node --test lib/audit-coordinator.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createAuditCoordinator, summarizeToolArgs } from './audit-coordinator.js';
import { readTrail, verifyTrail } from './audit-trail.js';

function makeSession() {
  const s = new EventEmitter();
  s.id = 'sess-1';
  s.workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'auditco-'));
  return s;
}
const entries = (ws) => readTrail(ws).split('\n').filter(Boolean).map((l) => JSON.parse(l));

test('summarizeToolArgs surfaces the meaningful argument per tool (#104)', () => {
  assert.equal(summarizeToolArgs('Bash', { command: './excli-interface search_records -json {"a":1}' }),
    './excli-interface search_records -json {"a":1}');
  assert.equal(summarizeToolArgs('Read', { file_path: 'evidence/records/http.json' }), 'evidence/records/http.json');
  assert.equal(summarizeToolArgs('Skill', { skill: 'evidence-ladder' }), 'evidence-ladder');
  assert.equal(summarizeToolArgs('Grep', { pattern: 'beacon', path: '.' }), '{"pattern":"beacon","path":"."}');
  assert.equal(summarizeToolArgs('Bash', undefined), '', 'no args → empty (caller falls back to the name)');
  // Bounded.
  const long = summarizeToolArgs('Bash', { command: 'x'.repeat(500) });
  assert.ok(long.length < 500 && /\[\+\d+ chars\]$/.test(long), 'clipped with a length note');
});

test('tool_call entries record the tool AND a summary of what it ran (#104)', () => {
  const co = createAuditCoordinator();
  const s = makeSession();
  co.capture(s, { type: 'tool_execution_start', toolName: 'Bash', args: { command: './excli-interface get_detection -json {"id":42}' } });
  const rows = entries(s.workspace);
  assert.equal(rows[0].type, 'tool_call');
  assert.equal(rows[0].tool, 'Bash');
  assert.match(rows[0].summary, /excli-interface get_detection/, 'the actual command is captured, not just "Bash"');
  fs.rmSync(s.workspace, { recursive: true, force: true });
});

test('a secret in a tool argument is redacted out of the summary (#104)', () => {
  const SECRET = 'sk-ant-abcd1234';
  const redact = (o) => JSON.parse(JSON.stringify(o).split(SECRET).join('[redacted]'));
  const co = createAuditCoordinator({ redact });
  const s = makeSession();
  co.capture(s, { type: 'tool_execution_start', toolName: 'Bash', args: { command: `curl -H "authorization: ${SECRET}" https://x` } });
  const raw = readTrail(s.workspace);
  assert.ok(!raw.includes(SECRET), 'secret scrubbed from the captured argument summary');
  assert.equal(verifyTrail(raw).ok, true);
  fs.rmSync(s.workspace, { recursive: true, force: true });
});

test('capture projects tool calls, action lifecycle, safety and memory events', () => {
  const co = createAuditCoordinator();
  const s = makeSession();
  co.capture(s, { type: 'tool_execution_start', toolName: 'search_records' });
  co.capture(s, { type: 'action_proposed', action: { id: 'a1', capabilityId: 'update_detection', label: 'close it' } });
  co.capture(s, { type: 'action_result', action: { id: 'a1', status: 'verified', decidedBy: 'user' } });
  co.capture(s, { type: 'safety_event', kind: 'injection_suspected', source: 'excli search_records' });
  co.capture(s, { type: 'memory_status', status: 'captured' });
  co.capture(s, { type: 'message_end', message: {} }); // ignored (not audit-worthy)

  const rows = entries(s.workspace);
  assert.deepEqual(rows.map((r) => r.type),
    ['tool_call', 'action_proposed', 'action_result', 'safety_event', 'memory_capture']);
  assert.equal(rows[0].summary, 'search_records');
  assert.equal(rows[1].ref, 'a1');
  assert.equal(rows[2].outcome, 'verified');
  assert.equal(verifyTrail(readTrail(s.workspace)).ok, true, 'the captured chain verifies');
  fs.rmSync(s.workspace, { recursive: true, force: true });
});

test('attachSession captures the verdict on a user turn end', () => {
  const co = createAuditCoordinator();
  const s = makeSession();
  co.attachSession(s);
  fs.mkdirSync(path.join(s.workspace, 'evidence'), { recursive: true });
  fs.writeFileSync(path.join(s.workspace, 'evidence', 'verdict.json'),
    JSON.stringify({ disposition: 'malicious', confidence: 'high', highest_rung_used: 'records' }));

  s.emit('agent_end', { promptSource: 'memory-capture' }); // not a user turn → ignored
  assert.equal(entries(s.workspace).length, 0);

  s.emit('agent_end', { promptSource: 'user' });
  const rows = entries(s.workspace);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].type, 'verdict');
  assert.equal(rows[0].outcome, 'malicious');
  assert.equal(rows[0].confidence, 'high');
  fs.rmSync(s.workspace, { recursive: true, force: true });
});

test('capture applies the injected redactor before writing (no secret in the trail)', () => {
  const SECRET = 'token-XYZ-secret';
  const redact = (o) => JSON.parse(JSON.stringify(o).split(SECRET).join('[redacted]'));
  const co = createAuditCoordinator({ redact });
  const s = makeSession();
  co.capture(s, { type: 'tool_call', summary: `ran with ${SECRET}` });
  co.capture(s, { type: 'tool_execution_start', toolName: `x ${SECRET}` });
  const raw = readTrail(s.workspace);
  assert.ok(!raw.includes(SECRET), 'no secret in the audit trail');
  assert.equal(verifyTrail(raw).ok, true);
  fs.rmSync(s.workspace, { recursive: true, force: true });
});

test('capture is inert for a session without a workspace (never throws)', () => {
  const co = createAuditCoordinator();
  assert.doesNotThrow(() => co.capture({ id: 'x' }, { type: 'tool_execution_start', toolName: 't' }));
  assert.doesNotThrow(() => co.capture(null, { type: 'tool_call' }));
});

test('seal signs the trail and emits the digest to the external sink', async () => {
  const emitted = [];
  const sink = { emit: (d) => { emitted.push(d); return Promise.resolve({ ok: true, emitted: true }); } };
  const signer = { keyId: 'k1', publicKeyPem: 'PEM', sign: () => 'sig' };
  const co = createAuditCoordinator({ getSigner: () => signer, sink });
  const s = makeSession();
  co.capture(s, { type: 'tool_execution_start', toolName: 'search_records' });
  const seal = co.seal(s);
  assert.equal(seal.type, 'seal');
  await new Promise((r) => setImmediate(r)); // let the fire-and-forget emit run
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].type, 'audit_seal');
  assert.equal(emitted[0].sessionId, s.id);
  assert.equal(emitted[0].keyId, 'k1');
  assert.ok(!JSON.stringify(emitted[0]).includes('sig'), 'the signature is not in the anchored digest');
  fs.rmSync(s.workspace, { recursive: true, force: true });
});

test('seal without a signer is a no-op (no sink emit)', () => {
  const emitted = [];
  const co = createAuditCoordinator({ sink: { emit: (d) => emitted.push(d) } });
  const s = makeSession();
  co.capture(s, { type: 'tool_execution_start', toolName: 'search_records' });
  assert.equal(co.seal(s), null);
  assert.equal(emitted.length, 0);
  fs.rmSync(s.workspace, { recursive: true, force: true });
});
