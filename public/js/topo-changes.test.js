import { test } from 'node:test';
import assert from 'node:assert/strict';
import { changeKeys, severityGroups } from './topo-changes.js';

test('groups by severity, keeping the order the diff produced', () => {
  const groups = severityGroups([
    { severity: 'info', label: 'a' },
    { severity: 'high', label: 'b' },
    { severity: 'medium', label: 'c' },
    { severity: 'high', label: 'd' },
  ]);
  assert.deepEqual(groups.high.map((c) => c.label), ['b', 'd']);
  assert.deepEqual(groups.medium.map((c) => c.label), ['c']);
  assert.deepEqual(groups.info.map((c) => c.label), ['a']);
});

test('an unknown or missing severity is treated as info, never dropped', () => {
  const groups = severityGroups([
    { severity: 'catastrophic', label: 'a' },
    { label: 'b' },
    null,
  ]);
  assert.equal(groups.high.length, 0);
  assert.equal(groups.info.length, 3, 'nothing silently disappears from the list');
});

test('severityGroups always returns all three buckets', () => {
  const groups = severityGroups([]);
  assert.deepEqual(Object.keys(groups).sort(), ['high', 'info', 'medium']);
  assert.deepEqual(groups.high, []);
});

test('a change resolves to the devices it is about', () => {
  // Device-scoped: one key.
  assert.deepEqual(changeKeys({ kind: 'device_added', key: 'dev:1' }), ['dev:1']);
  // A dependency is a canonical pair, and `key` is the joined form — the endpoints
  // are the real devices, so they win.
  assert.deepEqual(
    changeKeys({ kind: 'dependency_added', key: 'dev:1|dev:2', endpoints: ['dev:1', 'dev:2'] }),
    ['dev:1', 'dev:2'],
  );
  // An identity that moved is keyed by name, and names are not devices.
  assert.deepEqual(
    changeKeys({ kind: 'identity_moved', key: 'svc_backup', devices: ['dev:3', 'dev:4'] }),
    ['dev:3', 'dev:4'],
  );
});

test('a change with nothing to point at yields no keys', () => {
  assert.deepEqual(changeKeys({ kind: 'identity_added', key: '' }), []);
  assert.deepEqual(changeKeys({ endpoints: [] }), []);
  assert.deepEqual(changeKeys(null), []);
  assert.deepEqual(changeKeys({ devices: [null, ''] }), [], 'empty entries are not keys');
});
