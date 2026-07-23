import assert from 'node:assert/strict';
import { test } from 'node:test';
import { memoryGroupCheck } from './system-preflight.js';

test('memory disabled → no check emitted', () => {
  assert.equal(memoryGroupCheck(null), null);
});

test('the check is always non-fatal (optional)', () => {
  // A memory-namespace problem must be loud but must never block the app.
  for (const status of [
    { unreachable: true },
    { counts: [{ group: 'a', episodes: 1 }, { group: 'b', episodes: 1 }], declared: '' },
    { counts: [{ group: 'a', episodes: 5 }], declared: 'a' },
  ]) {
    assert.equal(memoryGroupCheck(status).optional, true);
    assert.equal(memoryGroupCheck(status).id, 'memory_group');
  }
});

test('unreachable FalkorDB is surfaced, not swallowed', () => {
  const c = memoryGroupCheck({ unreachable: true });
  assert.equal(c.ok, false);
  assert.match(c.message, /FalkorDB is unreachable/);
});

test('fragmentation fails the check with the split named', () => {
  const c = memoryGroupCheck({
    counts: [
      { group: 'pocextrahop', episodes: 11 },
      { group: 'ehdefault', episodes: 3 },
    ],
    declared: '',
  });
  assert.equal(c.ok, false);
  assert.match(c.message, /split across 2 groups/);
  assert.match(c.message, /pocextrahop \(11\)/);
  assert.match(c.message, /ehdefault \(3\)/);
});

test('a declared-but-empty group is flagged as writes landing elsewhere', () => {
  const c = memoryGroupCheck({
    counts: [
      { group: 'pocextrahop', episodes: 0 },
      { group: 'ehdefault', episodes: 3 },
    ],
    declared: 'pocextrahop',
  });
  assert.equal(c.ok, false);
  assert.match(c.message, /"pocextrahop" holds no episodes/);
});

test('a single populated group passes and names it', () => {
  const c = memoryGroupCheck({ counts: [{ group: 'pocextrahop', episodes: 11 }], declared: 'pocextrahop' });
  assert.equal(c.ok, true);
  assert.match(c.message, /"pocextrahop" — 11 episodes/);
});

test('a fresh empty store passes quietly', () => {
  const c = memoryGroupCheck({ counts: [{ group: 'ehdefault', episodes: 0 }], declared: 'ehdefault' });
  assert.equal(c.ok, true);
  assert.match(c.message, /no episodes stored yet/);
});
