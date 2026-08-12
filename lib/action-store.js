// File-based store for proposed write actions (Phase 1: governed write path).
//
// A "proposed action" is a write-class excli call the agent wants to make but
// CANNOT execute itself — the agent's excli socket stays read-only. The proposal
// is persisted here; a human approves it via /api/actions, and only then does the
// server-side privileged executor (ExcliBroker.executeApproved) run it. The store
// is intentionally file-based to match the app's single-process session model
// (no Postgres); it can migrate to a table later without changing the contract.
//
// Records live under `<workspace>/.actions/<id>.json`. The `.`-prefix keeps them
// out of visibleFiles(), so they never render as evidence in the UI.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { atomicWriteJson } from './session-store.js';

const ACTIONS_DIRNAME = '.actions';
const MAX_LABEL_LEN = 200;
const MAX_RESULT_STDOUT = 16 * 1024;

// How long a proposal stays approvable. A write proposed against the appliance's
// state at time T should not silently execute hours later against drifted state;
// past this, the proposal is `expired` and must be re-proposed. Long enough not
// to surprise an attentive analyst, short enough to bound staleness. (The UI also
// flags a softer 1h "stale" hint; expiration is the hard cutoff.)
export const PROPOSAL_TTL_MS = 24 * 60 * 60 * 1000; // 24h

// Phase 3 (#23) adds read-back verification, so a write has two possible success
// terminals: `verified` (desired state observed in read-back) and `executed`
// (accepted, but the capability has no verifier — the pre-Phase-3 meaning, kept
// for backward compatibility). `verification_failed` is a NON-success terminal:
// the appliance accepted the write but the desired state was not observed
// (accepted ≠ persisted, or the target drifted). `expired` retires a stale
// proposal. `verifying` is the transient read-back state (like `executing`).
export const ACTION_STATUSES = [
  'proposed', 'approved', 'executing', 'verifying',
  'executed', 'verified', 'verification_failed', 'rejected', 'failed', 'expired',
];

// A terminal status can never transition again (one-shot decisions).
const ALLOWED_TRANSITIONS = {
  proposed: new Set(['approved', 'rejected', 'expired']),
  approved: new Set(['executing', 'failed']),
  executing: new Set(['verifying', 'executed', 'failed', 'verification_failed']),
  verifying: new Set(['verified', 'verification_failed', 'failed']),
  executed: new Set(),
  verified: new Set(),
  verification_failed: new Set(),
  rejected: new Set(),
  failed: new Set(),
  expired: new Set(),
};

function badRequest(message) {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
}

/** UUIDv4 shape check, so a caller-supplied id can never escape the actions dir. */
export function isValidActionId(id) {
  return typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

function actionsDir(workspace) {
  return path.join(workspace, ACTIONS_DIRNAME);
}

function actionPath(workspace, id) {
  return path.join(actionsDir(workspace), `${id}.json`);
}

/**
 * Validate an agent-supplied proposal payload. Returns a normalized
 * {capabilityId, label, params}. Throws a 400 on any malformed field. Whether
 * the capability exists and is write-class is checked by the caller against the
 * live catalog (it needs the broker), not here.
 */
export function validateProposalPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw badRequest('A proposal must be a JSON object.');
  }
  const capabilityId = typeof payload.capabilityId === 'string' ? payload.capabilityId.trim() : '';
  if (!capabilityId) throw badRequest('A proposal requires a "capabilityId" (the excli tool name).');
  const label = typeof payload.label === 'string' ? payload.label.trim() : '';
  if (!label) throw badRequest('A proposal requires a short human-readable "label" describing the change.');
  if (label.length > MAX_LABEL_LEN) throw badRequest(`"label" must be ${MAX_LABEL_LEN} characters or fewer.`);
  const params = payload.params;
  if (params !== undefined && (typeof params !== 'object' || params === null || Array.isArray(params))) {
    throw badRequest('"params" must be a JSON object matching the tool\'s -help schema.');
  }
  return { capabilityId, label, params: params || {} };
}

/** Persist a new proposed action and return the full record. */
export function createAction(workspace, {
  sessionId, capabilityId, params, label, accessType = 'write', destructive = false,
  presence = null, presenceReason = '', ttlMs = PROPOSAL_TTL_MS,
}) {
  const id = crypto.randomUUID();
  const now = Date.now();
  const record = {
    id,
    sessionId,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ttlMs).toISOString(),
    status: 'proposed',
    capabilityId,
    params: params || {},
    label,
    accessType,
    destructive: Boolean(destructive),
    // #137: whether a human was present when this was proposed — chooses how the
    // approval is delivered (attended: prompt now; unattended: tray + notify,
    // never block) and makes "this sat unwatched" auditable. null on records
    // written before presence existed.
    presence: presence === 'attended' || presence === 'unattended' ? presence : null,
    presenceReason: String(presenceReason || ''),
    decidedAt: null,
    decidedBy: null,
    result: null,
    // Phase 3 (#23) audit evidence — populated as the action moves through
    // execute → read-back. Present (null) from creation so every record has a
    // stable shape.
    beforeState: null,   // target state observed just before execution
    desiredState: null,  // explicit intended after-state, derived from params
    afterState: null,    // target state observed in read-back
    verification: null,  // { status, checkedAt, detail, mismatches }
  };
  fs.mkdirSync(actionsDir(workspace), { recursive: true, mode: 0o700 });
  atomicWriteJson(actionPath(workspace, id), record);
  return record;
}

/** True when a proposal has passed its `expiresAt`. Only `proposed` actions can
 * expire; anything already decided is governed by its own terminal state. A
 * record without `expiresAt` (created before Phase 3) never expires. */
export function isExpired(record, now = Date.now()) {
  if (!record || record.status !== 'proposed' || !record.expiresAt) return false;
  const t = new Date(record.expiresAt).getTime();
  return Number.isFinite(t) && now >= t;
}

/**
 * Persist the `proposed → expired` transition for every stale proposal in a
 * workspace so the store, index, and UI agree that they are no longer approvable.
 * Returns the list of records that were expired (for broadcasting). Pure I/O over
 * the store; safe to call on every list.
 */
export function sweepExpired(workspace, now = Date.now()) {
  const expired = [];
  for (const record of listActions(workspace)) {
    if (!isExpired(record, now)) continue;
    try {
      expired.push(transitionAction(workspace, record.id, 'expired', {
        decidedAt: new Date(now).toISOString(),
        decidedBy: 'system:expiry',
      }));
    } catch { /* raced with a decision — the other transition wins */ }
  }
  return expired;
}

export function readAction(workspace, id) {
  if (!isValidActionId(id)) return null;
  try {
    return JSON.parse(fs.readFileSync(actionPath(workspace, id), 'utf8'));
  } catch {
    return null;
  }
}

/** All actions in a workspace, newest first. */
export function listActions(workspace) {
  let names;
  try {
    names = fs.readdirSync(actionsDir(workspace));
  } catch {
    return [];
  }
  const out = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const record = readAction(workspace, name.slice(0, -5));
    if (record) out.push(record);
  }
  out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return out;
}

// Open = still needs or is undergoing execution/verification; terminal states
// (executed/verified/verification_failed/rejected/failed/expired) are excluded.
const OPEN_STATUSES = new Set(['proposed', 'approved', 'executing', 'verifying']);

/** True while an action is not in a terminal state (executed/rejected/failed). */
export function isOpenAction(status) {
  return OPEN_STATUSES.has(status);
}

/**
 * Aggregate open actions across sessions for the cross-session dashboard. Pure:
 * takes `entries` of `{ sessionId, sessionTitle, workspace }` (not the live
 * sessions map) so it can be unit-tested. Returns every open action with its
 * `sessionId`/`sessionTitle` attached, sorted OLDEST-first (triage order), plus
 * `pendingCount` = the number awaiting a human decision (`proposed`).
 */
export function listActionsAcrossWorkspaces(entries = []) {
  const actions = [];
  for (const entry of entries) {
    if (!entry || !entry.workspace) continue;
    for (const record of listActions(entry.workspace)) {
      if (!isOpenAction(record.status)) continue;
      actions.push({ ...record, sessionId: entry.sessionId, sessionTitle: entry.sessionTitle || '' });
    }
  }
  actions.sort((a, b) => (a.createdAt > b.createdAt ? 1 : -1)); // oldest first
  const pendingCount = actions.reduce((n, a) => n + (a.status === 'proposed' ? 1 : 0), 0);
  return { pendingCount, actions };
}

/**
 * Move an action to nextStatus, enforcing the allowed-transition graph so a
 * terminal action can never be re-decided or re-executed. Throws 409 on an
 * illegal transition. `patch` merges extra fields (decidedAt, result, …).
 */
export function transitionAction(workspace, id, nextStatus, patch = {}) {
  const record = readAction(workspace, id);
  if (!record) {
    const err = new Error('Action not found.');
    err.statusCode = 404;
    throw err;
  }
  const allowed = ALLOWED_TRANSITIONS[record.status];
  if (!allowed || !allowed.has(nextStatus)) {
    const err = new Error(`Cannot move an action from "${record.status}" to "${nextStatus}".`);
    err.statusCode = 409;
    throw err;
  }
  const result = patch.result !== undefined ? clampResult(patch.result) : record.result;
  const updated = { ...record, ...patch, result, status: nextStatus };
  atomicWriteJson(actionPath(workspace, id), updated);
  return updated;
}

/** Keep persisted execution output bounded so action files stay small. */
function clampResult(result) {
  if (!result || typeof result !== 'object') return result;
  const out = { ...result };
  if (typeof out.stdout === 'string' && out.stdout.length > MAX_RESULT_STDOUT) {
    out.stdout = `${out.stdout.slice(0, MAX_RESULT_STDOUT)}\n…[truncated]`;
  }
  if (typeof out.stderr === 'string' && out.stderr.length > MAX_RESULT_STDOUT) {
    out.stderr = `${out.stderr.slice(0, MAX_RESULT_STDOUT)}\n…[truncated]`;
  }
  return out;
}

/**
 * Render the <pending-actions> context block injected into each turn so the
 * model sees the live status of everything it proposed — "the source of truth
 * for whether a proposed action actually happened." Returns '' when there are
 * none (nothing to inject).
 */
export function renderPendingActionsBlock(workspace) {
  const actions = listActions(workspace);
  if (!actions.length) return '';
  const lines = actions.map((a) => {
    const parts = [`- [${a.status}] ${a.capabilityId} — ${a.label}`];
    if (a.result?.error) parts.push(`    result: error — ${a.result.error}`);
    else if (a.status === 'verified') parts.push('    result: executed and confirmed by read-back');
    else if (a.status === 'verification_failed') parts.push(`    result: accepted but NOT confirmed — ${a.verification?.detail || 'desired state not observed on read-back'}`);
    else if (a.status === 'executed') parts.push('    result: executed (accepted; no read-back verifier for this capability)');
    return parts.join('\n');
  });
  return [
    '<pending-actions>',
    'These are write actions you proposed via ./propose-action. Their status here is',
    'the source of truth for whether the change actually happened.',
    'A write is CONFIRMED only when it shows "verified" (read-back observed the desired',
    'state) or "executed" (accepted; this capability has no read-back verifier — treat as',
    'accepted, not confirmed). "verification_failed" means the appliance accepted the write',
    'but the desired state was NOT observed on read-back — do not claim success; investigate',
    'or re-propose. "expired" means the proposal aged out unapproved; re-propose if still needed.',
    'Never tell the user an action succeeded unless it shows "verified" or "executed". Do not',
    're-propose an action that is already proposed, approved, executing, verifying, executed,',
    'or verified. A "rejected", "failed", "verification_failed", or "expired" action may be',
    're-proposed only if you have a corrected approach.',
    ...lines,
    '</pending-actions>',
  ].join('\n');
}
