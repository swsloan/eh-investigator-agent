import { expect, test } from '@playwright/test';

// Browser smoke for the network map.
//
// Every /api/topology route is gated on FalkorDB plus memory being enabled
// (routes/topology.js `enabled()`), so against the credential-free server the map
// only ever renders its empty state — there is nothing to exercise. These tests
// therefore stub the topology API at the network layer and drive the real
// renderer against it. That is deliberate: the part being protected here is
// public/js/topology.js, which the zone-topology work is about to rewrite, and
// the fixtures below are the shapes routes/topology.js actually serves.

// Served newest-first, the way readSnapshots returns them.
const SNAPSHOTS = [
  { id: 'snap-3', collected_at: '2026-08-03T22:52:00Z', window: '7d', device_count: 4, edge_count: 3, truncated: false },
  { id: 'snap-2', collected_at: '2026-08-02T22:50:00Z', window: '7d', device_count: 3, edge_count: 2, truncated: false },
  { id: 'snap-1', collected_at: '2026-08-01T22:48:00Z', window: '7d', device_count: 2, edge_count: 1, truncated: false },
];
const SNAPSHOT = SNAPSHOTS[0].id;

const DEVICES = [
  { key: 'dev:dc1', name: 'dc1.acme.lab', x: -30, y: -12, ip: '10.42.0.10', role: 'domain_controller', vlan: 10, critical: true, locality: 'Internal', segment: 'vlan:10', role_key: 'vlan:10/domain_controller' },
  { key: 'dev:nas', name: 'nas-backup-02.acme.lab', x: 26, y: 8, ip: '10.42.0.117', role: 'file_server', vlan: 20, critical: false, locality: 'Internal', segment: 'vlan:20', role_key: 'vlan:20/file_server' },
  { key: 'dev:sql', name: 'sql-erp-01.acme.lab', x: 4, y: 30, ip: '10.42.0.51', role: 'db_server', vlan: 20, critical: false, locality: 'Internal', segment: 'vlan:20', role_key: 'vlan:20/db_server' },
  { key: 'dev:ws', name: 'ws-114.acme.lab', x: -18, y: 26, ip: '10.42.30.114', role: 'pc', vlan: 30, critical: false, locality: 'Internal', segment: 'vlan:30', role_key: 'vlan:30/pc' },
];

const SEGMENTS = [
  { key: 'vlan:10', name: 'vlan:10', x: -30, y: -12, device_count: 1, parent: 'Internal', role: 'domain_controller' },
  { key: 'vlan:20', name: 'vlan:20', x: 15, y: 19, device_count: 2, parent: 'Internal', role: 'file_server' },
  { key: 'vlan:30', name: 'vlan:30', x: -18, y: 26, device_count: 1, parent: 'Internal', role: 'pc' },
];

const LOCALITIES = [{ key: 'Internal', name: 'Internal', x: 0, y: 0, device_count: 4, parent: '', role: 'file_server' }];

const edgesFor = (nodes) => (nodes.length < 2 ? [] : [{ src: nodes[0].key, dst: nodes[1].key, bytes: 4_200_000, links: 12 }]);


// One incident, shaped like lib/attack-overlay.js buildOverlay(). Stage indexes are
// positions in the client's TACTIC_ORDER: credential access, lateral movement,
// exfiltration.
const INCIDENT = {
  id: 'sess-1',
  title: 'Lateral movement from nas-backup-02',
  disposition: 'malicious',
  confidence: 'high',
  techniques: ['T1021.002', 'T1048'],
  stages: [
    { tactic: 'Credential Access', count: 1 },
    { tactic: 'Lateral Movement', count: 1 },
    { tactic: 'Exfiltration', count: 1 },
  ],
  entities: ['dev:ws', 'dev:nas', 'dev:dc1', 'ext:185.220.1.1'],
  externals: [{ key: 'ext:185.220.1.1', name: '185.220.1.1' }],
  bound: 3,
  unbound: 0,
  events: [
    { order: 0, seq: 0, time: '01:14', event: 'svc_backup credentials received from vdi-pool-07', tactic: 'Credential Access', stage: 7, src: 'dev:ws', dst: 'dev:nas', entities: ['dev:ws', 'dev:nas'], inferred: false },
    { order: 1, seq: 1, time: '01:31', event: 'SMB writes to dc1 SYSVOL share', tactic: 'Lateral Movement', stage: 9, src: 'dev:nas', dst: 'dev:dc1', entities: ['dev:nas', 'dev:dc1'], inferred: false },
    { order: 2, seq: 2, time: '02:05', event: '14 GB TLS to 185.220.1.1 over 40 min', tactic: 'Exfiltration', stage: 12, src: 'dev:nas', dst: 'ext:185.220.1.1', entities: ['dev:nas', 'ext:185.220.1.1'], inferred: false },
  ],
};

/** tierMap: every device's coordinates at each tier, so the client can lift it. */
const TIER_MAP = Object.fromEntries([
  ...DEVICES.map((d) => [d.key, { key: d.key, name: d.name, locality: d.locality, segment: d.segment, role_key: d.role_key }]),
  ['ext:185.220.1.1', { key: 'ext:185.220.1.1', locality: 'ext:185.220.1.1', segment: 'ext:185.220.1.1', role_key: 'ext:185.220.1.1', external: true }],
]);

/** Stub every topology route the map touches, shaped like routes/topology.js. */
async function stubTopology(page) {
  await page.route('**/api/topology/snapshots**', (route) => route.fulfill({
    json: { group: 'test', snapshots: SNAPSHOTS },
  }));

  // The list, and the overlay for the one incident in it.
  await page.route('**/api/topology/incidents/*', (route) => route.fulfill({
    json: { group: 'test', snapshot_id: SNAPSHOT, tierMap: TIER_MAP, ...INCIDENT },
  }));
  await page.route('**/api/topology/incidents', (route) => route.fulfill({
    json: {
      incidents: [{
        id: INCIDENT.id, title: INCIDENT.title, disposition: INCIDENT.disposition,
        confidence: INCIDENT.confidence, events: INCIDENT.events.length, createdAt: '2026-08-03T23:00:00Z',
      }],
    },
  }));

  await page.route('**/api/topology/identities**', (route) => route.fulfill({
    json: {
      group: 'test',
      snapshot_id: SNAPSHOT,
      identities: [{ name: 'svc_backup', principal: 'svc_backup@acme.lab', devices: [{ key: 'dev:nas', name: 'nas-backup-02.acme.lab', ip: '10.42.0.117', role: 'file_server', locality: 'Internal' }] }],
    },
  }));

  await page.route('**/api/topology/node/**', (route) => {
    const key = decodeURIComponent(new URL(route.request().url()).pathname.split('/').pop());
    const device = DEVICES.find((d) => d.key === key);
    if (!device) return route.fulfill({ status: 404, json: { error: 'not found' } });
    return route.fulfill({
      json: {
        group: 'test',
        snapshot_id: SNAPSHOT,
        device: { ...device, mac: '00:1B:44:11:3A:B7', vendor: 'Dell', dns_name: device.name },
        peers: [{ key: 'dev:dc1', name: 'dc1.acme.lab', ip: '10.42.0.10', bytes: 4_200_000, protocols: ['SMB'] }],
        identities: [],
        enrichments: [],
      },
    });
  });


  // Traffic history for the inspector's trend card. Registered AFTER the general
  // node route on purpose: Playwright checks handlers in reverse registration
  // order, so the more specific pattern has to come last to win.
  await page.route('**/api/topology/node/*/history**', (route) => route.fulfill({
    json: {
      group: 'test',
      key: 'dev:nas',
      series: [
        { snapshot_id: 'snap-1', collected_at: '2026-08-01T22:48:00Z', bytes_total: 61_000_000, peer_count: 4 },
        { snapshot_id: 'snap-2', collected_at: '2026-08-02T22:50:00Z', bytes_total: 88_000_000, peer_count: 5 },
        { snapshot_id: 'snap-3', collected_at: '2026-08-03T22:52:00Z', bytes_total: 412_000_000, peer_count: 7 },
      ],
    },
  }));


  // The matrix: a square of segment-to-segment totals. The diagonal is deliberately
  // the largest cell, because on a real estate it usually is.
  await page.route('**/api/topology/matrix**', (route) => route.fulfill({
    json: {
      group: 'test', snapshot_id: SNAPSHOT, groupBy: 'segment',
      axes: applyNames(SEGMENTS.map((sg) => ({ key: sg.key, name: sg.name, device_count: sg.device_count, role: sg.role }))),
      cells: [
        { src: 'vlan:20', dst: 'vlan:20', bytes: 13_800_000_000, links: 4 },  // diagonal, the biggest
        { src: 'vlan:30', dst: 'vlan:20', bytes: 1_600_000_000, links: 27 },
        { src: 'vlan:10', dst: 'vlan:20', bytes: 400_000_000, links: 9 },
        { src: 'vlan:20', dst: 'vlan:10', bytes: 12_000_000, links: 3 },
      ],
    },
  }));

  await page.route('**/api/topology/matrix/pairs**', (route) => {
    const q = new URL(route.request().url()).searchParams;
    return route.fulfill({
      json: {
        group: 'test', snapshot_id: SNAPSHOT,
        pairs: [
          { src_key: 'dev:nas', src_name: 'nas-backup-02.acme.lab', dst_key: 'dev:dc1', dst_name: 'dc1.acme.lab', bytes: 4_200_000, protocols: ['SMB'] },
          { src_key: 'dev:sql', src_name: 'sql-erp-01.acme.lab', dst_key: 'dev:dc1', dst_name: 'dc1.acme.lab', bytes: 900_000, protocols: ['LDAP'] },
        ],
        asked: { src: q.get('src'), dst: q.get('dst') },
      },
    });
  });


  // Drift between the two most recent snapshots, shaped like lib/topology-drift.js.
  await page.route('**/api/topology/drift**', (route) => route.fulfill({
    json: {
      group: 'test', from: 'snap-2', to: 'snap-3',
      description: '5 changes · +1 device · 2 high · 1 medium',
      truncated: false,
      counts: { device_added: 1, identity_moved: 1, dependency_added: 1, role_changed: 1, segment_changed: 1 },
      summary: { total: 5, high: 2, medium: 1, info: 2, devices_before: 3, devices_after: 4, edges_before: 2, edges_after: 3 },
      tierMap: TIER_MAP,
      changes: [
        { kind: 'identity_moved', severity: 'high', key: 'svc_backup', devices: ['dev:ws', 'dev:nas'],
          label: 'svc_backup authenticated on a host it has never used',
          detail: 'First seen on ws-114 · previously only on nas-backup-02' },
        { kind: 'dependency_added', severity: 'high', key: 'dev:nas|dev:dc1', endpoints: ['dev:nas', 'dev:dc1'],
          label: 'New dependency: nas-backup-02 → dc1', detail: 'Did not exist in the previous snapshot' },
        { kind: 'role_changed', severity: 'medium', key: 'dev:sql', from: 'db_server', to: 'file_server',
          label: 'sql-erp-01 role changed: db server → file server', detail: 'Reclassified by discovery' },
        { kind: 'device_added', severity: 'info', key: 'dev:ws', label: '1 new device in Workstations', detail: 'ws-114' },
        { kind: 'segment_changed', severity: 'info', key: 'dev:dc1', label: 'dc1 moved segment', detail: 'Normal churn' },
      ],
    },
  }));

  // The map payload varies by tier, so answer from the query the client sent.
  await page.route('**/api/topology/map**', (route) => {
    const params = new URL(route.request().url()).searchParams;
    const zoom = Number(params.get('zoom') || 0);
    const parent = params.get('parent') || '';
    const asked = params.get('snapshot') || SNAPSHOT;
    const expandedParam = params.get('expanded');
    mapRequests.push({ zoom, parent, snapshot: asked, expanded: expandedParam });

    // `expanded` selects the mixed payload, exactly as readMixedTier does: devices
    // for the named segments, aggregates for the rest, each node stamped with `tier`.
    if (expandedParam !== null) {
      const open = expandedParam.split(',').map((k) => k.trim()).filter(Boolean);
      const nodes = [
        ...DEVICES.filter((d) => open.includes(d.segment)).map((d) => ({ ...d, tier: 'device' })),
        ...SEGMENTS.filter((sg) => !open.includes(sg.key)).map((sg) => ({ ...sg, tier: 'segment' })),
      ];
      return route.fulfill({
        json: {
          group: 'test', nodes: applyNames(nodes), edges: edgesFor(nodes), zoom: 1, parent: '',
          expanded: open, mixed: true, snapshot_id: asked, segment_names: { ...segmentNames },
        },
      });
    }

    let nodes;
    if (zoom === 3) nodes = parent ? DEVICES.filter((d) => d.segment === parent) : DEVICES;
    else if (zoom === 1 || zoom === 2) nodes = SEGMENTS;
    else nodes = LOCALITIES;
    return route.fulfill({
      json: {
        group: 'test', nodes: applyNames(nodes), edges: edgesFor(nodes), zoom, parent,
        snapshot_id: asked, segment_names: { ...segmentNames },
      },
    });
  });

  // The one mutating topology route besides ingest.
  await page.route('**/api/topology/segment-name', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    const name = String(body.name || '').trim().slice(0, 60);
    if (name) segmentNames[body.key] = name; else delete segmentNames[body.key];
    return route.fulfill({ json: { group: 'test', key: body.key, name, names: { ...segmentNames } } });
  });
}

/** Same override the route applies: operator name wins, telemetry name kept. */
function applyNames(rows) {
  return rows.map((r) => (segmentNames[r.key]
    ? { ...r, name: segmentNames[r.key], telemetry_name: r.name, named: true }
    : r));
}

// Every /map query the client made, so a test can assert what it asked the server for.
let mapRequests = [];
// Operator segment names, as the durable TopoSegmentName store would hold them.
let segmentNames = {};

async function openMap(page) {
  await page.goto('/');
  await page.locator('.files-panel .rp-tab[data-rp="map"]').click();
  await expect(page.locator('#topology-overlay')).toBeVisible();
  // The canvas only un-hides once a payload with nodes has painted.
  await expect(page.locator('#topo-viewport')).toBeVisible();
}

test.describe('network map', () => {
  test.beforeEach(async ({ page }) => { mapRequests = []; segmentNames = {}; await stubTopology(page); });

  test('opens, paints, and keeps its floating chrome across a repaint', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));
    await openMap(page);

    await expect(page.locator('#topo-canvas canvas').first()).toBeVisible();
    await expect(page.locator('#topo-status')).toContainText('Segments');

    // Zoom + fit chrome is present...
    await expect(page.locator('.topo-zoom .topo-zoom-btn')).toHaveCount(3);

    // ...and survives a repaint. sigma.kill() empties its container on every
    // paint, so chrome parented to the canvas would silently disappear here.
    await page.locator('#topo-external').click();
    await expect(page.locator('#topo-external')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.topo-zoom .topo-zoom-btn')).toHaveCount(3);
    await page.locator('#topo-zoom-in').click();

    expect(pageErrors, `uncaught page errors: ${pageErrors.join(' | ')}`).toEqual([]);
  });

  test('finds a device by name and by IP', async ({ page }) => {
    await openMap(page);

    await page.locator('#topo-search').fill('nas');
    const list = page.locator('#topo-search-list');
    await expect(list).toBeVisible();
    await expect(list.locator('.topo-combo-item')).toHaveCount(1);
    await expect(list).toContainText('nas-backup-02.acme.lab');
    await expect(list).toContainText('10.42.0.117');
    await expect(list).toContainText('File server');
    await expect(list).toContainText('VLAN 20');

    // The index is the whole device tier, so an IP that is not on screen still hits.
    await page.locator('#topo-search').fill('10.42.30.');
    await expect(list.locator('.topo-combo-item')).toHaveCount(1);
    await expect(list).toContainText('ws-114.acme.lab');

    // Users are searchable too, from the identities already loaded for the snapshot.
    await page.locator('#topo-search').fill('svc_back');
    await expect(list).toContainText('svc_backup');
    await expect(list).toContainText('User · 1 device');

    await page.locator('#topo-search').fill('nothing-matches-this');
    await expect(list).toContainText('No device, IP or user matches that.');
  });

  test('selecting an off-screen device drills to its segment and inspects it', async ({ page }) => {
    await openMap(page);
    // Opens on the zone view: segments as containers, none opened, so no device yet.
    await expect(page.locator('#topo-status')).toContainText('Segments');

    await page.locator('#topo-search').fill('nas-backup');
    await page.locator('#topo-search-list .topo-combo-item').first().click();

    // Drilled to the device's segment...
    await expect(page.locator('#topo-status')).toContainText('Devices');
    await expect(page.locator('#topo-crumbs')).toContainText('VLAN 20');
    // ...and landed on the device itself.
    await expect(page.locator('.topo-ins-title')).toContainText('nas-backup-02.acme.lab');
    await expect(page.locator('.topo-inspector')).toContainText('10.42.0.117');
  });

  test('snapshot timeline renders one square per snapshot and switches on click', async ({ page }) => {
    await openMap(page);

    const squares = page.locator('#topo-snaps .topo-snap');
    await expect(squares).toHaveCount(SNAPSHOTS.length);

    // Newest is served first but drawn last, and starts selected.
    await expect(squares.nth(SNAPSHOTS.length - 1)).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('#topo-snap-label')).toContainText('4 devices');

    // Picking an older square refetches the map for that snapshot.
    await squares.nth(0).click();
    await expect(squares.nth(0)).toHaveAttribute('aria-checked', 'true');
    await expect(squares.nth(SNAPSHOTS.length - 1)).toHaveAttribute('aria-checked', 'false');
    await expect(page.locator('#topo-snap-label')).toContainText('2 devices');
    await expect.poll(() => mapRequests.some((r) => r.snapshot === 'snap-1')).toBe(true);
  });

  test('snapshot timeline is keyboard operable, as the select it replaced was', async ({ page }) => {
    await openMap(page);
    const squares = page.locator('#topo-snaps .topo-snap');

    // Roving tabindex: only the checked square is in the tab order.
    await expect(squares.nth(SNAPSHOTS.length - 1)).toHaveAttribute('tabindex', '0');
    await expect(squares.nth(0)).toHaveAttribute('tabindex', '-1');

    await squares.nth(SNAPSHOTS.length - 1).focus();
    await page.keyboard.press('ArrowLeft');
    await expect(squares.nth(SNAPSHOTS.length - 2)).toHaveAttribute('aria-checked', 'true');
    await expect(squares.nth(SNAPSHOTS.length - 2)).toBeFocused();
    await expect(page.locator('#topo-snap-label')).toContainText('3 devices');

    await page.keyboard.press('ArrowRight');
    await expect(squares.nth(SNAPSHOTS.length - 1)).toHaveAttribute('aria-checked', 'true');
  });

  test('composition chips count devices, and only where that count is honest', async ({ page }) => {
    await openMap(page);

    // Aggregate tier: a node's role is its DOMINANT role, so there is nothing
    // truthful to count and the chips stay empty.
    await expect(page.locator('#topo-status')).toContainText('Segments');
    await expect(page.locator('#topo-chips')).toBeEmpty();

    // Device tier: real per-device roles, so real counts.
    await page.locator('#topo-search').fill('nas-backup');
    await page.locator('#topo-search-list .topo-combo-item').first().click();
    await expect(page.locator('#topo-status')).toContainText('Devices');

    const chips = page.locator('#topo-chips .topo-chip');
    await expect(chips).toHaveCount(1); // vlan:20 holds a file server and a db server
    await expect(chips.first()).toContainText('Servers');
    await expect(chips.first()).toContainText('2');
  });

  test('opens on the zone view: a labelled container per segment, none opened', async ({ page }) => {
    await openMap(page);

    const zones = page.locator('.topo-zone-layer .topo-zone');
    await expect(zones).toHaveCount(SEGMENTS.length);
    await expect(page.locator('.topo-zone-layer .topo-zone-title').first()).toHaveText(/VLAN/);
    await expect(page.locator('.topo-zone-layer .topo-zone-sub').first()).toHaveText(/collapsed/);
    await expect(page.locator('.topo-zone.expanded')).toHaveCount(0);

    // The zone view asks for the mixed payload, with nothing open.
    expect(mapRequests.at(-1).expanded).toBe('');

    // The layer must cover the canvas. <svg> is a replaced element with an intrinsic
    // 300x150 size, so it silently keeps that size unless width/height are set — and
    // every zone outside that box is clipped, which looks like "zones do not work".
    const fits = await page.evaluate(() => {
      const layer = document.querySelector('.topo-zone-layer').getBoundingClientRect();
      const canvas = document.getElementById('topo-canvas').getBoundingClientRect();
      return {
        layer: { w: Math.round(layer.width), h: Math.round(layer.height) },
        canvas: { w: Math.round(canvas.width), h: Math.round(canvas.height) },
      };
    });
    expect(fits.layer).toEqual(fits.canvas);
  });

  test('a zone opens in place and closes again, without replacing the view', async ({ page }) => {
    await openMap(page);

    // Drive the click from the zone's own geometry rather than a guessed pixel.
    const box = async (title) => page.evaluate((want) => {
      const g = [...document.querySelectorAll('.topo-zone')]
        .find((n) => n.querySelector('.topo-zone-title')?.textContent === want);
      if (!g) return null;
      const r = g.querySelector('.topo-zone-rect');
      const v = (a) => Number(r.getAttribute(a));
      return {
        x: v('x'), y: v('y'), w: v('width'), h: v('height'),
        expanded: g.classList.contains('expanded'),
      };
    }, title);

    const collapsed = await box('VLAN 20');
    expect(collapsed, 'vlan:20 zone is drawn').not.toBeNull();
    expect(collapsed.expanded).toBe(false);

    // Clicking a collapsed zone opens it.
    await page.locator('#topo-canvas').click({
      position: { x: collapsed.x + collapsed.w / 2, y: collapsed.y + collapsed.h / 2 },
    });
    await expect.poll(() => mapRequests.at(-1)?.expanded).toBe('vlan:20');
    await expect(page.locator('.topo-zone.expanded')).toHaveCount(1);

    // Opening is not a drill: the other segments are still drawn, and the
    // breadcrumb has not moved.
    await expect(page.locator('.topo-zone-layer .topo-zone')).toHaveCount(SEGMENTS.length);
    await expect(page.locator('#topo-crumbs')).toContainText('All');
    await expect(page.locator('#topo-crumbs')).not.toContainText('VLAN 20');
    await expect(page.locator('#topo-status')).toContainText('4 nodes'); // 2 devices + 2 segments

    // Its label band closes it again.
    const open = await box('VLAN 20');
    expect(open.expanded).toBe(true);
    await page.locator('#topo-canvas').click({ position: { x: open.x + 40, y: open.y + 12 } });
    await expect.poll(() => mapRequests.at(-1)?.expanded).toBe('');
    await expect(page.locator('.topo-zone.expanded')).toHaveCount(0);
  });

  test('the mini-map shows every zone plus the camera footprint', async ({ page }) => {
    await openMap(page);

    await expect(page.locator('#topo-minimap')).toBeVisible();
    await expect(page.locator('.topo-mini-zone')).toHaveCount(SEGMENTS.length);
    await expect(page.locator('.topo-mini-view')).toHaveCount(1);

    // Every proxy sits inside the mini-map body — a zone drawn outside it is a
    // projection bug that no count would catch.
    const inside = await page.evaluate(() => {
      const body = document.getElementById('topo-mini-body').getBoundingClientRect();
      return [...document.querySelectorAll('.topo-mini-zone, .topo-mini-view')].every((el) => {
        const r = el.getBoundingClientRect();
        return r.left >= body.left - 1 && r.right <= body.right + 1
          && r.top >= body.top - 1 && r.bottom <= body.bottom + 1;
      });
    });
    expect(inside, 'a mini-map proxy escaped the mini-map').toBe(true);

    // Opening a zone is reflected there too.
    const box = await page.evaluate(() => {
      const g = [...document.querySelectorAll('.topo-zone')]
        .find((n) => n.querySelector('.topo-zone-title')?.textContent === 'VLAN 20');
      const r = g.querySelector('.topo-zone-rect'); const v = (a) => Number(r.getAttribute(a));
      return { x: v('x'), y: v('y'), w: v('width'), h: v('height') };
    });
    await page.locator('#topo-canvas').click({ position: { x: box.x + box.w / 2, y: box.y + box.h / 2 } });
    await expect(page.locator('.topo-mini-zone.expanded')).toHaveCount(1);
  });

  test('clicking the mini-map pans the camera there', async ({ page }) => {
    await openMap(page);
    const body = page.locator('#topo-mini-body');
    await expect(body).toBeVisible();

    // The viewport box is what moves; compare where it sits before and after.
    const viewLeft = () => page.evaluate(() => {
      const v = document.querySelector('.topo-mini-view');
      const b = document.getElementById('topo-mini-body').getBoundingClientRect();
      return v ? Math.round(v.getBoundingClientRect().left - b.left) : null;
    });
    const before = await viewLeft();

    // Zoom in first, or the viewport covers the whole estate and cannot move.
    await page.locator('#topo-zoom-in').click();
    await page.locator('#topo-zoom-in').click();
    await page.waitForTimeout(400);

    const rect = await body.boundingBox();
    await page.mouse.click(rect.x + rect.width * 0.85, rect.y + rect.height * 0.5);
    await page.waitForTimeout(500);

    const after = await viewLeft();
    expect(after, 'the camera footprint should have moved right').not.toBe(before);
  });

  test('the incident button states whether one is drawn, and clears again', async ({ page }) => {
    await openMap(page);

    const btn = page.locator('#topo-incident-btn');
    // Idle: ordinary chrome, saying what it does rather than what it is not. The old
    // entry point was a search box whose placeholder read "No overlay".
    await expect(btn).toHaveText(/Overlay an incident/);
    await expect(btn).not.toHaveClass(/active/);
    await expect(page.locator('#topo-incident-clear')).toBeHidden();
    await expect(page.locator('#topo-killchain')).toBeHidden();

    await btn.click();
    await expect(page.locator('#topo-incident-pop')).toBeVisible();
    await expect(page.locator('#topo-overlay-list .topo-combo-item')).toContainText([
      /No overlay/, /Lateral movement from nas-backup-02/,
    ]);

    await page.locator('#topo-overlay-list .topo-combo-item', { hasText: 'Lateral movement' }).click();
    await expect(page.locator('#topo-incident-pop')).toBeHidden();
    await expect(btn).toHaveClass(/active/);
    await expect(btn).toContainText('Lateral movement from nas-backup-02');
    await expect(page.locator('#topo-incident-clear')).toBeVisible();

    // Clearing returns the map to its plain state.
    await page.locator('#topo-incident-clear').click();
    await expect(btn).not.toHaveClass(/active/);
    await expect(btn).toHaveText(/Overlay an incident/);
    await expect(page.locator('#topo-killchain')).toBeHidden();
  });

  test('the kill chain is on the map, numbered and in order', async ({ page }) => {
    await openMap(page);
    await page.locator('#topo-incident-btn').click();
    await page.locator('#topo-overlay-list .topo-combo-item', { hasText: 'Lateral movement' }).click();

    const strip = page.locator('#topo-killchain');
    await expect(strip).toBeVisible();
    const stages = strip.locator('.topo-killchain-stage');
    await expect(stages).toHaveCount(3);
    await expect(stages.nth(0)).toContainText('Credential Access');
    await expect(stages.nth(1)).toContainText('Lateral Movement');
    await expect(stages.nth(2)).toContainText('Exfiltration');
    // Numbered, so the order reads as a sequence rather than a set.
    await expect(stages.nth(0).locator('.topo-killchain-num')).toHaveText('1');
    await expect(stages.nth(2).locator('.topo-killchain-num')).toHaveText('3');

    // Each stage carries its own colour from the MITRE ordering, not one alert red.
    const colours = await strip.locator('.topo-killchain-num').evaluateAll(
      (els) => els.map((el) => getComputedStyle(el).backgroundColor),
    );
    expect(new Set(colours).size, `stage colours: ${colours.join(', ')}`).toBe(3);

    // The inspector still carries the full sequence.
    await expect(page.locator('.topo-inspector')).toContainText('SMB writes to dc1 SYSVOL share');
  });

  /** Draw the one fixture incident over the map. */
  async function overlayIncident(page) {
    await page.locator('#topo-incident-btn').click();
    await page.locator('#topo-overlay-list .topo-combo-item', { hasText: 'Lateral movement' }).click();
    await expect(page.locator('#topo-incident-btn')).toHaveClass(/active/);
  }

  test('the incident is drawn as directed, numbered, staged paths', async ({ page }) => {
    await openMap(page);
    await overlayIncident(page);

    const paths = page.locator('.topo-attack-layer .topo-attack-path');
    await expect(paths).toHaveCount(3); // ws→nas, nas→dc1, nas→external

    // Direction: every path carries an arrowhead. A sigma edge could not.
    const markers = await paths.evaluateAll((els) => els.map((e) => e.getAttribute('marker-end')));
    expect(markers.every((m) => /^url\(#topo-arrow-/.test(m || ''))).toBe(true);

    // Stage colour, not one alert red: three steps, three MITRE stages.
    const strokes = await paths.evaluateAll((els) => els.map((e) => getComputedStyle(e).stroke));
    expect(new Set(strokes).size, `path colours: ${strokes.join(', ')}`).toBe(3);

    // Numbered in sequence order.
    const nums = await page.locator('.topo-attack-badge-num').allTextContents();
    expect(nums.sort()).toEqual(['1', '2', '3']);

    // Patient zero is marked, and the endpoint outside the estate is dashed.
    await expect(page.locator('.topo-attack-zero')).toHaveCount(1);
    await expect(page.locator('.topo-attack-external-ring')).toHaveCount(1);
  });

  test('the layer covers the canvas and sits above it', async ({ page }) => {
    await openMap(page);
    await overlayIncident(page);
    const geom = await page.evaluate(() => {
      const canvas = document.getElementById('topo-canvas');
      const attack = canvas.querySelector('svg.topo-attack-layer');
      const zone = canvas.querySelector('svg.topo-zone-layer');
      const kids = [...canvas.children];
      const box = (el) => { const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; };
      const c = canvas.getBoundingClientRect();
      return {
        attack: box(attack),
        canvas: { w: Math.round(c.width), h: Math.round(c.height) },
        zoneBeforeCanvases: kids.indexOf(zone) < kids.findIndex((k) => k.tagName === 'CANVAS'),
        attackAfterCanvases: kids.indexOf(attack) > kids.findLastIndex((k) => k.tagName === 'CANVAS'),
      };
    });
    // Same replaced-element trap the zone layer hit: an <svg> without an explicit
    // size keeps its intrinsic 300x150 and clips everything outside it.
    expect(geom.attack).toEqual(geom.canvas);
    // Zones under the nodes, attack paths over them — a badge behind a node is unreadable.
    expect(geom.zoneBeforeCanvases).toBe(true);
    expect(geom.attackAfterCanvases).toBe(true);
  });

  test('a sequence step and its path on the map are the same object', async ({ page }) => {
    await openMap(page);
    await overlayIncident(page);

    const rows = page.locator('.topo-ev[data-pair]');
    await expect(rows).toHaveCount(3);

    // Hovering a step lights its path and mutes the others.
    await rows.nth(1).hover();
    await expect(page.locator('.topo-attack-path.lit')).toHaveCount(1);
    await expect(page.locator('.topo-attack-path.muted')).toHaveCount(2);

    await page.locator('#topo-incident-btn').hover(); // away from the row
    await expect(page.locator('.topo-attack-path.lit')).toHaveCount(0);
  });

  test('reduced motion freezes the attack paths without erasing them', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openMap(page);
    await overlayIncident(page);

    const path = page.locator('.topo-attack-path').first();
    await expect(path).toHaveCount(1);
    const style = await path.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { duration: cs.animationDuration, dasharray: cs.strokeDasharray, opacity: cs.opacity };
    });
    // Motion stops...
    expect(parseFloat(style.duration)).toBeLessThan(0.05);
    // ...but the route is still a visible, directed, dashed line. Freeze, don't hide.
    expect(style.dasharray).toMatch(/\d/);
    expect(Number(style.opacity)).toBeGreaterThan(0.5);
  });

  /** Open the inspector on nas-backup-02 via search. */
  async function inspectNas(page) {
    await page.locator('#topo-search').fill('nas-backup');
    await page.locator('#topo-search-list .topo-combo-item').first().click();
    await expect(page.locator('.topo-ins-title')).toContainText('nas-backup-02');
  }

  test('the inspector plots the device across snapshots', async ({ page }) => {
    await openMap(page);
    await inspectNas(page);

    const trend = page.locator('#topo-trend');
    await expect(trend).toContainText('Traffic · 3 snapshots');
    // The axis names the series honestly: snapshots, not a fixed window.
    await expect(trend.locator('.topo-spark-axis span').first()).toHaveText(/Aug 1/);
    await expect(trend.locator('.topo-spark-axis span').last()).toHaveText(/Aug 3/);

    // Latest totals, not a sum over the series.
    await expect(trend.locator('.topo-tile').first()).toContainText('412.0 MB');
    await expect(trend.locator('.topo-tile').last()).toContainText('7');

    // The line is a real polyline over the three points, drawn inside its box.
    const d = await trend.locator('.topo-spark-line').getAttribute('d');
    expect((d.match(/L/g) || []).length).toBe(2);
    const ys = [...d.matchAll(/[ML]([\d.]+),([\d.]+)/g)].map((m) => Number(m[2]));
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...ys)).toBeLessThanOrEqual(44);
    // The peak snapshot is the highest point, i.e. the smallest y.
    expect(ys[2]).toBeLessThan(ys[0]);
  });

  test('investigate hands the device to the composer with its context', async ({ page }) => {
    await openMap(page);
    await inspectNas(page);
    await page.locator('#topo-investigate').click();

    // The map closes, because the composer is behind it.
    await expect(page.locator('#topology-overlay')).toBeHidden();
    const input = page.locator('#input');
    await expect(input).toBeFocused();
    const text = await input.inputValue();
    // Structured, not a name drop: identity plus which snapshot it was seen in.
    expect(text).toContain('nas-backup-02.acme.lab');
    expect(text).toContain('10.42.0.117');
    expect(text).toContain('dev:nas');
    expect(text).toMatch(/snapshot Aug 3/);
  });

  test('investigate carries the incident step when one is drawn', async ({ page }) => {
    await openMap(page);
    await overlayIncident(page);
    await inspectNas(page);
    await page.locator('#topo-investigate').click();

    const text = await page.locator('#input').inputValue();
    expect(text).toContain('Lateral movement from nas-backup-02');
    // nas is the destination of step 1 and the source of steps 2 and 3; the first
    // step naming it is the one that explains why it is interesting.
    expect(text).toMatch(/step 1 \(Credential Access\)/);
  });

  test('the matrix squares off traffic, and keeps the diagonal', async ({ page }) => {
    await openMap(page);
    await page.locator('.topo-view[data-view="matrix"]').click();

    const grid = page.locator('.topo-matrix-grid');
    await expect(grid).toBeVisible();
    // 3 groups: 3 column heads, 3 row heads, 9 cells.
    await expect(page.locator('.topo-matrix-col')).toHaveCount(3);
    await expect(page.locator('.topo-matrix-row')).toHaveCount(3);
    await expect(page.locator('.topo-cell')).toHaveCount(9);
    await expect(page.locator('.topo-cell.diagonal')).toHaveCount(3);

    // The topology is put away rather than left underneath.
    await expect(page.locator('#topo-viewport')).toBeHidden();
    await expect(page.locator('#topo-matrix-controls')).toBeVisible();
  });

  test('the diagonal has its own scale, so it cannot flatten the rest', async ({ page }) => {
    await openMap(page);
    await page.locator('.topo-view[data-view="matrix"]').click();

    const alpha = (src, dst) => page.locator(`.topo-cell[data-src="${src}"][data-dst="${dst}"]`)
      .evaluate((el) => Number(el.style.getPropertyValue('--cell-alpha')));

    // vlan:20→itself is 13.8 GB, an order of magnitude over the heaviest pair. If it
    // shared the ramp, every off-diagonal cell would collapse toward invisible.
    const diagonal = await alpha('vlan:20', 'vlan:20');
    const heaviestPair = await alpha('vlan:30', 'vlan:20');
    const lightPair = await alpha('vlan:20', 'vlan:10');

    expect(diagonal).toBeGreaterThan(0.6);       // saturated on its own scale
    expect(heaviestPair).toBeGreaterThan(0.6);   // and so is the heaviest real pair
    // The off-diagonal cells still separate from each other.
    expect(heaviestPair - lightPair).toBeGreaterThan(0.1);
  });

  test('a cell opens the conversations behind it, and hands them to the topology', async ({ page }) => {
    await openMap(page);
    await page.locator('.topo-view[data-view="matrix"]').click();
    await page.locator('.topo-cell[data-src="vlan:30"][data-dst="vlan:20"]').click();

    const rail = page.locator('.topo-inspector');
    await expect(rail).toContainText('VLAN 30 → VLAN 20');
    // The cell's own total, from the matrix model rather than a second fetch.
    await expect(rail).toContainText('1.6 GB');
    await expect(rail).toContainText('27 conversations');
    await expect(rail).toContainText('nas-backup-02.acme.lab');
    await expect(rail).toContainText('dc1.acme.lab');

    // "Show these pairs" returns to the topology scoped to exactly those devices.
    await page.locator('#topo-pairs-show').click();
    await expect(page.locator('#topo-viewport')).toBeVisible();
    await expect(page.locator('.topo-view[data-view="topology"]')).toHaveClass(/active/);
    await expect(page.locator('#topo-crumbs')).toContainText('VLAN 30 → VLAN 20');
  });

  test('a diagonal cell says what it is', async ({ page }) => {
    await openMap(page);
    await page.locator('.topo-view[data-view="matrix"]').click();
    await page.locator('.topo-cell[data-src="vlan:20"][data-dst="vlan:20"]').click();
    const rail = page.locator('.topo-inspector');
    await expect(rail).toContainText('within the group');
    await expect(rail).toContainText(/East-west movement looks like this/);
  });

  test('the matrix lights the cells the overlaid incident crossed', async ({ page }) => {
    await openMap(page);
    await overlayIncident(page);
    await page.locator('.topo-view[data-view="matrix"]').click();

    // ws→nas crosses vlan:30→vlan:20 and nas→dc1 crosses vlan:20→vlan:10; the
    // exfil step targets an external actor that is not an axis, so no third cell.
    const hot = page.locator('.topo-cell.incident');
    await expect(hot).toHaveCount(2);
    await expect(page.locator('.topo-cell.incident[data-src="vlan:30"][data-dst="vlan:20"]')).toBeVisible();
    await expect(page.locator('.topo-cell.incident[data-src="vlan:20"][data-dst="vlan:10"]')).toBeVisible();
    await expect(page.locator('.topo-matrix-legend')).toContainText('incident traffic');

    // The selected cell says which steps crossed it, and flags their conversations.
    await page.locator('.topo-cell[data-src="vlan:20"][data-dst="vlan:10"]').click();
    const rail = page.locator('.topo-inspector');
    await expect(rail).toContainText('This cell carries the overlaid incident');
    await expect(rail).toContainText('Step 2 · Lateral Movement · nas-backup-02.acme.lab → dc1.acme.lab');
    await expect(page.locator('.topo-pairs li.incident')).toHaveCount(1);
    await expect(page.locator('.topo-pairs li.incident')).toContainText('nas-backup-02.acme.lab');
  });

  test('picking or clearing an incident while on the matrix redraws it in place', async ({ page }) => {
    await openMap(page);
    await page.locator('.topo-view[data-view="matrix"]').click();
    await expect(page.locator('.topo-cell.incident')).toHaveCount(0);

    await overlayIncident(page);
    await expect(page.locator('.topo-cell.incident')).toHaveCount(2);

    await page.locator('#topo-incident-clear').click();
    await expect(page.locator('.topo-cell.incident')).toHaveCount(0);
    await expect(page.locator('.topo-matrix-legend')).not.toContainText('incident traffic');
  });

  test('naming a segment relabels it everywhere, and survives a repaint', async ({ page }) => {
    await openMap(page);
    // Telemetry can only name a segment by its VLAN or subnet.
    await expect(page.locator('.topo-zone-title').first()).toContainText('VLAN');

    await page.locator('#topo-name-zones').click();
    const rail = page.locator('.topo-inspector');
    await expect(rail).toContainText('Name zones');
    // Every segment listed once, biggest first, telemetry label kept beside the input.
    await expect(page.locator('.topo-names li')).toHaveCount(3);
    await expect(page.locator('.topo-name-key').first()).toHaveText('VLAN 20');

    const input = page.locator('.topo-name-input[data-key="vlan:20"]');
    await input.fill('Storage & Backup');
    await input.press('Enter');
    await expect(page.locator('#topo-name-status')).toContainText('Named VLAN 20 → Storage & Backup');

    // The zone container is labelled from the key, so this is the case that proves
    // the name reached more than the nodes in the payload.
    await expect(page.locator('.topo-zone-title', { hasText: 'STORAGE & BACKUP' })).toBeVisible();

    // And the matrix axes, which are the same segments.
    await page.locator('.topo-view[data-view="matrix"]').click();
    await expect(page.locator('.topo-matrix-col', { hasText: 'Storage & Backup' })).toBeVisible();
  });

  test('clearing a name goes back to the telemetry label', async ({ page }) => {
    await openMap(page);
    await page.locator('#topo-name-zones').click();
    const input = page.locator('.topo-name-input[data-key="vlan:20"]');
    await input.fill('Storage & Backup');
    await input.press('Enter');
    await expect(page.locator('.topo-zone-title', { hasText: 'STORAGE & BACKUP' })).toBeVisible();

    await page.locator('#topo-name-zones').click();
    await page.locator('.topo-name-input[data-key="vlan:20"]').fill('');
    await page.locator('.topo-name-input[data-key="vlan:20"]').press('Enter');
    await expect(page.locator('#topo-name-status')).toContainText('back to its telemetry label');
    await expect(page.locator('.topo-zone-title', { hasText: 'VLAN 20' })).toBeVisible();
  });

  test('a node can be dragged clear of the pile without opening it', async ({ page }) => {
    await openMap(page);
    // A collapsed zone holds exactly its one aggregate node, so the zone container's
    // centre is where that node is drawn — and the container is in the DOM, which is
    // how the drag is observed without reaching into the renderer.
    const rect = page.locator('.topo-zone[data-key="vlan:20"] .topo-zone-rect');
    const boxOf = async () => JSON.parse(await rect.evaluate(
      (r) => JSON.stringify({ x: +r.getAttribute('x'), y: +r.getAttribute('y') })));

    const before = await boxOf();
    const canvas = await page.locator('#topo-canvas').boundingBox();
    const svgBox = await rect.boundingBox();
    const cx = svgBox.x + svgBox.width / 2;
    const cy = svgBox.y + svgBox.height / 2;

    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 100, cy + 70, { steps: 12 });
    await page.mouse.up();

    const after = await boxOf();
    expect(Math.abs(after.x - before.x) + Math.abs(after.y - before.y)).toBeGreaterThan(10);
    // Moving a node to read it is not a request to drill into it.
    await expect(page.locator('#topo-crumbs')).not.toContainText('VLAN 20');
    expect(canvas).toBeTruthy();
  });

  test('a plain click still drills in, because a click is not a drag', async ({ page }) => {
    await openMap(page);
    const rect = page.locator('.topo-zone[data-key="vlan:20"] .topo-zone-rect');
    const svgBox = await rect.boundingBox();
    // Same press point, no travel: the zone opens, as it always did.
    await page.mouse.click(svgBox.x + svgBox.width / 2, svgBox.y + svgBox.height / 2);
    await expect(page.locator('.topo-zone[data-key="vlan:20"]')).toHaveClass(/expanded/);
  });

  test('a zero-width first paint recovers instead of wedging the map', async ({ page }) => {
    await openMap(page);
    // Reproduce the trap: Sigma throws when it measures a container with no box, and
    // the old error path hid the viewport — so the container stayed unmeasurable and
    // every retry threw identically, behind a message blaming the server.
    await page.evaluate(() => {
      const vp = document.getElementById('topo-viewport');
      vp.style.width = '0px';
      vp.style.height = '0px';
    });
    await page.locator('#topo-refresh').click();
    await expect(page.locator('#topo-empty')).not.toContainText('Could not reach the topology service');

    // Give it a box back; it should draw itself without another click.
    await page.evaluate(() => {
      const vp = document.getElementById('topo-viewport');
      vp.style.width = '';
      vp.style.height = '';
    });
    await expect(page.locator('#topo-viewport')).toBeVisible();
    await expect(page.locator('.topo-zone-rect').first()).toBeVisible({ timeout: 8000 });
  });

  test('the matrix is a real ARIA grid — rows, headers, and named cells', async ({ page }) => {
    await openMap(page);
    await page.locator('.topo-view[data-view="matrix"]').click();

    // A header row plus one row per axis, each carrying its cells.
    await expect(page.locator('.topo-matrix-grid[role="grid"]')).toHaveCount(1);
    await expect(page.locator('.topo-matrix-grid > [role="row"]')).toHaveCount(4); // header + 3 axes
    await expect(page.locator('[role="columnheader"]')).toHaveCount(4);            // corner + 3 axes
    await expect(page.locator('[role="rowheader"]')).toHaveCount(3);
    // Every cell is inside a row, so it has coordinates.
    await expect(page.locator('[role="row"] [role="gridcell"]')).toHaveCount(9);

    // The name states the pair and the value, not just the printed number.
    await expect(page.locator('.topo-cell[data-src="vlan:30"][data-dst="vlan:20"]'))
      .toHaveAttribute('aria-label', 'VLAN 30 to VLAN 20: 1.6 GB');
    await expect(page.locator('.topo-cell[data-src="vlan:20"][data-dst="vlan:20"]'))
      .toHaveAttribute('aria-label', /within itself/);
  });

  test('an empty cell stays reachable and says it is empty', async ({ page }) => {
    await openMap(page);
    await page.locator('.topo-view[data-view="matrix"]').click();
    // vlan:10 → vlan:10 has no traffic in the fixture.
    const empty = page.locator('.topo-cell[data-src="vlan:10"][data-dst="vlan:10"]');
    await expect(empty).toHaveAttribute('aria-disabled', 'true');
    await expect(empty).not.toHaveAttribute('disabled', /.*/); // a disabled button is skipped entirely
    await expect(empty).toHaveAttribute('aria-label', /no traffic/);
    // Reachable by keyboard — the whole point of aria-disabled over disabled.
    await empty.focus();
    await expect(empty).toBeFocused();
    // Dispatched rather than clicked: Playwright's actionability check treats
    // aria-disabled as not-enabled and refuses, which is itself the correct
    // behaviour. This asserts the handler declines even if a click does land.
    await empty.dispatchEvent('click');
    await expect(page.locator('.topo-inspector')).not.toContainText('Selected cell');
  });

  test('the grid has one tab stop, and arrows move it', async ({ page }) => {
    await openMap(page);
    await page.locator('.topo-view[data-view="matrix"]').click();

    // Exactly one cell is in the tab order — not one per cell.
    await expect(page.locator('.topo-cell[tabindex="0"]')).toHaveCount(1);

    const first = page.locator('.topo-cell[tabindex="0"]');
    const startSrc = await first.getAttribute('data-src');
    await first.focus();
    await page.keyboard.press('ArrowDown');
    const moved = page.locator('.topo-cell:focus');
    await expect(moved).toHaveAttribute('data-src', /.+/);
    expect(await moved.getAttribute('data-src')).not.toBe(startSrc); // moved a row
    // The tab stop moved with focus rather than multiplying.
    await expect(page.locator('.topo-cell[tabindex="0"]')).toHaveCount(1);

    await page.keyboard.press('ArrowRight');
    await expect(page.locator('.topo-cell[tabindex="0"]')).toHaveCount(1);
  });

  test('changes lead with severity, and fold the churn away', async ({ page }) => {
    await openMap(page);
    await page.locator('.topo-view[data-view="changes"]').click();

    await expect(page.locator('.topo-sev-chip.high')).toHaveText('2 high');
    await expect(page.locator('.topo-sev-chip.medium')).toHaveText('1 medium');

    // High and medium are open; info is collapsed behind its own count, because
    // normal churn should not sit between the analyst and the two real findings.
    await expect(page.locator('.topo-change-list[data-sev="high"] .topo-change')).toHaveCount(2);
    await expect(page.locator('.topo-change-list[data-sev="medium"] .topo-change')).toHaveCount(1);
    await expect(page.locator('.topo-change-list[data-sev="info"]')).toBeHidden();
    await expect(page.locator('#topo-changes-info')).toHaveText(/Show 2 info changes/);

    await page.locator('#topo-changes-info').click();
    await expect(page.locator('.topo-change-list[data-sev="info"]')).toBeVisible();
    await expect(page.locator('#topo-changes-info')).toHaveText(/Hide 2 info changes/);

    // High severity is findable by shape, not only by reading.
    await expect(page.locator('.topo-change.high')).toHaveCount(2);
    await expect(page.locator('.topo-changes-foot')).toContainText('3 → 4 devices');
  });

  test('a change links to its place on the map', async ({ page }) => {
    await openMap(page);
    await page.locator('.topo-view[data-view="changes"]').click();

    // The identity change is about two devices, not the identity's own name.
    await page.locator('.topo-change.high').first().locator('.topo-change-show').click();

    await expect(page.locator('.topo-view[data-view="topology"]')).toHaveClass(/active/);
    await expect(page.locator('#topo-viewport')).toBeVisible();
    await expect(page.locator('#topo-crumbs')).toContainText('svc_backup authenticated');
    // Scoped by explicit keys, which is the one scope that always resolves.
    await expect.poll(() => mapRequests.at(-1)?.expanded).toBe(null);
  });

  test('the map remembers the comparison after you leave the changes view', async ({ page }) => {
    await openMap(page);
    await page.locator('.topo-view[data-view="changes"]').click();
    await expect(page.locator('.topo-sev-chip.high')).toBeVisible();

    await page.locator('.topo-view[data-view="topology"]').click();
    // Looking at what changed and then looking at the map should not lose the answer.
    await expect(page.locator('#topo-status')).toContainText('5 changes');
  });

  test('escape closes the incident picker before it closes the map', async ({ page }) => {
    await openMap(page);
    await page.locator('#topo-incident-btn').click();
    await expect(page.locator('#topo-incident-pop')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.locator('#topo-incident-pop')).toBeHidden();
    await expect(page.locator('#topology-overlay')).toBeVisible();
  });

  test('zone strokes are explicit per theme, not an alpha of the fill', async ({ page }) => {
    for (const theme of ['light', 'dark']) {
      await page.goto('/');
      await page.evaluate((t) => localStorage.setItem('eh-theme', t), theme);
      await openMap(page);
      const stroke = await page.locator('.topo-zone-rect').first()
        .evaluate((el) => getComputedStyle(el).stroke);
      // A resolved colour, and not transparent: the boundary is what says "region",
      // and a 4-5% tint of the fill all but disappears on the light canvas.
      expect(stroke, `${theme} zone stroke`).toMatch(/^rgb\(/);
      expect(stroke, `${theme} zone stroke`).not.toBe('rgba(0, 0, 0, 0)');
    }
  });

  test('slash focuses search, and escape closes the list without closing the map', async ({ page }) => {
    await openMap(page);

    await page.locator('#topo-canvas').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('/');
    await expect(page.locator('#topo-search')).toBeFocused();

    await page.locator('#topo-search').fill('dc1');
    await expect(page.locator('#topo-search-list')).toBeVisible();

    // First Escape dismisses the result list only.
    await page.keyboard.press('Escape');
    await expect(page.locator('#topo-search-list')).toBeHidden();
    await expect(page.locator('#topology-overlay')).toBeVisible();

    // A second Escape, with no list open, closes the map as it always has.
    await page.keyboard.press('Escape');
    await expect(page.locator('#topology-overlay')).toBeHidden();
  });
});
