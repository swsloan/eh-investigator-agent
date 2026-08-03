// Icons for device roles and avatars for identity types (Slice 6).
//
// Device icons render on the map through sigma's image node program, so each is a
// self-contained SVG served as a data: URI — which satisfies the strict CSP
// (`img-src 'self' data:`) with no CDN and no committed binary. Each glyph is a white
// pictogram on a disc of the role's colour, so it reads on both light and dark themes
// and keeps colour as the redundant channel. Identity avatars are plain inline SVG in
// the Users panel (no canvas involved).

// A device role maps to one of a small set of pictogram groups. Kept deliberately few
// and geometric so they stay legible at ~18px on the canvas.
const ROLE_GLYPH_GROUP = {
  domain_controller: 'shield',
  db_server: 'server', file_server: 'server', http_server: 'server',
  web_proxy: 'server', dns_server: 'server', dhcp_server: 'server',
  gateway: 'gateway', nat_gateway: 'gateway', vpn_gateway: 'gateway', load_balancer: 'gateway',
  firewall: 'firewall',
  pc: 'monitor', mobile_device: 'monitor',
  printer: 'printer',
  ip_camera: 'camera',
  medical_device: 'medical',
  other: 'dot', unknown: 'dot',
};

// White pictograms on a 24×24 canvas (the disc is drawn separately underneath).
const GLYPH = {
  shield: '<path d="M12 3l7 2v6c0 4-3 7-7 8-4-1-7-4-7-8V5z"/>',
  server: '<rect x="5" y="5" width="14" height="5" rx="1"/><rect x="5" y="13" width="14" height="5" rx="1"/><circle cx="8" cy="7.5" r="1"/><circle cx="8" cy="15.5" r="1"/>',
  gateway: '<path d="M6 12h12M6 12l3-3M6 12l3 3M18 12l-3-3M18 12l-3 3" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  firewall: '<rect x="5" y="6" width="14" height="12" rx="1" fill="none" stroke="#fff" stroke-width="1.6"/><path d="M5 10h14M5 14h14M9.5 6v4M14.5 6v4M12 10v4M9.5 14v4M14.5 14v4" stroke="#fff" stroke-width="1.2"/>',
  monitor: '<rect x="4" y="6" width="16" height="10" rx="1"/><rect x="9" y="17" width="6" height="1.5"/>',
  printer: '<rect x="7" y="4" width="10" height="5"/><rect x="4" y="9" width="16" height="7" rx="1"/><rect x="8" y="14" width="8" height="5"/><circle cx="16.5" cy="12" r="1"/>',
  camera: '<rect x="4" y="8" width="12" height="9" rx="1.5"/><path d="M16 11l4-2v7l-4-2z"/>',
  medical: '<path d="M10 4h4v6h6v4h-6v6h-4v-6H4v-4h6z"/>',
  dot: '<circle cx="12" cy="12" r="4"/>',
};

/** The glyph group for a role (defaults to a neutral dot). */
export function roleGlyphGroup(role) {
  return ROLE_GLYPH_GROUP[String(role || '').toLowerCase()] || 'dot';
}

/** A data: URI SVG icon for a device role, on a disc of the given colour. */
export function roleIconDataUri(role, color) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">`
    + `<circle cx="12" cy="12" r="12" fill="${color}"/>`
    + `<g fill="#fff">${GLYPH[roleGlyphGroup(role)]}</g></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/** The same glyph as an inline SVG string, for the legend. */
export function roleGlyphInline(role, color, size = 14) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true">`
    + `<circle cx="12" cy="12" r="12" fill="${color}"/><g fill="#fff">${GLYPH[roleGlyphGroup(role)]}</g></svg>`;
}

// ---- identity avatars --------------------------------------------------------

const AVATAR = {
  // person
  user: '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 19c0-3.5 3-6 7-6s7 2.5 7 6z"/>',
  // gear (service account)
  service: '<path d="M12 8.5a3.5 3.5 0 100 7 3.5 3.5 0 000-7zm9 3.5l-2-.6a7 7 0 00-.5-1.2l1-1.8-1.4-1.4-1.8 1a7 7 0 00-1.2-.5L14.5 3h-2l-.6 2a7 7 0 00-1.2.5l-1.8-1L7.5 5.9l1 1.8a7 7 0 00-.5 1.2l-2 .6v2l2 .6a7 7 0 00.5 1.2l-1 1.8 1.4 1.4 1.8-1a7 7 0 001.2.5l.6 2h2l.6-2a7 7 0 001.2-.5l1.8 1 1.4-1.4-1-1.8a7 7 0 00.5-1.2l2-.6z"/>',
  // monitor (computer account, $-suffixed)
  computer: '<rect x="4" y="6" width="16" height="10" rx="1"/><rect x="9" y="17" width="6" height="1.4"/>',
  // key (admin / privileged)
  admin: '<circle cx="8" cy="9" r="4"/><path d="M11 11l7 7M15 15l2-2M17 17l2-2" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/>',
};

/** Infer an identity type from its principal string. */
export function identityType(principal) {
  const p = String(principal || '').toLowerCase();
  if (/\$@|\$$/.test(p)) return 'computer';                          // MACHINE$@REALM
  // Bound tokens on non-letters (not \b — underscore is a word char, so `sql_agent`
  // would slip through a \b-anchored match).
  if (/(^|[^a-z])(svc|service|sql|iis|backup|scanner|task)([^a-z]|$)/.test(p)) return 'service';
  if (/(^|[^a-z])(admin|administrator|domain admins|root)([^a-z]|$)/.test(p)) return 'admin';
  return 'user';
}

/** An inline SVG avatar for an identity type (for the Users panel). */
export function avatarSvg(type, size = 16) {
  const t = AVATAR[type] ? type : 'user';
  return `<svg class="topo-avatar ${t}" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true">`
    + `<g fill="currentColor">${AVATAR[t]}</g></svg>`;
}
