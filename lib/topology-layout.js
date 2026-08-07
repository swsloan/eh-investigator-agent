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
// Layout is CLUSTER-THEN-LAYOUT: segments are placed relative to each other by the
// traffic between them, then each segment's devices are laid out locally and dropped
// inside it. One global pass over every device is topologically honest and
// semantically arbitrary — a segment's members scatter across the whole canvas, so
// the zone container drawn around them spans the map and overlaps its neighbours.
// Laying out per segment is what makes the map read as an architecture diagram.
//
// A segment sits exactly at the MEAN of its own devices, because each local layout is
// mean-centred before being placed. That invariant is load-bearing: it is what makes
// opening a zone expand in place instead of teleporting the viewer. Role clusters and
// localities remain centroids of their members.

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
/**
 * Lay out one segment's devices around the origin, using only the conversations
 * inside it, then scale the result to fit `radius`.
 *
 * Mean-centred, so composing it onto a segment centre leaves that centre exactly at
 * the mean of its devices — the invariant the zone view depends on.
 */
function layoutCluster(deviceKeys, intraEdges, radius, previous) {
  const out = {};
  if (deviceKeys.length === 0) return out;
  if (deviceKeys.length === 1) { out[deviceKeys[0]] = { x: 0, y: 0 }; return out; }

  const g = new Graph({ type: 'undirected', allowSelfLoops: false });
  deviceKeys.forEach((key, i) => {
    const prior = previous?.[key];
    const seed = prior && Number.isFinite(prior.x) && Number.isFinite(prior.y)
      ? { x: prior.x, y: prior.y }
      : seedPosition(key, i);
    g.addNode(key, seed);
  });
  for (const e of intraEdges) {
    if (!g.hasNode(e.src) || !g.hasNode(e.dst) || g.hasEdge(e.src, e.dst)) continue;
    g.addEdge(e.src, e.dst, { weight: Math.max(1, Math.log10((e.bytes_total || 0) + 10)) });
  }
  const iterations = iterationsFor(g.order);
  if (iterations > 0) {
    forceAtlas2.assign(g, {
      iterations,
      settings: {
        ...forceAtlas2.inferSettings(g),
        edgeWeightInfluence: 1,
        outboundAttractionDistribution: true,
        adjustSizes: true,
      },
    });
  }

  const raw = deviceKeys.map((k) => {
    const a = g.getNodeAttributes(k);
    return { key: k, x: Number.isFinite(a.x) ? a.x : 0, y: Number.isFinite(a.y) ? a.y : 0 };
  });
  const cx = raw.reduce((t, p) => t + p.x, 0) / raw.length;
  const cy = raw.reduce((t, p) => t + p.y, 0) / raw.length;
  const reach = Math.max(...raw.map((p) => Math.hypot(p.x - cx, p.y - cy)), 0);
  // A cluster with no internal structure (no intra-segment traffic) collapses to a
  // point under FA2; ring it instead so its devices stay individually clickable.
  if (reach < 1e-9) {
    raw.forEach((p, i) => {
      const angle = (i / raw.length) * Math.PI * 2;
      out[p.key] = { x: Math.cos(angle) * radius * 0.7, y: Math.sin(angle) * radius * 0.7 };
    });
    return out;
  }
  const scale = radius / reach;
  for (const p of raw) out[p.key] = { x: (p.x - cx) * scale, y: (p.y - cy) * scale };
  return out;
}

/**
 * Compute positions for every tier of one snapshot.
 *
 * @param {object}   snapshot        { nodes, edges } from topology-model.normalize()
 * @param {object}   [opts]
 * @param {object}   [opts.previous] prior { key -> {x,y} } for DEVICES; used to seed
 *                                   and to restore the frame, so an unchanged network
 *                                   does not drift between snapshots
 * @param {Function} [opts.logger]
 * @returns {{ devices, roles, segments, localities, meta }} each key -> {x,y}
 */
export function layoutSnapshot({ nodes = [], edges = [] } = {}, { previous = null, logger = console } = {}) {
  const started = Date.now();
  const tiers = buildHierarchy(nodes);
  const segmentOf = new Map(nodes.map((n) => [n.key, n.segment]));

  // Devices per segment. buildHierarchy's segment members are ROLE keys, and the
  // local layout needs the devices themselves.
  const bySegment = new Map();
  for (const n of nodes) {
    if (!bySegment.has(n.segment)) bySegment.set(n.segment, []);
    bySegment.get(n.segment).push(n.key);
  }

  // Where each segment sat last time, so it can be seeded and the frame restored.
  const priorCentre = {};
  if (previous) {
    for (const [segment, keys] of bySegment) {
      const pts = keys.map((k) => previous[k]).filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y));
      if (pts.length) priorCentre[segment] = centroid(pts);
    }
  }

  // ---- 1. Place segments by the traffic between them. ------------------------
  const segGraph = new Graph({ type: 'undirected', allowSelfLoops: false });
  tiers.segments.forEach((seg, i) => {
    const seed = priorCentre[seg.key] || seedPosition(seg.key, i);
    segGraph.addNode(seg.key, { x: seed.x, y: seed.y });
  });
  const between = new Map();
  const intraBySegment = new Map();
  for (const e of edges) {
    const a = segmentOf.get(e.src);
    const b = segmentOf.get(e.dst);
    if (!a || !b) continue;
    if (a === b) {
      if (!intraBySegment.has(a)) intraBySegment.set(a, []);
      intraBySegment.get(a).push(e);
      continue;
    }
    const pair = a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
    between.set(pair, (between.get(pair) || 0) + (Number(e.bytes_total) || 0));
  }
  for (const [pair, bytes] of between) {
    const [a, b] = pair.split('\u0000');
    if (!segGraph.hasNode(a) || !segGraph.hasNode(b) || segGraph.hasEdge(a, b)) continue;
    segGraph.addEdge(a, b, { weight: Math.max(1, Math.log10(bytes + 10)) });
  }

  const seededFraction = previous
    ? tiers.segments.filter((s) => priorCentre[s.key]).length / Math.max(1, tiers.segments.length)
    : 0;
  const segIterations = seededFraction > 0.8
    ? Math.max(20, Math.round(iterationsFor(segGraph.order) * 0.15))
    : iterationsFor(segGraph.order);
  if (segIterations > 0 && segGraph.order > 1) {
    forceAtlas2.assign(segGraph, {
      iterations: segIterations,
      settings: {
        ...forceAtlas2.inferSettings(segGraph),
        edgeWeightInfluence: 1,
        outboundAttractionDistribution: true,
        adjustSizes: true,
      },
    });
  }

  const segments = {};
  for (const seg of tiers.segments) {
    const a = segGraph.getNodeAttributes(seg.key);
    segments[seg.key] = {
      x: Number.isFinite(a.x) ? a.x : 0,
      y: Number.isFinite(a.y) ? a.y : 0,
    };
  }
  // Restore the frame at the segment level; devices are composed from these, so the
  // whole map inherits it and only genuine change moves.
  alignTo(segments, priorCentre);
  const segCount = Object.fromEntries(tiers.segments.map((t) => [t.key, t.device_count]));
  separate(segments, segCount);

  // ---- 2. Fill each segment with its own devices. ----------------------------
  // Zone radii mirror separate()'s own footprint notion, so a cluster always fits
  // inside the space that was cleared for it.
  const xs = Object.values(segments).map((p) => p.x);
  const ys = Object.values(segments).map((p) => p.y);
  const extent = xs.length
    ? Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) || 1
    : 1;
  const unit = extent / 22;
  const zoneRadius = (key) => (0.6 + Math.sqrt(Math.max(1, segCount[key] || 1)) * 0.25) * unit;

  const devices = {};
  for (const [segment, keys] of bySegment) {
    const centre = segments[segment] || { x: 0, y: 0 };
    // 0.72 leaves the gap the zone container is drawn in, so neighbouring zones
    // stay visually distinct even when their members nearly touch.
    const local = layoutCluster(keys, intraBySegment.get(segment) || [], zoneRadius(segment) * 0.72, previous);
    for (const key of keys) {
      const offset = local[key] || { x: 0, y: 0 };
      devices[key] = { x: centre.x + offset.x, y: centre.y + offset.y };
    }
  }

  // ---- 3. The remaining tiers stay centroids of their members. ----------------
  const roles = {};
  for (const r of tiers.roles) roles[r.key] = centroid(r.members.map((k) => devices[k]).filter(Boolean));
  // Nudged only gently: a role cluster that wandered far enough to leave its zone
  // would contradict the container drawn around it.
  separate(roles, Object.fromEntries(tiers.roles.map((t) => [t.key, t.device_count])), { spacing: 0.3 });

  const localities = {};
  for (const l of tiers.localities) localities[l.key] = centroid(l.members.map((k) => segments[k]).filter(Boolean));
  separate(localities, Object.fromEntries(tiers.localities.map((t) => [t.key, t.device_count])));

  const elapsedMs = Date.now() - started;
  const deviceCount = Object.keys(devices).length;
  logger?.info?.(`[topology] layout: ${deviceCount} devices in ${tiers.segments.length} segments, `
    + `${segGraph.size} inter-segment links, ${segIterations} iterations, ${elapsedMs}ms`);

  return {
    devices,
    roles,
    segments,
    localities,
    meta: {
      iterations: segIterations,
      elapsedMs,
      nodes: deviceCount,
      edges: edges.length,
      segments: tiers.segments.length,
    },
  };
}
