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
 * The cells an overlaid incident's traffic crosses: pairId -> the overlay events
 * whose endpoints resolve into that (row, column) pair under the current grouping.
 *
 * Resolution comes from the overlay's own tierMap (device key -> segment/locality/
 * role_key), which the /incidents endpoint already binds against the displayed
 * snapshot. An event naming a device outside the snapshot has no tier and simply
 * doesn't mark a cell — same rule the topology drawing uses.
 *
 * External actors (C2, exfil targets) are not snapshot devices, so under segment
 * grouping their steps have no axis to land on and fall out — exactly as the
 * topology draws them outside every zone. Under LOCALITY grouping they belong on
 * the External axis: "which locality did the attack leave toward" is the question
 * that grouping exists to answer.
 */
export function incidentCells(overlay, groupBy = 'segment') {
  const field = groupBy === 'locality' ? 'locality' : (groupBy === 'role_key' ? 'role_key' : 'segment');
  const groupOf = (key) => {
    const tier = overlay.tierMap?.[key];
    if (!tier) return '';
    if (tier.external) return field === 'locality' ? 'External' : '';
    return tier[field] || '';
  };
  const cells = new Map();
  for (const ev of overlay?.events || []) {
    const src = groupOf(ev.src);
    const dst = groupOf(ev.dst);
    if (!src || !dst) continue;
    const id = pairId(src, dst);
    if (!cells.has(id)) cells.set(id, []);
    cells.get(id).push(ev);
  }
  return cells;
}

/**
 * Render the grid. Cells are buttons, because clicking one is how you get from a
 * total to the conversations behind it.
 */
export function renderMatrix(host, model, { selected = '', incident = null } = {}) {
  if (!host) return;
  const { axes, keys, byPair, peakOff, peakDiag } = model;
  if (!axes.length) {
    host.innerHTML = '<div class="topo-matrix-empty panel-sub">No traffic groups in this snapshot.</div>';
    return;
  }

  // An ARIA grid addresses a cell by its row and column, so every cell has to sit
  // inside a `row` and the labels have to be real headers. Without that a screen
  // reader is read a stream of byte counts with no way to tell which segment pair
  // any of them belongs to — which is the entire content of this view.
  //
  // The row wrappers carry `display: contents` (see .topo-matrix-rowgroup) so they
  // add the semantics without becoming grid items and collapsing the layout: the
  // corner, headers and cells must stay *direct* children of the CSS grid.
  const head = `<div class="topo-matrix-rowgroup" role="row">`
    + `<span class="topo-matrix-corner" role="columnheader"></span>`
    + axes.map((a) => `<span class="topo-matrix-col" role="columnheader" title="${esc(label(a))}">${esc(label(a))}</span>`).join('')
    + `</div>`;

  // One tab stop for the whole grid, then arrow keys — the grid pattern. Tabbing
  // through every cell of a 90×90 matrix is not navigation. The roving stop is the
  // selected cell if there is one, else the first.
  let rovingSet = false;
  const rows = axes.map((rowAxis) => {
    const cells = axes.map((colAxis) => {
      const id = pairId(rowAxis.key, colAxis.key);
      const hit = byPair.get(id);
      const diagonal = rowAxis.key === colAxis.key;
      const bytes = hit?.bytes || 0;
      const hot = Boolean(incident?.has(id));
      const alpha = rampAlpha(bytes, diagonal ? peakDiag : peakOff);
      const isSelected = selected === id;
      const classes = ['topo-cell'];
      if (diagonal) classes.push('diagonal');
      if (!bytes) classes.push('empty');
      if (hot) classes.push('incident');
      if (isSelected) classes.push('selected');
      // Reads as a sentence, because this is the cell's whole accessible name:
      // "VLAN 30 to VLAN 20: 1.6 GB, incident traffic".
      const name = `${label(rowAxis)} to ${label(colAxis)}${diagonal ? ' (within itself)' : ''}: `
        + `${fmtBytes(bytes) || 'no traffic'}${hot ? ', incident traffic' : ''}`;
      const title = name.replace(' to ', ' → ');
      // The value is only printed where the cell is dark enough to read it on, so
      // the printed text is never the accessible name.
      const text = bytes && alpha > 0.34 ? fmtBytes(bytes) : '';
      // An incident cell is meaningful with no recorded bytes: the overlay's steps
      // are the story there. Everything else with no traffic is `aria-disabled`
      // rather than `disabled`, so it stays reachable and can say "no traffic" —
      // a disabled button is skipped entirely, leaving holes in the grid.
      const actionable = Boolean(bytes || hot);
      const roving = !rovingSet && (isSelected || (!selected && actionable));
      if (roving) rovingSet = true;
      return `<button type="button" class="${classes.join(' ')}" role="gridcell"`
        + ` data-src="${esc(rowAxis.key)}" data-dst="${esc(colAxis.key)}"`
        + ` style="--cell-alpha:${alpha.toFixed(3)}" title="${esc(title)}"`
        + ` aria-label="${esc(name)}"${isSelected ? ' aria-selected="true"' : ''}`
        + ` tabindex="${roving ? '0' : '-1'}"`
        + `${actionable ? '' : ' aria-disabled="true"'}>${esc(text)}</button>`;
    }).join('');
    return `<div class="topo-matrix-rowgroup" role="row">`
      + `<span class="topo-matrix-row" role="rowheader" title="${esc(label(rowAxis))}">${esc(label(rowAxis))}</span>`
      + `${cells}</div>`;
  }).join('');

  host.innerHTML = `
    <div class="topo-matrix-scroll">
      <div class="topo-matrix-grid" role="grid"
           aria-label="Traffic between groups. Rows talk to columns."
           style="grid-template-columns: 150px repeat(${axes.length}, minmax(64px, 92px))">
        ${head}${rows}
      </div>
      <div class="topo-matrix-legend">
        <span class="topo-matrix-eyebrow">Volume</span>
        <span class="topo-matrix-ramp" aria-hidden="true"></span>
        <span class="topo-matrix-key">low → high</span>
        <span class="topo-matrix-swatch diagonal" aria-hidden="true"></span>
        <span class="topo-matrix-key">within a group</span>
        ${incident?.size ? `<span class="topo-matrix-swatch incident" aria-hidden="true"></span>
        <span class="topo-matrix-key">incident traffic</span>` : ''}
        <span class="topo-matrix-hint">Rows talk to columns · click a cell for the conversations behind it</span>
      </div>
    </div>`;

  // A snapshot where nothing is actionable (every cell empty, no overlay) would
  // otherwise leave the grid with no tab stop at all — unreachable by keyboard.
  if (!host.querySelector('.topo-cell[tabindex="0"]')) {
    host.querySelector('.topo-cell')?.setAttribute('tabindex', '0');
  }
}

/**
 * Move the grid's single tab stop.
 *
 * Exported because the roving tabindex is part of the grid's contract — the
 * renderer decides where the stop starts, and the key handler moves it — and both
 * halves have to agree or the grid ends up with two stops or none.
 */
export function moveRovingFocus(host, from, dRow, dCol) {
  const rows = [...(host?.querySelectorAll('.topo-matrix-rowgroup[role="row"]') || [])]
    .filter((r) => r.querySelector('.topo-cell'));
  const rowIndex = rows.findIndex((r) => r.contains(from));
  if (rowIndex === -1) return null;
  const cols = [...rows[rowIndex].querySelectorAll('.topo-cell')];
  const colIndex = cols.indexOf(from);
  const nextRow = Math.min(rows.length - 1, Math.max(0, rowIndex + dRow));
  const nextCol = Math.min(cols.length - 1, Math.max(0, colIndex + dCol));
  const target = [...rows[nextRow].querySelectorAll('.topo-cell')][nextCol];
  if (!target || target === from) return null;
  from.setAttribute('tabindex', '-1');
  target.setAttribute('tabindex', '0');
  target.focus();
  return target;
}

/** The right-rail detail for one selected cell. */
export function renderPairs(host, {
  srcLabel, dstLabel, bytes, links, diagonal, pairs = [], loading = false,
  // The overlaid incident, where it crosses this cell: the overlay events whose
  // endpoints land here ({seq, tactic, srcName, dstName}), and the device-pair
  // ids those events name, so their conversations are flagged in the list.
  steps = [], incidentPairs = null,
}) {
  if (!host) return;
  if (loading) {
    host.innerHTML = '<div class="topo-inspector-empty panel-sub">Loading conversations…</div>';
    return;
  }
  const flagged = (p) => Boolean(incidentPairs?.has(pairId(p.src_key, p.dst_key)) || incidentPairs?.has(pairId(p.dst_key, p.src_key)));
  const rows = pairs.map((p) => `
    <li${flagged(p) ? ' class="incident"' : ''}>
      <span class="topo-pair-name">${esc(p.src_name || p.src_key)} <span class="topo-pair-arrow">→</span> ${esc(p.dst_name || p.dst_key)}</span>
      <span class="topo-pair-bytes">${esc(fmtBytes(p.bytes))}</span>
    </li>`).join('');
  const incident = steps.length
    ? `<div class="topo-matrix-incident">This cell carries the overlaid incident:${steps.map((s) => `
        <div class="topo-matrix-incident-step">Step ${Number(s.seq) + 1} · ${esc(s.tactic || 'unclassified')} · ${esc(s.srcName)} → ${esc(s.dstName)}</div>`).join('')}
      </div>`
    : '';
  host.innerHTML = [
    `<div class="topo-ins-h">Selected cell</div>`,
    `<div class="topo-ins-title">${esc(srcLabel)} → ${esc(dstLabel)}</div>`,
    `<div class="topo-ins-sub panel-sub">${esc(fmtBytes(bytes) || 'no traffic')}`
      + `${links ? ` · ${links} conversation${links === 1 ? '' : 's'}` : ''}`
      + `${diagonal ? ' · within the group' : ''}</div>`,
    incident,
    diagonal
      ? `<div class="topo-matrix-note">Traffic that stayed inside this group. East-west movement looks like this, which is why it is on the matrix rather than hidden.</div>`
      : '',
    rows ? `<div class="topo-ins-h">Device pairs</div><ul class="topo-ins-list topo-pairs">${rows}</ul>` : '',
    pairs.length
      ? `<button type="button" id="topo-pairs-show" class="topo-investigate">Show these pairs on the topology</button>`
      : '<div class="topo-inspector-empty panel-sub">No device conversations recorded for this cell.</div>',
  ].join('');
}
