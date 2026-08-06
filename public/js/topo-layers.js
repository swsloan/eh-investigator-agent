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
