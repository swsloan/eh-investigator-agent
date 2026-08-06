// Who talks to whom, as a square of totals.
//
// A force graph stops carrying information somewhere around a few hundred visible
// nodes: everything is adjacent to everything and the eye has nowhere to rest. A
// matrix does not care how many groups there are — it just gets denser — so this is
// the view that survives an estate the topology cannot draw.

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Short byte counts; the cells are 56px and the labels have to fit. */
export function fmtBytes(n) {
  const v = Number(n) || 0;
  if (v >= 1e12) return `${(v / 1e12).toFixed(1)} TB`;
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)} GB`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(0)} MB`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)} KB`;
  return v ? `${v} B` : '';
}

/**
 * Cell alpha from volume.
 *
 * Normalised over OFF-DIAGONAL cells only. On a real estate the largest cell is
 * routinely a segment talking to itself — measured at 13.8 GB against 1.6 GB for the
 * heaviest cross-segment pair — so including the diagonal in the scale flattens every
 * other cell to near-invisible. The diagonal keeps its own scale and its own
 * treatment, so self-traffic is never mistaken for pair traffic.
 */
export function rampAlpha(bytes, peak) {
  if (!bytes || !peak) return 0;
  // Log, because traffic spans orders of magnitude and a linear ramp shows one cell.
  const t = Math.log10(bytes + 1) / Math.log10(peak + 1);
  return Math.max(0.07, Math.min(0.68, t * 0.68));
}

/**
 * The key for one cell.
 *
 * Exported because topology.js resolves a clicked cell against the same lookup, and
 * two modules composing the same key independently is exactly how they drift: the
 * grid found its totals while the detail rail reported "no traffic".
 */
export const pairId = (src, dst) => `${src}\u0000${dst}`;

/**
 * Build the matrix model from the server payload: axis order, a cell lookup, and the
 * two peaks the ramps normalise against.
 */
export function matrixModel({ axes = [], cells = [] } = {}) {
  const keys = axes.map((a) => a.key);
  const present = new Set(keys);
  const byPair = new Map();
  let peakOff = 0;
  let peakDiag = 0;
  for (const cell of cells) {
    if (!present.has(cell.src) || !present.has(cell.dst)) continue;
    const bytes = Number(cell.bytes) || 0;
    byPair.set(pairId(cell.src, cell.dst), { bytes, links: Number(cell.links) || 0 });
    if (cell.src === cell.dst) peakDiag = Math.max(peakDiag, bytes);
    else peakOff = Math.max(peakOff, bytes);
  }
  return { axes, keys, byPair, peakOff, peakDiag };
}

const label = (axis) => String(axis.name || axis.key || '').replace(/^(vlan|net|loc):/, (_, k) => (k === 'vlan' ? 'VLAN ' : ''));

/**
 * Render the grid. Cells are buttons, because clicking one is how you get from a
 * total to the conversations behind it.
 */
export function renderMatrix(host, model, { selected = '' } = {}) {
  if (!host) return;
  const { axes, keys, byPair, peakOff, peakDiag } = model;
  if (!axes.length) {
    host.innerHTML = '<div class="topo-matrix-empty panel-sub">No traffic groups in this snapshot.</div>';
    return;
  }

  const head = [`<span class="topo-matrix-corner"></span>`]
    .concat(axes.map((a) => `<span class="topo-matrix-col" title="${esc(label(a))}">${esc(label(a))}</span>`))
    .join('');

  const rows = axes.map((rowAxis) => {
    const cells = axes.map((colAxis) => {
      const id = pairId(rowAxis.key, colAxis.key);
      const hit = byPair.get(id);
      const diagonal = rowAxis.key === colAxis.key;
      const bytes = hit?.bytes || 0;
      const alpha = rampAlpha(bytes, diagonal ? peakDiag : peakOff);
      const classes = ['topo-cell'];
      if (diagonal) classes.push('diagonal');
      if (!bytes) classes.push('empty');
      if (selected === id) classes.push('selected');
      const title = `${label(rowAxis)} → ${label(colAxis)}${diagonal ? ' (within itself)' : ''}: ${fmtBytes(bytes) || 'no traffic'}`;
      // The value is only printed where the cell is dark enough to read it on.
      const text = bytes && alpha > 0.34 ? fmtBytes(bytes) : '';
      return `<button type="button" class="${classes.join(' ')}" role="gridcell"`
        + ` data-src="${esc(rowAxis.key)}" data-dst="${esc(colAxis.key)}"`
        + ` style="--cell-alpha:${alpha.toFixed(3)}" title="${esc(title)}"`
        + `${bytes ? '' : ' disabled'}>${esc(text)}</button>`;
    }).join('');
    return `<span class="topo-matrix-row" title="${esc(label(rowAxis))}">${esc(label(rowAxis))}</span>${cells}`;
  }).join('');

  host.innerHTML = `
    <div class="topo-matrix-scroll">
      <div class="topo-matrix-grid" role="grid"
           style="grid-template-columns: 150px repeat(${axes.length}, minmax(64px, 92px))">
        ${head}${rows}
      </div>
      <div class="topo-matrix-legend">
        <span class="topo-matrix-eyebrow">Volume</span>
        <span class="topo-matrix-ramp" aria-hidden="true"></span>
        <span class="topo-matrix-key">low → high</span>
        <span class="topo-matrix-swatch diagonal" aria-hidden="true"></span>
        <span class="topo-matrix-key">within a group</span>
        <span class="topo-matrix-hint">Rows talk to columns · click a cell for the conversations behind it</span>
      </div>
    </div>`;
}

/** The right-rail detail for one selected cell. */
export function renderPairs(host, { srcLabel, dstLabel, bytes, links, diagonal, pairs = [], loading = false }) {
  if (!host) return;
  if (loading) {
    host.innerHTML = '<div class="topo-inspector-empty panel-sub">Loading conversations…</div>';
    return;
  }
  const rows = pairs.map((p) => `
    <li>
      <span class="topo-pair-name">${esc(p.src_name || p.src_key)} <span class="topo-pair-arrow">→</span> ${esc(p.dst_name || p.dst_key)}</span>
      <span class="topo-pair-bytes">${esc(fmtBytes(p.bytes))}</span>
    </li>`).join('');
  host.innerHTML = [
    `<div class="topo-ins-h">Selected cell</div>`,
    `<div class="topo-ins-title">${esc(srcLabel)} → ${esc(dstLabel)}</div>`,
    `<div class="topo-ins-sub panel-sub">${esc(fmtBytes(bytes) || 'no traffic')}`
      + `${links ? ` · ${links} conversation${links === 1 ? '' : 's'}` : ''}`
      + `${diagonal ? ' · within the group' : ''}</div>`,
    diagonal
      ? `<div class="topo-matrix-note">Traffic that stayed inside this group. East-west movement looks like this, which is why it is on the matrix rather than hidden.</div>`
      : '',
    rows ? `<div class="topo-ins-h">Device pairs</div><ul class="topo-ins-list topo-pairs">${rows}</ul>` : '',
    pairs.length
      ? `<button type="button" id="topo-pairs-show" class="topo-investigate">Show these pairs on the topology</button>`
      : '<div class="topo-inspector-empty panel-sub">No device conversations recorded for this cell.</div>',
  ].join('');
}
