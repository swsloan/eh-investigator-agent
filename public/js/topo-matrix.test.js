// Matrix incident marking: which cells the overlaid incident's traffic crosses.
// Run: node --test public/js/topo-matrix.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { incidentCells, pairId } from './topo-matrix.js';

// The shape /api/topology/incidents/:id serves: events with device keys, and a
// tierMap binding each involved key to its segment/locality/role_key. External
// actors resolve to their own key on every tier.
const OVERLAY = {
  events: [
    { seq: 0, tactic: 'Credential Access', src: 'dev:ws', dst: 'dev:nas' },
    { seq: 1, tactic: 'Lateral Movement', src: 'dev:nas', dst: 'dev:dc1' },
    { seq: 2, tactic: 'Exfiltration', src: 'dev:nas', dst: 'ext:185.220.1.1' },
    { seq: 3, tactic: 'Lateral Movement', src: 'dev:ghost', dst: 'dev:dc1' }, // not in this snapshot
  ],
  tierMap: {
    'dev:ws': { key: 'dev:ws', segment: 'vlan:30', locality: 'Internal', role_key: 'vlan:30/pc' },
    'dev:nas': { key: 'dev:nas', segment: 'vlan:20', locality: 'Internal', role_key: 'vlan:20/file_server' },
    'dev:dc1': { key: 'dev:dc1', segment: 'vlan:10', locality: 'Internal', role_key: 'vlan:10/domain_controller' },
    'ext:185.220.1.1': { key: 'ext:185.220.1.1', segment: 'ext:185.220.1.1', locality: 'ext:185.220.1.1', role_key: 'ext:185.220.1.1', external: true },
  },
};

test('incidentCells maps events onto segment pairs via the overlay tierMap', () => {
  const cells = incidentCells(OVERLAY, 'segment');
  assert.ok(cells.has(pairId('vlan:30', 'vlan:20')), 'ws → nas crosses 30 → 20');
  assert.ok(cells.has(pairId('vlan:20', 'vlan:10')), 'nas → dc1 crosses 20 → 10');
  // The external actor is not a snapshot device: it has no segment axis to land
  // on, so its step falls out here — as the topology draws it outside every zone.
  assert.equal(cells.size, 2);
});

test('an event naming a device outside the snapshot marks no cell', () => {
  const cells = incidentCells(OVERLAY, 'segment');
  // dev:ghost has no tier — the same rule the topology drawing applies.
  for (const events of cells.values()) {
    assert.ok(events.every((e) => e.src !== 'dev:ghost'));
  }
});

test('a cell keeps the events behind it, so the rail can say which steps crossed here', () => {
  const cells = incidentCells(OVERLAY, 'segment');
  const events = cells.get(pairId('vlan:20', 'vlan:10'));
  assert.equal(events.length, 1);
  assert.equal(events[0].seq, 1);
  assert.equal(events[0].tactic, 'Lateral Movement');
});

test('grouping by locality folds intra-locality steps into the diagonal cell', () => {
  const cells = incidentCells(OVERLAY, 'locality');
  const diag = cells.get(pairId('Internal', 'Internal'));
  assert.equal(diag.length, 2, 'ws→nas and nas→dc1 are both Internal→Internal');
  // The exfil step lands on the External axis — "which locality did the attack
  // leave toward" is the question this grouping exists to answer.
  assert.ok(cells.has(pairId('Internal', 'External')));
  assert.equal(cells.get(pairId('Internal', 'External'))[0].tactic, 'Exfiltration');
});

test('no overlay, or an overlay with no bindable events, marks nothing', () => {
  assert.equal(incidentCells(null, 'segment').size, 0);
  assert.equal(incidentCells({ events: [], tierMap: {} }, 'segment').size, 0);
  assert.equal(incidentCells({ events: OVERLAY.events, tierMap: {} }, 'segment').size, 0);
});
