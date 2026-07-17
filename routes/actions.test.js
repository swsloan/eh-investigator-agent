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

function mount(session, { executeApproved = async () => ({ ok: true }) } = {}) {
  const sessions = new Map([[session.id, session]]);
  return (app) => app.use('/api/actions', actionsRouter({ sessions, executeApproved }));
}

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

test('approve runs the privileged executor and marks the action executed', async () => {
  const session = makeSession();
  const action = seedProposed(session);
  let executed = null;
  const executeApproved = async (a) => { executed = a.id; return { ok: true }; };
  await withServer(mount(session, { executeApproved }), async (base) => {
    const res = await decide(base, action.id, { session: session.id, decision: 'approve' });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.action.status, 'executed');
  });
  assert.equal(executed, action.id);
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
