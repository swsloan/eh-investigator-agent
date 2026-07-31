// Server-side graph layout for the topology map (Slice A).
//
// Positions are computed HERE, in Node, and persisted with the snapshot; the
// browser binds precomputed x/y and renders immediately. This is deliberate:
//
//   - ForceAtlas2 over a few thousand nodes on the browser's main thread blocks
//     it for seconds ("this page is unresponsive").
//   - The usual escape hatch — graphology's `/worker` layout entry points — is
//     unavailable, because lib/security-headers.js sets `worker-src 'none'` and
//     those workers are constructed from blob: URLs.
//
// Running in Node sidesteps the CSP constraint entirely instead of designing
// around it, and V8 here isn't competing with UI repaints.
//
// Aggregate tiers are CENTROIDS of their members, never independent layouts:
// a role cluster sits at the mean of its devices, a segment at the mean of its
// role clusters, a locality at the mean of its segments. That is what makes zoom
// behave like a map — a cluster is always where its members actually are, so
// zooming expands in place instead of teleporting the viewer.

import Graph from 'graphology';
import forceAtlas2 from 'graphology-layout-forceatlas2';
import { buildHierarchy } from './topology-model.js';

// Iteration budget scales down as the graph grows: layout is a server-side cost
// paid once per snapshot, and a pathological graph must degrade to slightly worse
// positions, never to a hung ingest.
const MAX_ITERATIONS = 600;
const MIN_ITERATIONS = 60;
const ITERATION_BUDGET = 400_000; // ~ iterations * nodes

export function iterationsFor(nodeCount) {
  if (nodeCount <= 1) return 0;
  const scaled = Math.floor(ITERATION_BUDGET / nodeCount);
  return Math.max(MIN_ITERATIONS, Math.min(MAX_ITERATIONS, scaled));
}

/**
 * Deterministic seed position for a node key. ForceAtlas2 needs distinct starting
 * coordinates (identical positions produce zero repulsion vectors and the graph
 * never separates), and using Math.random() would make every ingest of identical
 * input produce a different map. A cheap string hash on a unit circle gives both
 * determinism and separation. Exported for testing.
 */
export function seedPosition(key, index = 0) {
  let h = 2166136261;
  const s = String(key);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const angle = ((h >>> 0) % 3600) / 3600 * Math.PI * 2;
  // Spiral outward by index so large graphs don't start stacked on one ring.
  const radius = 1 + ((h >>> 8) % 100) / 100 + index * 0.001;
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
}

/** Mean position of the given member positions; {x:0,y:0} when there are none. */
function centroid(positions) {
  if (!positions.length) return { x: 0, y: 0 };
  let x = 0;
  let y = 0;
  for (const p of positions) { x += p.x; y += p.y; }
  return { x: x / positions.length, y: y / positions.length };
}

/**
 * Compute positions for every tier of one snapshot.
 *
 * @param {object}   snapshot        { nodes, edges } from topology-model.normalize()
 * @param {object}   [opts]
 * @param {object}   [opts.previous] prior { key -> {x,y} }; used as seed positions so
 *                                   an unchanged network doesn't drift between snapshots
 * @param {Function} [opts.logger]
 * @returns {{ devices, roles, segments, localities, meta }} each a Map-like object of key -> {x,y}
 */
export function layoutSnapshot({ nodes = [], edges = [] } = {}, { previous = null, logger = console } = {}) {
  const started = Date.now();
  const graph = new Graph({ type: 'undirected', allowSelfLoops: false });

  nodes.forEach((n, i) => {
    // Seed from the previous snapshot when we have it, so only genuine change moves.
    const prior = previous?.[n.key];
    const seed = prior && Number.isFinite(prior.x) && Number.isFinite(prior.y)
      ? { x: prior.x, y: prior.y }
      : seedPosition(n.key, i);
    graph.addNode(n.key, { x: seed.x, y: seed.y });
  });

  for (const e of edges) {
    if (!graph.hasNode(e.src) || !graph.hasNode(e.dst)) continue;
    if (graph.hasEdge(e.src, e.dst)) continue;
    // Heavier conversations pull harder, so traffic structure shapes the map.
    graph.addEdge(e.src, e.dst, { weight: Math.max(1, Math.log10((e.bytes_total || 0) + 10)) });
  }

  const iterations = iterationsFor(graph.order);
  if (iterations > 0 && graph.order > 1) {
    forceAtlas2.assign(graph, {
      iterations,
      settings: {
        ...forceAtlas2.inferSettings(graph),
        edgeWeightInfluence: 1,
        // Nodes with many peers (domain controllers, gateways) get more room, which
        // is exactly the read an operator wants from a dependency map.
        outboundAttractionDistribution: true,
        adjustSizes: true,
      },
    });
  }

  const devices = {};
  for (const n of nodes) {
    const attrs = graph.getNodeAttributes(n.key);
    devices[n.key] = {
      x: Number.isFinite(attrs.x) ? attrs.x : 0,
      y: Number.isFinite(attrs.y) ? attrs.y : 0,
    };
  }

  // Aggregates as centroids, rolled upward: devices → roles → segments → localities.
  const tiers = buildHierarchy(nodes);
  const roles = {};
  for (const r of tiers.roles) roles[r.key] = centroid(r.members.map((k) => devices[k]).filter(Boolean));
  const segments = {};
  for (const s of tiers.segments) segments[s.key] = centroid(s.members.map((k) => roles[k]).filter(Boolean));
  const localities = {};
  for (const l of tiers.localities) localities[l.key] = centroid(l.members.map((k) => segments[k]).filter(Boolean));

  const elapsedMs = Date.now() - started;
  logger?.info?.(`[topology] layout: ${graph.order} nodes, ${graph.size} edges, ${iterations} iterations, ${elapsedMs}ms`);

  return { devices, roles, segments, localities, meta: { iterations, elapsedMs, nodes: graph.order, edges: graph.size } };
}
