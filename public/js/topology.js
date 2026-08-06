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
import { avatarSvg, identityType, roleGlyphInline, roleIconDataUri } from './topo-glyphs.js';
import { changeKeys, renderChanges } from './topo-changes.js';
import { matrixModel, pairId, renderMatrix, renderPairs } from './topo-matrix.js';
import {
  badgeAt, clearAttack, clearZones, drawAttack, drawZones, emphasisePath,
  ensureAttackLayer, ensureZoneLayer, miniMapPointAt, renderMiniMap, zoneAt,
} from './topo-layers.js';

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
const EXTERNAL_ACTOR_COLOR = '#dc2626'; // a synthetic C2/exfil endpoint drawn on an incident

/** Mean {x,y} of graph node keys that exist; {x:0,y:0} when none. */
function centroidOfNodes(keys) {
  let x = 0; let y = 0; let n = 0;
  for (const k of keys) {
    if (!graph.hasNode(k)) continue;
    x += graph.getNodeAttribute(k, 'x') || 0;
    y += graph.getNodeAttribute(k, 'y') || 0;
    n++;
  }
  return n ? { x: x / n, y: y / n } : { x: 0, y: 0 };
}

/** A small deterministic offset for an external node, so it sits near — but not on — the incident. */
function extOffset(key) {
  let h = 2166136261;
  const s = String(key);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  const angle = ((h >>> 0) % 360) * Math.PI / 180;
  return { x: Math.cos(angle) * 3, y: Math.sin(angle) * 3 };
}

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
    // Edges are context, not the subject — kept faint so a dense device view reads as
    // nodes with connections, not a ball of wire. A light background washes out a
    // translucent line more than a dark one, so light gets a touch more opacity.
    // Low alpha so densely-meshed subnets (every workstation talking to the same DCs)
    // don't accumulate into a wall of white where the lines converge.
    edge: dark ? 'rgba(150,162,196,0.12)' : 'rgba(60,72,104,0.22)',
    // Used to emphasise a hovered node's own edges above the faded rest.
    edgeStrong: dark ? 'rgba(200,210,235,0.9)' : 'rgba(36,48,80,0.9)',
    edgeFaint: dark ? 'rgba(150,162,196,0.04)' : 'rgba(60,72,104,0.05)',
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
let hoveredNode = null; // device under the cursor, to trace its dependencies (plain map only)
let lastData = null;   // last painted tier, so a theme flip can repaint without refetching
let overlay = null;    // the incident currently drawn on top, or null for the plain map
let overlayStats = { steps: 0, paths: 0, nodes: 0 }; // last overlay panel counts (for back-to-incident)
let attackModel = null; // {paths, patientZero, externals, pairBySeq} for the vector layer
let hoveredPair = null; // step badge under the cursor, so hover work is done once
let matrixGroupBy = 'segment';

/** The status line for whatever the topology last painted. */
function statusForData() {
  if (!lastData) return '';
  const count = lastData.nodes.length;
  return `<b>${TIERS[lastData.zoom]}</b> · ${count} node${count === 1 ? '' : 's'} · `
    + `${lastData.edges.length} link${lastData.edges.length === 1 ? '' : 's'}`;
}

/** Light the inspector row for the step a badge stands for, and scroll it into view. */
function highlightIncidentStep(pairId) {
  let first = null;
  for (const row of document.querySelectorAll('.topo-ev[data-pair]')) {
    const match = row.dataset.pair === pairId;
    row.classList.toggle('lit', match);
    if (match && !first) first = row;
  }
  first?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
let drift = null;      // the active snapshot comparison, or null
let identitiesCache = []; // [{name, principal, devices:[{key,name,ip,role,locality}]}]
let snapshots = []; // [{id, collected_at, device_count, ...}], newest first as served
let incidentsCache = [];  // [{id, title, disposition, confidence, events, createdAt}]
let state = {
  group: '',
  snapshotId: '',
  zoom: 0,
  parent: '',
  scope: '',           // device field the parent matches on at zoom 3 (segment|role_key|locality)
  crumbs: [],          // [{zoom, parent, scope, label, keys}] — the drill-down path
  keys: null,          // explicit device set (the attack overlay's participants)
  showExternal: false, // default view is internal-only; toggle reveals External nodes
  showNeighbors: false, // in a scoped device view, pull one-hop peers outside the scope
  loading: false,
  autoTier: true,      // camera-driven LOD; only live under ?lod=camera (see CAMERA_LOD)
  zones: true,         // the zone view: segments as containers, opened in place
  expanded: [],        // segment keys currently opened into their devices
};

// Camera-ratio level-of-detail is retired: zooming past a band refetched and
// repainted the whole graph, so the map teleported under the cursor. Expansion is
// explicit now. The old behaviour stays reachable for one release for estates where
// zones degenerate — a single segment, or roles unknown everywhere — after which
// this flag and the TIER_BANDS machinery go.
const CAMERA_LOD = new URLSearchParams(window.location.search).get('lod') === 'camera';

/** A segment key (`vlan:204`, `net:10.0.0.0/24`, `loc:Internal`) as a short label. */
function prettySegment(s) {
  return String(s || '').replace(/^(vlan|net|loc):/, (_, k) => (k === 'vlan' ? 'VLAN ' : ''));
}

/** A role slug (`domain_controller`) as a readable label (`Domain controller`). */
function prettyRole(r) {
  return String(r || 'unknown').replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

let legendVisible = true; // the colour legend is on by default; a toggle hides it

/**
 * The tier a single node is drawn at.
 *
 * A zone payload is mixed — devices inside opened segments, aggregates everywhere
 * else — so colour, size and labelling are per node rather than per payload. Nodes
 * from the old single-tier reads carry no `tier` and fall back to the payload's.
 */
function tierOf(node, zoom) {
  if (node?.tier === 'device') return 3;
  if (node?.tier === 'segment') return 1;
  return zoom;
}

function colorFor(node, zoom) {
  // Every tier carries meaning in its colour rather than going flat blue in the
  // middle: localities carry the locality hue; segments and role clusters carry the
  // hue of their DOMINANT device role (so a server subnet reads differently from a
  // workstation subnet) when the snapshot provides it, falling back to the locality
  // hue; devices carry their own role hue.
  if (zoom === 0) return LOCALITY_COLOR[node.name] || LOCALITY_COLOR.Unknown;
  if (zoom === 1) return node.role ? (ROLE_COLOR[node.role] || ROLE_COLOR.unknown) : (LOCALITY_COLOR[node.parent] || LOCALITY_COLOR.Unknown);
  if (zoom === 2) return ROLE_COLOR[node.name] || ROLE_COLOR.unknown;
  return ROLE_COLOR[node.role] || ROLE_COLOR.unknown;
}

// Base on-screen size per device role, so servers/DCs/gateways read as bigger than
// workstations — which also makes them (not every PC) the nodes that carry a label by
// default. Critical devices get a bump on top.
const DEVICE_BASE = {
  domain_controller: 8, db_server: 8, firewall: 8, gateway: 8,
  file_server: 7, http_server: 7, web_proxy: 7, dns_server: 7, dhcp_server: 7,
  nat_gateway: 7, vpn_gateway: 7, load_balancer: 7, medical_device: 6,
  pc: 5, mobile_device: 5, printer: 5, ip_camera: 5, other: 5, unknown: 5,
};

/** Aggregates scale with the devices they contain; devices scale with role + criticality. */
function sizeFor(node, zoom) {
  if (zoom === 3) {
    const base = DEVICE_BASE[node.role] ?? 5.5;
    return node.critical ? base + 3 : base;
  }
  const n = Number(node.device_count) || 1;
  return Math.max(6, Math.min(26, 5 + Math.sqrt(n) * 2.2));
}

/**
 * The longest domain suffix shared by most device names (e.g. `.acmelegal.lab`), so the
 * device tier can show `dc1` instead of `dc1.acmelegal.lab` — the repeated suffix is
 * noise that makes long labels collide. Returns '' when there is no common suffix.
 */
function commonDomainSuffix(names) {
  const domains = names.map((n) => String(n || '')).filter((n) => n.includes('.') && !/^\d+(\.\d+){3}$/.test(n))
    .map((n) => n.slice(n.indexOf('.') + 1).toLowerCase());
  if (domains.length < 3) return '';
  const counts = new Map();
  for (const d of domains) counts.set(d, (counts.get(d) || 0) + 1);
  let best = ''; let bestN = 0;
  for (const [d, c] of counts) if (c > bestN) { best = d; bestN = c; }
  // Only strip when it's genuinely shared (covers at least half the dotted names).
  return bestN >= Math.max(3, domains.length * 0.5) ? best : '';
}

/** Strip a trailing `.<suffix>` (case-insensitive) from a hostname for display. */
function stripSuffix(name, suffix) {
  const s = String(name ?? '');
  if (!suffix) return s;
  const tail = `.${suffix}`;
  return s.toLowerCase().endsWith(tail) ? s.slice(0, -tail.length) : s;
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
    state.zoom = last ? last.zoom : (CAMERA_LOD ? 0 : 1);
    state.scope = last?.scope || '';
    state.keys = last?.keys || null;   // leaving the incident view drops its key scope
    state.autoTier = state.crumbs.length === 0;
    // "All" is the zone view again; anything deeper is a scoped single-tier read and
    // must stop asking for the mixed payload, which ignores parent/scope/keys.
    state.zones = !CAMERA_LOD && state.crumbs.length === 0;
    updateNeighborBtn();
    load();
  }));
}

function inspector(html) {
  // Any panel render clears the "device being shown" marker; showDevice re-sets it
  // once it has finished, so a background enrichment poll can only refresh the device
  // the user is actually looking at.
  currentDeviceKey = null;
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


/**
 * A device's traffic across the retained snapshots: a sparkline plus the current
 * totals.
 *
 * Fetched after the panel is written rather than before it, so the identity and
 * details never wait on a trend. The card is honest about its own axis — the series
 * is "the last N snapshots", not a fixed 7 days, because snapshot cadence is
 * whatever the operator has been running.
 */
async function renderDeviceTrend(key) {
  const host = $('topo-trend');
  if (!host) return;
  let series = [];
  try {
    const params = new URLSearchParams();
    if (state.group) params.set('group', state.group);
    const res = await fetch(`/api/topology/node/${encodeURIComponent(key)}/history?${params}`);
    if (!res.ok) { host.remove(); return; }
    ({ series = [] } = await res.json());
  } catch { host.remove(); return; }
  // Stale response for a device the user has already navigated away from.
  if (currentDeviceKey !== key) return;
  if (!series.length) { host.remove(); return; }

  const latest = series[series.length - 1];
  const values = series.map((p) => Number(p.bytes_total) || 0);
  const peak = Math.max(...values, 1);
  const W = 240;
  const H = 44;
  // A single snapshot is a point, not a trend; draw it as a flat line rather than
  // dividing by zero.
  const step = series.length > 1 ? W / (series.length - 1) : 0;
  const pts = values.map((v, i) => `${(i * step).toFixed(1)},${(H - (v / peak) * (H - 4) - 2).toFixed(1)}`);
  const line = `M${pts.join('L')}`;
  const area = `${line}L${W},${H}L0,${H}Z`;
  const span = series.length === 1
    ? 'one snapshot'
    : `${series.length} snapshots`;

  host.innerHTML = `
    <div class="topo-ins-h">Traffic · ${esc(span)}</div>
    <svg class="topo-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
      <path class="topo-spark-area" d="${area}"></path>
      <path class="topo-spark-line" d="${line}"></path>
    </svg>
    <div class="topo-spark-axis">
      <span>${esc(snapshotStampShort(series[0].collected_at))}</span>
      <span>${esc(snapshotStampShort(latest.collected_at))}</span>
    </div>
    <div class="topo-tiles">
      <div class="topo-tile"><span class="topo-tile-label">Bytes</span><b>${esc(bytes(latest.bytes_total))}</b></div>
      <div class="topo-tile"><span class="topo-tile-label">Peers</span><b>${Number(latest.peer_count) || 0}</b></div>
    </div>`;
}

/** `Aug 3` — enough to place a point on the axis without crowding it. */
function snapshotStampShort(raw) {
  const d = raw ? new Date(raw) : null;
  return d && !Number.isNaN(d.getTime())
    ? d.toLocaleString(undefined, { month: 'short', day: 'numeric' })
    : String(raw || '').slice(0, 10);
}

/**
 * Hand the device to the agent. A prefill rather than a spawned session: seeding a
 * session raises workspace and approval lifecycle questions that this button should
 * not be deciding. It carries the context the analyst can see — which snapshot, and
 * which incident step if one is drawn — so the agent starts where they are.
 */
function investigateDevice(device) {
  const parts = [`Investigate ${device.name || device.key}`];
  const ident = [device.ip, device.key].filter(Boolean).join(', ');
  if (ident) parts.push(`(${ident})`);
  const context = [];
  const snap = snapshots.find((s) => s.id === state.snapshotId);
  if (snap) context.push(`snapshot ${snapshotStampShort(snap.collected_at)}`);
  if (overlay) {
    const step = overlay.events.find((e) => e.src === device.key || e.dst === device.key);
    context.push(step
      ? `incident "${overlay.title}" step ${step.seq + 1} (${step.tactic || 'unclassified'})`
      : `incident "${overlay.title}"`);
  }
  const text = `${parts.join(' ')}${context.length ? ` — context: ${context.join(', ')}` : ''}`;
  close(); // the map is a full-screen overlay; the composer is behind it
  const input = $('input');
  if (!input) return;
  input.value = text;
  input.focus();
  input.dispatchEvent(new Event('input', { bubbles: true })); // grow the textarea
  input.setSelectionRange(text.length, text.length);
}

async function showDevice(key) {
  inspector('<div class="topo-inspector-empty panel-sub">Loading…</div>');
  try {
    const params = new URLSearchParams({ group: state.group, snapshot: state.snapshotId });
    const res = await fetch(`/api/topology/node/${encodeURIComponent(key)}?${params}`);
    if (!res.ok) { inspector('<div class="topo-inspector-empty panel-sub">No detail for this device.</div>'); return; }
    const { device, peers, identities, enrichments } = await res.json();
    const rows = (peers || []).slice(0, 12).map((p) => (
      `<li><span class="topo-peer-name">${esc(p.name || p.ip || p.key)}</span>`
      + `<span class="topo-peer-bytes">${esc(bytes(p.bytes))}</span></li>`
    )).join('');
    // Identity/inventory rows — only the ones ExtraHop actually resolved. Hostname is
    // the primary name; DNS/DHCP/NetBIOS are shown when they add something distinct.
    const detailRows = [
      ['Hostname', device.name],
      ['DNS', device.dns_name],
      ['DHCP', device.dhcp_name],
      ['NetBIOS', device.netbios_name],
      ['IP', device.ip],
      ['MAC', device.mac],
      ['Vendor', device.vendor],
      ['OS', device.software],
    ].filter(([, v]) => v && String(v).trim())
      // Drop a DNS/DHCP/NetBIOS row that only repeats the hostname.
      .filter(([label, v], _i, all) => !(['DNS', 'DHCP', 'NetBIOS'].includes(label)
        && String(v).toLowerCase() === String(all[0][1]).toLowerCase()));
    const details = detailRows.map(([label, v]) => (
      `<li><span class="topo-kv-k">${esc(label)}</span><span class="topo-kv-v mono">${esc(v)}</span></li>`
    )).join('');
    // If an incident is overlaid, a device's detail must not strand the user away from
    // it: offer a way back, and say what this device did in the incident.
    const incidentSteps = overlay
      ? overlay.events.filter((e) => e.src === key || e.dst === key || (e.entities || []).includes(key))
      : [];
    inspector([
      overlay ? `<button type="button" class="topo-back" id="topo-inc-back">← Back to incident</button>` : '',
      `<div class="topo-ins-title">${esc(device.name)}</div>`,
      `<div class="topo-ins-sub mono">${esc(device.ip)}${device.mac ? ` · ${esc(device.mac)}` : ''}</div>`,
      `<div class="topo-ins-tags">`,
      `<span class="topo-tag">${esc(device.role || 'unknown')}</span>`,
      device.vlan ? `<span class="topo-tag">VLAN ${esc(device.vlan)}</span>` : '',
      `<span class="topo-tag">${esc(device.locality)}</span>`,
      device.critical ? '<span class="topo-tag crit">Critical</span>' : '',
      `</div>`,
      incidentSteps.length
        ? `<div class="topo-ins-h">In this incident</div><ul class="topo-ins-list topo-events">${incidentSteps.map((e) => {
          const idx = overlay.tacticOrder.indexOf(e.tactic);
          return `<li class="topo-ev"><span class="topo-ev-dot" style="--stage:${STAGE_COLOR[idx] || '#94a3b8'}"></span>`
            + `<div><div class="topo-ev-head">${esc(e.event)}</div>`
            + `<div class="topo-ev-meta">${esc(e.time || '—')}${e.tactic ? ` · ${esc(e.tactic)}` : ''}</div></div></li>`;
        }).join('')}</ul>`
        : '',
      details ? `<div class="topo-ins-h">Details</div><ul class="topo-ins-list topo-kv">${details}</ul>` : '',
      identities?.length
        ? `<div class="topo-ins-h">Users</div><ul class="topo-ins-list topo-users">${identities.map((i) => (
          `<li><button type="button" class="topo-user-link" data-user="${esc(i.name)}">`
          + `${avatarSvg(identityType(i.principal || i.name))}<span class="topo-user-name">${esc(i.name)}</span></button></li>`
        )).join('')}</ul>`
        : '',
      enrichmentsHtml(enrichments),
      `<div id="topo-trend" class="topo-trend"></div>`,
      rows ? `<div class="topo-ins-h">Top conversations</div><ul class="topo-ins-list topo-peers">${rows}</ul>` : '',
      `<div class="topo-ins-foot panel-sub">Peers reflect the significant-traffic topology (top-N per device), not every connection.</div>`,
      `<button type="button" id="topo-investigate" class="topo-investigate">`
      + `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>`
      + `Investigate this device</button>`,
      askHtml(),
    ].join(''));
    // Clicking a user cross-links to that identity's device set.
    $('topo-inspector')?.querySelectorAll('.topo-user-link').forEach((b) => b.addEventListener('click', () => showUser(b.dataset.user)));
    $('topo-inc-back')?.addEventListener('click', backToIncident);
    wireAsk(device.key);
    currentDeviceKey = device.key; // now showing this device; enrichment polls may refresh it
    $('topo-investigate')?.addEventListener('click', () => investigateDevice(device));
    renderDeviceTrend(device.key);
  } catch {
    inspector('<div class="topo-inspector-empty panel-sub">Could not load device detail.</div>');
  }
}

/** Minimal detail for a synthetic external actor (C2/exfil) — it has no device record. */
function showExternalNode(raw) {
  const steps = overlay
    ? overlay.events.filter((e) => e.src === raw.key || e.dst === raw.key || (e.entities || []).includes(raw.key))
    : [];
  inspector([
    overlay ? `<button type="button" class="topo-back" id="topo-inc-back">← Back to incident</button>` : '',
    `<div class="topo-ins-title">${esc(raw.name)}</div>`,
    `<div class="topo-ins-tags"><span class="topo-tag crit">External</span></div>`,
    `<div class="topo-ins-foot panel-sub">An endpoint outside the mapped estate that this incident reached (e.g. C2 or exfil). Not a discovered device — shown so the attack's path off-network is visible.</div>`,
    steps.length
      ? `<div class="topo-ins-h">In this incident</div><ul class="topo-ins-list topo-events">${steps.map((e) => {
        const idx = overlay.tacticOrder.indexOf(e.tactic);
        return `<li class="topo-ev"><span class="topo-ev-dot" style="--stage:${STAGE_COLOR[idx] || '#94a3b8'}"></span>`
          + `<div><div class="topo-ev-head">${esc(e.event)}</div>`
          + `<div class="topo-ev-meta">${esc(e.time || '—')}${e.tactic ? ` · ${esc(e.tactic)}` : ''}</div></div></li>`;
      }).join('')}</ul>`
      : '',
  ].join(''));
  $('topo-inc-back')?.addEventListener('click', backToIncident);
}

/* ------------------------------------------------------ device enrichment */

// Quick-picks the panel offers; the value is the server-side preset key.
const ENRICH_CHIPS = [
  ['ports', 'Open ports'], ['dns', 'DNS activity'], ['users', 'Users'],
  ['software', 'Software / OS'], ['peers', 'Detailed peers'],
];
let currentDeviceKey = null; // which device the inspector is showing, so a poll can't hijack another
let enrichTimer = null;

/** The recorded enrichments block for a device, or '' when there are none. */
function enrichmentsHtml(list) {
  if (!Array.isArray(list) || !list.length) return '';
  const rows = list.map((e) => (
    `<li><div class="topo-enrich-label">${esc(prettyRole(e.label))}</div>`
    + `<div class="topo-enrich-value">${esc(e.value)}</div>`
    + `<div class="topo-enrich-time panel-sub">${esc(String(e.collected_at || '').replace('T', ' ').replace(/\..*$/, '').replace('Z', ''))}</div></li>`
  )).join('');
  return `<div class="topo-ins-h">Enrichments</div><ul class="topo-ins-list topo-enrich">${rows}</ul>`;
}

/** The "Ask ExtraHop about this device" area — quick-pick chips + a free-text box. */
function askHtml() {
  const chips = ENRICH_CHIPS.map(([k, label]) => `<button type="button" class="topo-chip" data-preset="${esc(k)}">${esc(label)}</button>`).join('');
  return [
    `<div class="topo-ins-h">Ask ExtraHop about this device</div>`,
    `<div class="topo-chips">${chips}</div>`,
    `<div class="topo-ask-row"><input id="topo-ask-input" class="topo-select topo-ask-input" type="text" placeholder="Or ask anything…" autocomplete="off">`,
    `<button type="button" id="topo-ask-go" class="btn-secondary slim">Ask</button></div>`,
    `<div id="topo-ask-status" class="topo-ins-foot panel-sub"></div>`,
  ].join('');
}

function wireAsk(key) {
  const insp = $('topo-inspector');
  insp?.querySelectorAll('.topo-chip').forEach((b) => b.addEventListener('click', () => enrichDevice(key, { preset: b.dataset.preset })));
  $('topo-ask-go')?.addEventListener('click', () => {
    const v = $('topo-ask-input')?.value.trim();
    if (v) enrichDevice(key, { request: v });
  });
  $('topo-ask-input')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('topo-ask-go')?.click(); });
}

async function enrichDevice(key, body) {
  const statusEl = $('topo-ask-status');
  if (statusEl) statusEl.textContent = 'Asking ExtraHop — this runs a live read-only query and can take a moment…';
  // Count what's there now, so the poll can tell when the new answer lands.
  let before = 0;
  try {
    const r = await fetch(`/api/topology/enrichments/${encodeURIComponent(key)}?${new URLSearchParams({ group: state.group })}`);
    if (r.ok) before = (await r.json()).enrichments?.length || 0;
  } catch { /* assume none */ }
  try {
    const res = await fetch(`/api/topology/enrich/${encodeURIComponent(key)}?${new URLSearchParams({ group: state.group, snapshot: state.snapshotId })}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { if (statusEl) statusEl.textContent = data.error || 'Could not start the query.'; return; }
  } catch { if (statusEl) statusEl.textContent = 'Could not reach the enrichment service.'; return; }
  pollEnrichments(key, before, 0);
}

/** Poll for the enrichment to appear, then re-render the device (bounded ~2 min). */
function pollEnrichments(key, before, tries) {
  if (enrichTimer) clearTimeout(enrichTimer);
  if (currentDeviceKey !== key) return; // the user moved on; stop
  if (tries > 40) { const s = $('topo-ask-status'); if (s) s.textContent = 'Still working — reopen this device shortly to see the result.'; return; }
  enrichTimer = setTimeout(async () => {
    if (currentDeviceKey !== key) return;
    let list = null;
    try {
      const r = await fetch(`/api/topology/enrichments/${encodeURIComponent(key)}?${new URLSearchParams({ group: state.group })}`);
      if (r.ok) list = (await r.json()).enrichments || [];
    } catch { /* keep polling */ }
    if (list && list.length > before) { showDevice(key); return; }
    pollEnrichments(key, before, tries + 1);
  }, 3000);
}

function drillInto(node) {
  // Aggregate clicked: descend into it. A segment drills STRAIGHT to its devices
  // (scope='segment'), skipping the Role tier — that tier collapses to one meaningless
  // "other" node when roles are unknown, and clicking through it was pure friction.
  // Role clusters (only reached via camera LOD) still drill to their devices.
  // Suspends camera-driven LOD so the view stays where the user put it.
  const from = state.zoom;
  let zoom;
  let scope;
  if (from === 0) { zoom = 1; scope = ''; }            // locality → segments
  else if (from === 1) { zoom = 3; scope = 'segment'; } // segment → devices (skip Role)
  else { zoom = 3; scope = 'role_key'; }                // role cluster → devices
  state.crumbs.push({ zoom, parent: node.key, scope, label: node.name });
  state.zoom = zoom;
  state.parent = node.key;
  state.scope = scope;
  state.keys = null;
  state.autoTier = false;
  state.zones = false; // a drill is a scoped single-tier read
  updateNeighborBtn();
  load();
}

/** The "Show outside dependencies" control only applies to a scoped device view. */
function updateNeighborBtn() {
  const btn = $('topo-neighbors');
  if (!btn) return;
  const applies = state.zoom === 3 && Boolean(state.parent) && !state.keys;
  btn.classList.toggle('hidden', !applies);
  if (!applies && state.showNeighbors) {
    state.showNeighbors = false;
    btn.setAttribute('aria-pressed', 'false');
    btn.classList.remove('active');
  }
}

// ---- Camera chrome ----------------------------------------------------------
// Ratio bounds are shared with the sigma settings below so the buttons and the
// wheel can never disagree about how far the map zooms. Remember that sigma's
// ratio SHRINKS as you zoom in, so zooming in divides.
const MIN_RATIO = 0.02;
const MAX_RATIO = 4;
const ZOOM_STEP = 1.4; // per button press

/** Camera animations are JS, so the CSS reduced-motion floor cannot reach them. */
function camDuration(ms) {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 0 : ms;
}

/**
 * The camera state that frames the whole graph. Sigma normalises node coordinates
 * into the unit square, so (0.5, 0.5) always centres everything and the ratio is
 * the only real choice — slightly over 1 so the outermost labels have room instead
 * of being clipped flush against the container edge.
 */
function fitState(nodeCount) {
  return { x: 0.5, y: 0.5, ratio: nodeCount <= 3 ? 1.08 : 1.18 };
}

function zoomCamera(factor) {
  if (!sigma) return;
  const cam = sigma.getCamera();
  const ratio = Math.min(Math.max(cam.ratio * factor, MIN_RATIO), MAX_RATIO);
  cam.animate({ ratio }, { duration: camDuration(180) });
}

/**
 * Frame everything currently loaded. While auto-tier is on this can pull the camera
 * back past a tier band and trigger a refetch of the wider tier — which is the right
 * answer for a control that means "show me all of it".
 */
function fitToView() {
  if (!sigma || !lastData) return;
  sigma.getCamera().animate(fitState(lastData.nodes.length), { duration: camDuration(260) });
}

// Role → the coarse bucket the context bar counts by. Deliberately blunt: the point
// is "what kind of place is this", not a taxonomy.
const ROLE_GROUP = {
  domain_controller: 'Servers', db_server: 'Servers', file_server: 'Servers', http_server: 'Servers',
  dns_server: 'Infra', dhcp_server: 'Infra', gateway: 'Infra', nat_gateway: 'Infra',
  firewall: 'Infra', load_balancer: 'Infra', vpn_gateway: 'Infra', web_proxy: 'Infra',
  pc: 'Endpoints', mobile_device: 'Endpoints', printer: 'Endpoints',
  ip_camera: 'Endpoints', medical_device: 'Endpoints',
};
const GROUP_ORDER = ['Servers', 'Endpoints', 'Infra', 'Other'];

/**
 * Composition of what is painted, as counts.
 *
 * Device tier only. On aggregate tiers a node's `role` is its DOMINANT role, so
 * counting device_count against it would report every device in a file-server-heavy
 * segment as a server — confidently wrong. The status line already carries the
 * node/link totals for those tiers.
 */
function renderChips(data) {
  const el = $('topo-chips');
  if (!el) return;
  if (data.zoom !== 3) { el.innerHTML = ''; return; }
  const counts = new Map();
  for (const n of data.nodes) {
    if (n.neighbor) continue; // pulled in from outside the scope; not part of "here"
    const group = ROLE_GROUP[n.role] || 'Other';
    counts.set(group, (counts.get(group) || 0) + 1);
  }
  const critical = data.nodes.filter((n) => n.critical && !n.neighbor).length;
  const chips = GROUP_ORDER
    .filter((g) => counts.get(g))
    .map((g) => `<span class="topo-chip">${g} <b>${counts.get(g)}</b></span>`);
  if (critical) chips.push(`<span class="topo-chip crit">Critical <b>${critical}</b></span>`);
  el.innerHTML = chips.join('');
}

// Above this many nodes, labelling everything stops helping: sigma paints them all
// and they overlap into a smear. Measured against this renderer — 11 and 20 nodes
// read cleanly with the roomy policy, 30 starts colliding, 48 is unreadable. Under
// the cap every node is named; over it, only the bigger nodes (servers, DCs,
// gateways, critical hosts) keep a label and the hover card covers the rest.
const LABEL_ALL_MAX = 24;

/** Sigma label settings for this payload: name everything, or triage by size. */
function labelPolicy(data) {
  if (data.nodes.length <= LABEL_ALL_MAX) {
    return { labelRenderedSizeThreshold: 0, labelDensity: 4, labelGridCellSize: 60 };
  }
  // Over the cap the threshold triages by size. A mixed payload is mostly devices
  // once anything is open, so it uses the device threshold.
  const deviceHeavy = data.nodes.some((n) => tierOf(n, data.zoom) === 3);
  return {
    labelRenderedSizeThreshold: deviceHeavy ? 7 : 4,
    labelDensity: 0.7,
    labelGridCellSize: 110,
  };
}

// ---- Hover card -------------------------------------------------------------
// Sigma labels what it can fit (see the label policy in paint), but past a couple
// of dozen nodes it has to drop labels or they pile into an unreadable smear. The
// hover card is what makes that safe: whatever the label grid decided, a node under
// the cursor always states who it is.

let hoverCardNode = null; // graph key the card is currently describing, or null

/** Identity markup for a node. Names come off the wire — escape everything. */
function hoverCardHtml(raw, zoom) {
  if (!raw) return '';
  const name = esc(raw.name ?? raw.key ?? '');
  if (!name) return '';
  if (raw.external) {
    return `<div class="topo-hc-name">${name}</div>
      <div class="topo-hc-meta">External endpoint · outside the estate</div>`;
  }

  const bits = [];
  let tags = '';
  if (zoom === 3) {
    if (raw.ip) bits.push(esc(raw.ip));
    if (raw.role) bits.push(esc(prettyRole(raw.role)));
    const seg = prettySegment(raw.segment);
    if (seg) bits.push(esc(seg));
    if (raw.critical) tags += '<span class="topo-hc-tag crit">Critical</span>';
    if (raw.neighbor) tags += '<span class="topo-hc-tag">Outside this segment</span>';
  } else {
    const n = Number(raw.device_count) || 0;
    if (n) bits.push(`${n} device${n === 1 ? '' : 's'}`);
    // On aggregates `role` is the segment's DOMINANT role, not a device's own.
    if (raw.role) bits.push(`mostly ${esc(prettyRole(raw.role).toLowerCase())}`);
  }

  const hint = zoom === 3 ? 'Click for details' : 'Click to drill in';
  return `<div class="topo-hc-name">${name}</div>
    ${bits.length ? `<div class="topo-hc-meta">${bits.join(' · ')}</div>` : ''}
    ${tags ? `<div class="topo-hc-tags">${tags}</div>` : ''}
    <div class="topo-hc-hint">${hint}</div>`;
}

/** Clamp v into [lo, hi], preferring lo when the span is too small to hold it. */
function clamp(v, lo, hi) {
  return hi < lo ? lo : Math.min(Math.max(v, lo), hi);
}

/**
 * Park the card beside its node. Fixed-positioned off the canvas' client rect, so
 * it needs no offset maths against the panel chrome and sigma's canvas teardown
 * can't disturb it.
 *
 * Side preference is right-of-node, flipping left when that would overflow — but
 * the flip is only a preference. On a narrow canvas (the inspector takes 320px,
 * and the layout sheds the right column entirely under 1100px) neither side may
 * fit, so the result is clamped into the canvas afterwards. Without that, flipping
 * a 200px card beside a node 45px from the left edge puts it off-screen.
 */
function positionHoverCard(nodeKey) {
  const el = $('topo-hovercard');
  const container = $('topo-canvas');
  if (!el || !container || !sigma || !graph?.hasNode(nodeKey)) return;
  const p = sigma.graphToViewport({
    x: graph.getNodeAttribute(nodeKey, 'x'),
    y: graph.getNodeAttribute(nodeKey, 'y'),
  });
  const rect = container.getBoundingClientRect();
  const gap = Math.max(14, (Number(graph.getNodeAttribute(nodeKey, 'size')) || 6) + 10);
  el.classList.remove('hidden'); // must be laid out before it can be measured
  const { offsetWidth: w, offsetHeight: h } = el;
  let left = rect.left + p.x + gap;
  if (left + w > rect.right - 8) left = rect.left + p.x - gap - w;
  el.style.left = `${Math.round(clamp(left, rect.left + 8, rect.right - w - 8))}px`;
  el.style.top = `${Math.round(clamp(rect.top + p.y - h / 2, rect.top + 8, rect.bottom - h - 8))}px`;
}

function showHoverCard(nodeKey) {
  const el = $('topo-hovercard');
  if (!el || !graph?.hasNode(nodeKey)) return;
  const html = hoverCardHtml(graph.getNodeAttribute(nodeKey, 'raw'), lastData?.zoom ?? 3);
  if (!html) return;
  el.innerHTML = html;
  hoverCardNode = nodeKey;
  positionHoverCard(nodeKey);
}

function hideHoverCard() {
  hoverCardNode = null;
  $('topo-hovercard')?.classList.add('hidden');
}

/**
 * The zones for a payload: one per segment, each owning the nodes drawn inside it.
 *
 * A collapsed segment owns exactly its own aggregate node, so the container still
 * frames it — that is what makes opening one read as the same object changing
 * resolution rather than the view being replaced.
 */
function zonesFor(data) {
  if (!data?.mixed) return [];
  const open = new Set(data.expanded || []);
  const bySegment = new Map();
  for (const n of data.nodes) {
    const key = tierOf(n, data.zoom) === 3 ? n.segment : n.key;
    if (!key) continue;
    if (!bySegment.has(key)) bySegment.set(key, { members: [], node: null, devices: 0 });
    const zone = bySegment.get(key);
    zone.members.push(n.key);
    if (tierOf(n, data.zoom) === 3) zone.devices += 1; else zone.node = n;
  }
  return [...bySegment.entries()].map(([key, zone]) => {
    const expanded = open.has(key);
    const count = expanded ? zone.devices : (Number(zone.node?.device_count) || 0);
    return {
      key,
      count,
      title: prettySegment(key).toUpperCase(),
      sub: expanded
        ? `${count} device${count === 1 ? '' : 's'} · open`
        : `${count} device${count === 1 ? '' : 's'} · collapsed`,
      memberKeys: zone.members,
      expanded,
      // The role hue tints the label; the boundary itself uses the zone tokens, which
      // are tuned per theme. A 20-hue palette cannot be trusted to stay legible as a
      // hairline on white.
      accent: zone.node?.role ? (ROLE_COLOR[zone.node.role] || '') : '',
    };
  });
}

/** Open or close a zone, keeping the camera so the map does not jump underfoot. */
function toggleZone(key) {
  if (!key) return;
  const open = new Set(state.expanded);
  if (open.has(key)) open.delete(key); else open.add(key);
  state.expanded = [...open];
  load({ keepCamera: true });
}

function paint(data) {
  lastData = data;
  hideHoverCard(); // the graph is about to be rebuilt; any open card is stale
  const theme = themeColors();
  const G = window.graphology?.Graph || window.graphology;
  graph = new G({ type: 'undirected', allowSelfLoops: false, multi: false });

  // Device-tier nodes render as role ICONS (a white glyph on the role-coloured disc)
  // through sigma's image node program; aggregate tiers stay coloured circles. The
  // icon is a data: URI SVG, so it works under the strict CSP with no CDN.
  // A zone payload can contain devices at any zoom, so the image program is enabled
  // whenever the payload holds one; `tier` decides per node whether it is used.
  const hasDevices = data.nodes.some((n) => tierOf(n, data.zoom) === 3);
  const useIcons = hasDevices && Boolean(window.Sigma?.rendering?.createNodeImageProgram);
  // Drop the domain suffix every device shares, so `dc1` shows instead of the FQDN.
  const dnsSuffix = hasDevices
    ? commonDomainSuffix(data.nodes.filter((n) => tierOf(n, data.zoom) === 3).map((n) => n.name))
    : '';

  for (const n of data.nodes) {
    // Neighbor = a one-hop peer pulled in from OUTSIDE the scoped segment/cluster
    // ("show outside dependencies"). Muted and labelled with where it lives, so the
    // boundary is legible and the in-scope devices stay the focus.
    const tier = tierOf(n, data.zoom);
    const isNeighbor = tier === 3 && n.neighbor;
    const color = isNeighbor ? 'rgba(130,138,160,0.55)' : colorFor(n, tier);
    const short = tier === 3 ? stripSuffix(n.name ?? n.key, dnsSuffix) : String(n.name ?? n.key);
    graph.addNode(n.key, {
      x: Number(n.x) || 0,
      y: Number(n.y) || 0,
      size: isNeighbor ? sizeFor(n, tier) * 0.72 : sizeFor(n, tier),
      // Sigma renders labels itself into canvas; it never parses HTML, but keep the
      // same escaping discipline as the rest of the UI — device names come off the
      // wire and are attacker-controllable (lib/telemetry-taint.js).
      label: isNeighbor ? `${short} · ${prettySegment(n.segment)}` : short,
      color,
      ...(useIcons && tier === 3 ? { type: 'image', image: roleIconDataUri(n.role, isNeighbor ? '#94a3b8' : color) } : {}),
      neighbor: isNeighbor,
      raw: n,
    });
  }
  const known = new Set(data.nodes.map((n) => n.key));
  for (const e of data.edges) {
    if (!known.has(e.src) || !known.has(e.dst) || e.src === e.dst) continue;
    if (graph.hasEdge(e.src, e.dst)) continue;
    graph.addEdge(e.src, e.dst, {
      // Compressed so only genuinely heavy conversations read as thick; the rest stay
      // hairline, so the view is nodes-with-links rather than a ball of wire.
      size: Math.max(0.3, Math.min(2.4, (Math.log10((Number(e.bytes) || 0) + 10) - 1.4) * 1.15)),
      color: theme.edge,
      raw: e,
    });
  }

  const container = $('topo-canvas');
  if (sigma) { sigma.kill(); sigma = null; }
  hoveredNode = null;
  const makeImage = window.Sigma?.rendering?.createNodeImageProgram;
  sigma = new window.Sigma(graph, container, {
    ...(makeImage ? { nodeProgramClasses: { image: makeImage() } } : {}),
    renderEdgeLabels: false,
    defaultEdgeColor: theme.edge,
    labelColor: { color: theme.label },
    ...labelPolicy(data),
    labelSize: 12,
    minCameraRatio: MIN_RATIO,
    maxCameraRatio: MAX_RATIO,
    zIndex: true,
  });

  // Sigma fits nodes flush to the container edges, which clips the labels of
  // whichever nodes land on the boundary. Pull the camera back slightly so the
  // outermost labels have room. Done before the LOD listener is attached so this
  // deliberate framing can't be mistaken for a user zoom. Same state the
  // fit-to-view button animates to.
  sigma.getCamera().setState(fitState(data.nodes.length));

  sigma.on('clickNode', ({ node }) => {
    const raw = graph.getNodeAttribute(node, 'raw');
    if (raw?.external) { showExternalNode(raw); return; } // C2/exfil: no cluster to drill, no device record
    if (tierOf(raw, data.zoom) === 3) { showDevice(raw.key); return; }
    // In the zone view a segment opens in place; elsewhere it still replaces the view.
    if (data.mixed) toggleZone(raw.key); else drillInto(raw);
  });

  // The zone layer is pointer-transparent, so sigma reports the click and the layer
  // is asked what was under it. Only the label band collapses an open zone: its body
  // is empty canvas as far as the user is concerned.
  sigma.on('clickStage', ({ event }) => {
    // A step badge takes precedence over the zone under it: it is the smaller,
    // more deliberate target.
    const pair = attackModel ? badgeAt(event.x, event.y) : null;
    if (pair) { highlightIncidentStep(pair); return; }
    if (!zones.length) return;
    const hit = zoneAt(event.x, event.y);
    if (!hit) return;
    if (hit.expanded && hit.region === 'label') toggleZone(hit.key);
    else if (!hit.expanded) toggleZone(hit.key);
  });

  // Hovering the map lights the badge under the cursor, so the numbers read as
  // targets rather than decoration.
  if (attackModel) {
    const container = $('topo-canvas');
    container?.addEventListener('mousemove', (e) => {
      if (!attackModel) return;
      const rect = container.getBoundingClientRect();
      const pair = badgeAt(e.clientX - rect.left, e.clientY - rect.top);
      if (pair !== hoveredPair) {
        hoveredPair = pair;
        emphasisePath(attackLayer, pair || '');
        container.classList.toggle('badge-hover', Boolean(pair));
      }
    });
  }

  // Hover-to-trace: on the plain map, hovering a node emphasises its own edges and
  // fades the rest, so one device's dependencies are followable through the tangle.
  // Skipped while an overlay or drift is active — those own the colouring. The hover
  // CARD is not gated that way: identifying what you are pointing at matters just as
  // much mid-incident, and it only paints HTML beside the canvas.
  const trace = !overlay && !drift;
  sigma.on('enterNode', ({ node }) => {
    if (trace) { hoveredNode = node; sigma.refresh(); }
    showHoverCard(node);
  });
  sigma.on('leaveNode', () => {
    if (trace) { hoveredNode = null; sigma.refresh(); }
    hideHoverCard();
  });
  // Panning or zooming under an open card would leave it pointing at empty space.
  sigma.getCamera().on('updated', () => { if (hoverCardNode) positionHoverCard(hoverCardNode); });

  if (trace) {
    sigma.setSetting('edgeReducer', (edge, attrs) => {
      if (!hoveredNode) return attrs;
      return graph.hasExtremity(edge, hoveredNode)
        ? { ...attrs, color: theme.edgeStrong, size: Math.max(attrs.size, 1.6), zIndex: 2 }
        : { ...attrs, color: theme.edgeFaint };
    });
    sigma.setSetting('nodeReducer', (node, attrs) => {
      if (!hoveredNode || node === hoveredNode || graph.areNeighbors(hoveredNode, node)) return attrs;
      return { ...attrs, label: '' }; // hide unrelated labels while tracing one node
    });
  }

  // Camera-driven level of detail, only under ?lod=camera. Zoom is otherwise purely
  // visual and resolution is chosen by opening a zone.
  if (CAMERA_LOD) {
    sigma.getCamera().on('updated', () => {
      if (!state.autoTier || state.loading || state.zones) return;
      const next = tierForRatio(sigma.getCamera().ratio, state.zoom);
      if (next !== state.zoom) { state.zoom = next; load({ keepCamera: true }); }
    });
  }

  // Zones re-project from graph space on every frame sigma paints, so they track
  // the camera exactly rather than lagging a pan by a frame.
  const layer = ensureZoneLayer($('topo-canvas'));
  const attackLayer = ensureAttackLayer($('topo-canvas'));
  const zones = zonesFor(data);
  const mini = $('topo-minimap');
  mini?.classList.toggle('hidden', zones.length === 0);

  // applyOverlay builds the attack model from the payload, so it runs before the
  // first projection; both layers then re-project on every frame sigma paints.
  attackModel = null;
  applyOverlay(data);
  applyDrift(data);

  const redraw = () => {
    if (zones.length) {
      drawZones(layer, sigma, graph, zones);
      renderMiniMap(mini, sigma, graph, zones);
    }
    if (attackModel) drawAttack(attackLayer, sigma, graph, attackModel);
  };
  if (!zones.length) clearZones(layer);
  if (!attackModel) clearAttack(attackLayer);
  redraw();
  sigma.on('afterRender', redraw);

  const count = data.nodes.length;
  const base = `<b>${TIERS[data.zoom]}</b> · ${count} node${count === 1 ? '' : 's'} · ${data.edges.length} link${data.edges.length === 1 ? '' : 's'}`;
  let suffix = '';
  if (overlay) suffix = ` · <b>${esc(overlay.title)}</b> overlay`;
  else if (drift) suffix = ` · <b>${esc(drift.description)}</b>`;
  else if (data.neighbors) suffix = ' · <b>+ outside dependencies</b>';
  setStatus(base + suffix);
  renderChips(data);
  renderLegend();
}

/** One legend row: a colour swatch (optionally ringed/muted) + its meaning. */
function legendRow(color, label, opts = {}) {
  const cls = `topo-leg-sw${opts.ring ? ' ring' : ''}${opts.muted ? ' muted' : ''}`;
  return `<li><span class="${cls}" style="--c:${color}"></span><span>${esc(label)}</span></li>`;
}

/**
 * Context-aware legend: shows exactly the colour set the current view uses, sourced
 * from the same maps the renderer paints with (so it can never drift from the map).
 * Overlay and drift take priority; otherwise it follows the zoom tier.
 */
function renderLegend() {
  const box = $('topo-legend');
  const toggle = $('topo-legend-toggle');
  if (!box || !toggle) return;
  const show = legendVisible && Boolean(lastData);
  box.classList.toggle('hidden', !show);
  toggle.classList.toggle('hidden', !lastData);
  toggle.setAttribute('aria-pressed', String(legendVisible));
  if (!show) return;

  const z = lastData.zoom;
  let title;
  let rows;
  if (overlay) {
    title = 'Kill chain';
    rows = (overlay.stages || []).map((s) => legendRow(STAGE_COLOR[overlay.tacticOrder.indexOf(s.tactic)] || '#ef4444', s.tactic));
    if (overlay.externals?.length) rows.push(legendRow(EXTERNAL_ACTOR_COLOR, 'External actor (C2 / exfil)'));
  } else if (drift) {
    title = 'What changed';
    rows = [legendRow('#ef4444', 'High'), legendRow('#f59e0b', 'Medium'), legendRow('#0ea5e9', 'Info')];
  } else if (z === 0) {
    title = 'Locality';
    const present = new Set(lastData.nodes.map((n) => n.name));
    rows = ['Internal', 'External', 'Unknown']
      .filter((k) => k === 'Internal' || present.has(k))
      .map((k) => legendRow(LOCALITY_COLOR[k], k));
  } else if (z === 1) {
    // Segments carry the hue of their dominant device role when the snapshot has it;
    // otherwise they fall back to the locality hue.
    const roles = [...new Set(lastData.nodes.map((n) => n.role).filter(Boolean))];
    if (roles.length) {
      title = 'Segment · dominant role';
      rows = roles.slice(0, 12).map((r) => legendRow(ROLE_COLOR[r] || ROLE_COLOR.unknown, prettyRole(r)));
    } else {
      title = 'Locality';
      const present = new Set(lastData.nodes.map((n) => n.parent));
      rows = ['Internal', 'External', 'Unknown']
        .filter((k) => k === 'Internal' || present.has(k))
        .map((k) => legendRow(LOCALITY_COLOR[k], k));
    }
  } else {
    title = 'Device role';
    const roles = [...new Set(lastData.nodes.filter((n) => !n.neighbor).map((n) => (z === 2 ? n.name : n.role)).filter(Boolean))];
    // At the device tier the nodes are icons, so the legend shows the icon too.
    rows = roles.slice(0, 12).map((r) => {
      const c = ROLE_COLOR[r] || ROLE_COLOR.unknown;
      return z === 3
        ? `<li>${roleGlyphInline(r, c, 14)}<span>${esc(prettyRole(r))}</span></li>`
        : legendRow(c, prettyRole(r));
    });
    if (lastData.nodes.some((n) => n.critical)) rows.push(legendRow('#ef4444', 'Critical', { ring: true }));
    if (lastData.nodes.some((n) => n.neighbor)) rows.push(legendRow('rgba(130,138,160,0.55)', 'Outside this segment', { muted: true }));
  }
  box.innerHTML = `<div class="topo-leg-h">${esc(title)}</div><ul class="topo-leg-list">${rows.join('')}</ul>`;
}

/**
 * Ring the nodes that changed since the compared snapshot. Drift is an annotation on
 * the map, not a replacement for it: nothing is hidden, changed things just get a
 * halo whose colour carries severity. Devices roll up to whatever the current tier
 * draws, so a change stays visible when zoomed out.
 */
/**
 * The drawn node that stands for a device, most-resolved first.
 *
 * Overlay and drift both key their findings by device, and the map may be drawing
 * that device itself, its segment, its role cluster, or its locality — and in the
 * zone view, different answers for different devices in the same payload. Indexing a
 * fixed field by the payload's zoom cannot express that: a change inside an opened
 * zone would lift to a segment node that is no longer drawn, and vanish.
 */
const LIFT_ORDER = ['key', 'role_key', 'segment', 'locality'];
function liftToDrawn(tiers) {
  if (!tiers || !graph) return '';
  for (const field of LIFT_ORDER) {
    const key = tiers[field];
    if (key && graph.hasNode(key)) return key;
  }
  return '';
}

function applyDrift(data) {
  if (!drift || !graph || overlay) return;
  const HALO = { high: '#ef4444', medium: '#f59e0b', info: '#0ea5e9' };
  const RANK = { high: 0, medium: 1, info: 2 };

  // Map each changed device onto the node drawn at this tier.
  const worst = new Map();
  const noteKey = (key, severity) => {
    if (!key || !graph.hasNode(key)) return;
    const current = worst.get(key);
    if (!current || RANK[severity] < RANK[current]) worst.set(key, severity);
  };
  for (const change of drift.changes) {
    const tiers = drift.tierMap?.[change.key];
    if (tiers) { noteKey(liftToDrawn(tiers), change.severity); continue; }
    for (const endpoint of change.endpoints || change.devices || []) {
      const t = drift.tierMap?.[endpoint];
      if (t) noteKey(liftToDrawn(t), change.severity);
    }
  }

  for (const [key, severity] of worst) {
    graph.setNodeAttribute(key, 'color', HALO[severity] || HALO.info);
    graph.setNodeAttribute(key, 'size', (graph.getNodeAttribute(key, 'size') || 5) * 1.4);
  }
  driftPainted = worst.size > 0 || drift.changes.length === 0;
}

// ---- View switch ------------------------------------------------------------
// Topology, matrix, changes. They share the snapshot, the group and the external
// filter; everything else about them is different, so each owns its own surface
// rather than trying to be the same canvas in three moods.

let view = 'topology';
let matrixState = null; // {model, selected} for the traffic matrix

function setView(next) {
  if (next === view) return;
  view = next;
  for (const b of document.querySelectorAll('.topo-view')) {
    const on = b.dataset.view === next;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', String(on));
  }
  $('topo-viewport')?.classList.toggle('hidden', next !== 'topology' || !lastData);
  $('topo-matrix')?.classList.toggle('hidden', next !== 'matrix');
  $('topo-changes')?.classList.toggle('hidden', next !== 'changes');
  $('topo-empty')?.classList.toggle('hidden', next !== 'topology' || Boolean(lastData));
  // Chrome that belongs to the map only.
  for (const id of ['topo-neighbors', 'topo-chips']) $(id)?.classList.toggle('hidden', next !== 'topology');
  $('topo-matrix-controls')?.classList.toggle('hidden', next !== 'matrix');
  if (next === 'matrix') loadMatrix();
  if (next === 'changes') loadChanges();
  if (next === 'topology') {
    // Looking at what changed and then looking at the map should not lose the
    // answer — but the status may only claim a comparison the graph is drawing.
    if (drift && !driftPainted) load({ keepCamera: true });
    else { setStatus(statusForData() + (drift ? ` · <b>${esc(drift.description || '')}</b>` : '')); sigma?.refresh(); }
  }
}

async function loadMatrix() {
  const host = $('topo-matrix');
  if (!host) return;
  host.innerHTML = '<div class="topo-matrix-empty panel-sub">Loading traffic matrix…</div>';
  setStatus('Traffic matrix');
  try {
    const params = new URLSearchParams({ groupBy: matrixGroupBy });
    if (state.group) params.set('group', state.group);
    if (state.snapshotId) params.set('snapshot', state.snapshotId);
    if (state.showExternal) params.set('external', '1');
    const res = await fetch(`/api/topology/matrix?${params}`);
    const data = await res.json();
    if (!res.ok) { host.innerHTML = `<div class="topo-matrix-empty panel-sub">${esc(data.error || 'Could not load the matrix.')}</div>`; return; }
    matrixState = { model: matrixModel(data), selected: '' };
    renderMatrix(host, matrixState.model);
    setStatus(`<b>Traffic matrix</b> · ${matrixState.model.axes.length} groups · ${matrixState.model.byPair.size} pairs`);
    wireMatrixCells();
    inspector('<div class="topo-inspector-empty panel-sub">Click a cell to see the conversations behind it.</div>');
  } catch {
    host.innerHTML = '<div class="topo-matrix-empty panel-sub">Could not load the matrix.</div>';
  }
}

function wireMatrixCells() {
  for (const cell of $('topo-matrix')?.querySelectorAll('.topo-cell:not([disabled])') || []) {
    cell.addEventListener('click', () => selectCell(cell.dataset.src, cell.dataset.dst));
  }
}

async function selectCell(src, dst) {
  if (!matrixState) return;
  const id = pairId(src, dst);
  matrixState.selected = id;
  renderMatrix($('topo-matrix'), matrixState.model, { selected: id });
  wireMatrixCells();

  const axis = (key) => matrixState.model.axes.find((a) => a.key === key);
  const nameOf = (key) => prettySegment(axis(key)?.name || key);
  const hit = matrixState.model.byPair.get(id) || { bytes: 0, links: 0 };
  const detail = {
    srcLabel: nameOf(src), dstLabel: nameOf(dst),
    bytes: hit.bytes, links: hit.links, diagonal: src === dst,
  };
  renderPairs($('topo-inspector'), { ...detail, loading: true });
  try {
    const params = new URLSearchParams({ groupBy: matrixGroupBy, src, dst });
    if (state.group) params.set('group', state.group);
    if (state.snapshotId) params.set('snapshot', state.snapshotId);
    const res = await fetch(`/api/topology/matrix/pairs?${params}`);
    const data = await res.json();
    if (matrixState.selected !== id) return; // the user moved on
    renderPairs($('topo-inspector'), { ...detail, pairs: res.ok ? data.pairs || [] : [] });
    $('topo-pairs-show')?.addEventListener('click', () => {
      // Hand the cell's devices to the topology, which already knows how to scope
      // itself to an explicit key set.
      const keys = [...new Set((data.pairs || []).flatMap((pr) => [pr.src_key, pr.dst_key]))].filter(Boolean);
      if (!keys.length) return;
      state.keys = keys; state.zoom = 3; state.parent = ''; state.scope = '';
      state.zones = false; state.autoTier = false;
      state.crumbs = [{ zoom: 3, parent: '', scope: '', label: `${detail.srcLabel} → ${detail.dstLabel}`, keys }];
      setView('topology');
      load();
    });
  } catch {
    renderPairs($('topo-inspector'), { ...detail, pairs: [] });
  }
}

let changesShowInfo = false;
let driftPainted = false; // whether the drawn graph already carries the drift halos

/**
 * Load and render the drift between the two most recent snapshots.
 *
 * `drift` stays set afterwards, so switching back to the topology still haloes the
 * changed nodes and the status line still names the comparison. Looking at what
 * changed and then looking at the map should not lose the answer.
 */
async function loadChanges() {
  const host = $('topo-changes');
  if (!host) return;
  renderChanges(host, null);
  setStatus('Comparing snapshots…');
  try {
    const params = new URLSearchParams();
    if (state.group) params.set('group', state.group);
    const res = await fetch(`/api/topology/drift?${params}`);
    const data = await res.json();
    if (!res.ok) {
      host.innerHTML = `<div class="topo-changes-empty panel-sub">${esc(data.error || 'Could not compare snapshots.')}</div>`;
      return;
    }
    drift = data;
    driftPainted = false;
    paintChanges();
    setStatus(`<b>Changes</b> · ${esc(drift.description || '')}`);
    inspector('<div class="topo-inspector-empty panel-sub">Every change links to its place on the map.</div>');
  } catch {
    host.innerHTML = '<div class="topo-changes-empty panel-sub">Could not compare snapshots.</div>';
  }
}

function paintChanges() {
  const host = $('topo-changes');
  if (!host || !drift) return;
  renderChanges(host, drift, { showInfo: changesShowInfo });
  $('topo-changes-info')?.addEventListener('click', () => {
    changesShowInfo = !changesShowInfo;
    paintChanges();
  });
  for (const btn of host.querySelectorAll('.topo-change-show')) {
    btn.addEventListener('click', () => {
      const change = drift.changes[Number(btn.dataset.index)];
      showChangeOnMap(change);
    });
  }
}

/**
 * Scope the topology to one change.
 *
 * A change names devices; the map may be drawing those devices, their segments, or
 * neither. An explicit key set is the one scope that always resolves, and it is what
 * the incident overlay already uses for the same reason.
 */
function showChangeOnMap(change) {
  const keys = changeKeys(change).filter((k) => drift?.tierMap?.[k] || k);
  if (!keys.length) return;
  state.keys = keys; state.zoom = 3; state.parent = ''; state.scope = '';
  state.zones = false; state.autoTier = false;
  state.crumbs = [{ zoom: 3, parent: '', scope: '', label: change.label || 'Change', keys }];
  setView('topology');
  load();
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
  // tier coordinates for exactly this. External actors carry the same key at every
  // tier, so once injected they lift to themselves.
  // Inject external actor nodes (C2 / exfil) — they belong to no cluster and draw as
  // themselves at every zoom. Place each near the incident's internal footprint so the
  // path out of the estate reads clearly. Done before lifting, so they can be lifted to.
  const footprint = [];
  for (const ev of overlay.events) {
    for (const k of [ev.src, ev.dst]) {
      const t = overlay.tierMap?.[k];
      if (t && !t.external) { const key = liftToDrawn(t); if (key) footprint.push(key); }
    }
  }
  const center = centroidOfNodes(footprint);
  for (const ext of overlay.externals || []) {
    if (graph.hasNode(ext.key)) continue;
    const off = extOffset(ext.key);
    graph.addNode(ext.key, {
      x: center.x + off.x, y: center.y + off.y, size: 8,
      label: `${ext.name} (external)`, color: EXTERNAL_ACTOR_COLOR,
      external: true, raw: { key: ext.key, name: ext.name, external: true },
    });
  }

  const liftKey = (deviceKey) => {
    const tiers = overlay.tierMap?.[deviceKey];
    if (!tiers) return '';
    return liftToDrawn(tiers);
  };

  const involved = new Set();
  const steps = [];
  const pairBySeq = new Map(); // event seq -> the path it is drawn on
  for (const ev of overlay.events) {
    const src = liftKey(ev.src);
    const dst = liftKey(ev.dst);
    for (const k of [src, dst]) if (k) involved.add(k);
    if (src && dst && src !== dst) {
      steps.push({ ...ev, from: src, to: dst });
      pairBySeq.set(ev.seq, `${src} ${dst}`);
    }
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
    const id = `${step.from}\u0000${step.to}`;
    if (!byPair.has(id)) byPair.set(id, { from: step.from, to: step.to, steps: [] });
    byPair.get(id).steps.push(step);
  }

  // Attack paths are drawn on the vector layer, not as sigma edges. A sigma edge is a
  // straight line with a flat colour and a text label: it cannot bow, cannot carry a
  // direction arrow, cannot animate, and its label collides with the node labels. The
  // steps are the story, so they get real geometry.
  const paths = [];
  for (const pair of byPair.values()) {
    // Colour by the furthest-along stage on this link: how bad it eventually got.
    const peak = pair.steps.reduce((a, b) => ((b.stage ?? -1) > (a.stage ?? -1) ? b : a));
    const numbers = pair.steps.map((st) => st.seq + 1).sort((a, b) => a - b);
    paths.push({
      id: `${pair.from} ${pair.to}`,
      from: pair.from,
      to: pair.to,
      color: STAGE_COLOR[peak.stage ?? 0] || '#ef4444',
      badge: String(numbers[0]),
      title: pair.steps.length === 1
        ? `Step ${numbers[0]}: ${peak.tactic || 'step'}`
        : `Steps ${numbers.join(', ')} · ${peak.tactic || 'steps'}`,
    });
  }

  // Patient zero: the source of the first step. Nothing on the map said where an
  // incident began, and it is the first thing an analyst looks for.
  const first = overlay.events.find((e) => e.seq === 0) || overlay.events[0];
  const patientZero = first ? liftKey(first.src) : '';
  const externals = (overlay.externals || []).map((e) => e.key).filter((k) => graph.hasNode(k));
  attackModel = { paths, patientZero, externals, pairBySeq };
  sigma.setSetting('renderEdgeLabels', false);
  overlayStats = { steps: steps.length, paths: byPair.size, nodes: involved.size };
  renderIncidentChrome();
  renderOverlayPanel(overlayStats.steps, overlayStats.paths, overlayStats.nodes);
}

/** Re-show the incident summary (from a device's detail, "← Back to incident"). */
function backToIncident() {
  if (overlay) renderOverlayPanel(overlayStats.steps, overlayStats.paths, overlayStats.nodes);
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
    const pair = attackModel?.pairBySeq?.get(e.seq) || '';
    return `<li class="topo-ev${pair ? ' linked' : ''}"${pair ? ` data-pair="${esc(pair)}"` : ''}>
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

  // Hovering a step lights its path on the map, which is the whole reason the
  // sequence and the geometry are the same object rather than two lists.
  const attackLayer = $('topo-canvas')?.querySelector('svg.topo-attack-layer');
  for (const row of document.querySelectorAll('.topo-ev[data-pair]')) {
    row.addEventListener('mouseenter', () => emphasisePath(attackLayer, row.dataset.pair));
    row.addEventListener('mouseleave', () => emphasisePath(attackLayer, ''));
  }
}

export async function load({ keepCamera = false } = {}) {
  if (state.loading) return;
  state.loading = true;
  const cam = keepCamera && sigma ? { ...sigma.getCamera().getState() } : null;
  try {
    const params = new URLSearchParams({ zoom: String(state.zoom) });
    if (state.group) params.set('group', state.group);
    if (state.snapshotId) params.set('snapshot', state.snapshotId);
    // The zone view is a whole-estate read with holes punched in it, so it takes no
    // parent/scope: `expanded` is the only thing that varies. An empty value is still
    // sent, since it is what selects the mixed payload.
    if (state.zones) params.set('expanded', state.expanded.join(','));
    if (state.parent) params.set('parent', state.parent);
    if (state.scope) params.set('scope', state.scope);
    if (state.showExternal) params.set('external', '1');
    if (state.showNeighbors && state.zoom === 3 && state.parent) params.set('neighbors', '1');
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
    $('topo-viewport').classList.remove('hidden');
    paint(data);
    if (cam) sigma.getCamera().setState(cam);
    renderCrumbs();
    updateNeighborBtn();
  } catch (err) {
    console.error('[topology] load failed', err);
    showEmpty('Could not reach the topology service.');
  } finally {
    state.loading = false;
  }
}

function showEmpty(message) {
  if (sigma) { sigma.kill(); sigma = null; }
  $('topo-viewport').classList.add('hidden');
  $('topo-legend')?.classList.add('hidden');
  $('topo-legend-toggle')?.classList.add('hidden');
  const el = $('topo-empty');
  el.classList.remove('hidden');
  el.innerHTML = `<div class="topo-empty-inner">${message}</div>`;
  setStatus('');
  renderCrumbs();
}

/** Cache the incident list for the searchable overlay picker. */
async function loadIncidents() {
  try {
    const res = await fetch('/api/topology/incidents');
    if (!res.ok) { incidentsCache = []; return; }
    const { incidents } = await res.json();
    incidentsCache = Array.isArray(incidents) ? incidents : [];
  } catch { incidentsCache = []; }
}

function incidentLabel(i) {
  if (!i || !i.id) return '';
  return `${i.title}${i.disposition ? ` · ${i.disposition}` : ''} (${i.events})`;
}

/**
 * The searchable overlay dropdown. The first row always clears the overlay, then the
 * incidents that match the typed filter — so a large history is reachable without a
 * giant static list (issue #4: "show the first six, let the user search for others").
 */
function renderIncidentList(filter = '') {
  const list = $('topo-overlay-list');
  if (!list) return;
  const q = filter.trim().toLowerCase();
  const matches = q
    ? incidentsCache.filter((i) => `${i.title} ${i.disposition}`.toLowerCase().includes(q))
    : incidentsCache;
  const items = [`<li role="option" class="topo-combo-item" data-id="">No overlay</li>`]
    .concat(matches.slice(0, 100).map((i) => (
      `<li role="option" class="topo-combo-item" data-id="${esc(i.id)}">${esc(incidentLabel(i))}</li>`
    )));
  list.innerHTML = items.join('');
  $('topo-overlay-search')?.setAttribute('aria-expanded', 'true');
  list.querySelectorAll('.topo-combo-item').forEach((li) => li.addEventListener('mousedown', (e) => {
    // mousedown (not click) + preventDefault, so selecting doesn't lose input focus to
    // the blur race before we read the choice.
    e.preventDefault();
    const id = li.dataset.id;
    hideIncidentList();
    $('topo-incident-pop')?.classList.add('hidden');
    $('topo-incident-btn')?.setAttribute('aria-expanded', 'false');
    const input = $('topo-overlay-search');
    if (input) input.value = '';
    selectOverlay(id);
  }));
}

function hideIncidentList() {
  $('topo-incident-pop')?.classList.add('hidden');
  $('topo-overlay-search')?.setAttribute('aria-expanded', 'false');
  $('topo-incident-btn')?.setAttribute('aria-expanded', 'false');
}

// ---- Find on map ------------------------------------------------------------
// Without this you can only reach a device by guessing which segment holds it and
// drilling. The index is the whole device tier for the current snapshot, fetched
// once on first use — the same read the incident overlay already does server-side.

let deviceIndex = null;  // [] of device-tier nodes, or null when not yet fetched
let deviceIndexKey = ''; // group|snapshot|external — a change invalidates the cache

function invalidateDeviceIndex() { deviceIndex = null; deviceIndexKey = ''; }

async function ensureDeviceIndex() {
  const key = `${state.group}|${state.snapshotId}|${state.showExternal ? 1 : 0}`;
  if (deviceIndex && deviceIndexKey === key) return deviceIndex;
  const params = new URLSearchParams({ zoom: '3', limit: '5000' });
  if (state.group) params.set('group', state.group);
  if (state.snapshotId) params.set('snapshot', state.snapshotId);
  if (state.showExternal) params.set('external', '1');
  try {
    const res = await fetch(`/api/topology/map?${params}`);
    const data = await res.json();
    deviceIndex = res.ok && Array.isArray(data.nodes) ? data.nodes : [];
  } catch { deviceIndex = []; }
  deviceIndexKey = key;
  return deviceIndex;
}

/** Devices matched on name or IP, then users on name. Prefix hits rank first. */
function searchResults(query) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const rank = (s) => (s.toLowerCase().startsWith(q) ? 0 : 1);
  const devices = [];
  for (const n of deviceIndex || []) {
    const name = String(n.name ?? n.key ?? '');
    const ip = String(n.ip ?? '');
    if (!name.toLowerCase().includes(q) && !ip.toLowerCase().includes(q)) continue;
    devices.push({
      kind: 'device',
      id: n.key,
      label: name || ip || n.key,
      meta: [ip, n.role ? prettyRole(n.role) : '', prettySegment(n.segment)].filter(Boolean).join(' · '),
      node: n,
      rank: Math.min(rank(name), rank(ip)),
    });
  }
  const users = (identitiesCache || [])
    .filter((i) => String(i.name || '').toLowerCase().includes(q))
    .map((i) => ({
      kind: 'user',
      id: i.name,
      label: i.name,
      meta: `User · ${i.devices?.length || 0} device${i.devices?.length === 1 ? '' : 's'}`,
      rank: rank(String(i.name || '')),
    }));
  const by = (a, b) => a.rank - b.rank || a.label.localeCompare(b.label);
  return [...devices.sort(by).slice(0, 40), ...users.sort(by).slice(0, 10)];
}

function hideSearchList() {
  $('topo-search-list')?.classList.add('hidden');
  $('topo-search')?.setAttribute('aria-expanded', 'false');
}

function renderSearchList(query) {
  const list = $('topo-search-list');
  if (!list) return;
  const results = searchResults(query);
  if (!query.trim()) { hideSearchList(); return; }
  list.innerHTML = results.length
    ? results.map((r) => (
      `<li role="option" class="topo-combo-item" data-kind="${r.kind}" data-id="${esc(r.id)}">`
      + `<span class="topo-find-name">${esc(r.label)}</span>`
      + (r.meta ? `<span class="topo-find-meta">${esc(r.meta)}</span>` : '')
      + `</li>`
    )).join('')
    : `<li class="topo-combo-item topo-find-empty">No device, IP or user matches that.</li>`;
  list.classList.remove('hidden');
  $('topo-search')?.setAttribute('aria-expanded', 'true');
  list.querySelectorAll('.topo-combo-item[data-id]').forEach((li) => {
    // mousedown + preventDefault so the choice is read before blur steals focus,
    // matching the incident picker.
    li.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const hit = results.find((r) => r.id === li.dataset.id && r.kind === li.dataset.kind);
      if (hit) selectSearchResult(hit);
    });
  });
}

/** Centre the camera on a node that is already painted. */
function flyTo(key) {
  if (!sigma || !graph?.hasNode(key)) return;
  const d = sigma.getNodeDisplayData(key);
  if (!d) return;
  const cam = sigma.getCamera();
  // Jumping to a device is an explicit navigation, so suspend camera-driven LOD the
  // way drilling does — otherwise the zoom-in below can cross a tier band and refetch
  // a different tier, throwing away the very device that was asked for.
  state.autoTier = false;
  cam.animate({ x: d.x, y: d.y, ratio: Math.min(cam.ratio, 0.6) }, { duration: camDuration(320) });
}

async function selectSearchResult(hit) {
  hideSearchList();
  const input = $('topo-search');
  if (input) input.value = hit.kind === 'user' ? hit.label : (hit.node?.name || hit.label);
  if (hit.kind === 'user') { await showUser(hit.id); return; }

  if (graph?.hasNode(hit.id)) { flyTo(hit.id); showDevice(hit.id); return; }

  // Off-screen: bring its segment into view first, then land on the device. Falling
  // back to a keys= view keeps search working for a device with no segment.
  const segment = hit.node?.segment || '';
  if (segment) {
    state.crumbs = [{ zoom: 3, parent: segment, scope: 'segment', label: prettySegment(segment) }];
    state.zoom = 3; state.parent = segment; state.scope = 'segment'; state.keys = null;
    state.zones = false;
  } else {
    state.crumbs = [{ zoom: 3, parent: '', scope: '', label: hit.label, keys: [hit.id] }];
    state.zoom = 3; state.parent = ''; state.scope = ''; state.keys = [hit.id];
    state.zones = false;
  }
  state.autoTier = false;
  updateNeighborBtn();
  await load();
  if (graph?.hasNode(hit.id)) { flyTo(hit.id); showDevice(hit.id); }
}


/**
 * Reflect the overlay in the chrome: the button says whether one is drawn, and the
 * kill-chain strip carries the incident's shape without needing the inspector open.
 */
function renderIncidentChrome() {
  const label = $('topo-incident-label');
  const btn = $('topo-incident-btn');
  const clear = $('topo-incident-clear');
  const strip = $('topo-killchain');
  const stages = $('topo-killchain-stages');
  if (!label || !btn) return;

  const active = Boolean(overlay);
  btn.classList.toggle('active', active);
  clear?.classList.toggle('hidden', !active);
  label.textContent = active ? overlay.title : 'Overlay an incident';
  btn.title = active ? `Incident overlay: ${overlay.title}` : 'Draw an incident over the map';

  if (!strip || !stages) return;
  strip.classList.toggle('hidden', !active || !overlay.stages?.length);
  if (!active || !overlay.stages?.length) { stages.replaceChildren(); return; }
  // Numbered chips joined by arrows: the order is the story.
  stages.innerHTML = overlay.stages.map((stage, i) => {
    const idx = overlay.tacticOrder.indexOf(stage.tactic);
    const color = STAGE_COLOR[idx] || '#ef4444';
    return (i ? '<span class="topo-killchain-arrow" aria-hidden="true">&rarr;</span>' : '')
      + `<span class="topo-killchain-stage" style="--stage:${color}">`
      + `<span class="topo-killchain-num">${i + 1}</span>${esc(stage.tactic)}`
      + `<b>${Number(stage.count) || 0}</b></span>`;
  }).join('');
}

/** Select an incident to draw, or '' to return to the plain map. */
async function selectOverlay(sessionId) {
  if (!sessionId) {
    overlay = null;
    const os = $('topo-overlay-search'); if (os) os.value = '';
    state.showExternal = false;
    $('topo-external')?.setAttribute('aria-pressed', 'false');
    $('topo-external')?.classList.remove('active');
    // Returning to the plain map leaves any incident framing behind.
    state.keys = null; state.crumbs = []; state.zoom = CAMERA_LOD ? 0 : 1; state.parent = ''; state.scope = ''; state.autoTier = true;
    state.zones = !CAMERA_LOD; state.expanded = [];
    renderIncidentChrome();
    load();
    inspector('<div class="topo-inspector-empty panel-sub">Click a zone to open it, or a device to inspect it.</div>');
    return;
  }
  inspector('<div class="topo-inspector-empty panel-sub">Loading incident…</div>');
  try {
    const params = new URLSearchParams({ group: state.group, snapshot: state.snapshotId });
    const res = await fetch(`/api/topology/incidents/${encodeURIComponent(sessionId)}?${params}`);
    const data = await res.json();
    if (!res.ok) { inspector(`<div class="topo-inspector-empty panel-sub">${esc(data.error || 'Could not load that incident.')}</div>`); return; }
    overlay = { ...data, tacticOrder: TACTIC_ORDER };
    // An incident and a snapshot comparison answer different questions; showing both
    // at once would mean two competing colour languages on the same nodes.
    if (drift) drift = null; // an incident overlay and a drift comparison are different reads
    // Start HIGH-LEVEL and zoomable — like the map it's drawn on. The whole estate is
    // shown at the segment tier with the incident's clusters highlighted and everything
    // else dimmed; camera-driven LOD stays on, so zooming in redraws the path at each
    // tier down to individual devices. (The old behaviour teleported straight to a bare
    // device set with no way to see context or zoom back out.) An incident can touch an
    // External-locality device, so make sure those are shown while an overlay is active.
    state.keys = null; state.parent = ''; state.scope = ''; state.crumbs = [];
    state.zoom = 1; state.autoTier = true;
    state.zones = false; // the overlay owns the framing until it is cleared
    state.showExternal = true;
    $('topo-external')?.setAttribute('aria-pressed', 'true');
    $('topo-external')?.classList.add('active');
    await load();
  } catch {
    inspector('<div class="topo-inspector-empty panel-sub">Could not load that incident.</div>');
  }
}

/* ------------------------------------------------------------------- users */

/** Load every identity in the snapshot once, so the Users panel and search are instant. */
async function loadIdentities() {
  try {
    const params = new URLSearchParams();
    if (state.group) params.set('group', state.group);
    if (state.snapshotId) params.set('snapshot', state.snapshotId);
    const res = await fetch(`/api/topology/identities?${params}`);
    if (!res.ok) { identitiesCache = []; return; }
    const { identities } = await res.json();
    identitiesCache = Array.isArray(identities) ? identities : [];
  } catch { identitiesCache = []; }
  const btn = $('topo-users');
  if (btn) btn.classList.toggle('hidden', identitiesCache.length === 0);
}

/** The searchable Users list, rendered into the inspector column. */
function renderUsersPanel(filter = '') {
  const q = filter.trim().toLowerCase();
  const matches = q
    ? identitiesCache.filter((i) => i.name.toLowerCase().includes(q) || (i.principal || '').toLowerCase().includes(q))
    : identitiesCache;
  const rows = matches.slice(0, 200).map((i) => (
    `<li><button type="button" class="topo-user-link" data-user="${esc(i.name)}">`
    + `${avatarSvg(identityType(i.principal || i.name))}`
    + `<span class="topo-user-name">${esc(i.name)}</span>`
    + `<span class="topo-user-count">${i.devices.length} device${i.devices.length === 1 ? '' : 's'}</span>`
    + `</button></li>`
  )).join('');
  inspector([
    `<div class="topo-ins-title">Users</div>`,
    `<div class="topo-ins-sub panel-sub">${identitiesCache.length} identit${identitiesCache.length === 1 ? 'y' : 'ies'} seen in this snapshot · click one to see its devices</div>`,
    `<input id="topo-user-search" class="topo-select topo-user-search" type="search" placeholder="Search users…" value="${esc(filter)}" autocomplete="off">`,
    matches.length
      ? `<ul class="topo-ins-list topo-users">${rows}</ul>`
      : `<div class="topo-ins-foot panel-sub">No user matches “${esc(filter)}”.</div>`,
  ].join(''));
  const search = $('topo-user-search');
  if (search) {
    search.addEventListener('input', (e) => renderUsersPanel(e.target.value));
    // Keep focus + caret at the end across the re-render.
    search.focus();
    const v = search.value; search.value = ''; search.value = v;
  }
  $('topo-inspector')?.querySelectorAll('.topo-user-link').forEach((b) => b.addEventListener('click', () => showUser(b.dataset.user)));
}

/** Open the Users panel (from the header button). */
function openUsers() {
  if (!identitiesCache.length) {
    inspector('<div class="topo-inspector-empty panel-sub">No users in this snapshot. Ask the agent to map the network — Tier 1 binds users on servers and critical hosts.</div>');
    return;
  }
  renderUsersPanel('');
}

/**
 * Frame the map on one identity's devices and list them. Reuses the key-scoped view
 * the attack overlay uses: the devices may span several segments, so a key set is the
 * right scope, and a breadcrumb makes it obvious how to get back.
 */
async function showUser(name) {
  const identity = identitiesCache.find((i) => i.name === name);
  if (!identity) return;
  const keys = identity.devices.map((d) => d.key).filter(Boolean);
  overlay = null; drift = null;
  const os = $('topo-overlay-search'); if (os) os.value = '';
  if (keys.length) {
    state.crumbs = [{ zoom: 3, parent: '', scope: '', label: `User: ${name}`, keys }];
    state.zoom = 3; state.parent = ''; state.scope = ''; state.keys = keys; state.autoTier = false;
    state.zones = false;
    await load();
  }
  const devRows = identity.devices.map((d) => (
    `<li><button type="button" class="topo-dev-link" data-key="${esc(d.key)}">`
    + `<span class="topo-peer-name">${esc(d.name || d.ip || d.key)}</span>`
    + `<span class="topo-peer-bytes">${esc(d.role || '')}</span></button></li>`
  )).join('');
  inspector([
    `<button type="button" class="topo-back" id="topo-user-back">← All users</button>`,
    `<div class="topo-ins-title">${esc(name)}</div>`,
    `<div class="topo-ins-sub panel-sub">Authenticated on ${identity.devices.length} device${identity.devices.length === 1 ? '' : 's'} in this snapshot</div>`,
    `<ul class="topo-ins-list topo-peers">${devRows}</ul>`,
    `<div class="topo-ins-foot panel-sub">An identity here authenticated from/to these hosts in the window — it does not by itself prove compromise.</div>`,
  ].join(''));
  $('topo-user-back')?.addEventListener('click', () => openUsers());
  $('topo-inspector')?.querySelectorAll('.topo-dev-link').forEach((b) => b.addEventListener('click', () => showDevice(b.dataset.key)));
}

/** `Aug 3, 22:52 · 114 devices`, falling back to the raw stamp if it won't parse. */
function snapshotLabel(s) {
  const raw = s.collected_at || '';
  const d = raw ? new Date(raw) : null;
  const when = d && !Number.isNaN(d.getTime())
    ? d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : String(raw || s.id).replace('T', ' ').replace('Z', '');
  return `${when} · ${Number(s.device_count) || 0} devices`;
}

/**
 * Snapshots as a timeline rather than a <select>: retention keeps a dozen at most
 * (EH_TOPOLOGY_KEEP), so they all fit as squares and the history is legible at a
 * glance. Oldest on the left so "now" is where the eye finishes.
 *
 * It replaces a native control, so it owes native behaviour: a radiogroup with
 * roving tabindex, arrow-key movement, and the full stamp on every square for
 * anyone who cannot see the ramp.
 */
function renderSnapshotTimeline() {
  const wrap = $('topo-snaps');
  const label = $('topo-snap-label');
  if (!wrap || !label) return;
  if (!snapshots.length) {
    wrap.innerHTML = '';
    label.textContent = 'No snapshots yet';
    return;
  }
  const ordered = [...snapshots].reverse(); // served newest-first
  wrap.innerHTML = ordered.map((s, i) => {
    const active = s.id === state.snapshotId;
    const age = ordered.length - 1 - i; // 0 = newest
    const tone = age === 0 ? 3 : age === 1 ? 2 : 1;
    return `<button type="button" role="radio" class="topo-snap${active ? ' active' : ''}"`
      + ` data-tone="${tone}" data-id="${esc(s.id)}" aria-checked="${active}"`
      + ` tabindex="${active ? '0' : '-1'}" title="${esc(snapshotLabel(s))}"`
      + ` aria-label="${esc(snapshotLabel(s))}"></button>`;
  }).join('');
  const current = ordered.find((s) => s.id === state.snapshotId) || ordered[ordered.length - 1];
  label.textContent = snapshotLabel(current);
}

/** Switch snapshots: a different point in time is a different map, so reset the view. */
function selectSnapshot(id, { focus = false } = {}) {
  if (!id || id === state.snapshotId) return;
  state.snapshotId = id;
  state.crumbs = []; state.parent = ''; state.scope = ''; state.zoom = CAMERA_LOD ? 0 : 1;
  state.keys = null; state.autoTier = true;
  state.zones = !CAMERA_LOD; state.expanded = [];
  invalidateDeviceIndex();
  renderSnapshotTimeline();
  if (focus) $('topo-snaps')?.querySelector('.topo-snap.active')?.focus();
  loadIdentities();
  load();
}

async function loadSnapshots() {
  try {
    const res = await fetch('/api/topology/snapshots');
    if (!res.ok) return;
    const data = await res.json();
    state.group = data.group || '';
    snapshots = Array.isArray(data.snapshots) ? data.snapshots : [];
    if (snapshots.length) state.snapshotId = snapshots[0].id;
    renderSnapshotTimeline();
  } catch { /* the empty state already explains it */ }
}

function open() {
  $('topology-overlay').classList.remove('hidden');
  setRpTab('map');
  // The map opens on the zone view: every segment as a labelled container, none of
  // them opened. Under ?lod=camera it opens on the old locality tier instead.
  state = {
    ...state,
    zoom: CAMERA_LOD ? 0 : 1,
    parent: '', scope: '', crumbs: [], keys: null,
    showExternal: false, showNeighbors: false, autoTier: true,
    zones: !CAMERA_LOD, expanded: [],
  };
  overlay = null; // the map always opens plain; an incident is something you choose
  drift = null;
  legendVisible = true;
  const os = $('topo-overlay-search'); if (os) os.value = '';
  renderIncidentChrome();
  setView('topology');
  drift = null;
  changesShowInfo = false;
  for (const id of ['topo-external', 'topo-neighbors']) {
    $(id)?.setAttribute('aria-pressed', 'false');
    $(id)?.classList.remove('active');
  }
  loadSnapshots().then(() => Promise.all([load(), loadIncidents(), loadIdentities()]));
}

function close({ activate = 'files' } = {}) {
  $('topology-overlay').classList.add('hidden');
  hideHoverCard(); // fixed-positioned: it would outlive the overlay otherwise
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
  $('topo-snaps')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.topo-snap');
    if (btn) selectSnapshot(btn.dataset.id);
  });
  $('topo-snaps')?.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const btns = [...($('topo-snaps')?.querySelectorAll('.topo-snap') || [])];
    const i = btns.findIndex((b) => b.getAttribute('aria-checked') === 'true');
    const next = btns[e.key === 'ArrowLeft' ? Math.max(0, i - 1) : Math.min(btns.length - 1, i + 1)];
    if (next && next !== btns[i]) selectSnapshot(next.dataset.id, { focus: true });
  });
  const overlaySearch = $('topo-overlay-search');
  const incidentPop = $('topo-incident-pop');
  const openIncidentPop = (open) => {
    incidentPop?.classList.toggle('hidden', !open);
    $('topo-incident-btn')?.setAttribute('aria-expanded', String(open));
    if (open) { renderIncidentList(overlaySearch?.value || ''); overlaySearch?.focus(); }
  };
  $('topo-incident-btn')?.addEventListener('click', () => {
    openIncidentPop(incidentPop?.classList.contains('hidden'));
  });
  $('topo-incident-clear')?.addEventListener('click', () => {
    if (overlaySearch) overlaySearch.value = '';
    selectOverlay('');
  });
  overlaySearch?.addEventListener('input', () => renderIncidentList(overlaySearch.value));
  overlaySearch?.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation(); // or app.js closes the whole map
    openIncidentPop(false);
    $('topo-incident-btn')?.focus();
  });
  // Clicking anywhere else dismisses it, the way a menu should.
  document.addEventListener('click', (e) => {
    if (incidentPop?.classList.contains('hidden')) return;
    if (e.target.closest('.topo-incident')) return;
    openIncidentPop(false);
  });
  $('topo-users')?.addEventListener('click', openUsers);
  $('topo-external')?.addEventListener('click', () => {
    state.showExternal = !state.showExternal;
    const b = $('topo-external');
    b?.setAttribute('aria-pressed', String(state.showExternal));
    b?.classList.toggle('active', state.showExternal);
    load({ keepCamera: true });
  });
  $('topo-neighbors')?.addEventListener('click', () => {
    state.showNeighbors = !state.showNeighbors;
    const b = $('topo-neighbors');
    b?.setAttribute('aria-pressed', String(state.showNeighbors));
    b?.classList.toggle('active', state.showNeighbors);
    load({ keepCamera: true });
  });
  const search = $('topo-search');
  search?.addEventListener('focus', async () => { await ensureDeviceIndex(); renderSearchList(search.value); });
  search?.addEventListener('input', async () => { await ensureDeviceIndex(); renderSearchList(search.value); });
  search?.addEventListener('blur', () => setTimeout(hideSearchList, 150));
  search?.addEventListener('keydown', (e) => {
    // Escape closes the result list first. Without stopping propagation here the
    // document-level handler in app.js would close the whole map instead.
    if (e.key === 'Escape' && !$('topo-search-list')?.classList.contains('hidden')) {
      e.stopPropagation();
      hideSearchList();
    }
  });
  // `/` focuses search, the way it does in the mockup and most map UIs — but never
  // while the caret is already in a field, or it would swallow the character.
  document.addEventListener('keydown', (e) => {
    if (e.key !== '/' || !isTopologyOpen()) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    e.preventDefault();
    $('topo-search')?.focus();
  });

  // Mini-map click pans to that part of the estate. Graph space is converted to the
  // camera's framed space by round-tripping through the viewport, which is the only
  // path sigma exposes between the two.
  $('topo-mini-body')?.addEventListener('click', (e) => {
    if (!sigma) return;
    const point = miniMapPointAt($('topo-mini-body'), e.clientX, e.clientY);
    if (!point) return;
    const framed = sigma.viewportToFramedGraph(sigma.graphToViewport(point));
    state.autoTier = false;
    sigma.getCamera().animate({ x: framed.x, y: framed.y }, { duration: camDuration(300) });
  });

  for (const b of document.querySelectorAll('.topo-view')) {
    b.addEventListener('click', () => setView(b.dataset.view));
  }
  $('topo-matrix-groupby')?.addEventListener('change', (e) => {
    matrixGroupBy = e.target.value;
    if (view === 'matrix') loadMatrix();
  });

  $('topo-zoom-in')?.addEventListener('click', () => zoomCamera(1 / ZOOM_STEP));
  $('topo-zoom-out')?.addEventListener('click', () => zoomCamera(ZOOM_STEP));
  $('topo-fit')?.addEventListener('click', fitToView);
  $('topo-legend-toggle')?.addEventListener('click', () => { legendVisible = !legendVisible; renderLegend(); });
  $('topo-refresh')?.addEventListener('click', () => {
    invalidateDeviceIndex();
    loadSnapshots().then(() => (view === 'matrix' ? loadMatrix() : load()));
  });
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
