// Server-side topology layout. Run: node --test lib/topology-layout.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { iterationsFor, layoutSnapshot, seedPosition } from './topology-layout.js';
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

test('every aggregate sits inside the bounding box of its members (centroid containment)', () => {
  const snap = synthetic(60);
  const { devices, roles, segments, localities } = layoutSnapshot(snap, { logger: quiet });

  const within = (point, memberPts, label) => {
    const xs = memberPts.map((p) => p.x);
    const ys = memberPts.map((p) => p.y);
    const eps = 1e-9;
    assert.ok(point.x >= Math.min(...xs) - eps && point.x <= Math.max(...xs) + eps, `${label} x inside members`);
    assert.ok(point.y >= Math.min(...ys) - eps && point.y <= Math.max(...ys) + eps, `${label} y inside members`);
  };

  for (const r of snap.tiers.roles) within(roles[r.key], r.members.map((k) => devices[k]), `role ${r.key}`);
  for (const s of snap.tiers.segments) within(segments[s.key], s.members.map((k) => roles[k]), `segment ${s.key}`);
  for (const l of snap.tiers.localities) within(localities[l.key], l.members.map((k) => segments[k]), `locality ${l.key}`);
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
