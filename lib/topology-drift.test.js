// Topology drift diffing. Run: node --test lib/topology-drift.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { describeDrift, diffSnapshots } from './topology-drift.js';

const dev = (key, over = {}) => ({
  key, name: `${key}.lab`, ip: `10.0.0.${key.replace(/\D/g, '') || 1}`,
  role: 'pc', vlan: '10', segment: 'vlan:10', critical: false, ...over,
});
const edge = (src, dst) => ({ src, dst, bytes_total: 100 });

const BASE = {
  devices: [dev('d1'), dev('d2'), dev('dc1', { role: 'domain_controller', critical: true })],
  edges: [edge('d1', 'dc1'), edge('d2', 'dc1')],
  identities: [{ name: 'sean.todd@ACME.LAB', devices: ['d1'] }],
};

const kinds = (out) => out.changes.map((c) => c.kind);
const find = (out, kind) => out.changes.filter((c) => c.kind === kind);

test('an identical pair of snapshots reports no change', () => {
  const out = diffSnapshots(BASE, BASE);
  assert.equal(out.changes.length, 0);
  assert.equal(out.summary.total, 0);
  assert.equal(describeDrift(out), 'No change since the previous snapshot.');
});

test('a new workstation is informational; a new domain controller is not', () => {
  const routine = diffSnapshots(BASE, { ...BASE, devices: [...BASE.devices, dev('d3')] });
  assert.equal(find(routine, 'device_added')[0].severity, 'info', 'a new PC is routine');

  const notable = diffSnapshots(BASE, {
    ...BASE, devices: [...BASE.devices, dev('dc2', { role: 'domain_controller' })],
  });
  const added = find(notable, 'device_added')[0];
  assert.equal(added.severity, 'high', 'a domain controller appearing overnight is not routine');
  assert.match(added.detail, /New domain_controller/);
});

test('a disappeared device is reported, and a critical one ranks higher', () => {
  const out = diffSnapshots(BASE, { ...BASE, devices: [dev('d1'), dev('d2')] });
  const gone = find(out, 'device_removed');
  assert.equal(gone.length, 1);
  assert.equal(gone[0].label, 'dc1.lab');
  assert.equal(gone[0].severity, 'medium');
  assert.match(gone[0].detail, /No longer observed/);
});

test('role, criticality and segment changes are each reported with before → after', () => {
  const out = diffSnapshots(BASE, {
    ...BASE,
    devices: [
      dev('d1', { role: 'db_server', critical: true, segment: 'vlan:99' }),
      dev('d2'),
      dev('dc1', { role: 'domain_controller', critical: true }),
    ],
  });
  const role = find(out, 'role_changed')[0];
  assert.equal(role.detail, 'Role pc → db_server');
  assert.equal(role.severity, 'high', 'becoming a database server is a high-signal change');

  assert.equal(find(out, 'criticality_changed')[0].detail, 'Marked critical');
  assert.equal(find(out, 'segment_changed')[0].detail, 'Segment vlan:10 → vlan:99');
});

test('new and dropped dependencies are reported, keyed canonically', () => {
  const out = diffSnapshots(BASE, { ...BASE, edges: [edge('d1', 'dc1'), edge('d1', 'd2')] });
  const added = find(out, 'dependency_added');
  const removed = find(out, 'dependency_removed');
  assert.equal(added.length, 1);
  assert.match(added[0].label, /d1\.lab ↔ d2\.lab/);
  assert.equal(removed.length, 1);
  assert.match(removed[0].label, /d2\.lab ↔ dc1\.lab/);
});

test('edge direction does not create a phantom change', () => {
  // topology-model canonicalizes pairs, but a differ that keyed on raw src/dst
  // would report the same conversation as both removed and added.
  const out = diffSnapshots(
    { devices: [dev('a'), dev('b')], edges: [{ src: 'a', dst: 'b' }] },
    { devices: [dev('a'), dev('b')], edges: [{ src: 'b', dst: 'a' }] },
  );
  assert.equal(out.changes.length, 0, 'a↔b is the same conversation whichever way it is written');
});

test('a new conversation into a crown-jewel asset outranks an ordinary one', () => {
  const out = diffSnapshots(BASE, { ...BASE, edges: [...BASE.edges, edge('d1', 'd2')] });
  assert.equal(find(out, 'dependency_added')[0].severity, 'info', 'workstation ↔ workstation is routine');

  const toDc = diffSnapshots(
    { devices: [dev('d3'), dev('dc1', { role: 'domain_controller', critical: true })], edges: [] },
    { devices: [dev('d3'), dev('dc1', { role: 'domain_controller', critical: true })], edges: [edge('d3', 'dc1')] },
  );
  assert.equal(find(toDc, 'dependency_added')[0].severity, 'medium');
});

test('an account appearing on a host it has never used is flagged', () => {
  const out = diffSnapshots(BASE, {
    ...BASE,
    identities: [{ name: 'sean.todd@ACME.LAB', devices: ['d1', 'dc1'] }],
  });
  const moved = find(out, 'identity_moved')[0];
  assert.equal(moved.severity, 'medium', 'a classic lateral-movement tell');
  assert.match(moved.detail, /Now seen on dc1\.lab/);

  // A brand-new identity is reported, but as informational.
  const fresh = diffSnapshots(BASE, {
    ...BASE, identities: [...BASE.identities, { name: 'svc-backup@ACME.LAB', devices: ['d2'] }],
  });
  assert.equal(find(fresh, 'identity_added')[0].severity, 'info');
});

test('changes are ranked most-severe first', () => {
  const out = diffSnapshots(BASE, {
    devices: [dev('d1'), dev('d2'), dev('dc1', { role: 'domain_controller', critical: true }), dev('dc2', { role: 'domain_controller' })],
    edges: [...BASE.edges, edge('d1', 'd2')],
    identities: BASE.identities,
  });
  const severities = out.changes.map((c) => c.severity);
  const rank = { high: 0, medium: 1, info: 2 };
  for (let i = 1; i < severities.length; i++) {
    assert.ok(rank[severities[i - 1]] <= rank[severities[i]], 'severity is non-decreasing down the list');
  }
  assert.equal(out.changes[0].kind, 'device_added');
  assert.equal(out.changes[0].severity, 'high');
});

test('the result is bounded and reports truncation', () => {
  const many = Array.from({ length: 500 }, (_, i) => dev(`n${i}`));
  const out = diffSnapshots({ devices: [], edges: [] }, { devices: many, edges: [] }, { limit: 50 });
  assert.equal(out.changes.length, 50);
  assert.equal(out.truncated, true);
  assert.equal(out.summary.total, 500, 'the summary still counts everything');
});

test('a first-ever snapshot (nothing before) reports every device as added, not as noise', () => {
  const out = diffSnapshots(null, BASE);
  assert.equal(find(out, 'device_added').length, 3);
  assert.equal(find(out, 'device_removed').length, 0);
  assert.equal(out.summary.devices_before, 0);
});

test('junk input yields an empty diff rather than throwing', () => {
  for (const [a, b] of [[null, null], [undefined, undefined], [{}, {}], [{ devices: 'x' }, { edges: 3 }]]) {
    assert.doesNotThrow(() => diffSnapshots(a, b));
    assert.equal(diffSnapshots(a, b).changes.length, 0);
  }
});

test('describeDrift summarises device delta and severity for the status bar', () => {
  const out = diffSnapshots(BASE, { ...BASE, devices: [...BASE.devices, dev('dc2', { role: 'domain_controller' })] });
  const text = describeDrift(out);
  assert.match(text, /1 change/);
  assert.match(text, /\+1 device/);
  assert.match(text, /1 high/);
});
