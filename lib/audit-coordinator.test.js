// Audit capture coordinator (#30 Slice A). Run: node --test lib/audit-coordinator.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createAuditCoordinator } from './audit-coordinator.js';
import { readTrail, verifyTrail } from './audit-trail.js';

function makeSession() {
  const s = new EventEmitter();
  s.id = 'sess-1';
  s.workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'auditco-'));
  return s;
}
const entries = (ws) => readTrail(ws).split('\n').filter(Boolean).map((l) => JSON.parse(l));

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
