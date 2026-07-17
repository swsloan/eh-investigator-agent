// Cross-session approval dashboard (issue #13, Phase A — MVP).
// A header badge shows the number of write actions awaiting approval across ALL
// sessions; clicking it opens a panel to review/approve/reject them without
// leaving the current session. Backed by GET /api/actions/pending (index-served)
// and driven in real time by the global GET /api/actions/stream SSE channel
// (Phase B): the stream pushes the pending count on every action change so the
// badge updates instantly; the panel re-fetches the full list on a poke. A slow
// poll runs only as a reconnect safety net.
import { listPendingActions, listSessions } from './api.js';
import { $ } from './dom.js';
import { actionCard } from './actions.js';
import { switchSession } from './sessions.js';

const FALLBACK_POLL_MS = 60000;
let stream = null;
let fallbackTimer = null;
let lastData = { pendingCount: 0, actions: [] };

export function isApprovalsOpen() {
  return !$('approvals-modal')?.classList.contains('hidden');
}

export function closeApprovals() {
  $('approvals-modal')?.classList.add('hidden');
}

function openApprovals() {
  $('approvals-modal')?.classList.remove('hidden');
  renderApprovalsBody(lastData);
  refreshApprovals(); // freshen on open
}

/** Fetch the cross-session aggregate; update the badge and (if open) the panel. */
export async function refreshApprovals() {
  try {
    lastData = await listPendingActions();
  } catch {
    lastData = { pendingCount: 0, actions: [] };
  }
  updateBadge(lastData.pendingCount);
  if (isApprovalsOpen()) renderApprovalsBody(lastData);
}

function updateBadge(count) {
  const el = $('approvals-count');
  if (!el) return;
  el.textContent = String(count);
  el.classList.toggle('hidden', !count);
  $('approvals-btn')?.classList.toggle('has-pending', !!count);
}

function renderApprovalsBody(data) {
  const body = $('approvals-body');
  if (!body) return;
  const actions = data?.actions || [];
  if (!actions.length) {
    body.replaceChildren(el('div', 'approvals-empty', 'No approvals waiting.'));
    return;
  }
  // Group by origin session, preserving oldest-first order within each group.
  const groups = new Map();
  for (const action of actions) {
    if (!groups.has(action.sessionId)) {
      groups.set(action.sessionId, { title: action.sessionTitle || 'Session', actions: [] });
    }
    groups.get(action.sessionId).actions.push(action);
  }

  const frag = document.createDocumentFragment();
  for (const [sessionId, group] of groups) {
    const section = el('div', 'approvals-group');
    const head = el('div', 'approvals-group-head');
    head.append(el('span', 'approvals-group-title', group.title));
    const open = el('button', 'approvals-open-session', 'Open session');
    open.type = 'button';
    open.addEventListener('click', () => openSession(sessionId));
    head.append(open);
    section.append(head);
    for (const action of group.actions) {
      section.append(actionCard(action, { onResult: () => refreshApprovals() }));
    }
    frag.append(section);
  }
  body.replaceChildren(frag);
}

async function openSession(sessionId) {
  closeApprovals();
  try {
    const sessions = await listSessions();
    const session = sessions.find((s) => s.id === sessionId);
    if (session) switchSession(session);
  } catch { /* best effort — the session may have been deleted */ }
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function onStreamMessage(ev) {
  let msg;
  try { msg = JSON.parse(ev.data); } catch { return; }
  if (typeof msg.pendingCount === 'number') updateBadge(msg.pendingCount);
  // The stream carries only the count; the panel (when open) needs the full list.
  if (isApprovalsOpen()) refreshApprovals();
}

function connectStream() {
  try { stream?.close(); } catch { /* ignore */ }
  stream = new EventSource('/api/actions/stream'); // auto-reconnects on error
  stream.onmessage = onStreamMessage;
}

// Safety net: only polls when the stream is not open (e.g. mid-reconnect).
function startFallbackPoll() {
  stopFallbackPoll();
  fallbackTimer = setInterval(() => {
    if (document.visibilityState === 'visible' && (!stream || stream.readyState !== 1)) refreshApprovals();
  }, FALLBACK_POLL_MS);
}

function stopFallbackPoll() {
  if (fallbackTimer) clearInterval(fallbackTimer);
  fallbackTimer = null;
}

export function initApprovals() {
  $('approvals-btn')?.addEventListener('click', openApprovals);
  $('approvals-close')?.addEventListener('click', closeApprovals);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshApprovals();
  });
  connectStream();
  startFallbackPoll();
  refreshApprovals(); // initial load (the stream snapshot also updates the badge)
}
