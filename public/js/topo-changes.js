// What changed between two snapshots, severity first.
//
// The drift diff has always been computed (lib/topology-drift.js) and has always
// been readable only as coloured halos on the map plus a flat list in a 320px rail.
// Severity was a dot. This presents it the way an analyst triages it: the two things
// that matter at the top, the churn folded away underneath.

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// One glyph per kind of change, so a card is identifiable before it is read.
const ICONS = {
  device_added: '<path d="M12 5v14M5 12h14"/>',
  device_removed: '<path d="M5 12h14"/>',
  role_changed: '<path d="M12 3l7 3v6c0 4-3 7.5-7 9-4-1.5-7-5-7-9V6z"/>',
  criticality_changed: '<path d="M12 3l7 3v6c0 4-3 7.5-7 9-4-1.5-7-5-7-9V6z"/><path d="M12 9v4"/>',
  segment_changed: '<path d="M4 12h14M13 7l5 5-5 5"/>',
  dependency_added: '<path d="M4 12h14M13 7l5 5-5 5"/>',
  dependency_removed: '<path d="M20 12H6M11 7l-5 5 5 5"/>',
  identity_added: '<circle cx="12" cy="8" r="3.2"/><path d="M5 20c1.5-3.5 4-5 7-5s5.5 1.5 7 5"/>',
  identity_moved: '<circle cx="12" cy="8" r="3.2"/><path d="M5 20c1.5-3.5 4-5 7-5s5.5 1.5 7 5"/>',
};
const FALLBACK_ICON = '<circle cx="12" cy="12" r="8"/>';

const ORDER = ['high', 'medium', 'info'];
const HEADING = { high: 'High', medium: 'Medium', info: 'Info' };

/** Split changes into the three severity buckets, preserving server order within each. */
export function severityGroups(changes = []) {
  const groups = { high: [], medium: [], info: [] };
  for (const change of changes) {
    (groups[change?.severity] || groups.info).push(change);
  }
  return groups;
}

/**
 * The device keys a change is about, for scoping the map to it.
 *
 * A change is keyed by one device, a canonical pair, or a set of devices an identity
 * moved between — so the answer is a list, never a single key.
 */
export function changeKeys(change) {
  if (!change) return [];
  if (Array.isArray(change.endpoints) && change.endpoints.length) return change.endpoints.filter(Boolean);
  if (Array.isArray(change.devices) && change.devices.length) return change.devices.filter(Boolean);
  return change.key ? [change.key] : [];
}

function card(change, index) {
  const severity = ORDER.includes(change.severity) ? change.severity : 'info';
  const icon = ICONS[change.kind] || FALLBACK_ICON;
  const keys = changeKeys(change);
  return `
    <li class="topo-change ${severity}">
      <span class="topo-change-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
             stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icon}</svg>
      </span>
      <div class="topo-change-body">
        <div class="topo-change-title">${esc(change.label || change.kind)}</div>
        ${change.detail ? `<div class="topo-change-detail">${esc(change.detail)}</div>` : ''}
      </div>
      ${keys.length
    ? `<button type="button" class="topo-change-show" data-index="${index}">Show on map →</button>`
    : ''}
    </li>`;
}

/**
 * Render the whole view. Info is collapsed behind its own count: it is normal churn,
 * and eleven workstations changing VLAN should not sit between an analyst and the two
 * findings that matter.
 */
export function renderChanges(host, drift, { showInfo = false } = {}) {
  if (!host) return;
  if (!drift) {
    host.innerHTML = '<div class="topo-changes-empty panel-sub">Comparing snapshots…</div>';
    return;
  }
  const changes = Array.isArray(drift.changes) ? drift.changes : [];
  const groups = severityGroups(changes);
  const summary = drift.summary || {};

  if (!changes.length) {
    host.innerHTML = `<div class="topo-changes-inner">
      <div class="topo-changes-empty panel-sub">${esc(drift.description || 'No change since the previous snapshot.')}</div>
    </div>`;
    return;
  }

  const chips = ORDER.map((sev) => {
    const n = groups[sev].length;
    return n ? `<span class="topo-sev-chip ${sev}">${n} ${sev}</span>` : '';
  }).join('');

  // Index into the flat list, so a card's button can find its own change again.
  const indexOf = new Map(changes.map((c, i) => [c, i]));
  const section = (sev) => {
    const items = groups[sev];
    if (!items.length) return '';
    const body = `<ul class="topo-change-list${sev === 'info' && !showInfo ? ' hidden' : ''}" data-sev="${sev}">`
      + items.map((c) => card(c, indexOf.get(c))).join('') + '</ul>';
    const toggle = sev === 'info'
      ? `<button type="button" id="topo-changes-info" class="topo-changes-toggle" aria-expanded="${showInfo}">`
        + `${showInfo ? 'Hide' : 'Show'} ${items.length} info change${items.length === 1 ? '' : 's'}</button>`
      : '';
    const heading = sev === 'info' && !showInfo ? '' : `<div class="topo-sev-heading ${sev}">${HEADING[sev]}</div>`;
    return sev === 'info' ? `${toggle}${heading}${body}` : `${heading}${body}`;
  };

  host.innerHTML = `
    <div class="topo-changes-inner">
      <div class="topo-changes-head">
        <div class="topo-sev-chips">${chips}</div>
        <div class="topo-changes-range panel-sub">${esc(drift.description || '')}</div>
      </div>
      ${ORDER.map(section).join('')}
      ${drift.truncated ? '<div class="topo-changes-empty panel-sub">List truncated.</div>' : ''}
      <div class="topo-changes-foot panel-sub">
        ${Number(summary.devices_before) || 0} → ${Number(summary.devices_after) || 0} devices ·
        ${Number(summary.edges_before) || 0} → ${Number(summary.edges_after) || 0} conversations
      </div>
    </div>`;
}
