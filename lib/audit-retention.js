// Audit-trail retention (issue #30, Slice D).
//
// A configurable, conservative retention policy for the local audit trails. It
// only ever removes WHOLE, SEALED trails — never edits one in place, and never
// touches an unsealed trail (which is still active / not yet anchored). The
// external anchor (Slice C) is the long-term record, so pruning a sealed,
// anchored trail locally is safe. Default is keep-everything (both limits unset),
// so nothing is pruned unless an operator opts in.
//
//   EH_AUDIT_RETENTION_DAYS = prune sealed trails older than N days
//   EH_AUDIT_RETENTION_MAX  = keep at most the N most-recent sealed trails

import fs from 'node:fs';
import path from 'node:path';
import { readTrail, verifyTrail, trailPath } from './audit-trail.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Resolve the retention policy from the environment. Returns
 * { maxAgeMs, maxCount } with nulls when unset (= keep everything). */
export function resolveRetentionPolicy(env = process.env) {
  const days = Number(env.EH_AUDIT_RETENTION_DAYS);
  const max = Number(env.EH_AUDIT_RETENTION_MAX);
  return {
    maxAgeMs: Number.isFinite(days) && days > 0 ? days * DAY_MS : null,
    maxCount: Number.isFinite(max) && max >= 0 ? Math.floor(max) : null,
  };
}

export function policyIsActive(policy) {
  return Boolean(policy && (policy.maxAgeMs != null || policy.maxCount != null));
}

/** Inspect a workspace's trail: whether it exists, is sealed, and when it was
 * sealed (the last seal entry's `at`, else null). */
export function trailStatus(workspace) {
  const text = readTrail(workspace);
  if (!text) return { present: false, sealed: false, sealedAt: null };
  const v = verifyTrail(text);
  let sealedAt = null;
  if (v.sealed) {
    // The most recent seal entry's timestamp.
    for (const line of text.split('\n').filter(Boolean)) {
      try { const e = JSON.parse(line); if (e.type === 'seal') sealedAt = e.at || sealedAt; } catch { /* skip */ }
    }
  }
  return { present: true, sealed: v.sealed === true, sealedAt };
}

/**
 * Pure selector: given `trails` = [{ id, sealed, sealedAt }], return the ids to
 * prune under `policy`. ONLY sealed trails are eligible; unsealed trails are never
 * pruned. Age uses `sealedAt`; count keeps the newest `maxCount` sealed trails.
 */
export function selectTrailsToPrune(trails = [], policy = {}, now = Date.now()) {
  const sealed = trails.filter((t) => t && t.sealed && t.id);
  const doomed = new Set();

  if (policy.maxAgeMs != null) {
    for (const t of sealed) {
      const at = t.sealedAt ? new Date(t.sealedAt).getTime() : NaN;
      if (Number.isFinite(at) && now - at > policy.maxAgeMs) doomed.add(t.id);
    }
  }
  if (policy.maxCount != null && sealed.length > policy.maxCount) {
    const byNewest = [...sealed].sort((a, b) => (new Date(b.sealedAt || 0)) - (new Date(a.sealedAt || 0)));
    for (const t of byNewest.slice(policy.maxCount)) doomed.add(t.id);
  }
  return [...doomed];
}

/**
 * Apply retention across sessions. `entries` = [{ sessionId, workspace }]. Reads
 * each trail's status, selects prunable (sealed) ones, and removes only the trail
 * file (never the workspace/session). No-op when the policy is inactive. Returns
 * the pruned session ids.
 */
export function pruneAuditTrails({ entries = [], policy = {}, logger = console, now = Date.now() } = {}) {
  if (!policyIsActive(policy)) return [];
  const trails = [];
  const byId = new Map();
  for (const e of entries) {
    if (!e?.workspace || !e?.sessionId) continue;
    const status = trailStatus(e.workspace);
    if (!status.present) continue;
    trails.push({ id: e.sessionId, sealed: status.sealed, sealedAt: status.sealedAt });
    byId.set(e.sessionId, e.workspace);
  }
  const pruned = [];
  for (const id of selectTrailsToPrune(trails, policy, now)) {
    const workspace = byId.get(id);
    try {
      fs.rmSync(trailPath(workspace), { force: true });
      // Remove the now-empty audit dir (best effort).
      try { fs.rmdirSync(path.dirname(trailPath(workspace))); } catch { /* not empty / gone */ }
      pruned.push(id);
      logger?.info?.(`[audit-retention] pruned sealed trail for session ${id.slice(0, 8)}`);
    } catch (err) {
      logger?.warn?.(`[audit-retention] could not prune ${id.slice(0, 8)}: ${err?.message || err}`);
    }
  }
  return pruned;
}
