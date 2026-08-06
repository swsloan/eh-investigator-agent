// Topology store: graph naming, Cypher shape, escaping, label boundary.
// Run: node --test lib/topology-store.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TOPO_LABELS, deleteSnapshot, listSnapshots, readEnrichments, readIdentities, readMixedTier,
  readNode, readTier,
  topologyGraphName, writeEnrichments, writeSnapshot,
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
    ['TopoDevice', 'TopoRole', 'TopoSegment', 'TopoLocality', 'TopoIdentity', 'TopoSnapshot', 'TopoEnrichment'],
  );
});

test('aggregate tiers persist and return their dominant role (for segment colouring)', async () => {
  const snap = normalize({
    devices: [
      { id: '1', ipaddr: '10.0.0.10', role: 'domain_controller', vlanid: '10' },
      { id: '2', ipaddr: '10.0.0.11', role: 'pc', vlanid: '20' },
      { id: '3', ipaddr: '10.0.0.12', role: 'pc', vlanid: '20' },
    ],
  }, { group: 'g' });
  const c = fakeClient();
  await writeSnapshot(c, 'g', snap, layoutSnapshot(snap, { logger: { info: () => {} } }));
  const segWrite = c.mutations.map((m) => m.cypher).find((q) => /:TopoSegment \{/.test(q));
  assert.match(segWrite, /role: '(domain_controller|pc)'/, 'segments carry a dominant role');

  // The aggregate read returns it so the client can colour by it.
  c.queries.length = 0;
  await readTier(c, 'g', { snapshotId: 's1', zoom: 1, parent: 'Internal' });
  assert.match(c.queries[0].cypher, /n\.role AS role/, 'segment tier returns role');
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

  // Unscoped (top tier) must NOT add a PARENT scope clause — that view shows every
  // cluster. (The default-internal filter adds a locality `<>`/`IS NULL` clause, which
  // is not a parent scope, so assert specifically on the `a.<field> = '<parent>'` form.)
  c.queries.length = 0;
  await readTier(c, 'g', { snapshotId: 's1', zoom: 0 });
  assert.doesNotMatch(c.queries[1].cypher, /a\.\w+ = '/, 'the top tier has no parent scope');
});

test('the default view hides External; external:true opts it back in', async () => {
  const c = fakeClient();
  // Device tier: nodes and both edge endpoints are filtered to non-External.
  await readTier(c, 'g', { snapshotId: 's1', zoom: 3 });
  assert.match(c.queries[0].cypher, /n\.locality IS NULL OR n\.locality <> 'External'/, 'External devices hidden by default');
  assert.match(c.queries[1].cypher, /a\.locality IS NULL OR a\.locality <> 'External'/, 'edges to External are excluded');
  assert.match(c.queries[1].cypher, /b\.locality IS NULL OR b\.locality <> 'External'/);

  // Locality tier filters on the node's own key/name.
  c.queries.length = 0;
  await readTier(c, 'g', { snapshotId: 's1', zoom: 0 });
  assert.match(c.queries[0].cypher, /n\.key <> 'External'/, 'the External locality node is hidden at zoom 0');

  // external:true removes the filter entirely.
  c.queries.length = 0;
  await readTier(c, 'g', { snapshotId: 's1', zoom: 3, external: true });
  assert.doesNotMatch(c.queries[0].cypher, /<> 'External'/, 'external:true shows External nodes');
  assert.doesNotMatch(c.queries[1].cypher, /<> 'External'/, 'external:true shows External edges');
});

test('a segment drills straight to its devices via scope=segment', async () => {
  // The Role hop is skipped: a segment scopes the DEVICE tier on n.segment, not
  // role_key, so clicking a segment lands on its devices directly.
  const c = fakeClient();
  await readTier(c, 'g', { snapshotId: 's1', zoom: 3, parent: 'vlan:204', scope: 'segment' });
  assert.match(c.queries[0].cypher, /n\.segment = 'vlan:204'/, 'nodes scoped by segment');
  assert.match(c.queries[1].cypher, /a\.segment = 'vlan:204'/, 'edges scoped by segment (both ends)');
  assert.match(c.queries[1].cypher, /b\.segment = 'vlan:204'/);

  // An unknown scope value falls back to the tier default (role_key), never injected.
  c.queries.length = 0;
  await readTier(c, 'g', { snapshotId: 's1', zoom: 3, parent: 'vlan:204/pc', scope: 'evil; DROP' });
  assert.match(c.queries[0].cypher, /n\.role_key = 'vlan:204\/pc'/, 'bad scope falls back to role_key');
  assert.doesNotMatch(c.queries[0].cypher, /evil/, 'an unwhitelisted scope field never reaches Cypher');
});

test('neighbor mode returns in-scope devices, one-hop outside peers, and boundary edges', async () => {
  const c = fakeClient({
    "n.segment = 'vlan:10'": {
      columns: ['key', 'name', 'x', 'y', 'ip', 'role', 'vlan', 'critical', 'locality', 'segment', 'role_key', 'oid', 'discovery_id'],
      rows: [['oid:1', 'pc1', '0', '0', '10.0.0.1', 'pc', '10', 'false', 'Internal', 'vlan:10', 'vlan:10/pc', '1', '']],
    },
    'OR b.segment': {
      columns: [
        'a_key', 'a_name', 'a_x', 'a_y', 'a_role', 'a_critical', 'a_locality', 'a_segment', 'a_role_key',
        'b_key', 'b_name', 'b_x', 'b_y', 'b_role', 'b_critical', 'b_locality', 'b_segment', 'b_role_key', 'bytes',
      ],
      // pc1 (in scope, vlan:10) → srv1 (outside, vlan:20): a cross-boundary dependency.
      rows: [['oid:1', 'pc1', '0', '0', 'pc', 'false', 'Internal', 'vlan:10', 'vlan:10/pc',
        'oid:2', 'srv1', '5', '5', 'file_server', 'true', 'Internal', 'vlan:20', 'vlan:20/file_server', '2048']],
    },
  });
  const out = await readTier(c, 'g', { snapshotId: 's1', zoom: 3, parent: 'vlan:10', scope: 'segment', neighbors: true });
  assert.equal(out.neighbors, true);
  const byKey = Object.fromEntries(out.nodes.map((n) => [n.key, n]));
  assert.equal(byKey['oid:1'].neighbor, false, 'the in-scope device is not a neighbor');
  assert.equal(byKey['oid:2'].neighbor, true, 'the out-of-scope peer is flagged a neighbor');
  assert.equal(byKey['oid:2'].x, 5, 'neighbor coordinates are coerced to numbers');
  assert.equal(out.edges.length, 1, 'the boundary conversation is drawn');
  assert.equal(out.edges[0].bytes, 2048);
  // The edge query pulls conversations with EITHER endpoint in scope (not just both).
  const edgeQ = c.queries.find((q) => /OR b\.segment/.test(q.cypher));
  assert.ok(edgeQ, 'neighbor edges use an OR across endpoints');
});

test('an explicit key set scopes both nodes and edges, and overrides a parent', async () => {
  // How the attack overlay asks for exactly the incident's participants: they can
  // span several clusters, so neither a parent scope nor a whole tier is the view.
  const c = fakeClient();
  await readTier(c, 'g', { snapshotId: 's1', zoom: 3, parent: 'vlan:204/pc', keys: ['oid:1', 'oid:2'] });
  assert.match(c.queries[0].cypher, /n\.key IN \['oid:1', 'oid:2'\]/, 'nodes restricted to the key set');
  assert.doesNotMatch(c.queries[0].cypher, /role_key = /, 'the key set wins over a parent scope');
  assert.match(c.queries[1].cypher, /a\.key IN \['oid:1', 'oid:2'\]/);
  assert.match(c.queries[1].cypher, /b\.key IN \['oid:1', 'oid:2'\]/);
});

test('a hostile key in the set is escaped, and the set is bounded', async () => {
  const c = fakeClient();
  const many = Array.from({ length: 900 }, (_, i) => `oid:${i}`);
  await readTier(c, 'g', { snapshotId: 's1', zoom: 3, keys: ["x') RETURN 1 //", ...many] });
  const q = c.queries[0].cypher;
  assert.match(q, /'x\\'\) RETURN 1 \/\/'/, 'stored as an escaped literal');
  assert.ok(!/[^\\]'\) RETURN/.test(q), 'no unescaped break-out');
  assert.ok((q.match(/'oid:/g) || []).length <= 500, 'key set is capped');
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

test('the richer inventory fields are persisted on the device node', async () => {
  const snap = normalize({
    devices: [{ id: '1', name: 'dc1', ipaddr: '10.0.0.10', role: 'domain_controller',
      dns_name: 'dc1.acme.lab', netbios_name: 'DC1', vendor: 'VMware', software: 'Windows Server 2019' }],
  }, { group: 'g' });
  const c = fakeClient();
  await writeSnapshot(c, 'g', snap, layoutSnapshot(snap, { logger: { info: () => {} } }));
  const deviceWrite = c.mutations.map((m) => m.cypher).find((q) => /:TopoDevice \{/.test(q));
  assert.match(deviceWrite, /dns_name: 'dc1\.acme\.lab'/);
  assert.match(deviceWrite, /netbios_name: 'DC1'/);
  assert.match(deviceWrite, /vendor: 'VMware'/);
  assert.match(deviceWrite, /software: 'Windows Server 2019'/);
});

test('readNode returns the richer inventory fields for the detail panel', async () => {
  const c = fakeClient({
    'MATCH (d:TopoDevice {snapshot_id:': {
      columns: ['key', 'name', 'ip', 'mac', 'role', 'vlan', 'critical', 'oid', 'discovery_id', 'locality', 'segment', 'dns_name', 'dhcp_name', 'netbios_name', 'vendor', 'software', 'x', 'y'],
      rows: [['oid:1', 'dc1', '10.0.0.10', '', 'domain_controller', '10', 'true', '1', '', 'Internal', 'vlan:10', 'dc1.acme.lab', '', 'DC1', 'VMware', 'Windows Server 2019', '0', '0']],
    },
  });
  const { device } = await readNode(c, 'g', { snapshotId: 's1', key: 'oid:1' });
  assert.equal(device.dns_name, 'dc1.acme.lab');
  assert.equal(device.netbios_name, 'DC1');
  assert.equal(device.vendor, 'VMware');
  assert.equal(device.software, 'Windows Server 2019');
});

test('readIdentities groups a principal seen on many hosts into one row, most-connected first', async () => {
  const c = fakeClient({
    'AUTHENTICATED_AS': {
      columns: ['name', 'principal', 'device_key', 'device_name', 'device_ip', 'device_role', 'device_locality'],
      rows: [
        ['sean@ACME', 'sean@ACME', 'oid:1', 'dc1', '10.0.0.10', 'domain_controller', 'Internal'],
        ['sean@ACME', 'sean@ACME', 'oid:2', 'pc1', '10.0.0.50', 'pc', 'Internal'],
        ['svc@ACME', 'svc@ACME', 'oid:1', 'dc1', '10.0.0.10', 'domain_controller', 'Internal'],
      ],
    },
  });
  const out = await readIdentities(c, 'g', { snapshotId: 's1' });
  assert.equal(out.length, 2, 'two distinct principals');
  assert.equal(out[0].name, 'sean@ACME', 'the account on more hosts sorts first');
  assert.equal(out[0].devices.length, 2);
  assert.deepEqual(out[0].devices.map((d) => d.key), ['oid:1', 'oid:2'], 'all its hosts, once each');
  assert.equal(out[1].devices.length, 1);
  assert.match(c.queries[0].cypher, /u\.snapshot_id = 's1'/, 'scoped to the snapshot');
});

test('deleteSnapshot removes every label plus the header', async () => {
  const c = fakeClient();
  await deleteSnapshot(c, 'g', 's1');
  const all = c.mutations.map((m) => m.cypher).join('\n');
  for (const label of ['TopoDevice', 'TopoRole', 'TopoSegment', 'TopoLocality', 'TopoIdentity']) {
    assert.match(all, new RegExp(`MATCH \\(n:${label} \\{snapshot_id: 's1'\\}\\) DETACH DELETE n`));
  }
  assert.match(all, /MATCH \(s:TopoSnapshot \{id: 's1'\}\) DELETE s/);
  // Enrichments are durable — pruning a snapshot must never delete them.
  assert.doesNotMatch(all, /TopoEnrichment/, 'deleteSnapshot leaves enrichments alone');
});

test('writeEnrichments MERGEs by device+label, carries no snapshot_id, and escapes', async () => {
  const c = fakeClient();
  const n = await writeEnrichments(c, 'g', [
    { device_key: 'oid:1', label: 'ports', value: '445/tcp, 3389/tcp', collected_at: '2026-08-03T00:00:00Z' },
    { device_key: "oid:2') DETACH DELETE (x) //", label: 'dns', value: 'example.com' },
    { label: 'no-key-dropped', value: 'x' }, // missing device_key → skipped
  ]);
  assert.equal(n, 2, 'the entry with no device_key is dropped');
  const all = c.mutations.map((m) => m.cypher).join('\n');
  assert.match(all, /MERGE \(n:TopoEnrichment \{device_key: 'oid:1', label: 'ports'\}\)/, 'idempotent on device+label');
  assert.doesNotMatch(all, /snapshot_id/, 'enrichments are snapshot-independent (durable)');
  assert.ok(!/[^\\]'\) DETACH/.test(all), 'a hostile device_key cannot break out of the literal');
});

test('readEnrichments scopes to the device and readNode includes them', async () => {
  const c = fakeClient({
    'MATCH (n:TopoEnrichment {device_key:': {
      columns: ['label', 'value', 'collected_at'],
      rows: [['ports', '445/tcp', '2026-08-03T00:00:00Z']],
    },
  });
  const list = await readEnrichments(c, 'g', 'oid:1');
  assert.match(c.queries[0].cypher, /device_key: 'oid:1'/);
  assert.equal(list[0].label, 'ports');

  // readNode joins them into the device detail.
  c.queries.length = 0;
  const withDevice = fakeClient({
    'MATCH (d:TopoDevice {snapshot_id:': { columns: ['key', 'name'], rows: [['oid:1', 'dc1']] },
    'MATCH (n:TopoEnrichment {device_key:': { columns: ['label', 'value', 'collected_at'], rows: [['ports', '445/tcp', 't']] },
  });
  const node = await readNode(withDevice, 'g', { snapshotId: 's1', key: 'oid:1' });
  assert.equal(node.enrichments[0].label, 'ports', 'device detail carries enrichments');
});


// ---- mixed-resolution reads (zone view) --------------------------------------
// Cypher shape only; the queries themselves were exercised against a live FalkorDB
// when they were written, including that the zero-expansion case emits the same
// aggregation as the plain segment tier.

/** A client that answers device/segment/edge reads with distinguishable rows. */
function zoneClient() {
  const queries = [];
  return {
    queries,
    async mutate() { return { columns: [], rows: [] }; },
    async query(graph, cypher) {
      queries.push(cypher);
      if (cypher.includes(':TopoDevice)') && cypher.includes('n.ip AS ip')) {
        return { columns: ['key', 'name', 'segment'], rows: [['d1', 'nas', 'vlan:20']] };
      }
      if (cypher.includes(':TopoSegment)')) {
        return { columns: ['key', 'name', 'device_count'], rows: [['vlan:30', 'vlan:30', 82]] };
      }
      return { columns: [], rows: [] };
    },
  };
}

test('readMixedTier stamps each node with the resolution it is drawn at', async () => {
  const c = zoneClient();
  const out = await readMixedTier(c, 'g', { snapshotId: 's1', expanded: ['vlan:20'] });
  assert.deepEqual(out.nodes.map((n) => [n.key, n.tier]), [['d1', 'device'], ['vlan:30', 'segment']]);
  assert.equal(out.mixed, true);
  assert.deepEqual(out.expanded, ['vlan:20']);
  assert.equal(out.zoom, 1, 'a zone view is the segment tier with holes punched in it');
});

test('readMixedTier resolves each edge endpoint at its own resolution', async () => {
  const c = zoneClient();
  await readMixedTier(c, 'g', { snapshotId: 's1', expanded: ['vlan:20'] });
  const edgeQuery = c.queries.find((q) => q.includes('TALKS_TO'));
  // An endpoint inside an opened segment resolves to the device; otherwise to the segment.
  assert.match(edgeQuery, /CASE WHEN a\.segment IN \['vlan:20'\] THEN a\.key ELSE a\.segment END AS src/);
  assert.match(edgeQuery, /CASE WHEN b\.segment IN \['vlan:20'\] THEN b\.key ELSE b\.segment END AS dst/);
  // Traffic wholly inside one collapsed segment folds to a self-pair and drops.
  assert.match(edgeQuery, /WHERE src <> dst/);
});

test('with nothing expanded the zone view is exactly the segment tier', async () => {
  const c = zoneClient();
  const out = await readMixedTier(c, 'g', { snapshotId: 's1', expanded: [] });
  const edgeQuery = c.queries.find((q) => q.includes('TALKS_TO'));
  assert.doesNotMatch(edgeQuery, /CASE WHEN/, 'no expansion, no per-endpoint branching');
  assert.match(edgeQuery, /WITH a\.segment AS src, b\.segment AS dst/);
  assert.ok(out.nodes.every((n) => n.tier === 'segment'));
  assert.ok(!c.queries.some((q) => q.includes('n.ip AS ip')), 'no device read when nothing is open');
});

test('readMixedTier bounds and de-duplicates the expansion set', async () => {
  const c = zoneClient();
  const many = Array.from({ length: 80 }, (_, i) => `vlan:${i}`);
  const out = await readMixedTier(c, 'g', { snapshotId: 's1', expanded: [...many, 'vlan:1', '', null] });
  assert.equal(out.expanded.length, 50, 'an unbounded expansion set is an unbounded query');
  assert.equal(new Set(out.expanded).size, 50, 'de-duplicated');
  assert.ok(!out.expanded.includes(''), 'empty keys dropped');
});

test('readMixedTier hides External unless asked, on both node reads and edges', async () => {
  const hidden = zoneClient();
  await readMixedTier(hidden, 'g', { snapshotId: 's1', expanded: ['vlan:20'] });
  assert.ok(hidden.queries.every((q) => q.includes("<> 'External'")), 'every read filters External');

  const shown = zoneClient();
  await readMixedTier(shown, 'g', { snapshotId: 's1', expanded: ['vlan:20'], external: true });
  assert.ok(shown.queries.every((q) => !q.includes("<> 'External'")), 'external=1 opts it back in');
});

test('readMixedTier escapes expansion keys into Cypher', async () => {
  const c = zoneClient();
  await readMixedTier(c, 'g', { snapshotId: 's1', expanded: ["vlan:20' OR '1'='1"] });
  assert.ok(c.queries.every((q) => !q.includes("OR '1'='1'")), 'no unescaped break-out');
});

test('readMixedTier stays read-only', async () => {
  const c = zoneClient();
  await readMixedTier(c, 'g', { snapshotId: 's1', expanded: ['vlan:20'] });
  for (const q of c.queries) {
    assert.doesNotMatch(q, /\b(CREATE|MERGE|DELETE|SET|REMOVE)\b/, `read path emitted a write: ${q}`);
  }
});
