// The vector layer under the map.
//
// Sigma draws nodes and edges into WebGL/canvas and has no concept of a region, so
// the zone containers that make the map read as an architecture diagram cannot be
// sigma primitives. They are an SVG layer beneath sigma's canvases, re-projected
// from graph space to screen space on every frame sigma renders.
//
// It is pointer-transparent. Hit-testing goes the other way instead: sigma reports a
// stage click in viewport coordinates and `zoneAt` answers which zone owns that
// point, so there is no z-order fight with sigma's own mouse layer.

const NS = 'http://www.w3.org/2000/svg';

// Padding from the outermost member node to the zone edge. The extra at the bottom
// is room for the node labels sigma draws under each node.
const PAD_X = 34;
const PAD_TOP = 34;
const PAD_BOTTOM = 46;
const LABEL_BAND = 30; // top strip of a zone that acts as its collapse affordance
const MIN_W = 96;
const MIN_H = 74;

let rects = []; // last drawn geometry, in viewport px, for hit-testing

const el = (name, attrs = {}) => {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
};

/** The SVG layer for `container`, created on first use. */
export function ensureZoneLayer(container) {
  if (!container) return null;
  let svg = container.querySelector('svg.topo-zone-layer');
  if (svg) return svg;
  svg = el('svg', { class: 'topo-zone-layer', 'aria-hidden': 'true' });
  const defs = el('defs');
  const pattern = el('pattern', {
    id: 'topo-dotgrid', width: 26, height: 26, patternUnits: 'userSpaceOnUse',
  });
  pattern.appendChild(el('circle', { cx: 1, cy: 1, r: 1, class: 'topo-grid-dot' }));
  defs.appendChild(pattern);
  svg.appendChild(defs);
  svg.appendChild(el('rect', { class: 'topo-grid', x: 0, y: 0, width: '100%', height: '100%', fill: 'url(#topo-dotgrid)' }));
  svg.appendChild(el('g', { class: 'topo-zone-group' }));
  container.prepend(svg); // beneath sigma's canvases
  return svg;
}

/**
 * The screen-space box around a zone's members, or null when none are drawn.
 *
 * Node size is the raw attribute rather than display data: it is only used to keep
 * the box clear of the glyphs, and an approximation that never under-pads is worth
 * more here than exactness.
 */
function memberBox(sigma, graph, memberKeys) {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  let found = false;
  for (const key of memberKeys) {
    if (!graph.hasNode(key)) continue;
    const p = sigma.graphToViewport({
      x: graph.getNodeAttribute(key, 'x'),
      y: graph.getNodeAttribute(key, 'y'),
    });
    const r = Number(graph.getNodeAttribute(key, 'size')) || 6;
    found = true;
    minX = Math.min(minX, p.x - r); maxX = Math.max(maxX, p.x + r);
    minY = Math.min(minY, p.y - r); maxY = Math.max(maxY, p.y + r);
  }
  if (!found) return null;
  const x = minX - PAD_X;
  const y = minY - PAD_TOP;
  const w = Math.max(MIN_W, (maxX - minX) + PAD_X * 2);
  const h = Math.max(MIN_H, (maxY - minY) + PAD_TOP + PAD_BOTTOM);
  return { x, y, w, h };
}

/**
 * Paint the zones for the current frame.
 *
 * Called from sigma's afterRender, so it runs on every pan and zoom: cheap DOM
 * attribute writes on a handful of elements, rebuilt each time rather than diffed,
 * because the set changes whenever a zone opens or closes.
 */
export function drawZones(svg, sigma, graph, zones) {
  if (!svg || !sigma || !graph) return;
  const group = svg.querySelector('.topo-zone-group');
  if (!group) return;
  const next = [];
  const frag = document.createDocumentFragment();

  for (const zone of zones) {
    const box = memberBox(sigma, graph, zone.memberKeys);
    if (!box) continue;
    next.push({ ...box, key: zone.key, expanded: Boolean(zone.expanded) });

    const g = el('g', { class: `topo-zone${zone.expanded ? ' expanded' : ''}` });
    if (zone.accent) g.setAttribute('style', `--zone-accent:${zone.accent}`);
    g.appendChild(el('rect', {
      class: 'topo-zone-rect', x: box.x, y: box.y, width: box.w, height: box.h, rx: 18,
    }));

    const title = el('text', { class: 'topo-zone-title', x: box.x + 16, y: box.y + 21 });
    title.textContent = zone.title;
    g.appendChild(title);

    if (zone.sub) {
      const sub = el('text', { class: 'topo-zone-sub', x: box.x + 16, y: box.y + 37 });
      sub.textContent = zone.sub;
      g.appendChild(sub);
    }
    frag.appendChild(g);
  }

  group.replaceChildren(frag);
  rects = next;
}

export function clearZones(svg) {
  rects = [];
  svg?.querySelector('.topo-zone-group')?.replaceChildren();
}

// ---- Attack layer -----------------------------------------------------------
// Zones sit under sigma's canvases; attack paths sit over them, because a step badge
// behind a node is a badge you cannot read. Same projection, same afterRender hook,
// same pointer-transparency — badges are hit-tested from a stage click instead.

let badges = [];      // last drawn badge geometry, viewport px, for hit-testing
let emphasis = '';    // pair id to light, if any
const BADGE_R = 11;      // drawn radius, from the design
const BADGE_HIT_R = 13;  // ≥20px target: these are hover/click anchors for the inspector

/** The SVG layer above sigma's canvases, created on first use. */
export function ensureAttackLayer(container) {
  if (!container) return null;
  let svg = container.querySelector('svg.topo-attack-layer');
  if (svg) return svg;
  svg = el('svg', { class: 'topo-attack-layer', 'aria-hidden': 'true' });
  svg.appendChild(el('defs'));
  svg.appendChild(el('g', { class: 'topo-attack-group' }));
  container.append(svg); // above sigma's canvases
  return svg;
}

/** An arrowhead in `color`, reused across frames. Markers cannot inherit a stroke. */
function arrowFor(svg, color) {
  const id = `topo-arrow-${color.replace(/[^a-z0-9]/gi, '')}`;
  const defs = svg.querySelector('defs');
  if (!defs.querySelector(`#${id}`)) {
    const marker = el('marker', {
      id, viewBox: '0 0 8 8', refX: 7, refY: 4, markerWidth: 7, markerHeight: 7,
      orient: 'auto-start-reverse',
    });
    marker.appendChild(el('path', { d: 'M0 0L8 4L0 8z', fill: color }));
    defs.appendChild(marker);
  }
  return `url(#${id})`;
}

const at = (sigma, graph, key) => (graph.hasNode(key)
  ? sigma.graphToViewport({ x: graph.getNodeAttribute(key, 'x'), y: graph.getNodeAttribute(key, 'y') })
  : null);

/**
 * Draw the incident: its paths, their step numbers, patient zero, and the endpoints
 * outside the estate.
 *
 * Paths bow rather than run straight, so two hosts that talk in both directions do
 * not draw one line over the other, and so a path between adjacent zones is
 * distinguishable from the ordinary traffic edge beneath it.
 */
export function drawAttack(svg, sigma, graph, model) {
  if (!svg || !sigma || !graph) return;
  const group = svg.querySelector('.topo-attack-group');
  if (!group) return;
  const frag = document.createDocumentFragment();
  const next = [];

  for (const path of model?.paths || []) {
    const a = at(sigma, graph, path.from);
    const b = at(sigma, graph, path.to);
    if (!a || !b) continue;
    // Perpendicular bow, scaled to the span so it stays proportionate at any zoom.
    const dx = b.x - a.x; const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const bow = Math.min(60, len * 0.18);
    const mx = (a.x + b.x) / 2 - (dy / len) * bow;
    const my = (a.y + b.y) / 2 + (dx / len) * bow;

    const line = el('path', {
      class: 'topo-attack-path',
      d: `M${a.x} ${a.y} Q${mx} ${my} ${b.x} ${b.y}`,
      stroke: path.color,
      'marker-end': arrowFor(svg, path.color),
    });
    line.dataset.pair = path.id;
    frag.appendChild(line);

    // Badge at the curve's midpoint (t=0.5 on a quadratic).
    const bxm = 0.25 * a.x + 0.5 * mx + 0.25 * b.x;
    const bym = 0.25 * a.y + 0.5 * my + 0.25 * b.y;
    const badge = el('g', { class: 'topo-attack-badge' });
    badge.dataset.pair = path.id;
    badge.appendChild(el('circle', { class: 'topo-attack-badge-hit', cx: bxm, cy: bym, r: BADGE_HIT_R }));
    badge.appendChild(el('circle', { class: 'topo-attack-badge-dot', cx: bxm, cy: bym, r: BADGE_R, fill: path.color }));
    const text = el('text', { class: 'topo-attack-badge-num', x: bxm, y: bym + 4 });
    text.textContent = path.badge;
    badge.appendChild(text);
    const title = el('title');
    title.textContent = path.title;
    badge.appendChild(title);
    frag.appendChild(badge);
    next.push({ x: bxm, y: bym, r: BADGE_HIT_R, pair: path.id });
  }

  // Patient zero: where the incident started, which nothing on the map said before.
  const zero = at(sigma, graph, model?.patientZero);
  if (zero) {
    const halo = el('circle', { class: 'topo-attack-zero', cx: zero.x, cy: zero.y, r: 26 });
    frag.appendChild(halo);
  }

  // Endpoints outside the estate: dashed, because they are not devices we know.
  for (const key of model?.externals || []) {
    const p = at(sigma, graph, key);
    if (!p) continue;
    const g = el('g', { class: 'topo-attack-external' });
    g.appendChild(el('circle', { class: 'topo-attack-external-ring', cx: p.x, cy: p.y, r: 17 }));
    g.appendChild(el('path', {
      class: 'topo-attack-external-x',
      d: `M${p.x - 5} ${p.y - 5}L${p.x + 5} ${p.y + 5}M${p.x + 5} ${p.y - 5}L${p.x - 5} ${p.y + 5}`,
    }));
    frag.appendChild(g);
  }

  group.replaceChildren(frag);
  badges = next;
  // Emphasis is state, not a class someone set: this rebuilds its elements on every
  // frame, so anything applied from outside would vanish on the next render.
  applyEmphasis(svg);
}

export function clearAttack(svg) {
  badges = [];
  emphasis = '';
  svg?.querySelector('.topo-attack-group')?.replaceChildren();
}

function applyEmphasis(svg) {
  for (const node of svg.querySelectorAll('[data-pair]')) {
    node.classList.toggle('muted', Boolean(emphasis) && node.dataset.pair !== emphasis);
    node.classList.toggle('lit', Boolean(emphasis) && node.dataset.pair === emphasis);
  }
}

/** The step badge under a viewport point, or null. */
export function badgeAt(x, y) {
  for (const b of badges) {
    if (Math.hypot(x - b.x, y - b.y) <= b.r) return b.pair;
  }
  return null;
}

/** Emphasise one path and its badge; pass '' to clear. Survives redraws. */
export function emphasisePath(svg, pairId) {
  emphasis = pairId || '';
  if (svg) applyEmphasis(svg);
}

// ---- Mini-map ---------------------------------------------------------------
// Orientation, not navigation: at any zoom it answers "where am I in the estate".
// Zones are drawn in GRAPH space, so the picture is stable while the camera moves
// and only the viewport rectangle travels across it.

let miniBox = null; // graph-space bounds the mini-map is currently showing

/** Graph-space bounds of every drawn node, padded so edge nodes are not flush. */
function graphBounds(graph) {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  graph.forEachNode((_key, attrs) => {
    const x = Number(attrs.x) || 0; const y = Number(attrs.y) || 0;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  });
  if (!Number.isFinite(minX)) return null;
  const padX = Math.max((maxX - minX) * 0.08, 1);
  const padY = Math.max((maxY - minY) * 0.08, 1);
  return { minX: minX - padX, maxX: maxX + padX, minY: minY - padY, maxY: maxY + padY };
}

function zoneGraphBox(graph, memberKeys) {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const key of memberKeys) {
    if (!graph.hasNode(key)) continue;
    const x = Number(graph.getNodeAttribute(key, 'x')) || 0;
    const y = Number(graph.getNodeAttribute(key, 'y')) || 0;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  return Number.isFinite(minX) ? { minX, maxX, minY, maxY } : null;
}

/**
 * Redraw the mini-map for the current frame.
 *
 * The viewport rectangle comes from converting the canvas corners back to graph
 * space, so it stays honest under any pan or zoom without tracking camera state.
 */
export function renderMiniMap(mini, sigma, graph, zones) {
  if (!mini || !sigma || !graph) return;
  const body = mini.querySelector('.topo-mini-body');
  if (!body) return;
  const bounds = graphBounds(graph);
  miniBox = bounds;
  if (!bounds) { body.replaceChildren(); return; }

  const w = body.clientWidth || 134;
  const h = body.clientHeight || 60;
  const spanX = bounds.maxX - bounds.minX || 1;
  const spanY = bounds.maxY - bounds.minY || 1;
  const toMini = (x, y) => ({
    x: ((x - bounds.minX) / spanX) * w,
    y: ((y - bounds.minY) / spanY) * h,
  });

  const frag = document.createDocumentFragment();
  for (const zone of zones) {
    const box = zoneGraphBox(graph, zone.memberKeys);
    if (!box) continue;
    const a = toMini(box.minX, box.minY);
    const b = toMini(box.maxX, box.maxY);
    // A collapsed segment has one member, so its box is a point. Give it a footprint
    // scaled to the devices it stands for — otherwise the whole estate reduces to a
    // scatter of identical 4px dots and the mini-map says nothing about its shape.
    const floor = Math.min(22, 7 + Math.sqrt(Math.max(1, zone.count || 1)) * 1.4);
    const width = Math.max(floor, b.x - a.x);
    const height = Math.max(floor, b.y - a.y);
    const cx = (a.x + b.x) / 2;
    const cy = (a.y + b.y) / 2;
    const div = document.createElement('div');
    div.className = `topo-mini-zone${zone.expanded ? ' expanded' : ''}`;
    // Centred on the members, then clamped so a proxy never leaves the mini-map.
    div.style.left = `${Math.max(0, Math.min(w - width, cx - width / 2))}px`;
    div.style.top = `${Math.max(0, Math.min(h - height, cy - height / 2))}px`;
    div.style.width = `${width}px`;
    div.style.height = `${height}px`;
    if (zone.accent) div.style.setProperty('--zone-accent', zone.accent);
    frag.appendChild(div);
  }

  // Where the camera is looking, in the same graph space.
  const canvas = sigma.getContainer();
  const tl = sigma.viewportToGraph({ x: 0, y: 0 });
  const br = sigma.viewportToGraph({ x: canvas.clientWidth, y: canvas.clientHeight });
  const v1 = toMini(Math.min(tl.x, br.x), Math.min(tl.y, br.y));
  const v2 = toMini(Math.max(tl.x, br.x), Math.max(tl.y, br.y));
  const view = document.createElement('div');
  view.className = 'topo-mini-view';
  view.style.left = `${Math.max(0, v1.x)}px`;
  view.style.top = `${Math.max(0, v1.y)}px`;
  view.style.width = `${Math.max(3, Math.min(w, v2.x) - Math.max(0, v1.x))}px`;
  view.style.height = `${Math.max(3, Math.min(h, v2.y) - Math.max(0, v1.y))}px`;
  frag.appendChild(view);

  body.replaceChildren(frag);
}

/**
 * The graph point a mini-map click refers to, or null.
 *
 * Callers turn this into a camera move: `graphToViewport` then
 * `viewportToFramedGraph` gives the framed coordinate the camera centres on, which
 * is the only conversion sigma exposes between the two spaces.
 */
export function miniMapPointAt(body, clientX, clientY) {
  if (!body || !miniBox) return null;
  const rect = body.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  const fx = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  const fy = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
  return {
    x: miniBox.minX + fx * (miniBox.maxX - miniBox.minX),
    y: miniBox.minY + fy * (miniBox.maxY - miniBox.minY),
  };
}

/**
 * Which zone owns a viewport point.
 *
 * Smallest-area-first, so a zone nested inside another still wins its own clicks.
 * `region` distinguishes the label band at the top — the affordance for collapsing
 * an open zone — from the body, which is empty canvas as far as the user is
 * concerned and should not swallow the click.
 */
export function zoneAt(x, y) {
  const hits = rects
    .filter((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h)
    .sort((a, b) => a.w * a.h - b.w * b.h);
  const hit = hits[0];
  if (!hit) return null;
  return {
    key: hit.key,
    expanded: hit.expanded,
    region: y <= hit.y + LABEL_BAND ? 'label' : 'body',
  };
}
