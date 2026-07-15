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
