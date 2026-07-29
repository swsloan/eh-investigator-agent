// Crash recovery for interrupted governed writes (#23).
// Run: node --test lib/action-recover.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAction, readAction, transitionAction } from './action-store.js';
import { recoverInterruptedActions } from './action-recover.js';

function ws() { return fs.mkdtempSync(path.join(os.tmpdir(), 'eh-recover-')); }

// Drive an action into a transient state to simulate a crash at that point.
function stuck(workspace, { capabilityId, params, status }) {
  const a = createAction(workspace, { sessionId: 's', capabilityId, params, label: 'l' });
  transitionAction(workspace, a.id, 'approved');
  transitionAction(workspace, a.id, 'executing');
  if (status === 'verifying') transitionAction(workspace, a.id, 'verifying');
  return a;
}

const observeReturning = (bySubject) => async (probes = []) => {
  const out = {};
  for (const p of probes) out[p.subject] = bySubject[p.subject] || { ok: false, record: null, error: 'no stub' };
  return out;
};

test('a verifiable action stuck in verifying is resolved by read-back (verified)', async () => {
  const workspace = ws();
  const a = stuck(workspace, { capabilityId: 'update_detection', params: { id: 1, status: 'open' }, status: 'verifying' });
  await recoverInterruptedActions({
    entries: [{ sessionId: 's', workspace }],
    observe: observeReturning({ detection: { ok: true, record: { id: 1, status: 'open' } } }),
  });
  const rec = readAction(workspace, a.id);
  assert.equal(rec.status, 'verified');
  assert.match(rec.verification.detail, /Recovered after restart/);
  fs.rmSync(workspace, { recursive: true, force: true });
});

test('a verifiable action stuck in executing is read back; a non-matching state → verification_failed', async () => {
  const workspace = ws();
  const a = stuck(workspace, { capabilityId: 'update_detection', params: { id: 1, ticket_id: 'INC-1' }, status: 'executing' });
  await recoverInterruptedActions({
    entries: [{ sessionId: 's', workspace }],
    observe: observeReturning({ detection: { ok: true, record: { id: 1, ticket_id: null } } }),
  });
  const rec = readAction(workspace, a.id);
  assert.equal(rec.status, 'verification_failed');
  fs.rmSync(workspace, { recursive: true, force: true });
});

test('a non-verifiable action stuck in executing is marked failed, never re-run', async () => {
  const workspace = ws();
  const a = stuck(workspace, { capabilityId: 'create_investigation', params: { title: 'x' }, status: 'executing' });
  let observed = false;
  await recoverInterruptedActions({
    entries: [{ sessionId: 's', workspace }],
    observe: async () => { observed = true; return {}; },
  });
  const rec = readAction(workspace, a.id);
  assert.equal(rec.status, 'failed');
  assert.equal(rec.verification.status, 'interrupted');
  assert.match(rec.result.error, /Interrupted before completion/);
  assert.equal(observed, false, 'no read-back for a non-verifiable capability');
  fs.rmSync(workspace, { recursive: true, force: true });
});

test('terminal and open-but-not-transient actions are left alone', async () => {
  const workspace = ws();
  const done = createAction(workspace, { sessionId: 's', capabilityId: 'update_detection', params: { id: 1 }, label: 'done' });
  transitionAction(workspace, done.id, 'rejected');
  const proposed = createAction(workspace, { sessionId: 's', capabilityId: 'update_detection', params: { id: 2 }, label: 'prop' });
  const resolved = await recoverInterruptedActions({
    entries: [{ sessionId: 's', workspace }],
    observe: observeReturning({}),
  });
  assert.equal(resolved.length, 0);
  assert.equal(readAction(workspace, done.id).status, 'rejected');
  assert.equal(readAction(workspace, proposed.id).status, 'proposed');
  fs.rmSync(workspace, { recursive: true, force: true });
});
