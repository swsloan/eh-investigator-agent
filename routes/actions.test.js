import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { actionsRouter } from './actions.js';
import { createAction, readAction } from '../lib/action-store.js';
import { withServer } from '../lib/http-test-harness.js';

function makeSession(overrides = {}) {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'action-ws-'));
  return { id: 'sess-1', workspace, title: 'T', running: false, ...overrides };
}

function seedProposed(session) {
  return createAction(session.workspace, {
    sessionId: session.id,
    capabilityId: 'update_detection',
    params: { id: 1 },
    label: 'test action',
  });
}

function mount(session, { executeApproved = async () => ({ ok: true }), observe } = {}) {
  const sessions = new Map([[session.id, session]]);
  return (app) => app.use('/api/actions', actionsRouter({ sessions, executeApproved, observe }));
}

// A read-back stub: resolves each probe's subject from `bySubject`. Used to drive
// the before-capture (precondition) and post-write verification of a verifiable
// capability. Absent subjects report an unreadable target.
function observeReturning(bySubject) {
  return async (probes = []) => {
    const out = {};
    for (const p of probes) out[p.subject] = bySubject[p.subject] || { ok: false, record: null, error: 'no stub' };
    return out;
  };
}

// A pristine detection whose fields match a status-only write, so both the
// precondition read and the read-back confirm the desired state.
const detectionObserved = (record) => observeReturning({ detection: { ok: true, record } });

function decide(base, id, payload) {
  return fetch(`${base}/api/actions/${id}/decide`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

test('reject transitions a proposed action to rejected', async () => {
  const session = makeSession();
  const action = seedProposed(session);
  await withServer(mount(session), async (base) => {
    const res = await decide(base, action.id, { session: session.id, decision: 'reject' });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.action.status, 'rejected');
    assert.equal(readAction(session.workspace, action.id).status, 'rejected');
  });
  fs.rmSync(session.workspace, { recursive: true, force: true });
});

test('approve runs the executor and, when read-back confirms, marks the action verified', async () => {
  const session = makeSession();
  const action = createAction(session.workspace, {
    sessionId: session.id, capabilityId: 'update_detection', params: { id: 1, status: 'in_progress' }, label: 'assign',
  });
  let executed = null;
  const executeApproved = async (a) => { executed = a.id; return { ok: true }; };
  const observe = detectionObserved({ id: 1, status: 'in_progress' }); // desired state holds
  await withServer(mount(session, { executeApproved, observe }), async (base) => {
    const res = await decide(base, action.id, { session: session.id, decision: 'approve' });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.action.status, 'verified');
    assert.equal(body.action.verification.status, 'verified');
    assert.deepEqual(body.action.desiredState, { status: 'in_progress' });
  });
  assert.equal(executed, action.id);
  assert.equal(readAction(session.workspace, action.id).status, 'verified');
  fs.rmSync(session.workspace, { recursive: true, force: true });
});

test('an already-decided action cannot be decided again (one-shot, 409)', async () => {
  const session = makeSession();
  const action = seedProposed(session);
  await withServer(mount(session), async (base) => {
    assert.equal((await decide(base, action.id, { session: session.id, decision: 'reject' })).status, 200);
    const again = await decide(base, action.id, { session: session.id, decision: 'approve' });
    assert.equal(again.status, 409);
  });
  fs.rmSync(session.workspace, { recursive: true, force: true });
});

test('a decision is refused while the agent is running (409)', async () => {
  const session = makeSession({ running: true });
  const action = seedProposed(session);
  let ran = false;
  await withServer(mount(session, { executeApproved: async () => { ran = true; return { ok: true }; } }), async (base) => {
    const res = await decide(base, action.id, { session: session.id, decision: 'approve' });
    assert.equal(res.status, 409);
  });
  assert.equal(ran, false, 'executor must not run while the session is busy');
  assert.equal(readAction(session.workspace, action.id).status, 'proposed');
  fs.rmSync(session.workspace, { recursive: true, force: true });
});

test('decide validates the action id, decision, and session', async () => {
  const session = makeSession();
  const action = seedProposed(session);
  await withServer(mount(session), async (base) => {
    assert.equal((await decide(base, 'not a valid id!', { session: session.id, decision: 'approve' })).status, 400);
    assert.equal((await decide(base, action.id, { session: session.id, decision: 'maybe' })).status, 400);
    assert.equal((await decide(base, action.id, { session: 'ghost', decision: 'approve' })).status, 404);
  });
  fs.rmSync(session.workspace, { recursive: true, force: true });
});

// --- Phase 3 (#23): read-back verification, precondition, expiry -----------------

test('accepted-but-not-persisted: executor succeeds but read-back does not confirm → verification_failed', async () => {
  const session = makeSession();
  const action = createAction(session.workspace, {
    sessionId: session.id, capabilityId: 'update_detection', params: { id: 1, ticket_id: 'INC-1' }, label: 'set ticket',
  });
  // The appliance ACCEPTS the write (exit 0) but the field never persists — the
  // exact ticket_id trap from docs/NOTES-write-path-validation.md.
  const observe = detectionObserved({ id: 1, ticket_id: null });
  await withServer(mount(session, { executeApproved: async () => ({ ok: true }), observe }), async (base) => {
    const res = await decide(base, action.id, { session: session.id, decision: 'approve' });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, false, 'not confirmed → ok:false');
    assert.equal(body.action.status, 'verification_failed');
    assert.match(body.action.verification.detail, /ticket_id/);
    assert.equal(body.action.afterState.detection.ticket_id, null);
  });
  fs.rmSync(session.workspace, { recursive: true, force: true });
});

test('target drift: precondition read fails before execution → failed, executor never runs', async () => {
  const session = makeSession();
  const action = seedProposed(session); // update_detection id:1
  let ran = false;
  const executeApproved = async () => { ran = true; return { ok: true }; };
  const observe = observeReturning({ detection: { ok: false, record: null, error: 'Detection not found' } });
  await withServer(mount(session, { executeApproved, observe }), async (base) => {
    const res = await decide(base, action.id, { session: session.id, decision: 'approve' });
    assert.equal(res.status, 409);
    const body = await res.json();
    assert.equal(body.action.status, 'failed');
    assert.equal(body.action.verification.status, 'precondition_failed');
  });
  assert.equal(ran, false, 'a drifted target must not execute');
  fs.rmSync(session.workspace, { recursive: true, force: true });
});

test('a capability with no verifier terminates as executed (backward compatible)', async () => {
  const session = makeSession();
  const action = createAction(session.workspace, {
    sessionId: session.id, capabilityId: 'create_investigation', params: { title: 'x' }, label: 'make inv',
  });
  // observe must NOT be consulted for an unsupported capability.
  const observe = async () => { throw new Error('observe should not run for unsupported caps'); };
  await withServer(mount(session, { executeApproved: async () => ({ ok: true }), observe }), async (base) => {
    const res = await decide(base, action.id, { session: session.id, decision: 'approve' });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.action.status, 'executed');
    assert.equal(body.action.verification.status, 'unsupported');
  });
  fs.rmSync(session.workspace, { recursive: true, force: true });
});

test('an expired proposal cannot be approved and is retired to expired (409)', async () => {
  const session = makeSession();
  const action = createAction(session.workspace, {
    sessionId: session.id, capabilityId: 'update_detection', params: { id: 1 }, label: 'stale', ttlMs: -1000,
  });
  let ran = false;
  await withServer(mount(session, { executeApproved: async () => { ran = true; return { ok: true }; } }), async (base) => {
    const res = await decide(base, action.id, { session: session.id, decision: 'approve' });
    assert.equal(res.status, 409);
    assert.match((await res.json()).error, /expired/i);
  });
  assert.equal(ran, false, 'an expired proposal must not execute');
  assert.equal(readAction(session.workspace, action.id).status, 'expired');
  fs.rmSync(session.workspace, { recursive: true, force: true });
});
