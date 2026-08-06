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

const SNAPSHOT = 'snap-1';

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
    json: { group: 'test', snapshots: [{ id: SNAPSHOT, collected_at: '2026-08-03T22:52:00Z', window: '7d', device_count: DEVICES.length, edge_count: 3, truncated: false }] },
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
    let nodes;
    if (zoom === 3) nodes = parent ? DEVICES.filter((d) => d.segment === parent) : DEVICES;
    else if (zoom === 1) nodes = SEGMENTS;
    else if (zoom === 2) nodes = SEGMENTS;
    else nodes = LOCALITIES;
    return route.fulfill({
      json: { group: 'test', nodes, edges: edgesFor(nodes), zoom, parent, snapshot_id: SNAPSHOT },
    });
  });
}

async function openMap(page) {
  await page.goto('/');
  await page.locator('.files-panel .rp-tab[data-rp="map"]').click();
  await expect(page.locator('#topology-overlay')).toBeVisible();
  // The canvas only un-hides once a payload with nodes has painted.
  await expect(page.locator('#topo-viewport')).toBeVisible();
}

test.describe('network map', () => {
  test.beforeEach(async ({ page }) => { await stubTopology(page); });

  test('opens, paints, and keeps its floating chrome across a repaint', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));
    await openMap(page);

    await expect(page.locator('#topo-canvas canvas').first()).toBeVisible();
    await expect(page.locator('#topo-status')).toContainText('Localities');

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
    // Opens at the locality tier, so no device is painted yet.
    await expect(page.locator('#topo-status')).toContainText('Localities');

    await page.locator('#topo-search').fill('nas-backup');
    await page.locator('#topo-search-list .topo-combo-item').first().click();

    // Drilled to the device's segment...
    await expect(page.locator('#topo-status')).toContainText('Devices');
    await expect(page.locator('#topo-crumbs')).toContainText('VLAN 20');
    // ...and landed on the device itself.
    await expect(page.locator('.topo-ins-title')).toContainText('nas-backup-02.acme.lab');
    await expect(page.locator('.topo-inspector')).toContainText('10.42.0.117');
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
