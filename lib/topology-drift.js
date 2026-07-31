// Topology drift (Slice D): what changed in the environment between two snapshots.
//
// Pure — no I/O. The route reads two snapshots from the store and hands them here.
//
// This is arguably worth more than the static map: a map tells you what the network
// looks like, drift tells you what just became true. A domain controller that
// appeared overnight, a workstation that started talking to the DB server, a host
// that changed role — those are the things worth a human's attention.
//
// Design rules:
//   - Diff on `key`, the identity that is stable across snapshots (OID when known).
//   - Report severity so a UI can lead with what matters, not with the longest list.
//   - Say what changed, not merely that something did: every entry names the thing
//     and, where applicable, the before → after.

const NEW_CRITICAL_ROLES = new Set([
  'domain_controller', 'db_server', 'file_server', 'firewall', 'gateway',
  'nat_gateway', 'vpn_gateway', 'load_balancer', 'dns_server', 'dhcp_server',
]);

function str(v) {
  return v == null ? '' : String(v).trim();
}

/** Always an array — a snapshot field can be absent, null, or (from a hand-edited
 *  artifact) the wrong type entirely, and none of those may throw. */
function list(value) {
  return Array.isArray(value) ? value : [];
}

function byKey(items) {
  const map = new Map();
  for (const item of list(items)) {
    const key = str(item?.key);
    if (key) map.set(key, item);
  }
  return map;
}

/** Stable id for a conversation, matching topology-model's canonical pair. */
function edgeId(edge) {
  const a = str(edge?.src);
  const b = str(edge?.dst);
  if (!a || !b) return '';
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function label(device) {
  return str(device?.name) || str(device?.ip) || str(device?.key);
}

/**
 * Compare two snapshots.
 *
 * @param {{devices:Array, edges:Array}} before  the older snapshot
 * @param {{devices:Array, edges:Array}} after   the newer snapshot
 * @param {object} [opts]
 * @param {number} [opts.limit] max entries per category (default 200)
 * @returns {{changes:Array, summary:object, counts:object}}
 */
export function diffSnapshots(before, after, { limit = 200 } = {}) {
  const beforeDevices = byKey(before?.devices);
  const afterDevices = byKey(after?.devices);
  const changes = [];

  // --- devices that appeared -------------------------------------------------
  for (const [key, device] of afterDevices) {
    if (beforeDevices.has(key)) continue;
    const role = str(device.role);
    changes.push({
      kind: 'device_added',
      // A new workstation is routine; a new domain controller is not.
      severity: device.critical || NEW_CRITICAL_ROLES.has(role) ? 'high' : 'info',
      key,
      label: label(device),
      detail: `New ${role || 'device'}${device.ip ? ` (${device.ip})` : ''}${device.vlan ? ` on VLAN ${device.vlan}` : ''}`,
      role,
    });
  }

  // --- devices that disappeared ---------------------------------------------
  for (const [key, device] of beforeDevices) {
    if (afterDevices.has(key)) continue;
    const role = str(device.role);
    changes.push({
      kind: 'device_removed',
      // Losing a critical asset from the map is worth a look — it may be
      // decommissioned, or it may simply have gone quiet.
      severity: device.critical || NEW_CRITICAL_ROLES.has(role) ? 'medium' : 'info',
      key,
      label: label(device),
      detail: `No longer observed (was ${role || 'device'}${device.ip ? ` ${device.ip}` : ''})`,
      role,
    });
  }

  // --- devices that changed in place ----------------------------------------
  for (const [key, now] of afterDevices) {
    const was = beforeDevices.get(key);
    if (!was) continue;
    if (str(was.role) !== str(now.role)) {
      changes.push({
        kind: 'role_changed',
        severity: NEW_CRITICAL_ROLES.has(str(now.role)) ? 'high' : 'medium',
        key,
        label: label(now),
        detail: `Role ${str(was.role) || 'unknown'} → ${str(now.role) || 'unknown'}`,
        from: str(was.role),
        to: str(now.role),
      });
    }
    if (Boolean(was.critical) !== Boolean(now.critical)) {
      changes.push({
        kind: 'criticality_changed',
        severity: now.critical ? 'medium' : 'info',
        key,
        label: label(now),
        detail: now.critical ? 'Marked critical' : 'No longer marked critical',
      });
    }
    if (str(was.segment) !== str(now.segment)) {
      changes.push({
        kind: 'segment_changed',
        // Moving between segments can mean a re-IP, or a host crossing a boundary
        // it should not have crossed.
        severity: 'medium',
        key,
        label: label(now),
        detail: `Segment ${str(was.segment) || 'unknown'} → ${str(now.segment) || 'unknown'}`,
        from: str(was.segment),
        to: str(now.segment),
      });
    }
  }

  // --- dependencies ----------------------------------------------------------
  const beforeEdges = new Map();
  for (const e of list(before?.edges)) { const id = edgeId(e); if (id) beforeEdges.set(id, e); }
  const afterEdges = new Map();
  for (const e of list(after?.edges)) { const id = edgeId(e); if (id) afterEdges.set(id, e); }

  const name = (key) => label(afterDevices.get(key) || beforeDevices.get(key)) || key;

  for (const [id, edge] of afterEdges) {
    if (beforeEdges.has(id)) continue;
    const [a, b] = id.split('|');
    const target = afterDevices.get(edge.dst) || afterDevices.get(b);
    changes.push({
      kind: 'dependency_added',
      // A new conversation reaching a crown-jewel asset is the interesting case.
      severity: target?.critical || NEW_CRITICAL_ROLES.has(str(target?.role)) ? 'medium' : 'info',
      key: id,
      label: `${name(a)} ↔ ${name(b)}`,
      detail: 'New conversation',
      endpoints: [a, b],
    });
  }
  for (const [id] of beforeEdges) {
    if (afterEdges.has(id)) continue;
    const [a, b] = id.split('|');
    changes.push({
      kind: 'dependency_removed',
      severity: 'info',
      key: id,
      label: `${name(a)} ↔ ${name(b)}`,
      detail: 'Conversation no longer observed',
      endpoints: [a, b],
    });
  }

  // --- identities ------------------------------------------------------------
  const identityKey = (i) => `${str(i?.name).toLowerCase()}`;
  const beforeIdentities = new Map(list(before?.identities).map((i) => [identityKey(i), i]));
  for (const identity of list(after?.identities)) {
    const k = identityKey(identity);
    if (!k) continue;
    const was = beforeIdentities.get(k);
    if (!was) {
      changes.push({ kind: 'identity_added', severity: 'info', key: k, label: str(identity.name), detail: 'Identity first observed' });
      continue;
    }
    const wasOn = new Set(list(was.devices).map(str));
    const added = list(identity.devices).map(str).filter((d) => d && !wasOn.has(d));
    if (added.length) {
      changes.push({
        kind: 'identity_moved',
        // An account showing up on a host it has never used before is a classic
        // lateral-movement tell.
        severity: 'medium',
        key: k,
        label: str(identity.name),
        detail: `Now seen on ${added.map(name).join(', ')}`,
        devices: added,
      });
    }
  }

  const RANK = { high: 0, medium: 1, info: 2 };
  changes.sort((a, b) => (RANK[a.severity] - RANK[b.severity]) || a.kind.localeCompare(b.kind) || a.label.localeCompare(b.label));

  const counts = {};
  for (const c of changes) counts[c.kind] = (counts[c.kind] || 0) + 1;
  const bySeverity = { high: 0, medium: 0, info: 0 };
  for (const c of changes) bySeverity[c.severity]++;

  const capped = changes.slice(0, Math.max(1, Math.min(1000, Number(limit) || 200)));
  return {
    changes: capped,
    truncated: changes.length > capped.length,
    counts,
    summary: {
      total: changes.length,
      ...bySeverity,
      devices_before: beforeDevices.size,
      devices_after: afterDevices.size,
      edges_before: beforeEdges.size,
      edges_after: afterEdges.size,
    },
  };
}

/** One-line human summary of a diff, for the map's status bar. */
export function describeDrift({ summary } = {}) {
  if (!summary || !summary.total) return 'No change since the previous snapshot.';
  const parts = [];
  const added = summary.devices_after - summary.devices_before;
  if (added > 0) parts.push(`+${added} device${added === 1 ? '' : 's'}`);
  if (added < 0) parts.push(`${added} device${added === -1 ? '' : 's'}`);
  if (summary.high) parts.push(`${summary.high} high`);
  if (summary.medium) parts.push(`${summary.medium} medium`);
  return `${summary.total} change${summary.total === 1 ? '' : 's'}${parts.length ? ` · ${parts.join(' · ')}` : ''}`;
}
