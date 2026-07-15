// Governed write path — the approval surface (Phase 4).
// Renders proposed write actions in a tray above the composer and lets the user
// approve or reject them. Populated from GET /api/actions on session switch (so
// pending approvals survive a reload) and updated live from action_* SSE events.
import { listActions, decideAction } from './api.js';
import { dom } from './dom.js';
import { state } from './state.js';

const TERMINAL = new Set(['executed', 'rejected', 'failed']);

const STATUS_LABEL = {
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

function actionCard(action) {
  const card = document.createElement('div');
  card.className = `action-card action-${action.status}`;
  card.dataset.actionId = action.id;

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
    card.appendChild(actionButtons(action, feedback));
  }
  return card;
}

function actionButtons(action, feedback) {
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
  reject.addEventListener('click', () => decide(action, 'reject', setBusy, feedback));
  approve.addEventListener('click', () => decide(action, 'approve', setBusy, feedback));
  row.append(reject, approve);
  return row;
}

async function decide(action, decision, setBusy, feedback) {
  if (!state.session) return;
  setBusy(true);
  feedback.classList.add('hidden');
  try {
    const { ok, data } = await decideAction(state.session.id, action.id, decision);
    if (ok && data?.action) {
      applyActionEvent({ action: data.action }); // re-renders; SSE will also confirm
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
