// Server-side topology layout. Run: node --test lib/topology-layout.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { alignTo, iterationsFor, layoutSnapshot, seedPosition, separate } from './topology-layout.js';
import { normalize } from './topology-model.js';

const quiet = { info: () => {} };

function synthetic(deviceCount, { vlans = 4 } = {}) {
  const devices = [];
  for (let i = 0; i < deviceCount; i++) {
    devices.push({
      id: String(i),
      name: `dev${i}`,
      ipaddr: `10.0.${Math.floor(i / 250) % 250}.${i % 250}`,
      role: i % 7 === 0 ? 'domain_controller' : 'pc',
      vlanid: String(i % vlans),
    });
  }
  const edges = [];
  for (let i = 1; i < deviceCount; i++) {
    edges.push({ src: String(i), dst: String(i % 7 === 0 ? 0 : i - 1), bytes_out: 1000 + i, bytes_in: 10 });
  }
  return normalize({ devices, edges });
}

test('layout assigns finite coordinates to every device', () => {
  const snap = synthetic(40);
  const { devices, meta } = layoutSnapshot(snap, { logger: quiet });
  assert.equal(Object.keys(devices).length, snap.nodes.length);
  for (const [key, p] of Object.entries(devices)) {
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), `${key} has finite coords`);
  }
  assert.ok(meta.iterations > 0);
});

test('layout is deterministic — identical input yields an identical map', () => {
  const snap = synthetic(30);
  const a = layoutSnapshot(snap, { logger: quiet }).devices;
  const b = layoutSnapshot(snap, { logger: quiet }).devices;
  assert.deepEqual(a, b, 're-ingesting the same snapshot must not reshuffle the map');
});

test('seedPosition is stable per key and separates distinct keys', () => {
  assert.deepEqual(seedPosition('oid:1'), seedPosition('oid:1'));
  assert.notDeepEqual(seedPosition('oid:1'), seedPosition('oid:2'));
});

test('nodes do not all collapse onto one point', () => {
  // Identical starting coordinates produce zero repulsion and a degenerate layout.
  const { devices } = layoutSnapshot(synthetic(25), { logger: quiet });
  const pts = Object.values(devices);
  const spreadX = Math.max(...pts.map((p) => p.x)) - Math.min(...pts.map((p) => p.x));
  const spreadY = Math.max(...pts.map((p) => p.y)) - Math.min(...pts.map((p) => p.y));
  assert.ok(spreadX > 0.01 && spreadY > 0.01, `layout has real spread (${spreadX}, ${spreadY})`);
});

test('every aggregate stays near its members (centroid, then nudged apart for legibility)', () => {
  // Aggregates start at the exact centroid of their members — that is what makes
  // zoom expand IN PLACE. `separate()` may then nudge a cluster off the exact mean
  // so overlapping clusters do not hide each other's labels, so the contract is
  // "close to its members", not "strictly inside their bounding box".
  const snap = synthetic(60);
  const { devices, roles, segments } = layoutSnapshot(snap, { logger: quiet });

  const near = (point, memberPts, label) => {
    const xs = memberPts.map((p) => p.x);
    const ys = memberPts.map((p) => p.y);
    const cx = xs.reduce((a, b) => a + b, 0) / xs.length;
    const cy = ys.reduce((a, b) => a + b, 0) / ys.length;
    // Tolerance scales with the spread of the whole tier, so this is meaningful on
    // both a tight and a sprawling graph.
    const spread = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 1);
    const drift = Math.hypot(point.x - cx, point.y - cy);
    assert.ok(drift <= spread * 1.5 + 1, `${label} stays near its members (drift ${drift.toFixed(2)} vs spread ${spread.toFixed(2)})`);
  };

  for (const r of snap.tiers.roles) near(roles[r.key], r.members.map((k) => devices[k]), `role ${r.key}`);
  for (const s of snap.tiers.segments) near(segments[s.key], s.members.map((k) => roles[k]), `segment ${s.key}`);
});

test('separate() pushes overlapping aggregates apart, deterministically', () => {
  // The real case this fixes: several workstation VLANs whose devices interleave in
  // the traffic graph, so their centroids coincide and the labels pile up.
  const stacked = () => ({ a: { x: 0, y: 0 }, b: { x: 0, y: 0 }, c: { x: 0.01, y: 0 }, far: { x: 40, y: 40 } });
  const weights = { a: 90, b: 70, c: 60, far: 2 };

  const out = separate(stacked(), weights);
  const dist = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);
  assert.ok(dist(out.a, out.b) > 0.5, `a/b separated (${dist(out.a, out.b).toFixed(2)})`);
  assert.ok(dist(out.a, out.c) > 0.5, 'a/c separated');
  assert.ok(dist(out.b, out.c) > 0.5, 'b/c separated');
  // The isolated node had no collision, so it must not have been dragged around.
  assert.equal(out.far.x, 40);
  assert.equal(out.far.y, 40);

  assert.deepEqual(separate(stacked(), weights), out, 'same input yields the same separation');
});

test('separate() is a no-op for fewer than two nodes', () => {
  assert.deepEqual(separate({}, {}), {});
  assert.deepEqual(separate({ only: { x: 3, y: 4 } }, {}), { only: { x: 3, y: 4 } });
});

test('alignTo restores the previous frame (translation + scale)', () => {
  const previous = { a: { x: 0, y: 0 }, b: { x: 10, y: 0 }, c: { x: 0, y: 10 } };
  // The same shape, shifted far away and doubled in size — what FA2 drift looks like.
  const drifted = { a: { x: 100, y: 50 }, b: { x: 120, y: 50 }, c: { x: 100, y: 70 } };
  const out = alignTo({ ...drifted }, previous);
  for (const k of ['a', 'b', 'c']) {
    assert.ok(Math.hypot(out[k].x - previous[k].x, out[k].y - previous[k].y) < 1e-6, `${k} realigned`);
  }
});

test('alignTo is a no-op without enough common ground', () => {
  const p = { a: { x: 1, y: 2 } };
  assert.deepEqual(alignTo({ ...p }, null), p, 'no previous layout');
  assert.deepEqual(alignTo({ ...p }, { z: { x: 9, y: 9 } }), p, 'no overlapping keys');
});

test('an added device barely moves the rest of the map (frame-to-frame stability)', () => {
  // Drift is unreadable if re-running the layout reshuffles everything: the operator
  // cannot tell real movement from FA2 wander. Seeding alone does NOT achieve this —
  // FA2 has no fixed origin or scale — so alignTo + a reduced iteration budget do.
  const first = layoutSnapshot(synthetic(40), { logger: quiet }).devices;
  const grown = synthetic(41);
  const second = layoutSnapshot(grown, { previous: first, logger: quiet }).devices;

  const xs = Object.values(second).map((p) => p.x);
  const ys = Object.values(second).map((p) => p.y);
  const extent = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) || 1;
  const moves = Object.keys(first)
    .filter((k) => second[k])
    .map((k) => Math.hypot(second[k].x - first[k].x, second[k].y - first[k].y) / extent)
    .sort((a, b) => a - b);
  const median = moves[Math.floor(moves.length / 2)];
  assert.ok(median < 0.08, `unchanged devices hold position (median drift ${(median * 100).toFixed(1)}% of extent)`);
});

test('previous coordinates are reused as seeds so an unchanged network stays put', () => {
  const snap = synthetic(20);
  const first = layoutSnapshot(snap, { logger: quiet }).devices;
  const second = layoutSnapshot(snap, { previous: first, logger: quiet }).devices;
  // Seeded from a settled layout, positions should be stable rather than re-derived.
  for (const key of Object.keys(first)) {
    const moved = Math.hypot(second[key].x - first[key].x, second[key].y - first[key].y);
    const scale = Math.hypot(first[key].x, first[key].y) || 1;
    assert.ok(moved / scale < 2, `${key} did not fly across the map (moved ${moved.toFixed(2)})`);
  }
});

test('iteration budget shrinks as the graph grows, within bounds', () => {
  assert.equal(iterationsFor(0), 0);
  assert.equal(iterationsFor(1), 0);
  assert.ok(iterationsFor(100) > iterationsFor(10_000), 'bigger graph gets fewer iterations');
  assert.ok(iterationsFor(1_000_000) >= 60, 'never drops below the floor');
  assert.ok(iterationsFor(2) <= 600, 'never exceeds the ceiling');
});

test('a 5k-node snapshot lays out within a sane server-side budget', () => {
  const snap = synthetic(5000);
  const started = Date.now();
  const { devices, meta } = layoutSnapshot(snap, { logger: quiet });
  const elapsed = Date.now() - started;
  assert.equal(Object.keys(devices).length, 5000);
  assert.ok(elapsed < 60_000, `layout finished in ${elapsed}ms (${meta.iterations} iterations)`);
});

test('empty and single-node snapshots do not throw', () => {
  assert.doesNotThrow(() => layoutSnapshot({ nodes: [], edges: [] }, { logger: quiet }));
  assert.doesNotThrow(() => layoutSnapshot(undefined, { logger: quiet }));
  const one = normalize({ devices: [{ id: '1', ipaddr: '10.0.0.1' }] });
  const { devices } = layoutSnapshot(one, { logger: quiet });
  assert.ok(Number.isFinite(devices['oid:1'].x));
});

test('edges referencing unknown nodes are skipped rather than crashing the layout', () => {
  const snap = normalize({ devices: [{ id: '1', ipaddr: '10.0.0.1' }], edges: [] });
  snap.edges.push({ src: 'oid:1', dst: 'oid:ghost', bytes_total: 5 });
  assert.doesNotThrow(() => layoutSnapshot(snap, { logger: quiet }));
});

// ---- cluster-then-layout -----------------------------------------------------
// The property the zone view depends on: a segment's devices are together, and a
// container drawn round them does not swallow its neighbours.

/** Every device's distance to its own segment centre, and to the nearest other. */
function clusterStats(snap, layout) {
  const segmentOf = new Map(snap.nodes.map((n) => [n.key, n.segment]));
  let worstOwn = 0;
  let strays = 0;
  for (const node of snap.nodes) {
    const p = layout.devices[node.key];
    const own = layout.segments[segmentOf.get(node.key)];
    const dOwn = Math.hypot(p.x - own.x, p.y - own.y);
    worstOwn = Math.max(worstOwn, dOwn);
    for (const [key, centre] of Object.entries(layout.segments)) {
      if (key === segmentOf.get(node.key)) continue;
      if (Math.hypot(p.x - centre.x, p.y - centre.y) < dOwn) { strays += 1; break; }
    }
  }
  return { worstOwn, strays };
}

test('devices sit with their own segment, not scattered across the map', () => {
  const snap = synthetic(60, { vlans: 5 });
  const layout = layoutSnapshot(snap, { logger: quiet });
  const { worstOwn, strays } = clusterStats(snap, layout);

  // No device is closer to a segment it does not belong to. This is what a single
  // global pass could not give: there, a segment's members scatter and the zone
  // drawn around them spans the map.
  assert.equal(strays, 0, `${strays} device(s) landed nearer another segment`);

  // And the clusters are small relative to the whole map.
  const xs = Object.values(layout.devices).map((p) => p.x);
  const ys = Object.values(layout.devices).map((p) => p.y);
  const extent = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  assert.ok(worstOwn < extent * 0.3, `cluster radius ${worstOwn.toFixed(2)} vs map extent ${extent.toFixed(2)}`);
});

test('a segment sits exactly at the mean of its own devices', () => {
  const snap = synthetic(45, { vlans: 3 });
  const { devices, segments } = layoutSnapshot(snap, { logger: quiet });
  const bySegment = new Map();
  for (const n of snap.nodes) {
    if (!bySegment.has(n.segment)) bySegment.set(n.segment, []);
    bySegment.get(n.segment).push(devices[n.key]);
  }
  for (const [key, pts] of bySegment) {
    const mx = pts.reduce((t, p) => t + p.x, 0) / pts.length;
    const my = pts.reduce((t, p) => t + p.y, 0) / pts.length;
    // Opening a zone must expand in place, which only holds if the collapsed node
    // was already standing exactly where its devices are.
    assert.ok(Math.abs(segments[key].x - mx) < 1e-6, `${key} x drifted from its members`);
    assert.ok(Math.abs(segments[key].y - my) < 1e-6, `${key} y drifted from its members`);
  }
});

test('a segment with no internal traffic still spreads its devices', () => {
  // FA2 collapses a disconnected cluster to a point; those devices must stay
  // individually clickable rather than stacking.
  const devices = Array.from({ length: 6 }, (_, i) => ({
    id: String(i), name: `iso${i}`, ipaddr: `10.9.9.${i}`, role: 'pc', vlanid: '9',
  }));
  const snap = normalize({ devices, edges: [] });
  const layout = layoutSnapshot(snap, { logger: quiet });
  const pts = snap.nodes.map((n) => layout.devices[n.key]);
  const distinct = new Set(pts.map((p) => `${p.x.toFixed(4)},${p.y.toFixed(4)}`));
  assert.equal(distinct.size, pts.length, 'devices with no traffic still get distinct positions');
});
