import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeInsights } from './memory-graph.js';

const focus = { uuid: 'f1', name: 'WEB-APP02', type: 'Device' };
// helper to build a nodesById map
const nb = (arr) => new Map(arr.map((n) => [n.uuid, n]));

test('picks the highest-risk relationship (risk-typed neighbour wins)', () => {
  const nodes = nb([
    { uuid: 'a', name: 'Data Exfiltration', type: 'DetectionType' },
    { uuid: 'b', name: 'T1048', type: 'MitreTechnique' },
  ]);
  const edges = [
    { rel: 'IS_DETECTION_TYPE', fact: 'is of type Data Exfiltration', dir: 'out', source: 'f1', target: 'a', expired: false },
    { rel: 'MAPPED_TO_MITRE_TECHNIQUE', fact: 'mapped to T1048', dir: 'out', source: 'f1', target: 'b', expired: false },
  ];
  const ins = summarizeInsights(focus, edges, nodes, [{ created_at: '2026-07-10T00:00:00Z' }]);
  assert.equal(ins.highest_risk_rel.neighbor, 'T1048');
  assert.equal(ins.highest_risk_rel.neighbor_type, 'MitreTechnique');
});

test('risk wording alone lifts a non-risk-typed edge', () => {
  const nodes = nb([{ uuid: 'a', name: 'jdoe', type: 'Identity' }]);
  const edges = [{ rel: 'SUSPECTED_COMPROMISED_ACCOUNT_IN', fact: 'account jdoe suspected compromised', dir: 'in', source: 'a', target: 'f1', expired: false }];
  const ins = summarizeInsights(focus, edges, nodes, []);
  assert.equal(ins.highest_risk_rel.neighbor, 'jdoe');
});

test('expired facts are penalised and never chosen over a live risk', () => {
  const nodes = nb([
    { uuid: 'a', name: 'OldC2', type: 'IOC' },
    { uuid: 'b', name: 'benign.example', type: 'Endpoint' },
  ]);
  const edges = [
    { rel: 'BEACONED_TO', fact: 'beaconed to OldC2', dir: 'out', source: 'f1', target: 'a', expired: true },
    { rel: 'CONNECTED_TO', fact: 'connected to benign', dir: 'out', source: 'f1', target: 'b', expired: false },
  ];
  const ins = summarizeInsights(focus, edges, nodes, []);
  // expired IOC edge scores 2 - 3 = -1; benign live edge scores 0 → neither > 0 → null
  assert.equal(ins.highest_risk_rel, null);
});

test('no risk anywhere → null highest_risk_rel', () => {
  const nodes = nb([{ uuid: 'a', name: 'DNS', type: 'Service' }]);
  const edges = [{ rel: 'USES_SERVICE', fact: 'uses DNS', dir: 'out', source: 'f1', target: 'a', expired: false }];
  const ins = summarizeInsights(focus, edges, nodes, []);
  assert.equal(ins.highest_risk_rel, null);
});

test('provenance rollup: last_observed, prior count, live corroboration, changed flag', () => {
  const nodes = nb([{ uuid: 'a', name: 'x', type: 'IOC' }]);
  const edges = [
    { rel: 'R1', fact: 'malicious', dir: 'out', source: 'f1', target: 'a', expired: false },
    { rel: 'R2', fact: 'superseded', dir: 'out', source: 'f1', target: 'a', expired: true },
  ];
  const episodes = [
    { created_at: '2026-07-10T12:00:00Z' },
    { created_at: '2026-07-01T09:00:00Z' },
  ];
  const ins = summarizeInsights(focus, edges, nodes, episodes);
  assert.equal(ins.last_observed, '2026-07-10T12:00:00Z', 'newest episode (episodes are DESC)');
  assert.equal(ins.prior_investigations, 2);
  assert.equal(ins.corroboration, 1, 'only the live edge counts');
  assert.equal(ins.changed_since_prior, true, 'an expired fact means memory changed');
});

test('empty neighborhood is safe', () => {
  const ins = summarizeInsights(focus, [], new Map(), []);
  assert.deepEqual(ins, { last_observed: null, prior_investigations: 0, corroboration: 0, changed_since_prior: false, highest_risk_rel: null });
});
