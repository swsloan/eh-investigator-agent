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
export const TOPO_LABELS = ['TopoDevice', 'TopoRole', 'TopoSegment', 'TopoLocality', 'TopoIdentity', 'TopoSnapshot', 'TopoEnrichment'];

const trim = (v) => (v == null ? '' : String(v).trim());

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
        // Richer inventory fields (Slice 2). Stored verbatim (escaped); absent ones
        // are empty strings and simply don't render in the detail panel.
        + `dns_name: ${cypherStr(n.dns_name)}, dhcp_name: ${cypherStr(n.dhcp_name)}, `
        + `netbios_name: ${cypherStr(n.netbios_name)}, vendor: ${cypherStr(n.vendor)}, software: ${cypherStr(n.software)}, `
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
          // Persist the locality on every aggregate tier too, so the "internal only"
          // filter (readTier) can exclude External clusters at any zoom, not just at
          // the device tier. Localities filter on their own key, so theirs is ''.
          + `locality: ${cypherStr(t.locality || '')}, `
          // Dominant device role, so the renderer can colour a segment by the kind of
          // devices it mostly holds (server subnet vs workstation subnet).
          + `role: ${cypherStr(t.role || '')}, `
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
const NUMERIC_FIELDS = new Set(['x', 'y', 'bytes', 'bytes_in', 'bytes_out', 'bytes_total', 'links', 'device_count', 'edge_count', 'identity_count', 'peer_count']);
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

// Device fields a device-tier drill may be scoped by. Generalized so a segment can
// drill STRAIGHT to its devices (`scope='segment'`) without the intermediate Role hop
// that collapses to a single meaningless "other" node when roles are unknown. Only
// these three are returned by the device query, so a neighbor lift can read them.
const SCOPE_FIELDS = new Set(['segment', 'role_key', 'locality']);

/** FalkorDB coerces booleans/numbers to strings on prefixed columns too; do it by hand. */
const numOf = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const boolOf = (v) => v === true || v === 'true';

/**
 * The "hide External" clause for a tier, null-safe so snapshots written before
 * `locality` was stored on aggregate nodes still render (their locality reads NULL,
 * which must not be treated as External). Localities filter on their own key/name.
 */
function externalClause(zoom, alias = 'n') {
  if (zoom === 0) return ` AND ${alias}.key <> 'External'`;
  return ` AND (${alias}.locality IS NULL OR ${alias}.locality <> 'External')`;
}

/**
 * One zoom tier of a snapshot, optionally scoped to a parent cluster (drill-down).
 * Aggregation happens here rather than in the browser, so the wire payload stays
 * bounded no matter how large the estate is.
 *
 * @param {string}  [opts.scope]      device field the `parent` matches on at zoom 3
 *                                    (`segment` | `role_key` | `locality`); lets a
 *                                    segment drill straight to devices.
 * @param {boolean} [opts.external]   include External-locality nodes (default: hidden).
 * @param {boolean} [opts.neighbors]  at a scoped device tier, also return one-hop peers
 *                                    OUTSIDE the scope + every edge touching it, so
 *                                    cross-boundary dependencies are visible.
 */
export async function readTier(client, group, { snapshotId, zoom = 0, parent = '', scope = '', keys = null, external = false, neighbors = false, limit = 2000 } = {}) {
  const graph = topologyGraphName(group);
  const z = Math.max(0, Math.min(3, Number(zoom) || 0));
  const tier = TIER_QUERY[z];
  const n = Math.max(1, Math.min(5000, Number(limit) || 2000));
  const sid = cypherStr(snapshotId);
  const showExternal = Boolean(external);

  // An explicit key set is how the attack overlay asks for "just these devices":
  // the incident's actors may span several clusters, so neither a parent scope nor a
  // whole tier is the right view. Bounded like every other read. A key set is honored
  // verbatim — including External devices — since the caller named them.
  const keyList = Array.isArray(keys) ? keys.filter(Boolean).slice(0, 500) : null;

  // At the device tier, `scope` picks which field `parent` matches on. Elsewhere it is
  // the stored `parent` column of the aggregate node.
  const scopeField = z === 3 && SCOPE_FIELDS.has(String(scope)) ? String(scope) : tier.parent;

  // Neighbor mode only makes sense for a scoped device view.
  if (neighbors && z === 3 && parent && scopeField && !keyList?.length) {
    return readDeviceScopeWithNeighbors(client, graph, { sid, parent, scopeField, showExternal, limit: n, snapshotId, zoom: z });
  }

  const nodeScope = keyList?.length
    ? ` AND n.key IN [${keyList.map((k) => cypherStr(k)).join(', ')}]`
    : (parent && scopeField ? ` AND n.${scopeField} = ${cypherStr(parent)}` : '');
  const nodeExt = (!showExternal && !keyList?.length) ? externalClause(z) : '';
  // Devices carry their full tier coordinates (locality/segment/role_key) so the
  // attack overlay can lift a device-level actor up to whatever the current zoom
  // actually draws, without a second round-trip.
  const extra = tier.label === 'TopoDevice'
    ? `, n.ip AS ip, n.role AS role, n.vlan AS vlan, n.critical AS critical, n.locality AS locality, `
      + `n.segment AS segment, n.role_key AS role_key, n.oid AS oid, n.discovery_id AS discovery_id`
    : `, n.device_count AS device_count, n.parent AS parent, n.role AS role`;
  const nodes = toObjects(await client.query(graph,
    `MATCH (n:${assertLabel(tier.label)}) WHERE n.snapshot_id = ${sid}${nodeScope}${nodeExt} `
    + `RETURN n.key AS key, n.name AS name, n.x AS x, n.y AS y${extra} LIMIT ${n}`));

  // Edges only exist between devices; aggregate tiers roll them up by member. When
  // scoped to a parent, BOTH endpoints must be inside that scope — otherwise we ship
  // (and mis-count) edges to nodes this view doesn't draw.
  const groupBy = { 0: 'locality', 1: 'segment', 2: 'role_key', 3: 'key' }[z];
  const edgeScopeField = z === 3 ? scopeField : tier.edgeScope;
  const edgeScope = keyList?.length
    ? ` AND a.key IN [${keyList.map((k) => cypherStr(k)).join(', ')}] AND b.key IN [${keyList.map((k) => cypherStr(k)).join(', ')}]`
    : (parent && edgeScopeField
      ? ` AND a.${edgeScopeField} = ${cypherStr(parent)} AND b.${edgeScopeField} = ${cypherStr(parent)}`
      : '');
  const edgeExt = (!showExternal && !keyList?.length)
    ? ` AND (a.locality IS NULL OR a.locality <> 'External') AND (b.locality IS NULL OR b.locality <> 'External')`
    : '';
  const edges = toObjects(await client.query(graph,
    `MATCH (a:TopoDevice)-[r:TALKS_TO]->(b:TopoDevice) WHERE r.snapshot_id = ${sid}${edgeScope}${edgeExt} `
    + `WITH a.${groupBy} AS src, b.${groupBy} AS dst, sum(r.bytes_total) AS bytes, count(r) AS links `
    + `WHERE src <> dst RETURN src, dst, bytes, links ORDER BY bytes DESC LIMIT ${n}`));

  return { nodes, edges, zoom: z, parent, snapshot_id: snapshotId };
}

/**
 * Segments, with some of them opened up.
 *
 * The camera-tier map could only ever draw one resolution at a time, so "expand this
 * segment and leave the rest alone" had no representation: not in the payload, not in
 * the renderer. This returns both at once — devices for the expanded segments,
 * aggregate nodes for the rest — with every node stamped `tier` so the client can
 * size, colour and label it for what it actually is.
 *
 * Edges are rolled up per endpoint rather than per query. Each end of a conversation
 * resolves to a device key when its segment is open and to the segment key when it is
 * not, so a device can be drawn talking to a collapsed neighbour. Traffic wholly
 * inside one collapsed segment folds to a self-pair and drops out, which is correct:
 * it is internal to the node that represents it.
 */
export async function readMixedTier(client, group, {
  snapshotId, expanded = [], external = false, limit = 2000,
} = {}) {
  const graph = topologyGraphName(group);
  const n = Math.max(1, Math.min(5000, Number(limit) || 2000));
  const sid = cypherStr(snapshotId);
  const showExternal = Boolean(external);
  // Bounded like every other read: an unbounded expansion set is an unbounded query.
  const open = [...new Set((Array.isArray(expanded) ? expanded : []).filter(Boolean))].slice(0, 50);
  const openList = listLit(open);

  const deviceExt = showExternal ? '' : externalClause(3);
  const segmentExt = showExternal ? '' : externalClause(1);

  // Devices of the opened segments.
  const devices = open.length ? toObjects(await client.query(graph,
    `MATCH (n:TopoDevice) WHERE n.snapshot_id = ${sid} AND n.segment IN ${openList}${deviceExt} `
    + `RETURN n.key AS key, n.name AS name, n.x AS x, n.y AS y, n.ip AS ip, n.role AS role, `
    + `n.vlan AS vlan, n.critical AS critical, n.locality AS locality, n.segment AS segment, `
    + `n.role_key AS role_key, n.oid AS oid, n.discovery_id AS discovery_id LIMIT ${n}`)) : [];

  // Every other segment, still collapsed.
  const notOpen = open.length ? ` AND NOT n.key IN ${openList}` : '';
  const segments = toObjects(await client.query(graph,
    `MATCH (n:TopoSegment) WHERE n.snapshot_id = ${sid}${notOpen}${segmentExt} `
    + `RETURN n.key AS key, n.name AS name, n.x AS x, n.y AS y, `
    + `n.device_count AS device_count, n.parent AS parent, n.role AS role LIMIT ${n}`));

  const edgeExt = showExternal ? ''
    : ` AND (a.locality IS NULL OR a.locality <> 'External') AND (b.locality IS NULL OR b.locality <> 'External')`;
  const endpoint = (alias) => (open.length
    ? `CASE WHEN ${alias}.segment IN ${openList} THEN ${alias}.key ELSE ${alias}.segment END`
    : `${alias}.segment`);
  const edges = toObjects(await client.query(graph,
    `MATCH (a:TopoDevice)-[r:TALKS_TO]->(b:TopoDevice) WHERE r.snapshot_id = ${sid}${edgeExt} `
    + `WITH ${endpoint('a')} AS src, ${endpoint('b')} AS dst, r `
    + `WITH src, dst, sum(r.bytes_total) AS bytes, count(r) AS links `
    + `WHERE src <> dst RETURN src, dst, bytes, links ORDER BY bytes DESC LIMIT ${n}`));

  return {
    nodes: [
      ...devices.map((d) => ({ ...d, tier: 'device' })),
      ...segments.map((s) => ({ ...s, tier: 'segment' })),
    ],
    edges,
    zoom: 1,
    parent: '',
    expanded: open,
    mixed: true,
    snapshot_id: snapshotId,
  };
}

/**
 * Device view scoped to `parent` (via `scopeField`) that ALSO pulls in each in-scope
 * device's one-hop peers outside the scope, plus every conversation touching the scope.
 * This is what makes a segment's devices show their real dependencies — to each other
 * and across the boundary — instead of rendering as isolated dots. Out-of-scope nodes
 * are flagged `neighbor: true` so the renderer can de-emphasize them.
 */
async function readDeviceScopeWithNeighbors(client, graph, { sid, parent, scopeField, showExternal, limit, snapshotId, zoom }) {
  const p = cypherStr(parent);
  const extA = showExternal ? '' : ` AND (a.locality IS NULL OR a.locality <> 'External')`;
  const extB = showExternal ? '' : ` AND (b.locality IS NULL OR b.locality <> 'External')`;
  const nExt = showExternal ? '' : ` AND (n.locality IS NULL OR n.locality <> 'External')`;

  // In-scope devices first, so an in-scope device with no significant traffic still
  // appears (it isn't dropped just because it has no edge).
  const inScope = toObjects(await client.query(graph,
    `MATCH (n:TopoDevice) WHERE n.snapshot_id = ${sid} AND n.${scopeField} = ${p}${nExt} `
    + `RETURN n.key AS key, n.name AS name, n.x AS x, n.y AS y, n.ip AS ip, n.role AS role, `
    + `n.vlan AS vlan, n.critical AS critical, n.locality AS locality, n.segment AS segment, `
    + `n.role_key AS role_key, n.oid AS oid, n.discovery_id AS discovery_id LIMIT ${limit}`));

  // Every conversation with at least one endpoint in the scope. Directed rows (one per
  // relationship). Both endpoints' attributes come back so a neighbor node needs no
  // extra round-trip.
  const rows = await client.query(graph,
    `MATCH (a:TopoDevice)-[r:TALKS_TO]->(b:TopoDevice) `
    + `WHERE r.snapshot_id = ${sid} AND (a.${scopeField} = ${p} OR b.${scopeField} = ${p})${extA}${extB} `
    + `RETURN a.key AS a_key, a.name AS a_name, a.x AS a_x, a.y AS a_y, a.role AS a_role, `
    + `a.critical AS a_critical, a.locality AS a_locality, a.segment AS a_segment, a.role_key AS a_role_key, `
    + `b.key AS b_key, b.name AS b_name, b.x AS b_x, b.y AS b_y, b.role AS b_role, `
    + `b.critical AS b_critical, b.locality AS b_locality, b.segment AS b_segment, b.role_key AS b_role_key, `
    + `r.bytes_total AS bytes ORDER BY r.bytes_total DESC LIMIT ${limit}`);

  const idx = Object.fromEntries(rows.columns.map((c, i) => [c, i]));
  const cell = (row, name) => row[idx[name]];
  const nodes = new Map();
  for (const d of inScope) nodes.set(d.key, { ...d, neighbor: false });

  const endpoint = (row, side) => {
    const key = cell(row, `${side}_key`);
    return {
      key,
      name: cell(row, `${side}_name`),
      x: numOf(cell(row, `${side}_x`)),
      y: numOf(cell(row, `${side}_y`)),
      role: cell(row, `${side}_role`),
      critical: boolOf(cell(row, `${side}_critical`)),
      locality: cell(row, `${side}_locality`),
      segment: cell(row, `${side}_segment`),
      role_key: cell(row, `${side}_role_key`),
      neighbor: cell(row, `${side}_${scopeField}`) !== parent,
    };
  };

  const edges = [];
  for (const row of rows.rows) {
    const a = endpoint(row, 'a');
    const b = endpoint(row, 'b');
    if (!nodes.has(a.key)) nodes.set(a.key, a);
    if (!nodes.has(b.key)) nodes.set(b.key, b);
    edges.push({ src: a.key, dst: b.key, bytes: numOf(cell(row, 'bytes')), links: 1 });
  }

  return { nodes: [...nodes.values()], edges, zoom, parent, snapshot_id: snapshotId, neighbors: true };
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

/**
 * Persist user-requested device enrichments (Slice 5). Keyed by device KEY with NO
 * snapshot_id, so they are durable: they survive snapshot pruning and re-apply to
 * whatever snapshot draws that device. MERGE on (device_key, label) so re-asking the
 * same question updates in place rather than piling up duplicates.
 */
export async function writeEnrichments(client, group, entries = []) {
  const graph = topologyGraphName(group);
  let written = 0;
  for (const e of Array.isArray(entries) ? entries : []) {
    const key = trim(e?.device_key ?? e?.key);
    const label = trim(e?.label);
    if (!key || !label) continue;
    await client.mutate(graph,
      `MERGE (n:${assertLabel('TopoEnrichment')} {device_key: ${cypherStr(key)}, label: ${cypherStr(label)}}) `
      + `SET n.value = ${cypherStr(trim(e?.value))}, n.collected_at = ${cypherStr(trim(e?.collected_at) || new Date().toISOString())}`);
    written++;
  }
  return written;
}

/** Enrichments recorded for one device, newest first. */
export async function readEnrichments(client, group, key, { limit = 50 } = {}) {
  const graph = topologyGraphName(group);
  const n = Math.max(1, Math.min(200, Number(limit) || 50));
  return toObjects(await client.query(graph,
    `MATCH (n:TopoEnrichment {device_key: ${cypherStr(key)}}) `
    + `RETURN n.label AS label, n.value AS value, n.collected_at AS collected_at `
    + `ORDER BY n.collected_at DESC LIMIT ${n}`));
}

/** Full detail for one device, including its identities and top conversations. */
// Which device field a matrix groups by, and the aggregate tier that names its axis.
// Interpolated into Cypher, so it is a whitelist, never caller input.
const MATRIX_GROUPS = {
  segment: 'TopoSegment',
  locality: 'TopoLocality',
  role_key: 'TopoRole',
};

/**
 * Who talks to whom, as a square of totals.
 *
 * A force graph stops being readable somewhere around a few hundred visible nodes;
 * a matrix does not care how many there are. The aggregation is the one the segment
 * tier already computes, with one deliberate difference: the diagonal is kept.
 * Intra-segment traffic is exactly what east-west lateral movement looks like, and
 * on a real estate it is routinely the largest cell there is — dropping it would
 * hide the biggest number on the map.
 *
 * Axes come from the aggregate nodes rather than from the cells, so a group with no
 * conversations still gets a row and a column instead of vanishing.
 */
export async function readMatrix(client, group, {
  snapshotId, groupBy = 'segment', external = false, limit = 2000,
} = {}) {
  const graph = topologyGraphName(group);
  const field = MATRIX_GROUPS[groupBy] ? groupBy : 'segment';
  const label = MATRIX_GROUPS[field];
  const n = Math.max(1, Math.min(5000, Number(limit) || 2000));
  const sid = cypherStr(snapshotId);
  const showExternal = Boolean(external);

  const axisExt = showExternal ? '' : externalClause(field === 'locality' ? 0 : 1);
  const axes = toObjects(await client.query(graph,
    `MATCH (n:${assertLabel(label)}) WHERE n.snapshot_id = ${sid}${axisExt} `
    + `RETURN n.key AS key, n.name AS name, n.device_count AS device_count, n.role AS role `
    + `ORDER BY n.device_count DESC LIMIT ${n}`));

  const cellExt = showExternal ? ''
    : ` AND (a.locality IS NULL OR a.locality <> 'External') AND (b.locality IS NULL OR b.locality <> 'External')`;
  const cells = toObjects(await client.query(graph,
    `MATCH (a:TopoDevice)-[r:TALKS_TO]->(b:TopoDevice) WHERE r.snapshot_id = ${sid}${cellExt} `
    + `WITH a.${field} AS src, b.${field} AS dst, sum(r.bytes_total) AS bytes, count(r) AS links `
    + `RETURN src, dst, bytes, links ORDER BY bytes DESC LIMIT ${n}`));

  return { groupBy: field, axes, cells, snapshot_id: snapshotId };
}

/** The device conversations behind one matrix cell, heaviest first. */
export async function readMatrixPairs(client, group, {
  snapshotId, groupBy = 'segment', src = '', dst = '', limit = 20,
} = {}) {
  const graph = topologyGraphName(group);
  const field = MATRIX_GROUPS[groupBy] ? groupBy : 'segment';
  const n = Math.max(1, Math.min(200, Number(limit) || 20));
  const sid = cypherStr(snapshotId);
  return toObjects(await client.query(graph,
    `MATCH (a:TopoDevice)-[r:TALKS_TO]->(b:TopoDevice) WHERE r.snapshot_id = ${sid} `
    + `AND a.${field} = ${cypherStr(src)} AND b.${field} = ${cypherStr(dst)} `
    + `RETURN a.key AS src_key, a.name AS src_name, b.key AS dst_key, b.name AS dst_name, `
    + `r.bytes_total AS bytes, r.protocols AS protocols ORDER BY r.bytes_total DESC LIMIT ${n}`));
}

/**
 * One device's traffic across every retained snapshot.
 *
 * The map only ever showed a device as it is right now, so "is 412 GB normal for this
 * host?" — the question that decides whether a spike matters — had no answer on the
 * page. Retention keeps a dozen snapshots, so the series is short by construction and
 * needs no new collection: it is a roll-up of conversations already stored.
 *
 * Snapshots are per-snapshot node sets, so the device key matches across all of them
 * and `r.snapshot_id = d.snapshot_id` keeps each total inside its own snapshot.
 * Undirected, because a peer is a peer whichever way the conversation was recorded.
 */
export async function readNodeHistory(client, group, { key, limit = 24 } = {}) {
  const graph = topologyGraphName(group);
  const n = Math.max(1, Math.min(100, Number(limit) || 24));
  return toObjects(await client.query(graph,
    `MATCH (d:TopoDevice {key: ${cypherStr(key)}})-[r:TALKS_TO]-(p:TopoDevice) `
    + `WHERE r.snapshot_id = d.snapshot_id `
    + `RETURN d.snapshot_id AS snapshot_id, sum(r.bytes_total) AS bytes_total, `
    + `count(DISTINCT p.key) AS peer_count LIMIT ${n}`));
}

export async function readNode(client, group, { snapshotId, key, limit = 50 } = {}) {
  const graph = topologyGraphName(group);
  const sid = cypherStr(snapshotId);
  const k = cypherStr(key);
  const n = Math.max(1, Math.min(500, Number(limit) || 50));
  const [device] = toObjects(await client.query(graph,
    `MATCH (d:TopoDevice {snapshot_id: ${sid}, key: ${k}}) `
    + `RETURN d.key AS key, d.name AS name, d.ip AS ip, d.mac AS mac, d.role AS role, d.vlan AS vlan, `
    + `d.critical AS critical, d.oid AS oid, d.discovery_id AS discovery_id, d.locality AS locality, `
    + `d.segment AS segment, d.dns_name AS dns_name, d.dhcp_name AS dhcp_name, `
    + `d.netbios_name AS netbios_name, d.vendor AS vendor, d.software AS software, `
    + `d.x AS x, d.y AS y LIMIT 1`));
  if (!device) return null;
  const peers = toObjects(await client.query(graph,
    `MATCH (d:TopoDevice {snapshot_id: ${sid}, key: ${k}})-[r:TALKS_TO]-(p:TopoDevice) `
    + `RETURN p.key AS key, p.name AS name, p.ip AS ip, p.role AS role, r.bytes_total AS bytes, `
    + `r.protocols AS protocols ORDER BY r.bytes_total DESC LIMIT ${n}`));
  const identities = toObjects(await client.query(graph,
    `MATCH (d:TopoDevice {snapshot_id: ${sid}, key: ${k}})-[:AUTHENTICATED_AS]->(u:TopoIdentity) `
    + `RETURN u.name AS name, u.principal AS principal LIMIT ${n}`));
  // Durable, snapshot-independent enrichments the user asked the agent to fetch.
  const enrichments = await readEnrichments(client, group, key, { limit: n });
  return { device, peers, identities, enrichments };
}

/**
 * Every identity in a snapshot with the devices it authenticated from/to — the
 * "which users, on which hosts" view. A principal seen on several hosts is one row
 * with all of them (grouped here, not in Cypher, so the device fields come along).
 */
export async function readIdentities(client, group, { snapshotId, limit = 2000 } = {}) {
  const graph = topologyGraphName(group);
  const sid = cypherStr(snapshotId);
  const n = Math.max(1, Math.min(20000, Number(limit) || 2000));
  const rows = toObjects(await client.query(graph,
    `MATCH (d:TopoDevice)-[:AUTHENTICATED_AS]->(u:TopoIdentity) WHERE u.snapshot_id = ${sid} `
    + `RETURN u.name AS name, u.principal AS principal, d.key AS device_key, d.name AS device_name, `
    + `d.ip AS device_ip, d.role AS device_role, d.locality AS device_locality LIMIT ${n}`));
  const byName = new Map();
  for (const r of rows) {
    if (!byName.has(r.name)) byName.set(r.name, { name: r.name, principal: r.principal || r.name, devices: [] });
    byName.get(r.name).devices.push({
      key: r.device_key, name: r.device_name, ip: r.device_ip, role: r.device_role, locality: r.device_locality,
    });
  }
  // Most-connected identities first — the accounts on many hosts are the interesting ones.
  return [...byName.values()].sort((a, b) => b.devices.length - a.devices.length);
}
