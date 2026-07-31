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

/**
 * Anchor a fresh layout to the previous snapshot's.
 *
 * Seeding ForceAtlas2 from prior coordinates preserves the *shape* but not the
 * frame: FA2 has no fixed origin or scale, so a re-run drifts and rescales the whole
 * graph even when almost nothing changed — measured at ~40% of the graph's extent on
 * a snapshot with one added device. That makes "what moved?" unreadable, which is the
 * whole point of drift.
 *
 * This does the missing step: a similarity transform (translate + uniform scale)
 * fitted on the nodes common to both layouts, so unchanged parts of the network land
 * back where the operator last saw them and only genuine change moves. Rotation is
 * deliberately not corrected — FA2 seeded from a settled layout does not
 * systematically rotate, and fitting rotation on a near-degenerate point set is
 * numerically worse than leaving it alone.
 *
 * Pure; exported for testing.
 */
export function alignTo(positions, previous) {
  if (!previous) return positions;
  const keys = Object.keys(positions).filter((k) => previous[k]
    && Number.isFinite(previous[k].x) && Number.isFinite(previous[k].y));
  if (keys.length < 2) return positions; // nothing meaningful to align against

  const mean = (pick) => keys.reduce((t, k) => t + pick(k), 0) / keys.length;
  const nowCx = mean((k) => positions[k].x);
  const nowCy = mean((k) => positions[k].y);
  const oldCx = mean((k) => previous[k].x);
  const oldCy = mean((k) => previous[k].y);

  // Uniform scale = ratio of mean distance-from-centroid in each frame.
  const spread = (pick, cx, cy) => mean((k) => Math.hypot(pick(k).x - cx, pick(k).y - cy));
  const nowSpread = spread((k) => positions[k], nowCx, nowCy);
  const oldSpread = spread((k) => previous[k], oldCx, oldCy);
  const scale = nowSpread > 1e-9 ? oldSpread / nowSpread : 1;

  for (const key of Object.keys(positions)) {
    const p = positions[key];
    positions[key] = {
      x: oldCx + (p.x - nowCx) * scale,
      y: oldCy + (p.y - nowCy) * scale,
    };
  }
  return positions;
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
 * Nudge overlapping aggregates apart.
 *
 * A pure centroid is honest but often unreadable: clusters whose members are
 * spatially interleaved (three workstation VLANs that all talk to the same
 * servers) land on top of each other, hiding each other's labels. This pushes
 * colliding aggregates apart along the line between them, in place, for a few
 * deterministic passes — enough to separate labels while keeping each cluster
 * essentially where its members actually are.
 *
 * `weights` scales a node's footprint by how many devices it represents, mirroring
 * how the renderer sizes it. Exported for testing.
 */
export function separate(positions, weights = {}, { iterations = 60, spacing = 1 } = {}) {
  const keys = Object.keys(positions);
  if (keys.length < 2) return positions;
  const radius = (k) => spacing * (0.6 + Math.sqrt(Math.max(1, Number(weights[k]) || 1)) * 0.25);
  // Scale the whole separation to the spread of the data, so it works the same on a
  // tight graph as on a sprawling one.
  const xs = keys.map((k) => positions[k].x);
  const ys = keys.map((k) => positions[k].y);
  const extent = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) || 1;
  const unit = extent / 22;

  for (let it = 0; it < iterations; it++) {
    let moved = false;
    for (let i = 0; i < keys.length; i++) {
      for (let j = i + 1; j < keys.length; j++) {
        const a = positions[keys[i]];
        const b = positions[keys[j]];
        const min = (radius(keys[i]) + radius(keys[j])) * unit;
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let d = Math.hypot(dx, dy);
        if (d >= min) continue;
        if (d < 1e-9) {
          // Exactly coincident: break the tie deterministically by key order.
          dx = ((i * 31 + j * 17) % 7) - 3;
          dy = ((i * 13 + j * 29) % 7) - 3;
          d = Math.hypot(dx, dy) || 1;
        }
        const push = (min - d) / 2 / d;
        a.x -= dx * push; a.y -= dy * push;
        b.x += dx * push; b.y += dy * push;
        moved = true;
      }
    }
    if (!moved) break; // settled
  }
  return positions;
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

  // A snapshot seeded from a settled layout only needs to place what changed — running
  // the full budget re-flows the whole graph and destroys frame-to-frame stability.
  // Below, `alignTo` fixes the global frame; this keeps the local structure put too.
  const seededFraction = previous
    ? nodes.filter((n) => previous[n.key]).length / Math.max(1, nodes.length)
    : 0;
  const iterations = seededFraction > 0.8
    ? Math.max(20, Math.round(iterationsFor(graph.order) * 0.15))
    : iterationsFor(graph.order);
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
  // Put the frame back where it was, so unchanged devices sit where the operator
  // last saw them and drift highlights read as real movement.
  alignTo(devices, previous);

  // Aggregates as centroids, rolled upward: devices → roles → segments → localities.
  // Each tier is separated AFTER it is derived but BEFORE the tier above rolls it up,
  // so a parent still sits at the mean of where its children actually end up drawn.
  const tiers = buildHierarchy(nodes);
  const count = (items) => Object.fromEntries(items.map((t) => [t.key, t.device_count]));

  const roles = {};
  for (const r of tiers.roles) roles[r.key] = centroid(r.members.map((k) => devices[k]).filter(Boolean));
  separate(roles, count(tiers.roles));

  const segments = {};
  for (const s of tiers.segments) segments[s.key] = centroid(s.members.map((k) => roles[k]).filter(Boolean));
  separate(segments, count(tiers.segments));

  const localities = {};
  for (const l of tiers.localities) localities[l.key] = centroid(l.members.map((k) => segments[k]).filter(Boolean));
  separate(localities, count(tiers.localities));

  const elapsedMs = Date.now() - started;
  logger?.info?.(`[topology] layout: ${graph.order} nodes, ${graph.size} edges, ${iterations} iterations, ${elapsedMs}ms`);

  return { devices, roles, segments, localities, meta: { iterations, elapsedMs, nodes: graph.order, edges: graph.size } };
}
