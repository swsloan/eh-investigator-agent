// Network topology map — the semantic-zoom renderer (Slice B).
//
// This module ONLY renders. Node positions are computed server-side
// (lib/topology-layout.js) and arrive on every node as x/y, so we bind coordinates
// and paint immediately: no force simulation, no layout library in the browser.
// That is deliberate — laying out thousands of nodes on the main thread freezes the
// UI for seconds, and the CSP (`worker-src 'none'`) rules out a layout worker.
//
// Zoom behaves like a map. The server serves one level-of-detail tier at a time —
// localities → segments → role clusters → devices — so the wire payload stays
// bounded regardless of estate size. Because aggregate positions are the centroid
// of their members, zooming in expands a cluster IN PLACE rather than teleporting.
//
// Sigma + graphology load as plain UMD globals (window.Sigma / window.graphology)
// from same-origin <script> tags, which is what keeps this working under the strict
// CSP with no inline script and no bundler.

import { $ } from './dom.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Tier names, indexed by zoom level — mirrors TIER_QUERY in lib/topology-store.js.
const TIERS = ['Localities', 'Segments', 'Roles', 'Devices'];

// Camera ratio thresholds that select a tier. Sigma's ratio shrinks as you zoom IN,
// so the bands run large→small. HYSTERESIS keeps a tier switch from flapping when
// the camera hovers exactly on a boundary.
const TIER_BANDS = [0.62, 0.28, 0.12]; // >0.62 = tier 0, >0.28 = 1, >0.12 = 2, else 3
const HYSTERESIS = 0.18;

// Role → hue. Mid-tone so they read on both light and dark themes, matching the
// TYPE_COLOR convention in memory.js. Shape/label carry the meaning too, so the map
// survives greyscale and colour-vision deficiency.
const ROLE_COLOR = {
  domain_controller: '#8b5cf6',
  db_server: '#6366f1',
  file_server: '#3b82f6',
  http_server: '#0ea5e9',
  web_proxy: '#06b6d4',
  dns_server: '#14b8a6',
  dhcp_server: '#14b8a6',
  gateway: '#f59e0b',
  nat_gateway: '#f59e0b',
  firewall: '#ef4444',
  load_balancer: '#f97316',
  vpn_gateway: '#a855f7',
  pc: '#64748b',
  mobile_device: '#64748b',
  printer: '#94a3b8',
  ip_camera: '#94a3b8',
  medical_device: '#10b981',
  other: '#9ca3af',
  unknown: '#9ca3af',
};
const LOCALITY_COLOR = { Internal: '#3b82f6', External: '#ef4444', Unknown: '#9ca3af' };

/**
 * Sigma paints into a canvas, which cannot read CSS variables — so the theme-dependent
 * colours have to be resolved in JS at paint time and re-resolved when the theme
 * changes. Node hues are fixed brand/semantic values that work on both themes; only
 * the label and edge colours need to flip.
 */
function themeColors() {
  const css = getComputedStyle(document.documentElement);
  const dark = document.documentElement.getAttribute('data-theme') === 'dark'
    || (!document.documentElement.getAttribute('data-theme')
        && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  return {
    label: css.getPropertyValue('--ink').trim() || (dark ? '#ececf2' : '#1a1a22'),
    // Edges need enough contrast against the canvas in both directions. A light
    // background washes out a translucent line far more than a dark one does, so the
    // light theme gets a darker, more opaque stroke rather than the same value.
    edge: dark ? 'rgba(150,162,196,0.42)' : 'rgba(60,72,104,0.62)',
  };
}

// MITRE ATT&CK tactics in kill-chain order — must stay in lockstep with TACTICS in
// lib/attack-overlay.js, which assigns each event its stage index.
const TACTIC_ORDER = [
  'Reconnaissance', 'Resource Development', 'Initial Access', 'Execution',
  'Persistence', 'Privilege Escalation', 'Defense Evasion', 'Credential Access',
  'Discovery', 'Lateral Movement', 'Collection', 'Command and Control',
  'Exfiltration', 'Impact',
];

// Kill-chain stage colours, cool → hot along the attack. Matches the flow strip in
// the investigation report templates so the map and the report read alike.
const STAGE_COLOR = [
  '#64748b', '#64748b',                       // Reconnaissance, Resource Development
  '#0ea5e9', '#06b6d4',                       // Initial Access, Execution
  '#14b8a6', '#a3a635',                       // Persistence, Privilege Escalation
  '#eab308', '#f59e0b',                       // Defense Evasion, Credential Access
  '#f97316', '#ef4444',                       // Discovery, Lateral Movement
  '#dc2626', '#c026d3',                       // Collection, Command and Control
  '#b91c1c', '#7f1d1d',                       // Exfiltration, Impact
];

let sigma = null;
let graph = null;
let lastData = null;   // last painted tier, so a theme flip can repaint without refetching
let overlay = null;    // the incident currently drawn on top, or null for the plain map
let state = {
  group: '',
  snapshotId: '',
  zoom: 0,
  parent: '',
  crumbs: [],          // [{zoom, parent, label, keys}] — the drill-down path
  keys: null,          // explicit device set (the attack overlay's participants)
  loading: false,
  autoTier: true,      // camera-driven LOD; suspended while drilled into a cluster
};

function colorFor(node, zoom) {
  // Every tier carries meaning in its colour rather than going flat blue in the
  // middle: localities and the segments inside them share the locality hue, while
  // role clusters and devices share the role hue — so a colour you learn at one
  // zoom still means the same thing at the next.
  if (zoom === 0) return LOCALITY_COLOR[node.name] || LOCALITY_COLOR.Unknown;
  if (zoom === 1) return LOCALITY_COLOR[node.parent] || LOCALITY_COLOR.Unknown;
  if (zoom === 2) return ROLE_COLOR[node.name] || ROLE_COLOR.unknown;
  return ROLE_COLOR[node.role] || ROLE_COLOR.unknown;
}

/** Aggregates scale with the devices they contain; devices scale with criticality. */
function sizeFor(node, zoom) {
  if (zoom === 3) return node.critical ? 9 : 5;
  const n = Number(node.device_count) || 1;
  return Math.max(6, Math.min(26, 5 + Math.sqrt(n) * 2.2));
}

function tierForRatio(ratio, current) {
  let tier = TIER_BANDS.findIndex((b) => ratio > b);
  tier = tier === -1 ? TIERS.length - 1 : tier;
  if (tier === current) return current;
  // Require the camera to cross the boundary by a margin before switching, so a
  // ratio sitting on a threshold doesn't oscillate between two tiers.
  const boundary = TIER_BANDS[Math.min(tier, current)];
  const margin = boundary * HYSTERESIS;
  if (Math.abs(ratio - boundary) < margin) return current;
  return tier;
}

function setStatus(html) {
  const el = $('topo-status');
  if (el) el.innerHTML = html;
}

function renderCrumbs() {
  const el = $('topo-crumbs');
  if (!el) return;
  const parts = [`<button type="button" class="topo-crumb" data-idx="-1">All</button>`];
  state.crumbs.forEach((c, i) => {
    parts.push(`<span class="topo-crumb-sep">›</span><button type="button" class="topo-crumb" data-idx="${i}">${esc(c.label)}</button>`);
  });
  el.innerHTML = parts.join('');
  el.querySelectorAll('.topo-crumb').forEach((b) => b.addEventListener('click', () => {
    const idx = Number(b.dataset.idx);
    state.crumbs = idx < 0 ? [] : state.crumbs.slice(0, idx + 1);
    const last = state.crumbs[state.crumbs.length - 1];
    state.parent = last?.parent || '';
    state.zoom = last ? last.zoom : 0;
    state.keys = last?.keys || null;   // leaving the incident view drops its key scope
    state.autoTier = state.crumbs.length === 0;
    load();
  }));
}

function inspector(html) {
  const el = $('topo-inspector');
  if (el) el.innerHTML = html;
}

function bytes(n) {
  const v = Number(n) || 0;
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)} GB`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)} MB`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)} KB`;
  return `${v} B`;
}

async function showDevice(key) {
  inspector('<div class="topo-inspector-empty panel-sub">Loading…</div>');
  try {
    const params = new URLSearchParams({ group: state.group, snapshot: state.snapshotId });
    const res = await fetch(`/api/topology/node/${encodeURIComponent(key)}?${params}`);
    if (!res.ok) { inspector('<div class="topo-inspector-empty panel-sub">No detail for this device.</div>'); return; }
    const { device, peers, identities } = await res.json();
    const rows = (peers || []).slice(0, 12).map((p) => (
      `<li><span class="topo-peer-name">${esc(p.name || p.ip || p.key)}</span>`
      + `<span class="topo-peer-bytes">${esc(bytes(p.bytes))}</span></li>`
    )).join('');
    inspector([
      `<div class="topo-ins-title">${esc(device.name)}</div>`,
      `<div class="topo-ins-sub mono">${esc(device.ip)}${device.mac ? ` · ${esc(device.mac)}` : ''}</div>`,
      `<div class="topo-ins-tags">`,
      `<span class="topo-tag">${esc(device.role || 'unknown')}</span>`,
      device.vlan ? `<span class="topo-tag">VLAN ${esc(device.vlan)}</span>` : '',
      `<span class="topo-tag">${esc(device.locality)}</span>`,
      device.critical ? '<span class="topo-tag crit">Critical</span>' : '',
      `</div>`,
      identities?.length
        ? `<div class="topo-ins-h">Identities</div><ul class="topo-ins-list">${identities.map((i) => `<li>${esc(i.name)}</li>`).join('')}</ul>`
        : '',
      rows ? `<div class="topo-ins-h">Top conversations</div><ul class="topo-ins-list topo-peers">${rows}</ul>` : '',
      `<div class="topo-ins-foot panel-sub">Peers reflect the significant-traffic topology (top-N per device), not every connection.</div>`,
    ].join(''));
  } catch {
    inspector('<div class="topo-inspector-empty panel-sub">Could not load device detail.</div>');
  }
}

function drillInto(node) {
  // Aggregate clicked: descend one tier, scoped to it. Suspends camera-driven LOD
  // so the view stays where the user put it.
  state.crumbs.push({ zoom: state.zoom + 1, parent: node.key, label: node.name });
  state.zoom = Math.min(3, state.zoom + 1);
  state.parent = node.key;
  state.keys = null;
  state.autoTier = false;
  load();
}

function paint(data) {
  lastData = data;
  const theme = themeColors();
  const G = window.graphology?.Graph || window.graphology;
  graph = new G({ type: 'undirected', allowSelfLoops: false, multi: false });

  for (const n of data.nodes) {
    graph.addNode(n.key, {
      x: Number(n.x) || 0,
      y: Number(n.y) || 0,
      size: sizeFor(n, data.zoom),
      // Sigma renders labels itself into canvas; it never parses HTML, but keep the
      // same escaping discipline as the rest of the UI — device names come off the
      // wire and are attacker-controllable (lib/telemetry-taint.js).
      label: String(n.name ?? n.key),
      color: colorFor(n, data.zoom),
      raw: n,
    });
  }
  const known = new Set(data.nodes.map((n) => n.key));
  for (const e of data.edges) {
    if (!known.has(e.src) || !known.has(e.dst) || e.src === e.dst) continue;
    if (graph.hasEdge(e.src, e.dst)) continue;
    graph.addEdge(e.src, e.dst, {
      size: Math.max(0.6, Math.min(6, Math.log10((Number(e.bytes) || 0) + 10) - 0.6)),
      color: theme.edge,
      raw: e,
    });
  }

  const container = $('topo-canvas');
  if (sigma) { sigma.kill(); sigma = null; }
  sigma = new window.Sigma(graph, container, {
    renderEdgeLabels: false,
    defaultEdgeColor: theme.edge,
    labelColor: { color: theme.label },
    labelDensity: 0.6,
    labelGridCellSize: 90,
    labelRenderedSizeThreshold: 4,
    labelSize: 12,
    minCameraRatio: 0.02,
    maxCameraRatio: 4,
  });

  // Sigma fits nodes flush to the container edges, which clips the labels of
  // whichever nodes land on the boundary. Pull the camera back slightly so the
  // outermost labels have room. Done before the LOD listener is attached so this
  // deliberate framing can't be mistaken for a user zoom.
  sigma.getCamera().setState({ ratio: 1.18 });

  sigma.on('clickNode', ({ node }) => {
    const raw = graph.getNodeAttribute(node, 'raw');
    if (data.zoom === 3) showDevice(raw.key); else drillInto(raw);
  });

  // Camera-driven level of detail: the whole point of the map metaphor.
  sigma.getCamera().on('updated', () => {
    if (!state.autoTier || state.loading) return;
    const next = tierForRatio(sigma.getCamera().ratio, state.zoom);
    if (next !== state.zoom) { state.zoom = next; load({ keepCamera: true }); }
  });

  applyOverlay(data);

  const count = data.nodes.length;
  const base = `<b>${TIERS[data.zoom]}</b> · ${count} node${count === 1 ? '' : 's'} · ${data.edges.length} link${data.edges.length === 1 ? '' : 's'}`;
  setStatus(overlay ? `${base} · <b>${esc(overlay.title)}</b> overlay` : base);
}

/**
 * Draw the selected incident on top of the current tier.
 *
 * The map is aggregated, so an event's device-level actors have to be lifted to
 * whatever the current tier draws (a device rolls up into its role cluster, segment,
 * or locality). `memberOf` does that lift using the fields each tier already carries.
 * Nodes not touched by the incident are dimmed rather than hidden — context is the
 * point of drawing an attack on a map.
 */
function applyOverlay(data) {
  if (!overlay || !graph) return;

  // Lift a device-level actor to the node that represents it at this zoom: at zoom 0
  // a device isn't drawn, its locality is. The server ships each involved device's
  // tier coordinates for exactly this.
  const FIELD = ['locality', 'segment', 'role_key', 'key'];
  const liftKey = (deviceKey) => {
    const tiers = overlay.tierMap?.[deviceKey];
    if (!tiers) return '';
    const key = tiers[FIELD[data.zoom]] || '';
    return key && graph.hasNode(key) ? key : '';
  };

  const involved = new Set();
  const steps = [];
  for (const ev of overlay.events) {
    const src = liftKey(ev.src);
    const dst = liftKey(ev.dst);
    for (const k of [src, dst]) if (k) involved.add(k);
    if (src && dst && src !== dst) steps.push({ ...ev, from: src, to: dst });
  }

  // Dim everything the incident didn't touch.
  graph.forEachNode((key, attrs) => {
    if (involved.size && !involved.has(key)) {
      graph.setNodeAttribute(key, 'color', 'rgba(130,138,160,0.28)');
      graph.setNodeAttribute(key, 'label', '');
    } else if (involved.has(key)) {
      graph.setNodeAttribute(key, 'size', (attrs.size || 5) * 1.35);
    }
  });
  graph.forEachEdge((id) => graph.setEdgeAttribute(id, 'color', 'rgba(130,138,160,0.12)'));

  // An attack routinely hits the same pair of hosts several times (recon, then
  // encryption, then staging all run offender → DC). Those are ONE line on the map,
  // so collapse them into a single edge that names every step it carries — writing
  // each step separately would silently leave only the last one's label visible.
  const byPair = new Map();
  for (const step of steps) {
    const id = `${step.from} ${step.to}`;
    if (!byPair.has(id)) byPair.set(id, { from: step.from, to: step.to, steps: [] });
    byPair.get(id).steps.push(step);
  }

  for (const pair of byPair.values()) {
    // Colour by the furthest-along stage on this link: how bad it eventually got.
    const peak = pair.steps.reduce((a, b) => ((b.stage ?? -1) > (a.stage ?? -1) ? b : a));
    const color = STAGE_COLOR[peak.stage ?? 0] || '#ef4444';
    const numbers = pair.steps.map((s) => s.seq + 1).join(',');
    const label = pair.steps.length === 1
      ? `${numbers}. ${peak.tactic || 'step'}`
      : `${numbers} · ${peak.tactic || 'steps'}`;
    if (graph.hasEdge(pair.from, pair.to)) {
      graph.setEdgeAttribute(pair.from, pair.to, 'color', color);
      graph.setEdgeAttribute(pair.from, pair.to, 'size', 4);
      graph.setEdgeAttribute(pair.from, pair.to, 'label', label);
    } else {
      // This conversation isn't in the significant-traffic topology (net_detail
      // returns top-N peers), but the incident says it happened — draw it rather
      // than dropping a real attack step off the map.
      graph.addEdge(pair.from, pair.to, { color, size: 4, label, forced: true });
    }
  }
  sigma.setSetting('renderEdgeLabels', byPair.size > 0);
  renderOverlayPanel(steps.length, byPair.size, involved.size);
}

/** The incident's kill-chain strip + event list, in the inspector column. */
function renderOverlayPanel(drawnSteps, drawnPaths, involvedNodes) {
  if (!overlay) return;
  const chips = overlay.stages.map((s) => {
    const idx = overlay.tacticOrder.indexOf(s.tactic);
    return `<span class="topo-stage" style="--stage:${STAGE_COLOR[idx] || '#ef4444'}">${esc(s.tactic)} <b>${s.count}</b></span>`;
  }).join('');
  const rows = overlay.events.map((e) => {
    const idx = overlay.tacticOrder.indexOf(e.tactic);
    return `<li class="topo-ev">
      <span class="topo-ev-dot" style="--stage:${STAGE_COLOR[idx] || '#94a3b8'}"></span>
      <div>
        <div class="topo-ev-head">${esc(e.event)}${e.inferred ? ' <span class="topo-inferred" title="The devices for this step were inferred from the write-up, not stated in the verdict">inferred</span>' : ''}</div>
        <div class="topo-ev-meta">${esc(e.time || '—')}${e.tactic ? ` · ${esc(e.tactic)}` : ''}</div>
      </div>
    </li>`;
  }).join('');
  inspector([
    `<div class="topo-ins-title">${esc(overlay.title)}</div>`,
    `<div class="topo-ins-tags">`,
    overlay.disposition ? `<span class="topo-tag crit">${esc(overlay.disposition)}</span>` : '',
    overlay.confidence ? `<span class="topo-tag">${esc(overlay.confidence)} confidence</span>` : '',
    `</div>`,
    overlay.techniques.length
      ? `<div class="topo-ins-h">ATT&amp;CK</div><div class="topo-ins-tags">${overlay.techniques.map((t) => `<span class="topo-tag mono">${esc(t)}</span>`).join('')}</div>`
      : '',
    chips ? `<div class="topo-ins-h">Kill chain</div><div class="topo-stages">${chips}</div>` : '',
    `<div class="topo-ins-h">Sequence</div><ul class="topo-ins-list topo-events">${rows}</ul>`,
    `<div class="topo-ins-foot panel-sub">${drawnSteps} step${drawnSteps === 1 ? '' : 's'} drawn as ${drawnPaths} path${drawnPaths === 1 ? '' : 's'} across ${involvedNodes} node${involvedNodes === 1 ? '' : 's'}.`
      + (overlay.unbound ? ` ${overlay.unbound} event${overlay.unbound === 1 ? '' : 's'} name no device in this snapshot and are listed but not drawn.` : '')
      + `</div>`,
  ].join(''));
}

export async function load({ keepCamera = false } = {}) {
  if (state.loading) return;
  state.loading = true;
  const cam = keepCamera && sigma ? { ...sigma.getCamera().getState() } : null;
  try {
    const params = new URLSearchParams({ zoom: String(state.zoom) });
    if (state.group) params.set('group', state.group);
    if (state.snapshotId) params.set('snapshot', state.snapshotId);
    if (state.parent) params.set('parent', state.parent);
    if (state.keys?.length) params.set('keys', state.keys.join(','));
    const res = await fetch(`/api/topology/map?${params}`);
    const data = await res.json();
    if (!res.ok) { showEmpty(data.error || 'Could not load the map.'); return; }
    state.group = data.group || state.group;
    state.snapshotId = data.snapshot_id || '';
    if (!data.nodes?.length) {
      showEmpty(data.empty
        ? 'No network map yet. Ask the agent to <b>map the network</b> — it will sweep devices and their traffic, and the map appears here.'
        : 'This view is empty at the current zoom.');
      return;
    }
    $('topo-empty').classList.add('hidden');
    $('topo-canvas').classList.remove('hidden');
    paint(data);
    if (cam) sigma.getCamera().setState(cam);
    renderCrumbs();
  } catch (err) {
    showEmpty('Could not reach the topology service.');
  } finally {
    state.loading = false;
  }
}

function showEmpty(message) {
  if (sigma) { sigma.kill(); sigma = null; }
  $('topo-canvas').classList.add('hidden');
  const el = $('topo-empty');
  el.classList.remove('hidden');
  el.innerHTML = `<div class="topo-empty-inner">${message}</div>`;
  setStatus('');
  renderCrumbs();
}

/** Populate the overlay picker. "No overlay" is always first and always the default. */
async function loadIncidents() {
  const sel = $('topo-overlay-pick');
  if (!sel) return;
  try {
    const res = await fetch('/api/topology/incidents');
    if (!res.ok) return;
    const { incidents } = await res.json();
    sel.innerHTML = ['<option value="">No overlay</option>']
      .concat((incidents || []).map((i) => (
        `<option value="${esc(i.id)}">${esc(i.title)}${i.disposition ? ` · ${esc(i.disposition)}` : ''} (${i.events})</option>`
      ))).join('');
  } catch { /* the picker just stays at "No overlay" */ }
}

/** Select an incident to draw, or '' to return to the plain map. */
async function selectOverlay(sessionId) {
  if (!sessionId) {
    overlay = null;
    // Returning to the plain map also leaves the incident's key-scoped view.
    if (state.keys) { state.keys = null; state.crumbs = []; state.zoom = 0; state.parent = ''; state.autoTier = true; load(); }
    if (lastData) { const cam = sigma && { ...sigma.getCamera().getState() }; paint(lastData); if (cam) sigma.getCamera().setState(cam); }
    inspector('<div class="topo-inspector-empty panel-sub">Zoom in to devices, then click one to inspect it.</div>');
    return;
  }
  inspector('<div class="topo-inspector-empty panel-sub">Loading incident…</div>');
  try {
    const params = new URLSearchParams({ group: state.group, snapshot: state.snapshotId });
    const res = await fetch(`/api/topology/incidents/${encodeURIComponent(sessionId)}?${params}`);
    const data = await res.json();
    if (!res.ok) { inspector(`<div class="topo-inspector-empty panel-sub">${esc(data.error || 'Could not load that incident.')}</div>`); return; }
    overlay = { ...data, tacticOrder: TACTIC_ORDER };
    // Frame the incident. At an aggregate tier the actors collapse into one cluster
    // and there is literally no path to draw ("0 steps"), so selecting an incident
    // jumps to the device view of exactly its participants — the map equivalent of
    // searching an address and being taken there. The breadcrumb makes it obvious
    // where you are and how to get back.
    if (overlay.entities?.length) {
      state.crumbs = [{ zoom: 3, parent: '', label: overlay.title, keys: overlay.entities }];
      state.zoom = 3;
      state.parent = '';
      state.keys = overlay.entities;
      state.autoTier = false;
      await load();
    } else if (lastData) {
      paint(lastData);
    }
  } catch {
    inspector('<div class="topo-inspector-empty panel-sub">Could not load that incident.</div>');
  }
}

async function loadSnapshots() {
  try {
    const res = await fetch('/api/topology/snapshots');
    if (!res.ok) return;
    const { group, snapshots } = await res.json();
    state.group = group || '';
    const sel = $('topo-snapshot');
    if (!sel) return;
    sel.innerHTML = (snapshots || []).map((s) => (
      `<option value="${esc(s.id)}">${esc((s.collected_at || s.id).replace('T', ' ').replace('Z', ''))} · ${Number(s.device_count) || 0} devices</option>`
    )).join('');
    sel.disabled = !snapshots?.length;
    if (snapshots?.length) state.snapshotId = snapshots[0].id;
  } catch { /* the empty state already explains it */ }
}

function open() {
  $('topology-overlay').classList.remove('hidden');
  setRpTab('map');
  state = { ...state, zoom: 0, parent: '', crumbs: [], keys: null, autoTier: true };
  overlay = null; // the map always opens plain; an incident is something you choose
  loadSnapshots().then(() => Promise.all([load(), loadIncidents()]));
}

function close({ activate = 'files' } = {}) {
  $('topology-overlay').classList.add('hidden');
  if (sigma) { sigma.kill(); sigma = null; }
  setRpTab(activate);
}

function setRpTab(which) {
  document.querySelectorAll('.rp-tab').forEach((b) => b.classList.toggle('active', b.dataset.rp === which));
}

export function isTopologyOpen() { return !$('topology-overlay')?.classList.contains('hidden'); }
export function closeTopology() { close(); }

export function initTopology() {
  if (!$('topology-overlay')) return;
  // Each right-panel tab owns its own listener; passing the chosen tab through keeps
  // the handlers order-independent (memory.js does the same).
  document.querySelectorAll('.rp-tab').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.rp === 'map') open(); else close({ activate: b.dataset.rp });
  }));
  $('topo-close')?.addEventListener('click', () => close());
  $('topo-snapshot')?.addEventListener('change', (e) => {
    state.snapshotId = e.target.value;
    state.crumbs = []; state.parent = ''; state.zoom = 0; state.keys = null; state.autoTier = true;
    load();
  });
  $('topo-overlay-pick')?.addEventListener('change', (e) => selectOverlay(e.target.value));
  $('topo-refresh')?.addEventListener('click', () => { loadSnapshots().then(() => load()); });
  window.addEventListener('resize', () => { if (isTopologyOpen() && sigma) sigma.refresh(); });

  // Canvas can't read CSS variables, so a theme switch would otherwise leave the map
  // painted for the old theme — labels and edges effectively invisible on the new
  // background. Repaint from the cached tier (no refetch) and keep the camera.
  new MutationObserver(() => {
    if (!isTopologyOpen() || !lastData || !sigma) return;
    const cam = { ...sigma.getCamera().getState() };
    paint(lastData);
    sigma.getCamera().setState(cam);
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
}
