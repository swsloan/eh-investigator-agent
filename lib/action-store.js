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

export const ACTION_STATUSES = ['proposed', 'approved', 'executing', 'executed', 'rejected', 'failed'];

// A terminal status can never transition again (one-shot decisions).
const ALLOWED_TRANSITIONS = {
  proposed: new Set(['approved', 'rejected']),
  approved: new Set(['executing', 'failed']),
  executing: new Set(['executed', 'failed']),
  executed: new Set(),
  rejected: new Set(),
  failed: new Set(),
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
export function createAction(workspace, { sessionId, capabilityId, params, label, accessType = 'write', destructive = false }) {
  const id = crypto.randomUUID();
  const record = {
    id,
    sessionId,
    createdAt: new Date().toISOString(),
    status: 'proposed',
    capabilityId,
    params: params || {},
    label,
    accessType,
    destructive: Boolean(destructive),
    decidedAt: null,
    decidedBy: null,
    result: null,
  };
  fs.mkdirSync(actionsDir(workspace), { recursive: true, mode: 0o700 });
  atomicWriteJson(actionPath(workspace, id), record);
  return record;
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
    else if (a.status === 'executed') parts.push('    result: executed successfully');
    return parts.join('\n');
  });
  return [
    '<pending-actions>',
    'These are write actions you proposed via ./propose-action. Their status here is',
    'the source of truth for whether the change actually happened. Never tell the user',
    'an action succeeded unless it shows "executed". Do not re-propose an action that is',
    'already proposed, approved, executing, or executed. A "rejected" or "failed" action',
    'may be re-proposed only if you have a corrected approach.',
    ...lines,
    '</pending-actions>',
  ].join('\n');
}
