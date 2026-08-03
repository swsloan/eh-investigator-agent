// Network topology data model (Slice A of the topology map).
//
// Pure: the normalization contract between what the `network-topology` skill
// collects from ExtraHop and what the server persists. No I/O, no FalkorDB, no
// ExtraHop calls — so the shape of a snapshot is testable in isolation and the
// write path stays free of LLM extraction (byte counts, ports, and IDs survive
// losslessly). See docs/DESIGN-network-topology.md.
//
// A snapshot is one complete observation of the environment:
//   nodes[]      devices, keyed by a stable `key` (OID when known, else IP)
//   edges[]      one per conversation, canonicalized so A↔B isn't stored twice
//   identities[] tier-2 only (Kerberos/NTLM/LDAP binding)
//   tiers        the derived Locality → Segment → Role hierarchy the map zooms through

import ipaddr from 'ipaddr.js';

/** RFC1918 is internal by default — the one rule ExtraHop's own docs state.
 *  Everything else is External until an operator says otherwise. */
export const DEFAULT_LOCALITY_RULES = [
  { cidr: '10.0.0.0/8', name: 'Internal' },
  { cidr: '172.16.0.0/12', name: 'Internal' },
  { cidr: '192.168.0.0/16', name: 'Internal' },
];

export const EXTERNAL_LOCALITY = 'External';
export const UNKNOWN_LOCALITY = 'Unknown';

function str(v) {
  return v == null ? '' : String(v).trim();
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/**
 * Parse + validate locality rules, sorted most-specific-prefix-first so a
 * /24 carve-out wins over the /8 it sits inside. This mirrors how the ExtraHop
 * Trigger API orders `localityNames` (longer prefixes first). Invalid rules are
 * dropped rather than throwing — a bad entry in Settings must not break ingest.
 */
export function parseLocalityRules(rules = DEFAULT_LOCALITY_RULES) {
  const parsed = [];
  for (const rule of Array.isArray(rules) ? rules : []) {
    const cidr = str(rule?.cidr);
    const name = str(rule?.name);
    if (!cidr || !name) continue;
    try {
      const [addr, bits] = ipaddr.parseCIDR(cidr);
      parsed.push({ cidr, name, addr, bits, kind: addr.kind() });
    } catch { /* malformed CIDR — skip it */ }
  }
  return parsed.sort((a, b) => b.bits - a.bits);
}

/**
 * Which locality an IP belongs to. Derived from CIDR rules, NOT read from
 * ExtraHop: RevealX's Network Localities are only exposed to the Trigger API,
 * which this app cannot call (see docs/DESIGN-network-topology.md). An
 * environment using non-RFC1918 internal space needs matching rules configured
 * here or it will be grouped as External.
 *
 * @param {string} ip
 * @param {Array} rules output of parseLocalityRules(), or raw rules
 */
export function deriveLocality(ip, rules = DEFAULT_LOCALITY_RULES) {
  const value = str(ip);
  if (!value || !ipaddr.isValid(value)) return UNKNOWN_LOCALITY;
  const parsed = rules.length && rules[0]?.addr ? rules : parseLocalityRules(rules);
  let addr;
  try { addr = ipaddr.parse(value); } catch { return UNKNOWN_LOCALITY; }
  for (const rule of parsed) {
    // match() throws on an ipv4/ipv6 kind mismatch — skip rules of the other family.
    if (rule.kind !== addr.kind()) continue;
    try {
      if (addr.match(rule.addr, rule.bits)) return rule.name;
    } catch { /* defensive: treat an unmatchable rule as a miss */ }
  }
  return EXTERNAL_LOCALITY;
}

/** Stable identity across snapshots: the ExtraHop OID when known (durable), else the IP. */
export function nodeKey(device) {
  // Explicit null is a real input here (junk rows in a skill-produced file), and a
  // default parameter only covers undefined — so guard rather than destructure.
  if (!device || typeof device !== 'object') return '';
  const oid = str(device.oid ?? device.id);
  if (oid) return `oid:${oid}`;
  const ip = str(device.ip ?? device.ipaddr);
  return ip ? `ip:${ip}` : '';
}

/** The /24 an IPv4 address sits in — the subnet proxy used when a device has no VLAN. */
function subnetOf(ip) {
  const value = str(ip);
  if (!value || !ipaddr.isValid(value)) return '';
  try {
    const addr = ipaddr.parse(value);
    if (addr.kind() !== 'ipv4') return '';
    const o = addr.toByteArray();
    return `${o[0]}.${o[1]}.${o[2]}.0/24`;
  } catch { return ''; }
}

function normalizeNode(raw, rules) {
  const key = nodeKey(raw);
  if (!key) return null;
  const ip = str(raw.ip ?? raw.ipaddr);
  const vlan = str(raw.vlan ?? raw.vlanid);
  const locality = deriveLocality(ip, rules);
  const segment = vlan ? `vlan:${vlan}` : (subnetOf(ip) ? `net:${subnetOf(ip)}` : `loc:${locality}`);
  const role = str(raw.role) || 'unknown';
  // ExtraHop resolves a device name several ways; keep each distinctly so the detail
  // panel can show Hostname vs DNS vs DHCP vs NetBIOS instead of one opaque "name".
  const dnsName = str(raw.dns_name ?? raw.dnsName);
  const dhcpName = str(raw.dhcp_name ?? raw.dhcpName);
  const netbiosName = str(raw.netbios_name ?? raw.netbiosName);
  return {
    key,
    kind: 'device',
    name: str(raw.name ?? raw.display_name ?? raw.custom_name) || dnsName || netbiosName || ip || key,
    ip,
    mac: str(raw.mac ?? raw.macaddr),
    role,
    vlan,
    tags: Array.isArray(raw.tags) ? raw.tags.map(str).filter(Boolean) : [],
    critical: Boolean(raw.critical ?? raw.is_critical),
    oid: str(raw.oid ?? raw.id),
    discovery_id: str(raw.discovery_id ?? raw.discoveryId),
    // Richer identity/inventory fields (Slice 2). Optional — the skill fills what
    // ExtraHop returns; absent ones stay empty strings and simply don't render.
    dns_name: dnsName,
    dhcp_name: dhcpName,
    netbios_name: netbiosName,
    vendor: str(raw.vendor),
    software: str(raw.software ?? raw.os ?? raw.operating_system),
    // Derived hierarchy — what the map zooms through.
    locality,
    segment,
    roleKey: `${segment}/${role}`,
  };
}

/**
 * Merge one observed conversation into the edge map.
 *
 * Canonicalized: a device's `net_detail` view of a peer and that peer's view of
 * the same device are the SAME conversation, so both fold into one edge keyed by
 * the sorted pair. Byte counts stay directional relative to the canonical `src`
 * (bytes_out = src→dst, bytes_in = dst→src), flipping the observation when it
 * arrives from the far side. Without this, sweeping both endpoints double-counts
 * every link and the map grows a duplicate edge for each conversation.
 */
function mergeEdge(map, rawSrc, rawDst, out, incoming, protocols, firstSeen, lastSeen) {
  const a = str(rawSrc);
  const b = str(rawDst);
  if (!a || !b || a === b) return; // self-conversation carries no topology
  const flip = a > b;
  const src = flip ? b : a;
  const dst = flip ? a : b;
  const bytesOut = flip ? num(incoming) : num(out);
  const bytesIn = flip ? num(out) : num(incoming);
  const id = `${src}|${dst}`;
  const existing = map.get(id);
  if (!existing) {
    map.set(id, {
      src,
      dst,
      bytes_out: bytesOut,
      bytes_in: bytesIn,
      protocols: [...new Set(protocols.map(str).filter(Boolean))].sort(),
      first_seen: firstSeen || '',
      last_seen: lastSeen || '',
    });
    return;
  }
  existing.bytes_out += bytesOut;
  existing.bytes_in += bytesIn;
  for (const p of protocols) { const v = str(p); if (v && !existing.protocols.includes(v)) existing.protocols.push(v); }
  existing.protocols.sort();
  if (firstSeen && (!existing.first_seen || firstSeen < existing.first_seen)) existing.first_seen = firstSeen;
  if (lastSeen && lastSeen > existing.last_seen) existing.last_seen = lastSeen;
}

/**
 * Roll devices up into the Role → Segment → Locality hierarchy the map zooms
 * through. Pure derivation from the normalized nodes; both the layout step (which
 * positions aggregates as member centroids) and the store consume this.
 */
export function buildHierarchy(nodes = []) {
  const roles = new Map();
  const segments = new Map();
  const localities = new Map();
  for (const n of nodes) {
    if (!roles.has(n.roleKey)) {
      roles.set(n.roleKey, { key: n.roleKey, name: n.role, segment: n.segment, locality: n.locality, members: [] });
    }
    roles.get(n.roleKey).members.push(n.key);

    if (!segments.has(n.segment)) {
      segments.set(n.segment, { key: n.segment, name: n.segment.replace(/^(vlan|net|loc):/, ''), locality: n.locality, members: [] });
    }
    segments.get(n.segment).members.push(n.roleKey);

    if (!localities.has(n.locality)) {
      localities.set(n.locality, { key: n.locality, name: n.locality, members: [] });
    }
    localities.get(n.locality).members.push(n.segment);
  }
  const dedup = (m) => [...m.values()].map((v) => ({ ...v, members: [...new Set(v.members)], device_count: 0 }));
  const out = { roles: dedup(roles), segments: dedup(segments), localities: dedup(localities) };
  // Device counts roll upward so a collapsed cluster can show its weight.
  for (const r of out.roles) r.device_count = roles.get(r.key).members.length;
  const roleCount = new Map(out.roles.map((r) => [r.key, r.device_count]));
  for (const s of out.segments) s.device_count = s.members.reduce((t, rk) => t + (roleCount.get(rk) || 0), 0);
  const segCount = new Map(out.segments.map((s) => [s.key, s.device_count]));
  for (const l of out.localities) l.device_count = l.members.reduce((t, sk) => t + (segCount.get(sk) || 0), 0);
  return out;
}

/**
 * Normalize a raw `evidence/topology/topology.json` into the persisted snapshot
 * shape. Tolerant by design: the producer is an LLM-driven skill, so unknown
 * fields are ignored, malformed rows are dropped rather than throwing, and edges
 * referencing unknown devices are kept only if both endpoints resolve.
 *
 * @returns {{snapshot, nodes, edges, identities, tiers}}
 */
export function normalize(rawInput, { localityRules = DEFAULT_LOCALITY_RULES, group = '', now = () => new Date().toISOString() } = {}) {
  // Same reason as nodeKey: `normalize(null)` is a real call shape (unreadable or
  // empty artifact), and a default parameter would not catch it.
  const raw = rawInput && typeof rawInput === 'object' ? rawInput : {};
  const rules = parseLocalityRules(localityRules);

  const nodes = [];
  const byKey = new Map();
  const byIp = new Map();
  for (const d of Array.isArray(raw.devices ?? raw.nodes) ? (raw.devices ?? raw.nodes) : []) {
    const n = normalizeNode(d, rules);
    if (!n || byKey.has(n.key)) continue;
    byKey.set(n.key, n);
    if (n.ip) byIp.set(n.ip, n.key);
    nodes.push(n);
  }

  // Edge endpoints may be given as a node key, an OID, or a bare IP — resolve all
  // three to the canonical key so the graph doesn't split one device in two.
  const resolve = (v) => {
    const s = str(v);
    if (!s) return '';
    if (byKey.has(s)) return s;
    if (byIp.has(s)) return byIp.get(s);
    if (byKey.has(`oid:${s}`)) return `oid:${s}`;
    if (byKey.has(`ip:${s}`)) return `ip:${s}`;
    return '';
  };

  const edgeMap = new Map();
  for (const e of Array.isArray(raw.edges ?? raw.conversations) ? (raw.edges ?? raw.conversations) : []) {
    const src = resolve(e?.src ?? e?.source ?? e?.device);
    const dst = resolve(e?.dst ?? e?.target ?? e?.peer);
    if (!src || !dst) continue; // an endpoint we never discovered — not mappable
    mergeEdge(
      edgeMap, src, dst,
      e?.bytes_out ?? e?.bytesOut, e?.bytes_in ?? e?.bytesIn,
      Array.isArray(e?.protocols) ? e.protocols : (e?.protocol ? [e.protocol] : []),
      str(e?.first_seen ?? e?.firstSeen), str(e?.last_seen ?? e?.lastSeen),
    );
  }
  const edges = [...edgeMap.values()].map((e) => ({ ...e, bytes_total: e.bytes_out + e.bytes_in }));

  const identities = [];
  const seenIdentity = new Set();
  for (const i of Array.isArray(raw.identities) ? raw.identities : []) {
    const name = str(i?.name ?? i?.principal);
    if (!name || seenIdentity.has(name)) continue;
    seenIdentity.add(name);
    identities.push({
      key: `id:${name.toLowerCase()}`,
      name,
      principal: str(i?.principal) || name,
      devices: (Array.isArray(i?.devices) ? i.devices : []).map(resolve).filter(Boolean),
    });
  }

  const tiers = buildHierarchy(nodes);
  const collectedAt = str(raw.collected_at) || now();
  const snapshot = {
    id: str(raw.snapshot_id) || `snap-${collectedAt.replace(/[^0-9]/g, '').slice(0, 14)}`,
    group: str(group) || str(raw.group),
    collected_at: collectedAt,
    window: str(raw.window),
    tiers: Array.isArray(raw.tiers) ? raw.tiers.map(str).filter(Boolean) : ['devices', 'peers'],
    device_count: nodes.length,
    edge_count: edges.length,
    identity_count: identities.length,
    truncated: Boolean(raw.truncated),
  };

  return { snapshot, nodes, edges, identities, tiers };
}
