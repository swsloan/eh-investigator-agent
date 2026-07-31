// Topology store: graph naming, Cypher shape, escaping, label boundary.
// Run: node --test lib/topology-store.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TOPO_LABELS, deleteSnapshot, listSnapshots, readNode, readTier, topologyGraphName, writeSnapshot,
} from './topology-store.js';
import { normalize } from './topology-model.js';
import { layoutSnapshot } from './topology-layout.js';

/** Records every statement so we can assert on the emitted Cypher. */
function fakeClient(queryReplies = {}) {
  const mutations = [];
  const queries = [];
  return {
    mutations,
    queries,
    async mutate(graph, cypher) { mutations.push({ graph, cypher }); return { columns: [], rows: [] }; },
    async query(graph, cypher) {
      queries.push({ graph, cypher });
      for (const [needle, reply] of Object.entries(queryReplies)) {
        if (cypher.includes(needle)) return reply;
      }
      return { columns: [], rows: [] };
    },
  };
}

const SNAP = normalize({
  collected_at: '2026-07-31T00:00:00Z',
  devices: [
    { id: '1', name: 'dc1', ipaddr: '10.0.0.10', role: 'domain_controller', vlanid: '10', is_critical: true },
    { id: '2', name: 'pc1', ipaddr: '10.0.0.50', role: 'pc', vlanid: '10' },
  ],
  edges: [{ src: '2', dst: '1', bytes_out: 100, bytes_in: 50, protocols: ['cifs'] }],
  identities: [{ name: 'sean.todd@ACMELEGAL.LAB', devices: ['2'] }],
}, { group: 'pocextrahop' });

const LAYOUT = layoutSnapshot(SNAP, { logger: { info: () => {} } });

test('topology graph name is a sanitized sibling of the memory group', () => {
  assert.equal(topologyGraphName('pocextrahop'), 'pocextrahoptopology');
  assert.equal(topologyGraphName('PocExtraHop'), 'pocextrahoptopology', 'case-folded');
  assert.equal(topologyGraphName('eh-lab.example'), 'ehlabexampletopology', 'punctuation stripped');
  assert.equal(topologyGraphName(''), 'ehdefaulttopology');
  assert.notEqual(topologyGraphName('pocextrahop'), 'pocextrahop', 'never the memory graph itself');
});

test('writeSnapshot never touches the memory graph', async () => {
  const c = fakeClient();
  await writeSnapshot(c, 'pocextrahop', SNAP, LAYOUT);
  assert.ok(c.mutations.length > 0);
  for (const m of c.mutations) {
    assert.equal(m.graph, 'pocextrahoptopology', 'every write goes to the sibling graph');
  }
});

test('writeSnapshot brackets the ingest with an incomplete → complete flag', async () => {
  const c = fakeClient();
  await writeSnapshot(c, 'g', SNAP, LAYOUT);
  const first = c.mutations[0].cypher;
  const last = c.mutations[c.mutations.length - 1].cypher;
  assert.match(first, /TopoSnapshot/);
  assert.match(first, /s\.complete = false/, 'starts incomplete so a partial ingest is detectable');
  assert.match(last, /SET s\.complete = true/, 'flipped only after everything landed');
});

test('devices, tiers, edges and identities are all persisted with coordinates', async () => {
  const c = fakeClient();
  await writeSnapshot(c, 'g', SNAP, LAYOUT);
  const all = c.mutations.map((m) => m.cypher).join('\n');
  assert.match(all, /:TopoDevice \{/);
  assert.match(all, /:TopoLocality \{/);
  assert.match(all, /:TopoSegment \{/);
  assert.match(all, /:TopoRole \{/);
  assert.match(all, /:TopoIdentity \{/);
  assert.match(all, /\[:TALKS_TO \{/);
  assert.match(all, /\[:AUTHENTICATED_AS \{/);
  assert.match(all, /x: -?\d/, 'layout coordinates are written');
  assert.ok(!/x: NaN/.test(all), 'no NaN leaks into Cypher');
});

test('every write is scoped to the snapshot id so snapshots coexist', async () => {
  const c = fakeClient();
  const res = await writeSnapshot(c, 'g', SNAP, LAYOUT);
  for (const m of c.mutations) {
    assert.match(m.cypher, /snapshot_id|TopoSnapshot \{id:|MATCH \(s:TopoSnapshot/, 'statement carries snapshot scope');
  }
  assert.equal(res.snapshot_id, SNAP.snapshot.id);
});

test('hostile device names are escaped, not injected', async () => {
  // Device names come from the wire and are attacker-controllable.
  const evil = normalize({
    devices: [{ id: '1', ipaddr: '10.0.0.1', name: "x') DETACH DELETE (n) //" }],
  }, { group: 'g' });
  const c = fakeClient();
  await writeSnapshot(c, 'g', evil, layoutSnapshot(evil, { logger: { info: () => {} } }));
  const all = c.mutations.map((m) => m.cypher).join('\n');
  // The payload text still appears — as inert data inside a quoted literal. What
  // matters is that its quote is escaped, so the literal never terminates early and
  // the clause can never execute. Asserting the text is absent would be the wrong
  // test (and would pass for the wrong reasons).
  assert.match(all, /name: 'x\\'\) DETACH DELETE \(n\) \/\/'/, 'stored as an escaped literal');
  assert.ok(!/[^\\]'\) DETACH/.test(all), 'no unescaped quote lets the payload break out of the literal');
});

test('a non-whitelisted label is refused (Cypher label injection boundary)', () => {
  assert.ok(!TOPO_LABELS.includes('Device'), 'memory ontology labels are not topology labels');
  assert.deepEqual(
    TOPO_LABELS,
    ['TopoDevice', 'TopoRole', 'TopoSegment', 'TopoLocality', 'TopoIdentity', 'TopoSnapshot'],
  );
});

test('readTier reads the right label per zoom and stays read-only', async () => {
  const c = fakeClient();
  for (const [zoom, label] of [[0, 'TopoLocality'], [1, 'TopoSegment'], [2, 'TopoRole'], [3, 'TopoDevice']]) {
    c.queries.length = 0;
    await readTier(c, 'g', { snapshotId: 's1', zoom });
    assert.match(c.queries[0].cypher, new RegExp(`:${label}\\b`), `zoom ${zoom} reads ${label}`);
  }
  assert.equal(c.mutations.length, 0, 'reading never mutates');
});

test('readTier rolls edges up to the zoom tier and drops self-links', async () => {
  const c = fakeClient();
  await readTier(c, 'g', { snapshotId: 's1', zoom: 0 });
  const edgeQuery = c.queries[1].cypher;
  assert.match(edgeQuery, /a\.locality AS src, b\.locality AS dst/, 'aggregated by locality at zoom 0');
  assert.match(edgeQuery, /sum\(r\.bytes_total\)/);
  assert.match(edgeQuery, /WHERE src <> dst/, 'a cluster talking to itself is not a link');
});

test('readTier clamps limits and scopes drill-down to a parent', async () => {
  const c = fakeClient();
  await readTier(c, 'g', { snapshotId: 's1', zoom: 3, parent: 'vlan:10/pc', limit: 999999 });
  assert.match(c.queries[0].cypher, /n\.role_key = 'vlan:10\/pc'/, 'scoped to the parent cluster');
  assert.match(c.queries[0].cypher, /LIMIT 5000/, 'limit is clamped, not trusted');
});

test('a drill-down scopes BOTH edge endpoints, so counts match what is drawn', async () => {
  // Without this, drilling into a cluster returned every edge in the snapshot: the
  // renderer dropped the undrawable ones but the user saw "2 nodes · 574 links".
  const c = fakeClient();
  await readTier(c, 'g', { snapshotId: 's1', zoom: 3, parent: 'vlan:204/domain_controller' });
  const edgeQuery = c.queries[1].cypher;
  assert.match(edgeQuery, /a\.role_key = 'vlan:204\/domain_controller'/, 'source endpoint scoped');
  assert.match(edgeQuery, /b\.role_key = 'vlan:204\/domain_controller'/, 'target endpoint scoped');

  // Each tier scopes on the device property matching that tier's parent.
  for (const [zoom, parent, field] of [[1, 'Internal', 'locality'], [2, 'vlan:204', 'segment']]) {
    c.queries.length = 0;
    await readTier(c, 'g', { snapshotId: 's1', zoom, parent });
    assert.match(c.queries[1].cypher, new RegExp(`a\\.${field} = `), `zoom ${zoom} scopes edges on ${field}`);
  }

  // Unscoped (top tier) must NOT add a scope clause — that view shows everything.
  c.queries.length = 0;
  await readTier(c, 'g', { snapshotId: 's1', zoom: 0 });
  assert.doesNotMatch(c.queries[1].cypher, /AND a\./, 'the top tier is unscoped');
});

test('listSnapshots returns only completed snapshots, newest first', async () => {
  const c = fakeClient({
    'MATCH (s:TopoSnapshot)': { columns: ['id', 'collected_at'], rows: [['s2', '2026-07-31'], ['s1', '2026-07-30']] },
  });
  const out = await listSnapshots(c, 'g');
  assert.match(c.queries[0].cypher, /s\.complete = true/);
  assert.match(c.queries[0].cypher, /ORDER BY s\.collected_at DESC/);
  assert.deepEqual(out.map((s) => s.id), ['s2', 's1']);
});

test('readNode returns null for an unknown device instead of throwing', async () => {
  const c = fakeClient();
  assert.equal(await readNode(c, 'g', { snapshotId: 's1', key: 'oid:nope' }), null);
});

test('numbers and booleans are coerced out of FalkorDB string form', async () => {
  // Verified against the real database: the non-compact reply returns booleans and
  // aggregates as strings ("true", "1000"), which would give the renderer a truthy
  // "false" and string arithmetic on byte counts.
  const c = fakeClient({
    'MATCH (n:TopoDevice)': {
      columns: ['key', 'name', 'x', 'y', 'critical'],
      rows: [['oid:1', 'dc1', '1.5', '-0.5', 'false']],
    },
    'MATCH (a:TopoDevice)': { columns: ['src', 'dst', 'bytes', 'links'], rows: [['a', 'b', '1000', '2']] },
  });
  const { nodes, edges } = await readTier(c, 'g', { snapshotId: 's1', zoom: 3 });
  assert.strictEqual(nodes[0].x, 1.5);
  assert.strictEqual(nodes[0].y, -0.5);
  assert.strictEqual(nodes[0].critical, false, '"false" must not be truthy');
  assert.strictEqual(nodes[0].name, 'dc1', 'strings stay strings');
  assert.strictEqual(edges[0].bytes, 1000);
  assert.strictEqual(edges[0].links, 2);
});

test('deleteSnapshot removes every label plus the header', async () => {
  const c = fakeClient();
  await deleteSnapshot(c, 'g', 's1');
  const all = c.mutations.map((m) => m.cypher).join('\n');
  for (const label of ['TopoDevice', 'TopoRole', 'TopoSegment', 'TopoLocality', 'TopoIdentity']) {
    assert.match(all, new RegExp(`MATCH \\(n:${label} \\{snapshot_id: 's1'\\}\\) DETACH DELETE n`));
  }
  assert.match(all, /MATCH \(s:TopoSnapshot \{id: 's1'\}\) DELETE s/);
});
