// Memory graph overlay. Two modes over the read-only /api/memory/graph/* API
// (never mutates memory; bounded neighborhoods only, safe at any total scale):
//
//   • Browse  (v1, contextual recall): a "What do we know?" ego-network keyed to
//     an entity — focus + neighbors + the facts between them + the episodes that
//     mention it.
//   • This investigation (v2, real-time situational awareness): the entities the
//     current investigation is touching, derived live from the tool-call stream,
//     each resolved against memory as KNOWN (prior conclusions — click to expand
//     its ego-network) or NEW this run. Updates as the agent works.
//
// Rendered with a small dependency-free SVG layout — the graphs are small
// (< ~40 nodes) so SVG is crisp, themeable via CSS vars, and click/hover come
// for free. The server contract is renderer-agnostic; the future scale-explorer
// + timeline introduce sigma.js + graphology against the same endpoints.

import { state } from './state.js';
import { openPromoteDialog } from './eval.js';

const $ = (id) => document.getElementById(id);
// Ontology types offered for curating untyped nodes (mirrors the server whitelist).
const ONTOLOGY = ['Device', 'Identity', 'Endpoint', 'NetworkSegment', 'DetectionType', 'Detection', 'Investigation', 'Analyst', 'Disposition', 'MitreTechnique', 'IOC', 'Service', 'Group'];
const NS = 'http://www.w3.org/2000/svg';
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Node color by ontology type — mid-tone hues legible on both themes. Episodes
// (past investigations) get a distinct warm tone.
const TYPE_COLOR = {
  Device: '#3b82f6', Identity: '#8b5cf6', Endpoint: '#06b6d4', NetworkSegment: '#14b8a6',
  DetectionType: '#f59e0b', Detection: '#ef4444', Investigation: '#64748b', Analyst: '#22c55e',
  Disposition: '#a855f7', MitreTechnique: '#ec4899', IOC: '#dc2626', Service: '#0ea5e9',
  Group: '#84cc16', Episode: '#f97316', Entity: '#9ca3af',
};
const colorFor = (t) => TYPE_COLOR[t] || TYPE_COLOR.Entity;

// Macro-lane per ontology type for the semantic layout (doc §3.2): originators &
// assets on the left, threat objects on the right, conclusions up top, prior
// episodes along the bottom. The focus entity holds the centre.
const LANE = {
  Identity: 'left', Analyst: 'left', Group: 'left', Device: 'left', NetworkSegment: 'left',
  Detection: 'right', IOC: 'right', Service: 'right', Endpoint: 'right', DetectionType: 'right',
  MitreTechnique: 'top', Disposition: 'top',
  Investigation: 'bottom', Episode: 'bottom',
};

// Short type badge drawn inside each node — a secondary, colour-independent type
// cue (doc §3.3/§5) so the analyst doesn't have to memorise 13 hues and the graph
// stays legible in greyscale.
const TYPE_BADGE = {
  Device: 'DV', Identity: 'ID', Endpoint: 'EP', NetworkSegment: 'NET', DetectionType: 'DT',
  Detection: 'DET', Investigation: 'INV', Analyst: 'AN', Disposition: 'DIS',
  MitreTechnique: 'ATT', IOC: 'IOC', Service: 'SVC', Group: 'GRP',
};
const badgeFor = (t) => TYPE_BADGE[t] || '';

let currentGroup = null;
let searchDebounce = null;

// ---------- investigation mode (real-time) ----------
const INV_HUB = '__inv__';
let mode = 'browse';              // 'browse' | 'investigation'
let view = 'graph';               // 'graph' | 'timeline' (investigation mode only)
let surface = 'overlay';          // 'overlay' (full screen) | 'docked' (right rail)
const invTokens = new Set();      // raw entity tokens, in discovery order (Set keeps insertion order)
const invResolved = new Map();    // token -> { token, known, uuid?, name, type, summary? }
let invRenderTimer = null;
let forensicTimeline = null;      // structured timeline[] from verdict.json once the run completes
let forensicAttempted = false;    // avoid re-fetching verdict.json every render

// IPs and hostnames the agent explicitly queries/receives are the cleanest live
// signal of "what this investigation is touching."
const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const HOST = /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.){1,}[a-z]{2,}\b/gi;
const TLD_OK = new Set(['com', 'net', 'org', 'io', 'gov', 'edu', 'mil', 'co', 'ai', 'lab', 'local', 'internal', 'cloud', 'app', 'dev', 'info', 'biz']);
// Real domains that show up as boilerplate in tool output (XML namespaces, schema
// refs) rather than as entities in scope.
const NOISE_HOSTS = new Set(['w3.org', 'www.w3.org', 'schemas.xmlsoap.org', 'schemas.microsoft.com', 'schemas.android.com', 'purl.org', 'example.com']);

// Require a real TLD (drops code tokens like datetime.datetime.utcnow) and skip
// boilerplate domains.
function keepHost(h) {
  if (NOISE_HOSTS.has(h)) return false;
  const labels = h.split('.');
  return TLD_OK.has(labels[labels.length - 1].toLowerCase());
}
// Skip non-entity IPs: malformed/out-of-range, unspecified/broadcast, and network
// (.0) / broadcast (.255) addresses that aren't hosts.
function validIp(t) {
  const p = t.split('.');
  if (p.length !== 4 || !p.every((o) => o !== '' && +o >= 0 && +o <= 255)) return false;
  if (t === '0.0.0.0' || t === '255.255.255.255') return false;
  const last = +p[3];
  return last !== 0 && last !== 255;
}
// DOMAIN\user identities (very distinctive; low false-positive) and large
// numeric detection ids (only pulled from detection-related tool calls).
// Require ≥2 chars on BOTH sides of the separator: a real NetBIOS identity always
// has a multi-char domain and account (ACMELEGAL\ian.lindsay), whereas literal
// escape sequences that leak from tool output — external\n, r\n, ID\n, json\r,
// n\nRule — always have a single char on one side, so this drops them without
// touching genuine identities (residual multi-char artifacts fall to curation).
const IDENT = /\b[A-Za-z][\w.-]+\\[A-Za-z][\w.-]+\b/g;
const DETID = /\b\d{7,}\b/g;

function guessType(t) {
  if (t.startsWith('detection:')) return 'Detection';
  if (t.includes('\\')) return 'Identity';
  if (/^\d+\.\d+\.\d+\.\d+$/.test(t)) {
    return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(t) ? 'Device' : 'Endpoint';
  }
  return 'Endpoint';
}

// Detection ids appear as bare large integers; only trust them from tools whose
// name is about detections, to avoid grabbing random numbers as detections.
function extractDetections(toolName, args) {
  if (!/detection/i.test(String(toolName || ''))) return [];
  const ids = new Set();
  for (const m of JSON.stringify(args || {}).matchAll(DETID)) ids.add(`detection:${m[0]}`);
  return ids;
}

// Flatten any tool args/result into strings, then pull IPs + hostnames.
function collectStrings(v, out, depth = 0) {
  if (v == null || depth > 6 || out.length > 400) return;
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) for (const x of v) collectStrings(x, out, depth + 1);
  else if (typeof v === 'object') for (const k of Object.keys(v)) collectStrings(v[k], out, depth + 1);
}
function extractTokens(payload) {
  const strs = [];
  collectStrings(payload, strs);
  const text = strs.join(' ').slice(0, 20000);
  const toks = new Set();
  for (const m of text.matchAll(IPV4)) if (validIp(m[0])) toks.add(m[0]);
  for (const m of text.matchAll(HOST)) { const h = m[0].toLowerCase(); if (keepHost(h)) toks.add(h); }
  for (const m of text.matchAll(IDENT)) toks.add(m[0]); // DOMAIN\user identities
  return toks;
}

async function getJSON(url, opts) {
  const res = await fetch(url, opts);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

const qs = (params) => {
  const p = new URLSearchParams();
  if (currentGroup) p.set('group', currentGroup);
  for (const [k, v] of Object.entries(params || {})) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
};

// ---------- overview + namespace ----------
async function loadGroups() {
  try {
    const { groups, default: def } = await getJSON('/api/memory/graph/groups');
    const sel = $('mem-group');
    sel.innerHTML = groups.map((g) => `<option value="${esc(g)}">${esc(g)}</option>`).join('');
    currentGroup = def || groups[0] || null;
    if (currentGroup) sel.value = currentGroup;
  } catch { /* handled by loadOverview surfacing the error */ }
}

async function loadOverview() {
  const box = $('mem-overview');
  try {
    const ov = await getJSON(`/api/memory/graph/overview${qs()}`);
    renderDrift(ov.untyped);
    // Cold start: memory reachable but empty (e.g. first-ever investigation).
    if (!ov.entities) {
      box.innerHTML = `<div class="mem-coldstart">
        <div class="mem-coldstart-title">No memory yet in <b>${esc(currentGroup || 'this namespace')}</b></div>
        <p class="panel-sub">Memory is written when an investigation <em>closes</em>. Run one and its
        devices, identities, detections, and conclusions will land here as the first episode —
        future investigations start already knowing them.</p></div>`;
      return;
    }
    const chips = ov.byType.map((t) =>
      `<button type="button" class="mem-type-chip" data-type="${esc(t.type)}"><i style="background:${colorFor(t.type)}"></i>${esc(t.type)} <b>${t.count}</b></button>`).join('');
    const chip = (e) => `<button type="button" class="mem-ov-item" data-uuid="${esc(e.uuid)}"><i style="background:${colorFor(e.type)}"></i><span>${esc(e.name || e.uuid)}</span>${e.mentions ? `<b>${e.mentions}</b>` : ''}</button>`;
    const section = (title, items) => items && items.length
      ? `<div class="mem-ov-sec"><h5>${title}</h5>${items.map(chip).join('')}</div>` : '';
    const fresh = ov.freshness ? relDays(ov.freshness) : null;
    box.innerHTML = `<div class="mem-overview-counts"><b>${ov.entities}</b> entities · <b>${ov.episodes}</b> investigations${fresh ? ` · <span class="panel-sub">freshest ${esc(fresh)}</span>` : ''}</div>
      <div class="panel-sub">Click a type to drill in, or search above.</div>
      <div class="mem-type-legend">${chips}</div>
      <div class="mem-ov-dash">
        ${section('Recently learned', ov.recentEntities)}
        ${section('Most investigated', ov.topInvestigated)}
      </div>`;
    box.querySelectorAll('.mem-type-chip').forEach((c) => c.addEventListener('click', () => browseType(c.dataset.type)));
    box.querySelectorAll('.mem-ov-item').forEach((c) => c.addEventListener('click', () => focusEntity(c.dataset.uuid)));
  } catch (e) {
    box.innerHTML = `<div class="panel-sub">${e.message === 'Memory is disabled. Enable it in Settings → Memory.'
      ? 'Memory is disabled. Enable it in Settings → Memory.'
      : `Couldn't reach memory: ${esc(e.message)}`}</div>`;
  }
}

function renderDrift(untyped) {
  const el = $('mem-drift');
  if (untyped > 0) {
    el.classList.remove('hidden');
    el.textContent = `⚠ ${untyped} untyped`;
    el.onclick = () => showQuality();
  } else {
    el.classList.add('hidden');
  }
}

// Review untyped nodes: assign each a type or delete it (a guarded write).
async function showQuality() {
  let q;
  try { q = await getJSON(`/api/memory/graph/quality${qs()}`); }
  catch (e) { inspector(`<div class="panel-sub">${esc(e.message)}</div>`); return; }
  if (!q.count) {
    inspector(`<div class="mem-insp-head"><span class="mem-badge" style="background:var(--ok)">clean</span><h3>No untyped nodes</h3></div><p class="panel-sub">Every entity is classified.</p>`);
    return;
  }
  const opt = ONTOLOGY.map((t) => `<option value="${t}">${t}</option>`).join('');
  const rows = q.untyped.map((n) => `
    <div class="mem-curate-row" data-uuid="${esc(n.uuid)}">
      <div class="mem-curate-name"><code>${esc(n.name || n.uuid)}</code>${n.summary ? `<span class="panel-sub">${esc(n.summary.split('\n')[0])}</span>` : ''}</div>
      <div class="mem-curate-actions">
        <select class="mem-curate-type">${opt}</select>
        <button type="button" class="mem-curate-assign">Assign</button>
        <button type="button" class="mem-curate-del" title="Delete this node">✕</button>
      </div>
    </div>`).join('');
  inspector(`<div class="mem-insp-head"><span class="mem-badge" style="background:${colorFor('Entity')}">drift</span><h3>${q.count} untyped node(s)</h3></div>
    <p class="panel-sub">Extraction didn’t classify these. Assign the right type, or delete noise. This writes to memory.</p>
    <div class="mem-curate-list">${rows}</div>`);
  $('mem-inspector').querySelectorAll('.mem-curate-row').forEach((row) => {
    const uuid = row.dataset.uuid;
    row.querySelector('.mem-curate-assign').addEventListener('click', () => curate(uuid, 'assign', row.querySelector('.mem-curate-type').value, row));
    row.querySelector('.mem-curate-del').addEventListener('click', () => curate(uuid, 'delete', null, row));
  });
}

async function curate(uuid, action, type, row) {
  row.style.opacity = '0.5';
  try {
    await getJSON(`/api/memory/graph/curate${qs()}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ uuid, action, type }),
    });
    row.remove();
    loadOverview(); // refresh counts + drift badge
    if (!$('mem-inspector').querySelector('.mem-curate-row')) showQuality(); // all cleared → refresh view
  } catch (e) {
    row.style.opacity = '';
    const err = document.createElement('div');
    err.className = 'mem-curate-err';
    err.textContent = e.message;
    row.appendChild(err);
  }
}

// ---------- search + browse drill-down ----------
// Render a clickable entity list into the dropdown; clicking one opens its
// ego-network. Shared by search-as-you-type, search-focus (list all), and
// clicking a type chip to drill into that type.
function showResults(hits, { header } = {}) {
  const results = $('mem-results');
  const input = $('mem-search');
  if (!hits.length) {
    results.innerHTML = '<div class="mem-result-empty">No entities</div>';
  } else {
    results.innerHTML = (header ? `<div class="mem-result-head">${esc(header)}</div>` : '')
      + hits.map((h) => `<button class="mem-result" data-uuid="${esc(h.uuid)}"><i style="background:${colorFor(h.type)}"></i><span>${esc(h.name)}</span><em>${esc(h.type)}</em></button>`).join('');
    results.querySelectorAll('.mem-result').forEach((b) =>
      b.addEventListener('click', () => { results.classList.add('hidden'); input.value = ''; focusEntity(b.dataset.uuid); }));
  }
  results.classList.remove('hidden');
}

// Drill into a type from the overview legend.
async function browseType(type) {
  try {
    const { results: hits } = await getJSON(`/api/memory/graph/entities${qs({ type })}`);
    showResults(hits, { header: `${type} — ${hits.length}` });
  } catch (e) { showResults([], {}); }
}

function wireSearch() {
  const input = $('mem-search');
  const results = $('mem-results');
  const runSearch = () => {
    clearTimeout(searchDebounce);
    const q = input.value.trim();
    searchDebounce = setTimeout(async () => {
      try {
        // Empty query on focus → list entities so the analyst can scroll + pick.
        const url = q ? `/api/memory/graph/search${qs({ q })}` : `/api/memory/graph/entities${qs({ limit: 100 })}`;
        const { results: hits } = await getJSON(url);
        showResults(hits, q ? {} : { header: 'All entities — pick one' });
      } catch { /* transient */ }
    }, q ? 200 : 0);
  };
  input.addEventListener('input', runSearch);
  input.addEventListener('focus', () => { if (!input.value.trim()) runSearch(); });
  document.addEventListener('click', (e) => {
    if (!results.contains(e.target) && e.target !== input) results.classList.add('hidden');
  });
}

// ---------- ego-network render (SVG, semantic lanes) ----------
let lastGraph = null;
let selectedUuid = null;   // node currently spotlighted (dims non-adjacent)
// Track what was on screen last render so only genuinely-new nodes/edges animate
// in (doc §4.2/§4.6) — a resize or no-op re-render must NOT replay the bloom.
let prevNodeUuids = new Set();
let prevEdgeKeys = new Set();
const edgeKey = (e) => `${e.source}»${e.target}`;
const GRAPH_CAP = 40;      // bounded-SVG budget; above this we keep the top-N + "+N more"
let capOverride = null;    // set by "+N more" to reveal the rest for the current graph

async function focusEntity(uuid) {
  const svg = $('mem-svg');
  try {
    const data = await getJSON(`/api/memory/graph/neighbors${qs({ uuid })}`);
    lastGraph = data;
    capOverride = null; // new ego-network → start capped again
    $('mem-empty').classList.add('hidden');
    $('mem-timeline').classList.add('hidden');
    svg.classList.remove('hidden');
    renderGraph(data);
    renderFocusInspector(data);
  } catch (e) {
    inspector(`<div class="panel-sub">${esc(e.message)}</div>`);
  }
}

function renderGraph(data) {
  const svg = $('mem-svg');
  const rect = $('mem-canvas').getBoundingClientRect();
  const W = Math.max(rect.width, 480);
  const H = Math.max(rect.height, 360);
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.innerHTML = '';

  // Peripheral items: neighbor entities first, then episodes (grouped visually).
  let peers = data.nodes.map((n) => ({ kind: 'entity', ...n }))
    .concat(data.episodes.map((ep) => ({ kind: 'episode', uuid: ep.uuid, name: ep.name, type: 'Episode', created_at: ep.created_at, source: ep.source })));
  // Density cap (bounded-SVG budget): above GRAPH_CAP we keep the most-connected
  // entities (known-first, entities over episodes) and surface a "+N more" chip —
  // never a silent truncation. "+N more" sets capOverride to reveal the rest.
  const totalPeers = peers.length;
  const cap = capOverride || GRAPH_CAP;
  let hiddenPeers = 0;
  if (peers.length > cap) {
    const degree = new Map();
    for (const e of data.edges) { degree.set(e.source, (degree.get(e.source) || 0) + 1); degree.set(e.target, (degree.get(e.target) || 0) + 1); }
    const rank = (p) => (p.kind === 'episode' ? 0 : 100) + (p.known === true ? 20 : 0) + (degree.get(p.uuid) || 0);
    peers = peers.slice().sort((a, b) => rank(b) - rank(a)).slice(0, cap);
    hiddenPeers = totalPeers - peers.length;
  }
  const cx = W / 2;
  const cy = H / 2;

  // defs: arrowhead
  const defs = document.createElementNS(NS, 'defs');
  defs.innerHTML = `<marker id="mem-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="var(--gray)"/></marker>`;
  svg.appendChild(defs);

  // Semantic lanes (doc §3.2): sort peers into left/right/top/bottom by macro-
  // category so the layout reads as a security story (originator → focus → threat)
  // instead of an equal-weight radial scatter.
  const pos = new Map();
  pos.set(data.focus.uuid, { x: cx, y: cy });
  const lanes = { left: [], right: [], top: [], bottom: [] };
  for (const p of peers) {
    const lane = p.kind === 'episode' ? 'bottom' : (LANE[p.type] || 'right');
    lanes[lane].push(p);
  }
  const padX = 96;
  const padY = 64;
  // Inset the vertical lanes clear of the top/bottom rows (and rows clear of the
  // columns) so the corners aren't shared — otherwise a left-lane's top node and a
  // top-row's left node collide at (padX, padY).
  const colTop = padY + 76;
  const colBot = H - padY - 76;
  const rowL = padX + 104;
  const rowR = W - padX - 104;
  const placeCol = (arr, x) => {            // vertical lane — vary y at fixed x
    const n = arr.length;
    arr.forEach((p, i) => {
      const t = n <= 1 ? 0.5 : i / (n - 1);
      const dx = n > 8 ? (i % 2 ? 26 : -26) : 0;   // stagger crowded lanes so labels clear
      pos.set(p.uuid, { x: x + dx, y: colTop + (colBot - colTop) * t });
    });
  };
  const placeRow = (arr, y) => {            // horizontal lane — vary x at fixed y
    const n = arr.length;
    arr.forEach((p, i) => {
      const t = n <= 1 ? 0.5 : i / (n - 1);
      const dy = n > 8 ? (i % 2 ? 20 : -20) : 0;
      pos.set(p.uuid, { x: rowL + (rowR - rowL) * t, y: y + dy });
    });
  };
  placeCol(lanes.left, padX);
  placeCol(lanes.right, W - padX);
  placeRow(lanes.top, padY);
  placeRow(lanes.bottom, H - padY);

  // edges: entity facts (solid, directed) + episode mentions (dashed). Each edge
  // carries data-source/target so the spotlight can dim non-adjacent ones, and a
  // wide transparent hit line so the thin visible stroke is still clickable.
  const edgesLayer = document.createElementNS(NS, 'g');
  const liveRun = mode === 'investigation' && !!state.running;
  for (const e of data.edges) {
    const a = pos.get(e.source);
    const b = pos.get(e.target);
    if (!a || !b) continue;
    const isNewEdge = !prevEdgeKeys.has(edgeKey(e));
    const line = document.createElementNS(NS, 'line');
    line.setAttribute('x1', a.x); line.setAttribute('y1', a.y);
    line.setAttribute('x2', b.x); line.setAttribute('y2', b.y);
    // New relationships draw on once (§4.6); if the run is live they briefly march
    // (§4.1) then settle — motion only communicates a state change, never idles.
    const live = isNewEdge && liveRun && !e.expired;
    line.setAttribute('class', `mem-edge${e.expired ? ' expired' : ''}${isNewEdge && !e.expired ? ' entering' : ''}${live ? ' live' : ''}`);
    if (isNewEdge && !e.expired) line.style.setProperty('--edge-length', Math.round(Math.hypot(b.x - a.x, b.y - a.y)));
    line.setAttribute('marker-end', 'url(#mem-arrow)');
    line.dataset.source = e.source; line.dataset.target = e.target;
    line.appendChild(titleEl(`${e.rel}${e.expired ? ' (expired)' : ''}: ${e.fact || ''}`));
    edgesLayer.appendChild(line);
    if (live) setTimeout(() => line.classList.remove('live'), 2600); // stop after the transition

    if (e.rel || e.fact) {
      const hit = document.createElementNS(NS, 'line');
      hit.setAttribute('x1', a.x); hit.setAttribute('y1', a.y);
      hit.setAttribute('x2', b.x); hit.setAttribute('y2', b.y);
      hit.setAttribute('class', 'mem-edge-hit');
      hit.dataset.source = e.source; hit.dataset.target = e.target;
      hit.addEventListener('click', (ev) => { ev.stopPropagation(); spotlight(e.source); renderEdgeInspector(e, data); });
      edgesLayer.appendChild(hit);
    }
    // rel label at midpoint
    const t = document.createElementNS(NS, 'text');
    t.setAttribute('x', (a.x + b.x) / 2); t.setAttribute('y', (a.y + b.y) / 2 - 3);
    t.setAttribute('class', 'mem-edge-label');
    t.textContent = e.rel || '';
    edgesLayer.appendChild(t);
  }
  for (const ep of data.episodes) {
    const b = pos.get(ep.uuid);
    if (!b) continue;
    const line = document.createElementNS(NS, 'line');
    line.setAttribute('x1', cx); line.setAttribute('y1', cy);
    line.setAttribute('x2', b.x); line.setAttribute('y2', b.y);
    line.setAttribute('class', 'mem-edge mentions');
    line.dataset.source = data.focus.uuid; line.dataset.target = ep.uuid;
    edgesLayer.appendChild(line);
  }
  svg.appendChild(edgesLayer);

  // nodes — only nodes not present last render animate in (no bloom on resize)
  const nodesLayer = document.createElementNS(NS, 'g');
  nodesLayer.appendChild(nodeEl(data.focus, pos.get(data.focus.uuid), true, !prevNodeUuids.has(data.focus.uuid)));
  for (const p of peers) nodesLayer.appendChild(nodeEl(p, pos.get(p.uuid), false, !prevNodeUuids.has(p.uuid)));
  svg.appendChild(nodesLayer);
  // remember this render's nodes/edges so the next one only animates the delta
  prevNodeUuids = new Set([data.focus.uuid, ...peers.map((p) => p.uuid)]);
  prevEdgeKeys = new Set(data.edges.map(edgeKey));
  // fresh render starts un-spotlighted; clicking empty canvas clears any spotlight
  svg.classList.remove('has-selection');
  selectedUuid = null;
  svg.onclick = () => clearSpotlight();
  showLegend(true);
  showMore(hiddenPeers, totalPeers);
}

// "+N more" affordance when the density cap hides peers — never silent (doc note).
// Clicking reveals the rest for this graph by lifting the cap and re-rendering.
function showMore(hidden, total) {
  const canvas = $('mem-canvas');
  if (!canvas) return;
  let el = $('mem-more');
  if (!hidden) { if (el) el.classList.add('hidden'); return; }
  if (!el) {
    el = document.createElement('button');
    el.id = 'mem-more';
    el.type = 'button';
    el.className = 'mem-more';
    canvas.appendChild(el);
    el.addEventListener('click', () => { capOverride = total; if (lastGraph) renderGraph(lastGraph); });
  }
  el.textContent = `+${hidden} more — showing top ${total - hidden} of ${total}`;
  el.classList.remove('hidden');
}

// Spotlight the selected node's one-hop neighborhood (doc §3.4): dim every node
// and edge not adjacent to it so the local structure reads clearly. Recentering
// stays a separate explicit action, preserving spatial orientation.
function spotlight(uuid) {
  const svg = $('mem-svg');
  if (!svg) return;
  selectedUuid = uuid;
  const adj = new Set([uuid]);
  for (const e of (lastGraph?.edges || [])) {
    if (e.source === uuid) adj.add(e.target);
    if (e.target === uuid) adj.add(e.source);
  }
  for (const ep of (lastGraph?.episodes || [])) {
    if (uuid === lastGraph.focus.uuid) adj.add(ep.uuid);   // focus connects to all episodes
  }
  svg.classList.add('has-selection');
  svg.querySelectorAll('.mem-node').forEach((g) => g.classList.toggle('mem-dim', !adj.has(g.dataset.uuid)));
  svg.querySelectorAll('.mem-edge, .mem-edge-hit').forEach((l) => {
    const on = l.dataset.source === uuid || l.dataset.target === uuid;
    l.classList.toggle('mem-dim', !on);
  });
}

function clearSpotlight() {
  const svg = $('mem-svg');
  if (!svg) return;
  selectedUuid = null;
  svg.classList.remove('has-selection');
  svg.querySelectorAll('.mem-dim').forEach((el) => el.classList.remove('mem-dim'));
}

// Pinned relationship callout for a clicked edge (doc §3.4): the full fact,
// direction, and endpoints — no hover-only tooltip.
function renderEdgeInspector(e, data) {
  const src = data.nodes.find((n) => n.uuid === e.source) || data.focus;
  const tgt = data.nodes.find((n) => n.uuid === e.target) || data.focus;
  inspector(`
    <div class="mem-insp-head"><h3>Relationship</h3></div>
    <div class="mem-edge-callout">
      <div class="mem-edge-ends">${badge(src.type)} <b>${esc(src.name)}</b>
        <span class="mem-edge-arrow">${e.rel ? esc(e.rel) : 'relates to'} →</span>
        ${badge(tgt.type)} <b>${esc(tgt.name)}</b></div>
      ${e.fact ? `<p class="mem-edge-fact">${esc(e.fact)}</p>` : '<p class="panel-sub">No stored fact for this relationship.</p>'}
      ${e.expired ? '<p class="panel-sub">⚠ This relationship is expired (superseded by a later fact).</p>' : ''}
    </div>`);
}

// Persistent in-canvas legend for the known/new/changed encoding (doc §3.1).
// Lives in .mem-canvas (not the SVG) so it survives svg.innerHTML reflows.
function showLegend(on) {
  const canvas = $('mem-canvas');
  if (!canvas) return;
  let el = $('mem-legend');
  if (!on) { if (el) el.classList.add('hidden'); $('mem-more')?.classList.add('hidden'); return; }
  if (!el) {
    el = document.createElement('div');
    el.id = 'mem-legend';
    el.className = 'mem-legend';
    el.innerHTML = '<span class="mem-lg"><i class="mem-lg-known"></i>Known previously</span>'
      + '<span class="mem-lg"><i class="mem-lg-new"></i>New this run</span>'
      + '<span class="mem-lg"><i class="mem-lg-changed"></i>Changed this run</span>';
    canvas.appendChild(el);
  }
  el.classList.remove('hidden');
}

function titleEl(text) {
  const t = document.createElementNS(NS, 'title');
  t.textContent = text;
  return t;
}

function nodeEl(node, p, isFocus, entering) {
  const g = document.createElementNS(NS, 'g');
  // Headline signal (doc §3.1): prior memory reads as a quiet backdrop (known),
  // this run's discoveries arrive bright (isnew), and a known entity this run
  // re-classified stands out with an attention ring (changed). Not colour-only —
  // opacity/halo/ring back it up, mirrored in the in-canvas legend.
  const memState = node.known === true ? (node.changed ? 'changed' : 'known')
    : node.known === false ? 'isnew' : '';
  // A live investigation's hub pulses while the run is still resolving (doc §4.4);
  // the static focus halo stands on its own once it settles.
  const active = isFocus && node.uuid === INV_HUB && !!state.running;
  g.setAttribute('class', `mem-node${isFocus ? ' focus' : ''}${node.kind === 'episode' ? ' episode' : ''}${memState ? ' ' + memState : ''}${entering ? ' entering' : ''}${active ? ' active' : ''}`);
  g.dataset.uuid = node.uuid;
  // Position transform lives on the outer <g>; the visual transforms (entry scale)
  // live on the inner group so layout and animation never fight (doc §4.2).
  g.setAttribute('transform', `translate(${p.x},${p.y})`);
  const visual = document.createElementNS(NS, 'g');
  visual.setAttribute('class', 'mem-node-visual');
  const r = isFocus ? 26 : node.kind === 'episode' ? 12 : 18;
  const shape = node.kind === 'episode' ? document.createElementNS(NS, 'rect') : document.createElementNS(NS, 'circle');
  if (node.kind === 'episode') {
    shape.setAttribute('x', -r); shape.setAttribute('y', -r); shape.setAttribute('width', r * 2); shape.setAttribute('height', r * 2);
    shape.setAttribute('rx', 3); shape.setAttribute('transform', 'rotate(45)');
  } else {
    shape.setAttribute('r', r);
  }
  shape.setAttribute('fill', colorFor(node.type));
  // known / new / changed styling is driven by the state class on the parent <g>
  // (see memState above) so shape, label, and halo move together.
  shape.setAttribute('class', 'mem-node-shape');
  visual.appendChild(shape);
  visual.appendChild(titleEl(`${node.name || node.uuid} · ${node.type}${node.known === false ? ' · new this run' : node.known === true ? ' · known to memory' : ''}`));

  // Type badge inside the shape — colour-independent type cue (episodes are already
  // a distinct diamond, so they don't need one).
  const code = node.kind === 'episode' ? '' : badgeFor(node.type);
  if (code) {
    const badge = document.createElementNS(NS, 'text');
    badge.setAttribute('class', 'mem-node-badge');
    badge.setAttribute('y', 0);
    badge.style.fontSize = `${Math.max(8, Math.round(r * 0.52))}px`;
    badge.textContent = code;
    visual.appendChild(badge);
  }

  const label = document.createElementNS(NS, 'text');
  label.setAttribute('class', 'mem-node-label');
  label.setAttribute('y', r + 14);
  label.textContent = truncate(node.name || node.type, isFocus ? 40 : 22);
  visual.appendChild(label);
  g.appendChild(visual);

  // Single click inspects + spotlights (doc §3.4). Recentering on a peer is a
  // separate explicit action (double-click, or the button in the peer inspector)
  // so the layout doesn't shift out from under the analyst on every click.
  g.addEventListener('click', (ev) => {
    ev.stopPropagation();
    spotlight(node.uuid);
    if (node.kind === 'episode') { renderEpisodeInspector(node); return; }
    if (node.uuid === INV_HUB) { renderInvestigationInspector(); return; }
    if (node.known === false) { renderNewInspector(node); return; } // new this run → no ego-network to open
    if (isFocus && mode !== 'investigation') { renderFocusInspector(lastGraph); return; }
    renderPeerInspector(node); // known peer: fact + summary + explicit recenter
  });
  const recenterable = !isFocus && node.kind !== 'episode' && node.uuid !== INV_HUB && node.known !== false;
  if (recenterable) g.addEventListener('dblclick', (ev) => { ev.stopPropagation(); focusEntity(node.uuid); });
  return g;
}

// Lightweight inspector for a clicked neighbour: its type, the relationship fact
// linking it to the focus, its summary, and an explicit recenter action.
function renderPeerInspector(node) {
  const edges = lastGraph?.edges || [];
  const focusUuid = lastGraph?.focus?.uuid;
  const edge = edges.find((e) => (e.source === node.uuid && e.target === focusUuid)
    || (e.target === node.uuid && e.source === focusUuid));
  const summary = (node.summary || '').split('\n').filter(Boolean);
  inspector(`
    <div class="mem-insp-head">${badge(node.type)}<h3>${esc(node.name)}</h3></div>
    ${edge && (edge.rel || edge.fact) ? `<p class="mem-edge-fact"><span class="mem-rel">${esc(edge.rel || 'related')}</span> ${esc(edge.fact || '')}</p>` : ''}
    ${summary.length ? `<ul class="mem-summary">${summary.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>` : ''}
    <button type="button" class="mem-recenter btn-primary slim">Recenter on this entity →</button>
  `);
  const btn = $('mem-inspector').querySelector('.mem-recenter');
  if (btn) btn.addEventListener('click', () => focusEntity(node.uuid));
}

const truncate = (s, n) => (String(s).length > n ? `${String(s).slice(0, n - 1)}…` : String(s));

// Compact relative age for the freshness readout (browser Date is fine here).
const relDays = (iso) => {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const days = Math.floor((Date.now() - t) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  return new Date(t).toISOString().slice(0, 10);
};

// ---------- inspector ----------
function inspector(html) { $('mem-inspector').innerHTML = html; }

function badge(type) { return `<span class="mem-badge" style="background:${colorFor(type)}">${esc(type)}</span>`; }

function renderFocusInspector(data) {
  if (!data) return;
  const f = data.focus;
  const summary = (f.summary || '').split('\n').filter(Boolean);
  const facts = data.edges.map((e) => {
    const other = data.nodes.find((n) => n.uuid === (e.dir === 'out' ? e.target : e.source));
    return `<li><span class="mem-rel${e.expired ? ' expired' : ''}">${esc(e.rel)}</span> ${esc(e.fact || (other ? other.name : ''))}</li>`;
  }).join('');
  const eps = data.episodes.map((ep) =>
    `<li><code>${esc((ep.created_at || '').slice(0, 10))}</code> ${esc(ep.name || ep.uuid)}</li>`).join('');
  const ins = data.insights || {};
  const when = (ins.last_observed || '').slice(0, 10);
  const why = ins.highest_risk_rel;
  // Lead with the decision (doc §3.5): the single highest-risk relationship, then
  // at-a-glance provenance — not a raw fact dump followed by admin controls.
  const whyBlock = `
    <div class="mem-why">
      <div class="mem-why-head">Why this matters</div>
      ${why
    ? `<p class="mem-why-lead"><span class="mem-rel">${esc(why.rel || 'related')}</span> ${esc(why.fact || (why.neighbor ? `${why.neighbor}${why.neighbor_type ? ` (${why.neighbor_type})` : ''}` : ''))}</p>`
    : '<p class="panel-sub">No high-risk relationship on record — routine background context.</p>'}
      <div class="mem-why-meta">
        ${when ? `<span title="Most recent investigation to mention it">last seen <b>${esc(when)}</b></span>` : ''}
        <span title="Prior investigations that mention it"><b>${ins.prior_investigations || 0}</b> prior</span>
        <span title="Independent live facts attesting to it"><b>${ins.corroboration || 0}</b> facts</span>
        ${ins.changed_since_prior ? '<span class="mem-why-changed" title="A prior fact was superseded this or a later run">⟳ changed since prior</span>' : ''}
      </div>
    </div>`;
  inspector(`
    ${mode === 'investigation' ? '<button type="button" class="mem-crumb">← Back to investigation</button>' : ''}
    <div class="mem-insp-head">${badge(f.type)}<h3>${esc(f.name)}</h3></div>
    ${whyBlock}
    ${summary.length ? `<h4>Summary</h4><ul class="mem-summary">${summary.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>` : ''}
    <h4>Relationships <span class="panel-sub">(${data.edges.length})</span></h4>
    <ul class="mem-fact-list">${facts || '<li class="panel-sub">No facts.</li>'}</ul>
    <h4>History <span class="panel-sub">(${data.episodes.length})</span></h4>
    <ul class="mem-ep-list">${eps || '<li class="panel-sub">None recorded.</li>'}</ul>
    <button class="mem-investigate btn-primary slim" data-name="${esc(f.name)}">Ask the agent about this →</button>
    <details class="mem-fix"><summary>Fix classification</summary>
      <p class="panel-sub">Wrong type or noise? Re-type it or remove it (writes to memory).</p>
      <div class="mem-curate-actions">
        <select class="mf-type">${ONTOLOGY.map((t) => `<option value="${t}"${t === f.type ? ' selected' : ''}>${t}</option>`).join('')}</select>
        <button type="button" class="mf-retype">Change type</button>
        <button type="button" class="mf-del" title="Delete this node">✕</button>
      </div>
      <div class="mf-merge">
        <div class="panel-sub">Duplicate of another entity? Merge this into the one to keep:</div>
        <input class="mf-merge-q" type="text" placeholder="Search the entity to keep…" autocomplete="off">
        <div class="mf-merge-results"></div>
      </div>
      <div class="mem-curate-err mf-err"></div>
    </details>
  `);
  const box = $('mem-inspector');
  box.querySelector('.mem-crumb')?.addEventListener('click', () => renderCurrent());
  const btn = box.querySelector('.mem-investigate');
  if (btn) btn.addEventListener('click', () => seedInvestigation(btn.dataset.name));
  const err = box.querySelector('.mf-err');
  const fix = async (body, confirmMsg) => {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    err.textContent = '';
    try {
      await getJSON(`/api/memory/graph/curate${qs()}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      loadOverview();
      if (body.action === 'delete-any') { // node gone — drop back to the overview
        $('mem-svg').classList.add('hidden');
        $('mem-empty').classList.remove('hidden');
        inspector('<div class="mem-inspector-empty panel-sub">Node removed.</div>');
      } else {
        focusEntity(f.uuid); // reload with the new type
      }
    } catch (e) { err.textContent = e.message; }
  };
  box.querySelector('.mf-retype')?.addEventListener('click', () => fix({ uuid: f.uuid, action: 'retype', type: box.querySelector('.mf-type').value }));
  box.querySelector('.mf-del')?.addEventListener('click', () => fix({ uuid: f.uuid, action: 'delete-any' }, `Delete "${f.name}" from memory? This cannot be undone.`));
  // Merge: search for the entity to keep, then fold this one into it.
  const mq = box.querySelector('.mf-merge-q');
  const mr = box.querySelector('.mf-merge-results');
  let mdeb;
  mq?.addEventListener('input', () => {
    clearTimeout(mdeb);
    const q = mq.value.trim();
    if (!q) { mr.innerHTML = ''; return; }
    mdeb = setTimeout(async () => {
      try {
        const { results } = await getJSON(`/api/memory/graph/search${qs({ q })}`);
        const cands = results.filter((r) => r.uuid !== f.uuid);
        mr.innerHTML = cands.length
          ? cands.map((r) => `<button type="button" class="mf-merge-cand" data-uuid="${esc(r.uuid)}" data-name="${esc(r.name)}"><i style="background:${colorFor(r.type)}"></i><span>${esc(r.name)}</span><em>${esc(r.type)}</em></button>`).join('')
          : '<div class="panel-sub">No matches</div>';
        mr.querySelectorAll('.mf-merge-cand').forEach((b) => b.addEventListener('click', async () => {
          if (!window.confirm(`Merge "${f.name}" into "${b.dataset.name}"? "${f.name}" will be removed and its facts + episodes moved to "${b.dataset.name}".`)) return;
          err.textContent = '';
          try {
            await getJSON(`/api/memory/graph/curate${qs()}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'merge', uuid: f.uuid, into: b.dataset.uuid }) });
            loadOverview();
            focusEntity(b.dataset.uuid); // show the surviving canonical node
          } catch (e) { err.textContent = e.message; }
        }));
      } catch { /* transient */ }
    }, 200);
  });
}

function renderEpisodeInspector(ep) {
  inspector(`
    <div class="mem-insp-head">${badge('Episode')}<h3>Investigation</h3></div>
    <p><strong>${esc(ep.name || ep.uuid)}</strong></p>
    <p class="panel-sub">${esc((ep.created_at || '').replace('T', ' ').slice(0, 16))}</p>
    ${ep.source ? `<p>${esc(ep.source)}</p>` : ''}
  `);
}

// Prefill the composer with a question about the entity and close the overlay —
// deliberately does NOT auto-send (analyst stays in control).
function seedInvestigation(name) {
  const input = document.getElementById('input');
  if (input) {
    input.value = `What do we know about ${name}, and is there anything worth investigating?`;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  close();
  input?.focus();
}

// Fed by the session event stream (sse.js). Accumulates the entities a live (or
// replayed) investigation touches; resolution against memory is lazy (only when
// the panel is open in investigation mode), so a closed panel costs nothing.
export function onSessionEvent(ev) {
  if (!ev) return;
  if (ev.type === 'snapshot') { resetInvestigation(); return; }
  if (ev.type === 'tool_execution_start') {
    for (const t of extractTokens(ev.args)) invTokens.add(t);
    for (const d of extractDetections(ev.toolName, ev.args)) invTokens.add(d);
    liveInvUpdate();
  } else if (ev.type === 'tool_execution_end') {
    for (const t of extractTokens(ev.result?.content)) invTokens.add(t);
    liveInvUpdate();
  } else if (ev.type === 'agent_end') {
    // Run finished — upgrade the timeline to the agent's forensic one.
    loadForensicTimeline().then(() => {
      if (isMemoryOpen() && mode === 'investigation' && view === 'timeline') renderTimeline();
    });
  }
}

function resetInvestigation() {
  invTokens.clear();
  invResolved.clear();
  forensicTimeline = null;
  forensicAttempted = false;
  if (isMemoryOpen() && mode === 'investigation') renderCurrent();
}

// New tokens arrived — re-render if the user is watching investigation mode.
function liveInvUpdate() {
  if (!isMemoryOpen() || mode !== 'investigation') return;
  clearTimeout(invRenderTimer);
  invRenderTimer = setTimeout(renderCurrent, 250);
}

// On completion, read evidence/verdict.json for the current session; if it carries
// a structured `timeline`, the Timeline view swaps discovery-order for the
// agent's forensic event sequence. Best-effort: absent/old verdicts just leave
// the live discovery-order timeline in place.
// Fetch verdict.json for the current session and, if it carries a structured
// timeline, store it. Does NOT render (callers decide) to avoid recursion.
async function loadForensicTimeline() {
  forensicAttempted = true;
  const id = state.session?.id;
  if (!id) return;
  try {
    const res = await fetch(`/api/sessions/${id}/files/evidence/verdict.json`);
    if (!res.ok) return;
    const verdict = await res.json();
    const tl = Array.isArray(verdict.timeline) ? verdict.timeline : null;
    if (tl && tl.length) forensicTimeline = tl;
  } catch { /* no verdict / not JSON — keep discovery-order timeline */ }
}

async function resolveToken(tok) {
  invResolved.set(tok, { token: tok, known: null, name: tok, type: guessType(tok) }); // placeholder guards against dup work
  if (tok.startsWith('detection:')) {
    const id = tok.slice('detection:'.length);
    invResolved.set(tok, { token: tok, known: false, name: `Detection ${id}`, type: 'Detection' });
    try {
      const { results } = await getJSON(`/api/memory/graph/search${qs({ q: id })}`);
      const hit = results.find((r) => r.type === 'Detection') || results[0];
      if (hit) invResolved.set(tok, { token: tok, known: true, uuid: hit.uuid, name: hit.name, type: hit.type, summary: hit.summary });
    } catch { /* keep the default Detection node */ }
    return;
  }
  try {
    const { results } = await getJSON(`/api/memory/graph/search${qs({ q: tok })}`);
    const hit = results.find((r) => r.name.toLowerCase().includes(tok.toLowerCase())) || (results.length === 1 ? results[0] : null);
    invResolved.set(tok, hit
      ? { token: tok, known: true, uuid: hit.uuid, name: hit.name, type: hit.type, summary: hit.summary }
      : { token: tok, known: false, name: tok, type: guessType(tok) });
  } catch {
    invResolved.set(tok, { token: tok, known: false, name: tok, type: guessType(tok) });
  }
}

// Resolve tokens against memory (known vs new), dedupe (a device known by both IP
// and hostname collapses to one), and keep discovery order (Set insertion order).
async function resolvedEntities() {
  await Promise.all([...invTokens].filter((t) => !invResolved.has(t)).map(resolveToken));
  const seen = new Set();
  const ents = [];
  for (const tok of invTokens) {
    const r = invResolved.get(tok);
    if (!r) continue;
    const key = r.known ? r.uuid : `t:${tok}`;
    if (seen.has(key)) continue;
    seen.add(key);
    ents.push(r);
  }
  return ents;
}

function showInvEmpty() {
  $('mem-svg').classList.add('hidden');
  $('mem-timeline').classList.add('hidden');
  $('mem-empty').classList.remove('hidden');
  showLegend(false);
  $('mem-overview').innerHTML = '<div class="panel-sub">No entities observed yet. Start or continue an investigation — the devices, identities, and endpoints the agent queries appear here as it works, tagged by whether memory has seen them before.</div>';
  inspector('<div class="mem-inspector-empty panel-sub">Waiting for the investigation to touch its first entity…</div>');
}

// Investigation mode → dispatch to the selected view.
function renderCurrent() {
  if (mode !== 'investigation') return;
  if (view === 'timeline') renderTimeline();
  else renderInvestigation();
}

async function renderInvestigation() {
  const ents = await resolvedEntities();
  if (!ents.length) { showInvEmpty(); return; }
  $('mem-empty').classList.add('hidden');
  $('mem-timeline').classList.add('hidden');
  $('mem-svg').classList.remove('hidden');
  const g = {
    focus: { uuid: INV_HUB, name: invTitle(), type: 'Investigation' },
    nodes: ents.map((e) => ({ uuid: e.known ? e.uuid : `t:${e.token}`, name: e.name, type: e.type, known: e.known, summary: e.summary })),
    edges: ents.map((e) => ({ uuid: `inv-${e.token}`, rel: '', dir: 'out', source: INV_HUB, target: e.known ? e.uuid : `t:${e.token}`, expired: false })),
    episodes: [],
  };
  lastGraph = g;
  renderGraph(g);
  renderInvestigationInspector();
}

async function renderTimeline() {
  const box = $('mem-timeline');
  $('mem-svg').classList.add('hidden');
  showLegend(false);
  // If the run is already finished (viewing a completed investigation), try to
  // load its forensic timeline before rendering — agent_end won't fire on open.
  if (!forensicTimeline && !forensicAttempted && !state.running) await loadForensicTimeline();
  // Once the run closes and emits a structured verdict timeline, show the
  // forensic event sequence instead of the live discovery order.
  if (forensicTimeline) {
    $('mem-empty').classList.add('hidden');
    box.classList.remove('hidden');
    box.innerHTML = '<div class="mem-tl-head"><strong>Forensic timeline</strong><span class="panel-sub"> — reconstructed from evidence at close</span></div>'
      + forensicTimeline.map((e) => `
        <div class="mem-tl-event">
          <div class="mem-tl-time">${esc(e.time || e.when || '')}</div>
          <div class="mem-tl-body">
            <div class="mem-tl-title">${esc(e.event || e.title || '')}</div>
            ${e.detail ? `<div class="mem-tl-detail">${esc(e.detail)}</div>` : ''}
            ${e.evidence ? `<div class="mem-tl-ev panel-sub">${esc(e.evidence)}</div>` : ''}
          </div>
        </div>`).join('');
    renderInvestigationInspector();
    return;
  }
  const ents = await resolvedEntities();
  if (!ents.length) { showInvEmpty(); return; }
  $('mem-empty').classList.add('hidden');
  box.classList.remove('hidden');
  box.innerHTML = '<div class="mem-tl-head"><strong>Discovery order</strong><span class="panel-sub"> — entities as the agent reached them; upgrades to the forensic timeline when the run finishes</span></div>'
    + ents.map((e, i) => `
      <div class="mem-tl-row ${e.known ? 'known' : 'new'}"${e.known ? ` data-uuid="${esc(e.uuid)}"` : ''}>
        <span class="mem-tl-idx">${i + 1}</span>
        <i class="mem-tl-dot" style="background:${colorFor(e.type)}"></i>
        <span class="mem-tl-name">${esc(e.name)}</span>
        <span class="mem-tl-type">${esc(e.type)}</span>
        <span class="mem-tl-tag ${e.known ? 'known' : 'new'}">${e.known ? 'known' : 'new'}</span>
      </div>`).join('');
  box.querySelectorAll('.mem-tl-row.known').forEach((row) => row.addEventListener('click', () => {
    if (surface === 'docked') surface = 'overlay';
    view = 'graph';
    updateToggles();
    focusEntity(row.dataset.uuid); // drill into its memory ego-network
  }));
  renderInvestigationInspector();
}

function invTitle() {
  const t = state.session?.title;
  return t && t !== 'New session' ? t : 'This investigation';
}

function renderInvestigationInspector() {
  const recs = [...invResolved.values()];
  const known = recs.filter((r) => r.known === true).length;
  const nw = recs.filter((r) => r.known === false).length;
  inspector(`
    <div class="mem-insp-head">${badge('Investigation')}<h3>${esc(invTitle())}</h3></div>
    <p class="panel-sub">Entities the agent has touched this run, resolved against long-term memory.</p>
    <ul class="mem-fact-list">
      <li><span class="mem-rel">known</span> <b>${known}</b> already in memory — click a solid node to see what we concluded before.</li>
      <li><span class="mem-rel expired">new</span> <b>${nw}</b> not seen before (dashed) — no prior context.</li>
    </ul>
    <p class="panel-sub">Memory is written at investigation <em>close</em>, so "known" reflects <em>past</em> investigations; this run's conclusions land after it finishes.</p>
    ${state.session ? '<button class="mem-promote btn-primary slim">Promote to eval case →</button>' : ''}`);
  const pb = $('mem-inspector').querySelector('.mem-promote');
  if (pb) pb.addEventListener('click', () => { if (state.session) openPromoteDialog(state.session); });
}

function renderNewInspector(node) {
  inspector(`
    <div class="mem-insp-head">${badge(node.type)}<h3>${esc(node.name)}</h3></div>
    <p class="panel-sub">Observed in this investigation. <strong>No prior memory</strong> — the graph has not seen this before.</p>`);
}

// ---------- surface (dock / full-screen) + mode + view ----------
function updateToggles() {
  const ov = $('memory-overlay');
  ov.classList.toggle('docked', surface === 'docked');
  ov.classList.toggle('investigation', mode === 'investigation');
  document.body.classList.toggle('mem-docked', surface === 'docked' && isMemoryOpen());
  $('mem-mode-inv')?.classList.toggle('active', mode === 'investigation');
  $('mem-mode-browse')?.classList.toggle('active', mode === 'browse');
  $('mem-view-timeline')?.classList.toggle('active', view === 'timeline');
  $('mem-view-graph')?.classList.toggle('active', view === 'graph');
}

function applyState() {
  updateToggles();
  if (mode === 'investigation') {
    $('mem-results').classList.add('hidden');
    renderCurrent();
  } else {
    $('mem-svg').classList.add('hidden');
    $('mem-timeline').classList.add('hidden');
    $('mem-empty').classList.remove('hidden');
    showLegend(false);
    inspector('<div class="mem-inspector-empty panel-sub">Search for an entity, or pick one below.</div>');
    loadOverview();
  }
}

function setMode(next) {
  mode = next;
  if (mode === 'browse') { surface = 'overlay'; view = 'graph'; } // browse graph wants full screen
  applyState();
}

function setView(next) {
  if (mode !== 'investigation') return;
  view = next;
  if (view === 'graph' && surface === 'docked') surface = 'overlay'; // the radial graph needs room
  applyState();
}

function toggleSurface() {
  surface = surface === 'docked' ? 'overlay' : 'docked';
  updateToggles();
  if (mode === 'investigation') renderCurrent();
  else if (lastGraph && !$('mem-svg').classList.contains('hidden')) renderGraph(lastGraph);
}

function open() {
  $('memory-overlay').classList.remove('hidden');
  // Memory is one of the two right-panel tabs, so it always opens docked (in the
  // right column); "expand" is a separate full-screen toggle. Default to the
  // investigation view when the current run has touched entities, else browse.
  const preferInvestigation = invTokens.size > 0;
  mode = preferInvestigation ? 'investigation' : 'browse';
  view = 'timeline';
  surface = 'docked';
  setRpTab('memory');
  loadGroups().then(applyState);
}
function close() {
  $('memory-overlay').classList.add('hidden');
  document.body.classList.remove('mem-docked');
  setRpTab('files');
}

// Reflect + drive the Files/Memory right-panel switch (both header copies).
function setRpTab(which) {
  document.querySelectorAll('.rp-tab').forEach((b) => b.classList.toggle('active', b.dataset.rp === which));
}
export function isMemoryOpen() { return !$('memory-overlay')?.classList.contains('hidden'); }
export function closeMemory() { close(); }

export function initMemory() {
  const btn = $('memory-btn');
  if (!btn) return;
  btn.addEventListener('click', open);
  $('memory-close').addEventListener('click', close);
  // Files/Memory right-panel switch (present in both the files + memory headers).
  document.querySelectorAll('.rp-tab').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.rp === 'memory') open(); else close();
  }));
  $('mem-expand')?.addEventListener('click', toggleSurface);
  $('mem-mode-inv')?.addEventListener('click', () => setMode('investigation'));
  $('mem-mode-browse')?.addEventListener('click', () => setMode('browse'));
  $('mem-view-timeline')?.addEventListener('click', () => setView('timeline'));
  $('mem-view-graph')?.addEventListener('click', () => setView('graph'));
  $('mem-group').addEventListener('change', (e) => {
    currentGroup = e.target.value;
    invResolved.clear(); // re-resolve known/new against the newly selected namespace
    if (mode === 'investigation') { renderCurrent(); return; }
    $('mem-svg').classList.add('hidden');
    $('mem-timeline').classList.add('hidden');
    $('mem-empty').classList.remove('hidden');
    inspector('<div class="mem-inspector-empty panel-sub">Click a node to inspect it.</div>');
    loadOverview();
  });
  wireSearch();
  // Re-flow the graph on resize so the radial layout fills the panel.
  let resizeT = null;
  window.addEventListener('resize', () => {
    if (!isMemoryOpen() || !lastGraph || $('mem-svg').classList.contains('hidden')) return;
    clearTimeout(resizeT);
    resizeT = setTimeout(() => renderGraph(lastGraph), 150);
  });
}
