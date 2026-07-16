// Action store + governed write-path guards. Run: node --test lib/action-store.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createAction,
  readAction,
  listActions,
  transitionAction,
  validateProposalPayload,
  renderPendingActionsBlock,
  isValidActionId,
  isOpenAction,
  listActionsAcrossWorkspaces,
} from './action-store.js';

function tmpWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'eh-actions-test-'));
}

test('validateProposalPayload normalizes and rejects malformed input', () => {
  assert.deepEqual(
    validateProposalPayload({ capabilityId: ' update_detection ', label: ' tag it ', params: { id: 1 } }),
    { capabilityId: 'update_detection', label: 'tag it', params: { id: 1 } },
  );
  assert.deepEqual(validateProposalPayload({ capabilityId: 'x', label: 'y' }).params, {}, 'params defaults to {}');
  assert.throws(() => validateProposalPayload(null), /JSON object/);
  assert.throws(() => validateProposalPayload({ label: 'y' }), /capabilityId/);
  assert.throws(() => validateProposalPayload({ capabilityId: 'x' }), /label/);
  assert.throws(() => validateProposalPayload({ capabilityId: 'x', label: 'y', params: [] }), /params/);
  assert.throws(() => validateProposalPayload({ capabilityId: 'x', label: 'z'.repeat(201) }), /200/);
});

test('isValidActionId only accepts a uuid shape', () => {
  const ws = tmpWorkspace();
  const a = createAction(ws, { sessionId: 's', capabilityId: 'update_detection', label: 'l' });
  assert.equal(isValidActionId(a.id), true);
  assert.equal(isValidActionId('../etc/passwd'), false);
  assert.equal(isValidActionId('not-a-uuid'), false);
});

test('createAction persists a proposed record hidden from evidence', () => {
  const ws = tmpWorkspace();
  const rec = createAction(ws, { sessionId: 's1', capabilityId: 'update_detection', params: { id: 7 }, label: 'close it' });
  assert.equal(rec.status, 'proposed');
  assert.equal(rec.accessType, 'write');
  assert.equal(rec.result, null);
  assert.equal(readAction(ws, rec.id).capabilityId, 'update_detection');
  assert.ok(fs.existsSync(path.join(ws, '.actions')), 'stored under dot-prefixed dir');
});

test('transitionAction enforces the one-shot state graph', () => {
  const ws = tmpWorkspace();
  const rec = createAction(ws, { sessionId: 's', capabilityId: 'update_detection', label: 'l' });
  // Legal path: proposed -> approved -> executing -> executed.
  transitionAction(ws, rec.id, 'approved', { decidedBy: 'user' });
  transitionAction(ws, rec.id, 'executing');
  const done = transitionAction(ws, rec.id, 'executed', { result: { ok: true } });
  assert.equal(done.status, 'executed');
  // Terminal: cannot be re-decided or re-run.
  assert.throws(() => transitionAction(ws, rec.id, 'executing'), /Cannot move/);
  assert.throws(() => transitionAction(ws, rec.id, 'approved'), /Cannot move/);
});

test('transitionAction rejects an illegal jump (proposed -> executed)', () => {
  const ws = tmpWorkspace();
  const rec = createAction(ws, { sessionId: 's', capabilityId: 'update_detection', label: 'l' });
  assert.throws(() => transitionAction(ws, rec.id, 'executed'), /Cannot move/);
});

test('rejected is terminal', () => {
  const ws = tmpWorkspace();
  const rec = createAction(ws, { sessionId: 's', capabilityId: 'update_detection', label: 'l' });
  transitionAction(ws, rec.id, 'rejected', { decidedBy: 'user' });
  assert.throws(() => transitionAction(ws, rec.id, 'approved'), /Cannot move/);
});

test('transitionAction clamps oversized result output', () => {
  const ws = tmpWorkspace();
  const rec = createAction(ws, { sessionId: 's', capabilityId: 'update_detection', label: 'l' });
  transitionAction(ws, rec.id, 'approved');
  transitionAction(ws, rec.id, 'executing');
  const done = transitionAction(ws, rec.id, 'executed', { result: { ok: true, stdout: 'x'.repeat(100000) } });
  assert.ok(done.result.stdout.length < 20000, 'stdout clamped');
  assert.match(done.result.stdout, /truncated/);
});

test('listActions returns newest first', () => {
  const ws = tmpWorkspace();
  const a = createAction(ws, { sessionId: 's', capabilityId: 'update_detection', label: 'a', });
  // Force a later timestamp on the second record.
  const b = createAction(ws, { sessionId: 's', capabilityId: 'create_investigation', label: 'b' });
  const bLater = { ...readAction(ws, b.id), createdAt: new Date(Date.now() + 1000).toISOString() };
  fs.writeFileSync(path.join(ws, '.actions', `${b.id}.json`), JSON.stringify(bLater));
  const ids = listActions(ws).map((r) => r.id);
  assert.deepEqual(ids, [b.id, a.id]);
});

test('isOpenAction is true only for non-terminal states', () => {
  for (const s of ['proposed', 'approved', 'executing']) assert.equal(isOpenAction(s), true, s);
  for (const s of ['executed', 'rejected', 'failed']) assert.equal(isOpenAction(s), false, s);
});

test('listActionsAcrossWorkspaces aggregates open actions, oldest-first, with pendingCount', () => {
  const wsA = tmpWorkspace();
  const wsB = tmpWorkspace();
  // wsA: one proposed (older) + one already executed (terminal → excluded).
  const a1 = createAction(wsA, { sessionId: 'A', capabilityId: 'update_detection', label: 'A older' });
  const aDone = createAction(wsA, { sessionId: 'A', capabilityId: 'create_investigation', label: 'A done' });
  transitionAction(wsA, aDone.id, 'approved');
  transitionAction(wsA, aDone.id, 'executing');
  transitionAction(wsA, aDone.id, 'executed', { result: { ok: true } });
  // wsB: one approved (open, in-flight) that is NEWER than a1.
  const b1 = createAction(wsB, { sessionId: 'B', capabilityId: 'assign_devicetag_to_devices', label: 'B newer' });
  const bLater = { ...readAction(wsB, b1.id), createdAt: new Date(Date.now() + 5000).toISOString() };
  fs.writeFileSync(path.join(wsB, '.actions', `${b1.id}.json`), JSON.stringify(bLater));
  transitionAction(wsB, b1.id, 'approved');

  const entries = [
    { sessionId: 'A', sessionTitle: 'Alpha', workspace: wsA },
    { sessionId: 'B', sessionTitle: 'Bravo', workspace: wsB },
  ];
  const { pendingCount, actions } = listActionsAcrossWorkspaces(entries);
  // Terminal action excluded; two open actions remain.
  assert.equal(actions.length, 2);
  // Oldest-first: a1 (proposed) before b1 (approved, later timestamp).
  assert.deepEqual(actions.map((x) => x.id), [a1.id, b1.id]);
  // Origin session stamped.
  assert.equal(actions[0].sessionTitle, 'Alpha');
  assert.equal(actions[1].sessionId, 'B');
  // pendingCount = actions awaiting a human (proposed only).
  assert.equal(pendingCount, 1);
});

test('listActionsAcrossWorkspaces tolerates empty/missing workspaces', () => {
  assert.deepEqual(listActionsAcrossWorkspaces([]), { pendingCount: 0, actions: [] });
  assert.deepEqual(
    listActionsAcrossWorkspaces([{ sessionId: 'X', workspace: '/no/such/dir' }, null]),
    { pendingCount: 0, actions: [] },
  );
});

test('renderPendingActionsBlock summarizes live status, empty when none', () => {
  const ws = tmpWorkspace();
  assert.equal(renderPendingActionsBlock(ws), '', 'no actions => empty');
  const rec = createAction(ws, { sessionId: 's', capabilityId: 'update_detection', label: 'close detection 7' });
  const block = renderPendingActionsBlock(ws);
  assert.match(block, /<pending-actions>/);
  assert.match(block, /\[proposed\] update_detection — close detection 7/);
  transitionAction(ws, rec.id, 'approved');
  transitionAction(ws, rec.id, 'executing');
  transitionAction(ws, rec.id, 'executed', { result: { ok: true } });
  assert.match(renderPendingActionsBlock(ws), /executed successfully/);
});
