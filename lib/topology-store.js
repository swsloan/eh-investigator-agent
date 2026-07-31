// Topology persistence: the structured write + read path for the network map.
//
// Writes to a SIBLING FalkorDB graph (`<group>topology`), never into the
// investigation-memory graph. An inventory of thousands of devices in the memory
// graph would swamp overview() counts, the untyped-drift detector, and the
// deliberately-bounded ego-network panel, and every query in lib/memory-graph.js
// would need a topology exclusion clause. Keeping them apart means the memory
// surface is untouched by this feature. See docs/DESIGN-network-topology.md.
//
// Unlike memory (written by the agent through Graphiti's LLM extraction), topology
// is written by the SERVER from already-structured data — so byte counts, IDs, and
// coordinates survive losslessly. Writes go through client.mutate() (GRAPH.QUERY);
// every read stays on client.query() (GRAPH.RO_QUERY).

import { cypherStr } from './falkor-client.js';

// Labels are interpolated into Cypher (FalkorDB cannot parameterize a label), so
// they MUST come from this fixed whitelist — never from user or agent input. Same
// injection boundary rule as ONTOLOGY_TYPES in lib/memory-graph.js.
export const TOPO_LABELS = ['TopoDevice', 'TopoRole', 'TopoSegment', 'TopoLocality', 'TopoIdentity', 'TopoSnapshot'];

// Rows per write statement. FalkorDB takes one Cypher string per command and the
// client has a fixed timeout, so a 5k-device snapshot is committed in chunks
// rather than as one enormous statement.
const CHUNK = 200;

/**
 * The topology graph name for a memory group. Sanitized the same way group ids are
 * (lowercase alphanumeric) so it is a safe Redis key and matches the convention in
 * lib/settings.js#sanitizeGroupId.
 */
export function topologyGraphName(group) {
  const base = String(group || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  return `${base || 'ehdefault'}topology`;
}

function assertLabel(label) {
  if (!TOPO_LABELS.includes(label)) throw new Error(`refusing to use a non-whitelisted topology label: ${label}`);
  return label;
}

/** Numeric literal for Cypher; non-finite input becomes 0 rather than `NaN`/injection. */
function numLit(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function boolLit(v) {
  return v ? 'true' : 'false';
}

/** A Cypher list literal of escaped strings. */
function listLit(values = []) {
  return `[${(Array.isArray(values) ? values : []).map((v) => cypherStr(v)).join(', ')}]`;
}

function chunk(arr, size = CHUNK) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/* ------------------------------------------------------------------ writes */

/**
 * Persist one snapshot: nodes, aggregate tiers, edges, identities, and the
 * snapshot header. Every element carries `snapshot_id`, so snapshots coexist in
 * one graph and Slice D can diff two of them without a second store.
 *
 * @param {object} client   createFalkorClient()
 * @param {string} group    memory group (the topology graph name is derived)
 * @param {object} snapshot output of topology-model.normalize()
 * @param {object} layout   output of topology-layout.layoutSnapshot()
 */
export async function writeSnapshot(client, group, { snapshot, nodes, edges, identities, tiers }, layout) {
  const graph = topologyGraphName(group);
  const sid = snapshot.id;
  const sidLit = cypherStr(sid);
  const pos = (bucket, key) => layout?.[bucket]?.[key] || { x: 0, y: 0 };

  // Snapshot header first: if ingest dies partway, the header's `complete` flag
  // stays false and readers can tell a partial snapshot from a finished one.
  await client.mutate(graph, [
    `MERGE (s:${assertLabel('TopoSnapshot')} {id: ${sidLit}})`,
    `SET s.group = ${cypherStr(snapshot.group)},`,
    `    s.collected_at = ${cypherStr(snapshot.collected_at)},`,
    `    s.window = ${cypherStr(snapshot.window)},`,
    `    s.tiers = ${listLit(snapshot.tiers)},`,
    `    s.device_count = ${numLit(snapshot.device_count)},`,
    `    s.edge_count = ${numLit(snapshot.edge_count)},`,
    `    s.identity_count = ${numLit(snapshot.identity_count)},`,
    `    s.truncated = ${boolLit(snapshot.truncated)},`,
    `    s.complete = false`,
  ].join('\n'));

  for (const part of chunk(nodes)) {
    const rows = part.map((n) => {
      const p = pos('devices', n.key);
      return `(:${assertLabel('TopoDevice')} {`
        + `snapshot_id: ${sidLit}, key: ${cypherStr(n.key)}, name: ${cypherStr(n.name)}, `
        + `ip: ${cypherStr(n.ip)}, mac: ${cypherStr(n.mac)}, role: ${cypherStr(n.role)}, `
        + `vlan: ${cypherStr(n.vlan)}, tags: ${listLit(n.tags)}, critical: ${boolLit(n.critical)}, `
        + `oid: ${cypherStr(n.oid)}, discovery_id: ${cypherStr(n.discovery_id)}, `
        + `locality: ${cypherStr(n.locality)}, segment: ${cypherStr(n.segment)}, role_key: ${cypherStr(n.roleKey)}, `
        + `x: ${numLit(p.x)}, y: ${numLit(p.y)}})`;
    });
    await client.mutate(graph, `CREATE ${rows.join(', ')}`);
  }

  const tierSpec = [
    ['TopoRole', tiers.roles, 'roles'],
    ['TopoSegment', tiers.segments, 'segments'],
    ['TopoLocality', tiers.localities, 'localities'],
  ];
  for (const [label, items, bucket] of tierSpec) {
    for (const part of chunk(items)) {
      const rows = part.map((t) => {
        const p = pos(bucket, t.key);
        return `(:${assertLabel(label)} {`
          + `snapshot_id: ${sidLit}, key: ${cypherStr(t.key)}, name: ${cypherStr(t.name)}, `
          + `parent: ${cypherStr(t.segment || t.locality || '')}, device_count: ${numLit(t.device_count)}, `
          + `x: ${numLit(p.x)}, y: ${numLit(p.y)}})`;
      });
      await client.mutate(graph, `CREATE ${rows.join(', ')}`);
    }
  }

  for (const part of chunk(edges)) {
    // MATCH both endpoints within this snapshot, then create the conversation.
    const stmts = part.map((e) => (
      `MATCH (a:TopoDevice {snapshot_id: ${sidLit}, key: ${cypherStr(e.src)}}), `
      + `(b:TopoDevice {snapshot_id: ${sidLit}, key: ${cypherStr(e.dst)}}) `
      + `CREATE (a)-[:TALKS_TO {snapshot_id: ${sidLit}, bytes_out: ${numLit(e.bytes_out)}, `
      + `bytes_in: ${numLit(e.bytes_in)}, bytes_total: ${numLit(e.bytes_total)}, `
      + `protocols: ${listLit(e.protocols)}, first_seen: ${cypherStr(e.first_seen)}, `
      + `last_seen: ${cypherStr(e.last_seen)}}]->(b)`
    ));
    // One statement per edge (Cypher can't batch independent MATCH/CREATE pairs in
    // a single query without UNWIND, which needs parameters this client doesn't send).
    for (const s of stmts) await client.mutate(graph, s);
  }

  for (const part of chunk(identities)) {
    const rows = part.map((i) => (
      `(:${assertLabel('TopoIdentity')} {snapshot_id: ${sidLit}, key: ${cypherStr(i.key)}, `
      + `name: ${cypherStr(i.name)}, principal: ${cypherStr(i.principal)}})`
    ));
    await client.mutate(graph, `CREATE ${rows.join(', ')}`);
    for (const i of part) {
      for (const dev of i.devices) {
        await client.mutate(graph,
          `MATCH (d:TopoDevice {snapshot_id: ${sidLit}, key: ${cypherStr(dev)}}), `
          + `(u:TopoIdentity {snapshot_id: ${sidLit}, key: ${cypherStr(i.key)}}) `
          + `CREATE (d)-[:AUTHENTICATED_AS {snapshot_id: ${sidLit}}]->(u)`);
      }
    }
  }

  await client.mutate(graph, `MATCH (s:TopoSnapshot {id: ${sidLit}}) SET s.complete = true`);
  return { graph, snapshot_id: sid, nodes: nodes.length, edges: edges.length, identities: identities.length };
}

/** Delete one snapshot and everything belonging to it (used by retention/rollback). */
export async function deleteSnapshot(client, group, snapshotId) {
  const graph = topologyGraphName(group);
  const sid = cypherStr(snapshotId);
  for (const label of ['TopoDevice', 'TopoRole', 'TopoSegment', 'TopoLocality', 'TopoIdentity']) {
    await client.mutate(graph, `MATCH (n:${assertLabel(label)} {snapshot_id: ${sid}}) DETACH DELETE n`);
  }
  await client.mutate(graph, `MATCH (s:${assertLabel('TopoSnapshot')} {id: ${sid}}) DELETE s`);
}

/* ------------------------------------------------------------------- reads */

// FalkorDB's non-compact reply serializes booleans and aggregate numbers as
// STRINGS ("true", "1000"), so a naive read hands the renderer `"1000"` to do math
// on and a truthy `"false"`. Coerce the fields we know the types of, at the one
// place every read passes through.
const NUMERIC_FIELDS = new Set(['x', 'y', 'bytes', 'bytes_in', 'bytes_out', 'bytes_total', 'links', 'device_count', 'edge_count', 'identity_count']);
const BOOLEAN_FIELDS = new Set(['critical', 'truncated', 'complete']);

function coerce(field, value) {
  if (value === null || value === undefined) return value;
  if (NUMERIC_FIELDS.has(field)) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  if (BOOLEAN_FIELDS.has(field)) return value === true || value === 'true';
  return value;
}

function toObjects({ columns, rows }) {
  return rows.map((row) => {
    const o = {};
    columns.forEach((c, i) => { o[c] = coerce(c, row[i]); });
    return o;
  });
}

/** Completed snapshots, newest first. */
export async function listSnapshots(client, group, limit = 20) {
  const graph = topologyGraphName(group);
  const n = Math.max(1, Math.min(100, Number(limit) || 20));
  const res = await client.query(graph,
    `MATCH (s:TopoSnapshot) WHERE s.complete = true `
    + `RETURN s.id AS id, s.collected_at AS collected_at, s.window AS window, `
    + `s.device_count AS device_count, s.edge_count AS edge_count, s.truncated AS truncated `
    + `ORDER BY s.collected_at DESC LIMIT ${n}`);
  return toObjects(res);
}

/** The newest completed snapshot id, or '' when the graph has none. */
export async function latestSnapshotId(client, group) {
  const [first] = await listSnapshots(client, group, 1);
  return first?.id || '';
}

// Which label + parent field each zoom tier reads from, and — for the edge rollup,
// which always matches on TopoDevice — the device property that corresponds to that
// tier's parent scope. Without the edge scope, drilling into a cluster returns every
// edge in the snapshot: the renderer drops the ones whose endpoints aren't drawn, but
// the count shown to the user is wrong and the payload is far larger than needed.
const TIER_QUERY = {
  0: { label: 'TopoLocality', parent: null, edgeScope: null },
  1: { label: 'TopoSegment', parent: 'parent', edgeScope: 'locality' },
  2: { label: 'TopoRole', parent: 'parent', edgeScope: 'segment' },
  3: { label: 'TopoDevice', parent: 'role_key', edgeScope: 'role_key' },
};

/**
 * One zoom tier of a snapshot, optionally scoped to a parent cluster (drill-down).
 * Aggregation happens here rather than in the browser, so the wire payload stays
 * bounded no matter how large the estate is.
 */
export async function readTier(client, group, { snapshotId, zoom = 0, parent = '', keys = null, limit = 2000 } = {}) {
  const graph = topologyGraphName(group);
  const tier = TIER_QUERY[Math.max(0, Math.min(3, Number(zoom) || 0))];
  const n = Math.max(1, Math.min(5000, Number(limit) || 2000));
  const sid = cypherStr(snapshotId);

  // An explicit key set is how the attack overlay asks for "just these devices":
  // the incident's actors may span several clusters, so neither a parent scope nor a
  // whole tier is the right view. Bounded like every other read.
  const keyList = Array.isArray(keys) ? keys.filter(Boolean).slice(0, 500) : null;
  const scope = keyList?.length
    ? ` AND n.key IN [${keyList.map((k) => cypherStr(k)).join(', ')}]`
    : (parent && tier.parent ? ` AND n.${tier.parent} = ${cypherStr(parent)}` : '');
  // Devices carry their full tier coordinates (locality/segment/role_key) so the
  // attack overlay can lift a device-level actor up to whatever the current zoom
  // actually draws, without a second round-trip.
  const extra = tier.label === 'TopoDevice'
    ? `, n.ip AS ip, n.role AS role, n.vlan AS vlan, n.critical AS critical, n.locality AS locality, `
      + `n.segment AS segment, n.role_key AS role_key, n.oid AS oid, n.discovery_id AS discovery_id`
    : `, n.device_count AS device_count, n.parent AS parent`;
  const nodes = toObjects(await client.query(graph,
    `MATCH (n:${assertLabel(tier.label)}) WHERE n.snapshot_id = ${sid}${scope} `
    + `RETURN n.key AS key, n.name AS name, n.x AS x, n.y AS y${extra} LIMIT ${n}`));

  // Edges only exist between devices; aggregate tiers roll them up by member. When
  // scoped to a parent, BOTH endpoints must be inside that scope — otherwise we ship
  // (and mis-count) edges to nodes this view doesn't draw.
  const groupBy = { 0: 'locality', 1: 'segment', 2: 'role_key', 3: 'key' }[Number(zoom) || 0];
  const edgeScope = keyList?.length
    ? ` AND a.key IN [${keyList.map((k) => cypherStr(k)).join(', ')}] AND b.key IN [${keyList.map((k) => cypherStr(k)).join(', ')}]`
    : (parent && tier.edgeScope
      ? ` AND a.${tier.edgeScope} = ${cypherStr(parent)} AND b.${tier.edgeScope} = ${cypherStr(parent)}`
      : '');
  const edges = toObjects(await client.query(graph,
    `MATCH (a:TopoDevice)-[r:TALKS_TO]->(b:TopoDevice) WHERE r.snapshot_id = ${sid}${edgeScope} `
    + `WITH a.${groupBy} AS src, b.${groupBy} AS dst, sum(r.bytes_total) AS bytes, count(r) AS links `
    + `WHERE src <> dst RETURN src, dst, bytes, links ORDER BY bytes DESC LIMIT ${n}`));

  return { nodes, edges, zoom: Number(zoom) || 0, parent, snapshot_id: snapshotId };
}

/**
 * Everything needed to diff one snapshot against another (Slice D): its devices with
 * the attributes drift compares, its conversations, and its identity bindings.
 * Separate from readTier because drift needs the whole snapshot at device
 * granularity, not one bounded zoom tier.
 */
export async function readSnapshotForDiff(client, group, snapshotId, { limit = 20000 } = {}) {
  const graph = topologyGraphName(group);
  const sid = cypherStr(snapshotId);
  const n = Math.max(1, Math.min(50000, Number(limit) || 20000));

  const devices = toObjects(await client.query(graph,
    `MATCH (d:${assertLabel('TopoDevice')} {snapshot_id: ${sid}}) `
    + `RETURN d.key AS key, d.name AS name, d.ip AS ip, d.role AS role, d.vlan AS vlan, `
    + `d.critical AS critical, d.segment AS segment, d.locality AS locality LIMIT ${n}`));

  const edges = toObjects(await client.query(graph,
    `MATCH (a:TopoDevice)-[r:TALKS_TO]->(b:TopoDevice) WHERE r.snapshot_id = ${sid} `
    + `RETURN a.key AS src, b.key AS dst, r.bytes_total AS bytes_total LIMIT ${n}`));

  const identityRows = toObjects(await client.query(graph,
    `MATCH (d:TopoDevice)-[:AUTHENTICATED_AS]->(u:${assertLabel('TopoIdentity')}) `
    + `WHERE u.snapshot_id = ${sid} RETURN u.name AS name, d.key AS device LIMIT ${n}`));
  const byIdentity = new Map();
  for (const row of identityRows) {
    if (!byIdentity.has(row.name)) byIdentity.set(row.name, { name: row.name, devices: [] });
    byIdentity.get(row.name).devices.push(row.device);
  }

  return { snapshotId, devices, edges, identities: [...byIdentity.values()] };
}

/** Full detail for one device, including its identities and top conversations. */
export async function readNode(client, group, { snapshotId, key, limit = 50 } = {}) {
  const graph = topologyGraphName(group);
  const sid = cypherStr(snapshotId);
  const k = cypherStr(key);
  const n = Math.max(1, Math.min(500, Number(limit) || 50));
  const [device] = toObjects(await client.query(graph,
    `MATCH (d:TopoDevice {snapshot_id: ${sid}, key: ${k}}) `
    + `RETURN d.key AS key, d.name AS name, d.ip AS ip, d.mac AS mac, d.role AS role, d.vlan AS vlan, `
    + `d.critical AS critical, d.oid AS oid, d.discovery_id AS discovery_id, d.locality AS locality, `
    + `d.segment AS segment, d.x AS x, d.y AS y LIMIT 1`));
  if (!device) return null;
  const peers = toObjects(await client.query(graph,
    `MATCH (d:TopoDevice {snapshot_id: ${sid}, key: ${k}})-[r:TALKS_TO]-(p:TopoDevice) `
    + `RETURN p.key AS key, p.name AS name, p.ip AS ip, p.role AS role, r.bytes_total AS bytes, `
    + `r.protocols AS protocols ORDER BY r.bytes_total DESC LIMIT ${n}`));
  const identities = toObjects(await client.query(graph,
    `MATCH (d:TopoDevice {snapshot_id: ${sid}, key: ${k}})-[:AUTHENTICATED_AS]->(u:TopoIdentity) `
    + `RETURN u.name AS name, u.principal AS principal LIMIT ${n}`));
  return { device, peers, identities };
}
