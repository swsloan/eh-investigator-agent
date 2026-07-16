// Governed write path — the approval surface (Phase 4 + Phase A dashboard).
// Renders proposed write actions in a tray above the composer and lets the user
// approve or reject them. Populated from GET /api/actions on session switch (so
// pending approvals survive a reload) and updated live from action_* SSE events.
// The card renderer + decide flow are exported so the cross-session approvals
// dashboard (approvals.js) reuses one implementation.
import { listActions, decideAction } from './api.js';
import { dom } from './dom.js';
import { state } from './state.js';

const TERMINAL = new Set(['executed', 'rejected', 'failed']);

export const STATUS_LABEL = {
  proposed: 'Awaiting approval',
  approved: 'Approved',
  executing: 'Executing…',
  executed: 'Executed',
  rejected: 'Rejected',
  failed: 'Failed',
};

function pendingCount(actions) {
  return actions.filter((a) => a.status === 'proposed').length;
}

/** Fetch and render the active session's actions. Guards against a late response
 *  arriving after the user switched sessions. */
export async function refreshActions(sessionId) {
  if (!sessionId) { state.actions = []; renderActionsTray(); return; }
  let actions = [];
  try {
    actions = await listActions(sessionId);
  } catch { /* leave empty */ }
  if (!state.session || state.session.id !== sessionId) return; // switched away
  state.actions = Array.isArray(actions) ? actions : [];
  renderActionsTray();
}

/** Apply a single live action event (proposed / decided / result) to the list. */
export function applyActionEvent(ev) {
  const action = ev?.action;
  if (!action) return;
  // Only reflect events for the session currently on screen.
  if (!state.session || (action.sessionId && action.sessionId !== state.session.id)) return;
  const idx = state.actions.findIndex((a) => a.id === action.id);
  if (idx === -1) state.actions.unshift(action);
  else state.actions[idx] = action;
  renderActionsTray();
}

export function clearActionsTray() {
  state.actions = [];
  renderActionsTray();
}

function renderActionsTray() {
  const tray = dom.actionsTray;
  if (!tray) return;
  const actions = state.actions || [];
  if (!actions.length) {
    tray.classList.add('hidden');
    tray.replaceChildren();
    return;
  }
  tray.classList.remove('hidden');
  const pending = pendingCount(actions);

  const head = document.createElement('div');
  head.className = 'actions-tray-head';
  head.textContent = pending
    ? `${pending} change${pending === 1 ? '' : 's'} awaiting your approval`
    : 'Proposed changes';

  const list = document.createElement('div');
  list.className = 'actions-tray-list';
  for (const action of actions) list.appendChild(actionCard(action));

  tray.replaceChildren(head, list);
}

/**
 * Render one action as a card. `onResult(updatedAction)` fires after a decide
 * (default: reflect it into the in-chat tray). The dashboard passes its own
 * handler. `showSession` prepends the origin session's title (cross-session view).
 */
export function actionCard(action, { onResult, showSession = false } = {}) {
  const card = document.createElement('div');
  card.className = `action-card action-${action.status}`;
  card.dataset.actionId = action.id;

  if (showSession && action.sessionTitle) {
    const origin = document.createElement('div');
    origin.className = 'action-origin';
    origin.textContent = action.sessionTitle;
    card.appendChild(origin);
  }

  const headRow = document.createElement('div');
  headRow.className = 'action-head';
  const badge = document.createElement('span');
  badge.className = `action-badge badge-${action.status}`;
  badge.textContent = STATUS_LABEL[action.status] || action.status;
  const cap = document.createElement('code');
  cap.className = 'action-cap';
  cap.textContent = action.capabilityId;
  headRow.append(badge, cap);
  if (action.destructive) {
    const destructive = document.createElement('span');
    destructive.className = 'action-destructive';
    destructive.textContent = 'destructive';
    headRow.appendChild(destructive);
  }

  const label = document.createElement('div');
  label.className = 'action-label';
  label.textContent = action.label || '';

  const params = document.createElement('details');
  params.className = 'action-params';
  const summary = document.createElement('summary');
  summary.textContent = 'Parameters';
  const pre = document.createElement('pre');
  pre.textContent = JSON.stringify(action.params || {}, null, 2);
  params.append(summary, pre);

  card.append(headRow, label, params);

  const errText = action.result?.error;
  if (errText) {
    const err = document.createElement('div');
    err.className = 'action-error';
    err.textContent = errText;
    card.appendChild(err);
  }

  const feedback = document.createElement('div');
  feedback.className = 'action-feedback hidden';
  card.appendChild(feedback);

  if (action.status === 'proposed') {
    card.appendChild(actionButtons(action, feedback, onResult));
  }
  return card;
}

function actionButtons(action, feedback, onResult) {
  const row = document.createElement('div');
  row.className = 'action-buttons';
  const reject = document.createElement('button');
  reject.type = 'button';
  reject.className = 'action-btn action-reject';
  reject.textContent = 'Reject';
  const approve = document.createElement('button');
  approve.type = 'button';
  approve.className = 'action-btn action-approve';
  approve.textContent = 'Approve & run';
  const setBusy = (on) => { reject.disabled = on; approve.disabled = on; };
  reject.addEventListener('click', () => decide(action, 'reject', setBusy, feedback, onResult));
  approve.addEventListener('click', () => decide(action, 'approve', setBusy, feedback, onResult));
  row.append(reject, approve);
  return row;
}

/**
 * Approve/reject an action. Keys off the action's OWN sessionId so it works from
 * both the in-chat tray (active session) and the cross-session dashboard.
 * `onResult` defaults to reflecting the outcome into the tray.
 */
async function decide(action, decision, setBusy, feedback, onResult = (a) => applyActionEvent({ action: a })) {
  const sessionId = action.sessionId || state.session?.id;
  if (!sessionId) return;
  setBusy(true);
  feedback.classList.add('hidden');
  try {
    const { ok, data } = await decideAction(sessionId, action.id, decision);
    if (ok && data?.action) {
      onResult(data.action);
      return;
    }
    showFeedback(feedback, data?.error || 'Could not complete that action.');
  } catch {
    showFeedback(feedback, 'Network error — try again.');
  }
  setBusy(false);
}

function showFeedback(feedback, message) {
  feedback.textContent = message;
  feedback.classList.remove('hidden');
}
