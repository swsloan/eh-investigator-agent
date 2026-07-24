import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeInsights, dispositionChanged, summarizeGroupHealth, groupCounts, neighbors } from './memory-graph.js';

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
  // a superseded disposition (benign → malicious) = the conclusion changed
  const edges = [
    { rel: 'HAS_DISPOSITION', fact: 'disposition malicious', dir: 'out', source: 'f1', target: 'a', expired: false },
    { rel: 'HAS_DISPOSITION', fact: 'disposition benign', dir: 'out', source: 'f1', target: 'a', expired: true },
  ];
  const episodes = [
    { created_at: '2026-07-10T12:00:00Z' },
    { created_at: '2026-07-01T09:00:00Z' },
  ];
  const ins = summarizeInsights(focus, edges, nodes, episodes);
  assert.equal(ins.last_observed, '2026-07-10T12:00:00Z', 'newest episode (episodes are DESC)');
  assert.equal(ins.prior_investigations, 2);
  assert.equal(ins.corroboration, 1, 'only the live edge counts');
  assert.equal(ins.changed_since_prior, true, 'a superseded disposition means the conclusion changed');
});

test('changed_since_prior is a disposition change, not any expired fact', () => {
  const dispo = (fact, expired) => ({ rel: 'HAS_DISPOSITION', fact, dir: 'out', source: 'f1', target: 'a', expired });
  // benign → malicious: changed
  assert.equal(dispositionChanged([dispo('disposition malicious', false), dispo('disposition benign', true)]), true);
  // a non-disposition fact expiring: NOT a conclusion change
  assert.equal(dispositionChanged([
    { rel: 'CONNECTED_TO', fact: 'talked to host', dir: 'out', source: 'f1', target: 'a', expired: true },
    { rel: 'HAS_DISPOSITION', fact: 'disposition malicious', dir: 'out', source: 'f1', target: 'a', expired: false },
  ]), false);
  // same disposition re-asserted (expired + live identical): no change
  assert.equal(dispositionChanged([dispo('disposition malicious', false), dispo('disposition malicious', true)]), false);
  // only an expired disposition, nothing live to replace it: not "changed this run"
  assert.equal(dispositionChanged([dispo('disposition benign', true)]), false);
  assert.equal(dispositionChanged([]), false);
});

test('empty neighborhood is safe', () => {
  const ins = summarizeInsights(focus, [], new Map(), []);
  assert.deepEqual(ins, { last_observed: null, prior_investigations: 0, corroboration: 0, changed_since_prior: false, highest_risk_rel: null });
});

test('summarizeGroupHealth flags a single healthy group', () => {
  const h = summarizeGroupHealth([{ group: 'pocextrahop', episodes: 11, entities: 130 }], { declared: 'pocextrahop' });
  assert.equal(h.active, 'pocextrahop');
  assert.equal(h.activeEpisodes, 11);
  assert.equal(h.fragmented, false);
  assert.equal(h.declaredEmpty, false);
});

test('summarizeGroupHealth detects fragmentation across populated groups', () => {
  // The exact situation the live run surfaced: history in one group, new writes
  // in another.
  const h = summarizeGroupHealth([
    { group: 'pocextrahop', episodes: 11, entities: 130 },
    { group: 'ehdefault', episodes: 3, entities: 12 },
    { group: 'extrahop', episodes: 0, entities: 0 },
  ], { declared: '' });
  assert.equal(h.fragmented, true);
  assert.equal(h.populatedGroups.length, 2);
  assert.equal(h.populatedGroups[0].group, 'pocextrahop', 'ordered by episode count');
});

test('summarizeGroupHealth flags a declared group that holds nothing', () => {
  const h = summarizeGroupHealth([
    { group: 'pocextrahop', episodes: 0, entities: 0 },
    { group: 'ehdefault', episodes: 3, entities: 12 },
  ], { declared: 'pocextrahop' });
  assert.equal(h.declaredEmpty, true);
  assert.equal(h.active, 'ehdefault', 'active is where the episodes actually are');
});

test('summarizeGroupHealth is calm on an empty/fresh store', () => {
  const h = summarizeGroupHealth([{ group: 'ehdefault', episodes: 0, entities: 0 }], { declared: 'ehdefault' });
  assert.equal(h.fragmented, false);
  assert.equal(h.declaredEmpty, false);
  assert.equal(h.activeEpisodes, 0);
});

test('groupCounts runs two lean counts per group and tolerates unreadable graphs', async () => {
  const client = {
    async query(graph, cypher) {
      if (graph === 'boom') throw new Error('unreadable');
      const c = cypher.includes('Episodic') ? (graph === 'g1' ? 5 : 0) : (graph === 'g1' ? 40 : 1);
      return { columns: ['c'], rows: [[c]] };
    },
  };
  const counts = await groupCounts(client, ['g1', 'g2', 'boom']);
  assert.deepEqual(counts.find((c) => c.group === 'g1'), { group: 'g1', episodes: 5, entities: 40 });
  assert.deepEqual(counts.find((c) => c.group === 'g2'), { group: 'g2', episodes: 0, entities: 1 });
  assert.equal(counts.find((c) => c.group === 'boom').unreadable, true);
});

// A self-referential fact ("172.16.204.150 is JJKOUPRO1") is real in the store but
// carries no neighborhood: left in, it puts the focus in its own neighbor list and
// the renderer draws the focus node — and its label — a second time.
test('neighbors() excludes self-referential facts from the neighborhood', async () => {
  const seen = [];
  const client = {
    async query(graph, cypher) {
      seen.push(cypher);
      if (cypher.includes('MATCH (n:Entity {uuid:')
        && cypher.includes('RETURN n.uuid AS uuid') && !cypher.includes('RELATES_TO')) {
        return { columns: ['uuid', 'name', 'type', 'summary'], rows: [['f1', 'JJKOUPRO1', 'Device', 's']] };
      }
      if (cypher.includes('RELATES_TO')) {
        return {
          columns: ['euuid', 'rel', 'fact', 'src', 'invalid_at', 'uuid', 'name', 'type', 'summary'],
          rows: [
            // a genuine neighbor, and the self-loop a lenient server would return
            ['e1', 'COMMUNICATES_WITH', 'talks to C2', 'f1', null, 'n2', 'ei.example', 'IOC', ''],
            ['e2', 'IS_IDENTIFIED_AS', 'is JJKOUPRO1', 'f1', null, 'f1', 'JJKOUPRO1', 'Device', 's'],
          ],
        };
      }
      return { columns: ['uuid', 'name', 'created_at', 'source'], rows: [] };
    },
  };
  const out = await neighbors(client, 'g', 'f1');
  assert.ok(seen.some((c) => c.includes('m.uuid <> n.uuid')), 'self-loops are excluded in Cypher');
  assert.deepEqual(out.nodes.map((n) => n.uuid), ['n2'], 'focus is not its own neighbor');
  assert.deepEqual(out.edges.map((e) => e.uuid), ['e1'], 'the self-loop edge is dropped');
});
