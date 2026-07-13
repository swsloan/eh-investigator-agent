import { cypherStr } from './falkor-client.js';

/**
 * Read-only query layer for the memory-graph visualization (v1: contextual
 * recall). Every query is a bounded neighborhood or an aggregate — we never
 * ship the whole graph to the browser, which keeps this safe at any total scale
 * (see docs/DESIGN-memory-visualization.md §8, §10).
 *
 * Graph model (FalkorDB, via Graphiti):
 *   (:Entity:<Subtype>)  props: uuid, name, summary, group_id, created_at
 *   (:Episodic)          props: uuid, name, content, source_description, created_at, valid_at
 *   [:RELATES_TO]        entity↔entity fact: name (rel kind), fact, source/target_node_uuid, valid_at, invalid_at
 *   [:MENTIONS]          episode→entity provenance
 * The subtype is every label other than the base `Entity` label; we surface it
 * as a scalar `head([l IN labels(n) WHERE l <> 'Entity'])` so the RESP reply
 * stays primitive (FalkorDB stringifies list-valued columns otherwise).
 */

const SUBTYPE = "head([l IN labels(%v) WHERE l <> 'Entity'])";
const subtypeOf = (v) => SUBTYPE.replace('%v', v);

// The ExtraHop NDR ontology (mirrors graphiti/config.yaml entity_types). Only
// these are accepted as curation targets — the value is interpolated into a
// Cypher label, so it MUST come from this fixed whitelist, never user input.
export const ONTOLOGY_TYPES = [
  'Device', 'Identity', 'Endpoint', 'NetworkSegment', 'DetectionType', 'Detection',
  'Investigation', 'Analyst', 'Disposition', 'MitreTechnique', 'IOC', 'Service', 'Group',
];

/** Map {columns, rows} to an array of plain objects keyed by column name. */
function toObjects({ columns, rows }) {
  return rows.map((row) => {
    const o = {};
    columns.forEach((c, i) => { o[c] = row[i]; });
    return o;
  });
}

/** Type breakdown, episode count, and untyped (extraction-drift) count. */
export async function overview(client, graph) {
  const types = toObjects(await client.query(
    graph,
    `MATCH (n:Entity) RETURN ${subtypeOf('n')} AS type, count(*) AS count ORDER BY count DESC`,
  ));
  const [{ c: episodes = 0 } = {}] = toObjects(await client.query(
    graph, 'MATCH (e:Episodic) RETURN count(e) AS c',
  ));
  const byType = types
    .filter((t) => t.type)
    .map((t) => ({ type: t.type, count: t.count }));
  const untyped = types.filter((t) => !t.type).reduce((s, t) => s + (t.count || 0), 0);
  const total = types.reduce((s, t) => s + (t.count || 0), 0);

  // Dashboard rollups (doc §3.6): recently-learned, most-investigated, recent
  // investigations, and freshness. Small bounded queries — the graph is tiny.
  const recentEntities = toObjects(await client.query(
    graph,
    `MATCH (n:Entity) WHERE n.created_at IS NOT NULL
     RETURN n.uuid AS uuid, n.name AS name, ${subtypeOf('n')} AS type, n.created_at AS created_at
     ORDER BY n.created_at DESC LIMIT 5`,
  )).map((r) => ({ ...r, type: r.type || 'Entity' }));
  const topInvestigated = toObjects(await client.query(
    graph,
    `MATCH (ep:Episodic)-[:MENTIONS]->(n:Entity)
     RETURN n.uuid AS uuid, n.name AS name, ${subtypeOf('n')} AS type, count(ep) AS mentions
     ORDER BY mentions DESC LIMIT 5`,
  )).map((r) => ({ ...r, type: r.type || 'Entity' }));
  const recentEpisodes = toObjects(await client.query(
    graph,
    `MATCH (e:Episodic)
     RETURN e.uuid AS uuid, e.name AS name, e.created_at AS created_at
     ORDER BY e.created_at DESC LIMIT 5`,
  ));
  const freshness = recentEpisodes[0]?.created_at || recentEntities[0]?.created_at || null;

  return {
    group: graph, total, entities: total, episodes, untyped, byType,
    recentEntities, topInvestigated, recentEpisodes, freshness,
  };
}

/** Entity name search for the standalone picker. Bounded by `limit`. */
export async function search(client, graph, q, limit = 20) {
  const n = Math.min(Math.max(Number(limit) || 20, 1), 50);
  const rows = toObjects(await client.query(
    graph,
    `MATCH (n:Entity) WHERE toLower(n.name) CONTAINS toLower(${cypherStr(q)})
     RETURN n.uuid AS uuid, n.name AS name, ${subtypeOf('n')} AS type, n.summary AS summary
     ORDER BY n.name LIMIT ${n}`,
  ));
  return rows.map((r) => ({ ...r, type: r.type || 'Entity' }));
}

/**
 * The v1 surface: the ego-network of one entity — the focus node, its
 * neighbors, the facts between them, and the episodes that mention it.
 */
export async function neighbors(client, graph, uuid) {
  const id = cypherStr(uuid);
  const [focus] = toObjects(await client.query(
    graph,
    `MATCH (n:Entity {uuid:${id}})
     RETURN n.uuid AS uuid, n.name AS name, ${subtypeOf('n')} AS type, n.summary AS summary`,
  ));
  if (!focus) return null;
  focus.type = focus.type || 'Entity';

  const edgeRows = toObjects(await client.query(
    graph,
    `MATCH (n:Entity {uuid:${id}})-[e:RELATES_TO]-(m:Entity)
     RETURN e.uuid AS euuid, e.name AS rel, e.fact AS fact,
            e.source_node_uuid AS src, e.invalid_at AS invalid_at,
            m.uuid AS uuid, m.name AS name, ${subtypeOf('m')} AS type, m.summary AS summary`,
  ));

  const nodesById = new Map();
  const edges = [];
  for (const r of edgeRows) {
    if (!r.uuid) continue;
    if (!nodesById.has(r.uuid)) {
      nodesById.set(r.uuid, { uuid: r.uuid, name: r.name, type: r.type || 'Entity', summary: r.summary });
    }
    edges.push({
      uuid: r.euuid,
      rel: r.rel,
      fact: r.fact,
      // Orient the arrow: focus→neighbor when the fact's source is the focus.
      dir: r.src === focus.uuid ? 'out' : 'in',
      source: r.src === focus.uuid ? focus.uuid : r.uuid,
      target: r.src === focus.uuid ? r.uuid : focus.uuid,
      expired: Boolean(r.invalid_at),
    });
  }

  const episodes = toObjects(await client.query(
    graph,
    `MATCH (ep:Episodic)-[:MENTIONS]->(n:Entity {uuid:${id}})
     RETURN ep.uuid AS uuid, ep.name AS name, ep.created_at AS created_at, ep.source_description AS source
     ORDER BY ep.created_at DESC LIMIT 25`,
  ));

  return { focus, nodes: [...nodesById.values()], edges, episodes, insights: summarizeInsights(focus, edges, nodesById, episodes) };
}

// Entity types that make a relationship security-relevant, and words that signal
// risk in a relationship's name/fact. Used to surface the single most decision-
// relevant fact ("why this matters") instead of raw fact lists (doc §3.5).
const RISK_TYPES = new Set(['IOC', 'MitreTechnique', 'Detection']);
const RISK_RE = /(compromis|malicious|exfil|\bc2\b|beacon|lateral|exploit|attack|suspicious|ransom|persist|privileg|unauthoriz|breach)/i;

/** Decision-oriented rollup for the inspector — all derived from the neighborhood
 *  already fetched, so no extra graph round-trips. Exported for unit testing. */
export function summarizeInsights(focus, edges, nodesById, episodes) {
  const live = edges.filter((e) => !e.expired);
  // highest-risk relationship: risk-typed neighbour and/or risk wording, prefer live
  let best = null;
  let bestScore = 0;
  for (const e of edges) {
    const nb = nodesById.get(e.dir === 'out' ? e.target : e.source);
    let score = 0;
    if (nb && RISK_TYPES.has(nb.type)) score += 2;
    if (RISK_RE.test(`${e.rel || ''} ${e.fact || ''}`)) score += 1;
    if (e.expired) score -= 3;
    if (score > bestScore) { bestScore = score; best = { rel: e.rel, fact: e.fact, neighbor: nb ? nb.name : null, neighbor_type: nb ? nb.type : null }; }
  }
  return {
    last_observed: episodes[0]?.created_at || null,
    prior_investigations: episodes.length,
    corroboration: live.length,          // independent live facts attesting to it
    changed_since_prior: edges.some((e) => e.expired), // a superseded fact = memory changed
    highest_risk_rel: best,
  };
}

/** List entities, optionally filtered to one ontology type. Bounded. */
export async function listEntities(client, graph, type, limit = 200) {
  const n = Math.min(Math.max(Number(limit) || 200, 1), 500);
  const typeFilter = ONTOLOGY_TYPES.includes(type) ? `WHERE '${type}' IN labels(n)` : '';
  const rows = toObjects(await client.query(
    graph,
    `MATCH (n:Entity) ${typeFilter}
     RETURN n.uuid AS uuid, n.name AS name, ${subtypeOf('n')} AS type, n.summary AS summary
     ORDER BY n.name LIMIT ${n}`,
  ));
  return rows.map((r) => ({ ...r, type: r.type || 'Entity' }));
}

/**
 * Curation (WRITE): assign an ontology type to an untyped node, or delete it.
 * Guarded — only operates on nodes that are currently `[Entity]`-only, so it can
 * never mangle an already-classified entity. `type` must be in ONTOLOGY_TYPES
 * (it becomes a Cypher label). Sets BOTH the graph label and the `n.labels`
 * property, matching how Graphiti stores type.
 */
export async function assignType(client, graph, uuid, type) {
  if (!ONTOLOGY_TYPES.includes(type)) throw new Error(`Unknown entity type: ${type}`);
  const id = cypherStr(uuid);
  const { rows } = await client.mutate(
    graph,
    `MATCH (n:Entity {uuid:${id}}) WHERE size([l IN labels(n) WHERE l <> 'Entity']) = 0
     SET n:${type}, n.labels = ['Entity', '${type}']
     RETURN n.uuid`,
  );
  if (!rows.length) throw new Error('Node not found or already typed.');
  return { uuid, type };
}

export async function deleteUntyped(client, graph, uuid) {
  const id = cypherStr(uuid);
  const { rows } = await client.mutate(
    graph,
    `MATCH (n:Entity {uuid:${id}}) WHERE size([l IN labels(n) WHERE l <> 'Entity']) = 0
     WITH n, n.uuid AS u DETACH DELETE n RETURN u`,
  );
  if (!rows.length) throw new Error('Node not found or already typed.');
  return { uuid, deleted: true };
}

/**
 * Re-type a MIS-typed entity: swap its current ontology label for a new one.
 * Handles the "typed but wrong" case (e.g. a URI or user-agent stored as
 * Identity) that the untyped-drift flow can't. Removes the existing subtype
 * label(s) and sets the new one (+ n.labels). `type` must be in ONTOLOGY_TYPES;
 * the old label is validated as a bare identifier before it's interpolated.
 */
export async function retypeNode(client, graph, uuid, type) {
  if (!ONTOLOGY_TYPES.includes(type)) throw new Error(`Unknown entity type: ${type}`);
  const id = cypherStr(uuid);
  const cur = toObjects(await client.query(
    graph, `MATCH (n:Entity {uuid:${id}}) RETURN ${subtypeOf('n')} AS sub`,
  ));
  if (!cur.length) throw new Error('Node not found.');
  const sub = cur[0].sub;
  if (sub === type) return { uuid, type, unchanged: true };
  const remove = sub && /^[A-Za-z][A-Za-z0-9]*$/.test(sub) ? `REMOVE n:${sub} ` : '';
  const { rows } = await client.mutate(
    graph,
    `MATCH (n:Entity {uuid:${id}}) ${remove}SET n:${type}, n.labels = ['Entity', '${type}'] RETURN n.uuid`,
  );
  if (!rows.length) throw new Error('Node not found.');
  return { uuid, type, from: sub || null };
}

/**
 * Merge a duplicate entity into a canonical one (e.g. `10.0.10.4 (DC01)` ← `DC01`).
 * Re-points the duplicate's RELATES_TO facts (both directions) and episode
 * MENTIONS onto the canonical node, appends its summary, then deletes it.
 * dup↔canon edges are dropped (redundant after merge). Fact embeddings on moved
 * edges are not copied (the fact text is preserved; canon keeps its own vectors).
 */
export async function mergeNodes(client, graph, canonUuid, dupUuid) {
  if (canonUuid === dupUuid) throw new Error('Cannot merge a node into itself.');
  const C = cypherStr(canonUuid);
  const D = cypherStr(dupUuid);
  const present = toObjects(await client.query(graph, `MATCH (n:Entity) WHERE n.uuid IN [${C}, ${D}] RETURN n.uuid AS uuid`));
  if (present.length < 2) throw new Error('Both the canonical and duplicate entity must exist.');
  // Outgoing facts: (dup)-[r]->(o)  =>  (canon)-[r]->(o)
  await client.mutate(graph, `MATCH (d:Entity {uuid:${D}})-[r:RELATES_TO]->(o:Entity) WHERE o.uuid <> ${C}
    MATCH (c:Entity {uuid:${C}})
    CREATE (c)-[nr:RELATES_TO]->(o)
    SET nr.uuid=r.uuid, nr.name=r.name, nr.fact=r.fact, nr.group_id=r.group_id, nr.created_at=r.created_at, nr.valid_at=r.valid_at, nr.invalid_at=r.invalid_at, nr.source_node_uuid=${C}, nr.target_node_uuid=o.uuid, nr.episodes=r.episodes
    DELETE r`);
  // Incoming facts: (o)-[r]->(dup)  =>  (o)-[r]->(canon)
  await client.mutate(graph, `MATCH (o:Entity)-[r:RELATES_TO]->(d:Entity {uuid:${D}}) WHERE o.uuid <> ${C}
    MATCH (c:Entity {uuid:${C}})
    CREATE (o)-[nr:RELATES_TO]->(c)
    SET nr.uuid=r.uuid, nr.name=r.name, nr.fact=r.fact, nr.group_id=r.group_id, nr.created_at=r.created_at, nr.valid_at=r.valid_at, nr.invalid_at=r.invalid_at, nr.source_node_uuid=o.uuid, nr.target_node_uuid=${C}, nr.episodes=r.episodes
    DELETE r`);
  // Episode provenance: (ep)-[:MENTIONS]->(dup) => (ep)-[:MENTIONS]->(canon)
  await client.mutate(graph, `MATCH (ep:Episodic)-[m:MENTIONS]->(d:Entity {uuid:${D}})
    MATCH (c:Entity {uuid:${C}})
    CREATE (ep)-[:MENTIONS]->(c)
    DELETE m`);
  // Fold the duplicate's summary into the canonical, then remove it.
  await client.mutate(graph, `MATCH (c:Entity {uuid:${C}}), (d:Entity {uuid:${D}})
    SET c.summary = coalesce(c.summary, '') + '\n' + coalesce(d.summary, '')
    DETACH DELETE d`);
  return { canon: canonUuid, dup: dupUuid, merged: true };
}

/** Delete any node (used for mis-typed noise from the entity inspector). */
export async function deleteNode(client, graph, uuid) {
  const id = cypherStr(uuid);
  const { rows } = await client.mutate(
    graph,
    `MATCH (n:Entity {uuid:${id}}) WITH n, n.uuid AS u DETACH DELETE n RETURN u`,
  );
  if (!rows.length) throw new Error('Node not found.');
  return { uuid, deleted: true };
}

/** Untyped `[Entity]`-only nodes — the extraction-quality drift signal. */
export async function quality(client, graph, limit = 100) {
  const n = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const untyped = toObjects(await client.query(
    graph,
    `MATCH (n:Entity) WHERE size([l IN labels(n) WHERE l <> 'Entity']) = 0
     RETURN n.uuid AS uuid, n.name AS name, n.summary AS summary
     ORDER BY n.name LIMIT ${n}`,
  ));
  return { group: graph, count: untyped.length, untyped };
}

/**
 * Drift watch: periodically count untyped `[Entity]` nodes and warn when any
 * exist or the count grows. The ontology/capture-hygiene fixes (config.yaml +
 * investigation-memory SKILL) steer extraction but don't guarantee it, so this
 * is the lightweight backstop from the memory-quality workstream. Non-fatal:
 * any query failure is swallowed (memory may be off / FalkorDB unreachable).
 */
export function startDriftWatch({ client, groups, logger = console, intervalMs = 6 * 60 * 60 * 1000, firstDelayMs = 30 * 1000 }) {
  const last = new Map();
  let timer = null;

  async function checkOnce() {
    for (const g of groups()) {
      try {
        const { count } = await quality(client, g, 1);
        const prev = last.get(g);
        if (count > 0 && count !== prev) {
          logger.warn?.(`[memory-drift] ${g}: ${count} untyped [Entity] node(s) — extraction failed to classify; inspect via GET /api/memory/graph/quality?group=${g}`);
        } else if (count === 0 && prev > 0) {
          logger.log?.(`[memory-drift] ${g}: untyped nodes cleared.`);
        }
        last.set(g, count);
      } catch { /* memory off or unreachable — skip silently */ }
    }
  }

  const startTimer = setTimeout(() => {
    checkOnce();
    timer = setInterval(checkOnce, intervalMs);
    if (timer.unref) timer.unref();
  }, firstDelayMs);
  if (startTimer.unref) startTimer.unref();

  return { checkOnce, stop() { clearTimeout(startTimer); if (timer) clearInterval(timer); } };
}
