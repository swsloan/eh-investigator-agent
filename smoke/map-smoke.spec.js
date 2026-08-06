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

/** Stub every topology route the map touches, shaped like routes/topology.js. */
async function stubTopology(page) {
  await page.route('**/api/topology/snapshots**', (route) => route.fulfill({
    json: { group: 'test', snapshots: SNAPSHOTS },
  }));

  await page.route('**/api/topology/incidents**', (route) => route.fulfill({ json: { incidents: [] } }));

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
          group: 'test', nodes, edges: edgesFor(nodes), zoom: 1, parent: '',
          expanded: open, mixed: true, snapshot_id: asked,
        },
      });
    }

    let nodes;
    if (zoom === 3) nodes = parent ? DEVICES.filter((d) => d.segment === parent) : DEVICES;
    else if (zoom === 1 || zoom === 2) nodes = SEGMENTS;
    else nodes = LOCALITIES;
    return route.fulfill({
      json: { group: 'test', nodes, edges: edgesFor(nodes), zoom, parent, snapshot_id: asked },
    });
  });
}

// Every /map query the client made, so a test can assert what it asked the server for.
let mapRequests = [];

async function openMap(page) {
  await page.goto('/');
  await page.locator('.files-panel .rp-tab[data-rp="map"]').click();
  await expect(page.locator('#topology-overlay')).toBeVisible();
  // The canvas only un-hides once a payload with nodes has painted.
  await expect(page.locator('#topo-viewport')).toBeVisible();
}

test.describe('network map', () => {
  test.beforeEach(async ({ page }) => { mapRequests = []; await stubTopology(page); });

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
