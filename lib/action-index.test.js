// ActionIndex (cross-session open-action cache). Run: node --test lib/action-index.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { ActionIndex } from './action-index.js';

const rec = (id, over = {}) => ({
  id, sessionId: 'S', status: 'proposed', createdAt: `2026-01-01T00:00:${String(id).padStart(2, '0')}Z`, ...over,
});
const titleAll = (id) => (id === 'GONE' ? null : `title-${id}`);

test('seed keeps only open actions', () => {
  const idx = new ActionIndex().seed([
    rec('01'),
    rec('02', { status: 'approved' }),
    rec('03', { status: 'executed' }), // terminal — excluded
    rec('04', { status: 'rejected' }), // terminal — excluded
    { status: 'proposed' }, // no id — skipped
  ]);
  assert.equal(idx.open.size, 2);
  assert.ok(idx.open.has('01') && idx.open.has('02'));
});

test('apply upserts open actions and removes on terminal transition', () => {
  const idx = new ActionIndex();
  idx.apply(rec('01'));
  assert.equal(idx.open.size, 1);
  idx.apply(rec('01', { status: 'executing' })); // still open — upsert
  assert.equal(idx.open.get('01').status, 'executing');
  assert.equal(idx.open.size, 1);
  idx.apply(rec('01', { status: 'executed' })); // terminal — remove
  assert.equal(idx.open.size, 0);
  idx.apply(null); // tolerated
  idx.apply({ status: 'proposed' }); // no id — ignored
  assert.equal(idx.open.size, 0);
});

test('snapshot: oldest-first, titles resolved, pendingCount = proposed', () => {
  const idx = new ActionIndex().seed([
    rec('03', { sessionId: 'A', status: 'approved' }),
    rec('01', { sessionId: 'A', status: 'proposed' }),
    rec('02', { sessionId: 'B', status: 'proposed' }),
  ]);
  const { pendingCount, actions } = idx.snapshot((id) => `S-${id}`);
  assert.deepEqual(actions.map((a) => a.id), ['01', '02', '03']); // by createdAt
  assert.equal(actions[0].sessionTitle, 'S-A');
  assert.equal(pendingCount, 2); // two proposed, one approved
});

test('snapshot evicts actions whose session was deleted (self-healing)', () => {
  const idx = new ActionIndex().seed([
    rec('01', { sessionId: 'LIVE' }),
    rec('02', { sessionId: 'GONE' }),
  ]);
  const getTitle = (id) => (id === 'GONE' ? null : `t-${id}`);
  const first = idx.snapshot(getTitle);
  assert.deepEqual(first.actions.map((a) => a.id), ['01']);
  assert.equal(idx.open.has('02'), false, 'gone-session action evicted from the index');
});
