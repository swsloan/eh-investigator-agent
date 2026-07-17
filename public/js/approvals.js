// Cross-session approval dashboard (issue #13).
// A header badge shows the number of write actions awaiting approval across ALL
// sessions; clicking it opens a panel to review/approve/reject them without
// leaving the current session. Backed by GET /api/actions/pending (index-served)
// and driven in real time by the global GET /api/actions/stream SSE channel
// (Phase B). Phase C adds staleness/age surfacing, a session-busy indicator (via
// the shared card), opt-in desktop notifications, and accessibility polish.
import { listPendingActions, listSessions } from './api.js';
import { $ } from './dom.js';
import { actionCard } from './actions.js';
import { switchSession } from './sessions.js';

const FALLBACK_POLL_MS = 60000;
const AGE_REFRESH_MS = 30000; // re-render while open so relative ages/staleness update
const NOTIFY_PREF_KEY = 'eh-approvals-notify';

let stream = null;
let fallbackTimer = null;
let ageTimer = null;
let lastData = { pendingCount: 0, actions: [] };
let lastFocused = null;
let notifyEnabled = false;
let primedCount = false;
let prevPending = 0;

export function isApprovalsOpen() {
  return !$('approvals-modal')?.classList.contains('hidden');
}

export function closeApprovals() {
  $('approvals-modal')?.classList.add('hidden');
  if (ageTimer) { clearInterval(ageTimer); ageTimer = null; }
  if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus(); // C5: restore focus
}

function openApprovals() {
  lastFocused = document.activeElement; // C5: remember to restore on close
  $('approvals-modal')?.classList.remove('hidden');
  renderApprovalsBody(lastData);
  $('approvals-close')?.focus(); // C5: move focus into the dialog
  refreshApprovals(); // freshen on open
  // C1: keep ages fresh while the panel stays open.
  if (ageTimer) clearInterval(ageTimer);
  ageTimer = setInterval(() => { if (isApprovalsOpen()) renderApprovalsBody(lastData); }, AGE_REFRESH_MS);
}

let refreshSeq = 0;

/** Fetch the cross-session aggregate; update the badge and (if open) the panel.
 *  Burst SSE pokes can overlap fetches — a sequence guard discards a superseded
 *  (stale) response so it can't restore an older count/list over a newer one. */
export async function refreshApprovals() {
  const seq = ++refreshSeq;
  let data;
  try {
    data = await listPendingActions();
  } catch {
    data = { pendingCount: 0, actions: [] };
  }
  if (seq !== refreshSeq) return; // a newer refresh started; drop this stale result
  lastData = data;
  updateBadge(lastData.pendingCount);
  if (isApprovalsOpen()) renderApprovalsBody(lastData);
}

function updateBadge(count) {
  const el = $('approvals-count');
  if (el) {
    el.textContent = String(count);
    el.classList.toggle('hidden', !count);
  }
  const btn = $('approvals-btn');
  if (btn) {
    btn.classList.toggle('has-pending', !!count);
    btn.setAttribute('aria-label', count // C5: screen-reader label
      ? `${count} approval${count === 1 ? '' : 's'} awaiting review`
      : 'Pending approvals (none)');
  }
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
      section.append(actionCard(action, { onResult: () => refreshApprovals(), showAge: true }));
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

// ---- C4: opt-in desktop notifications for new approvals ----
function notifySupported() {
  return typeof window !== 'undefined' && 'Notification' in window;
}

function reflectNotifyToggle() {
  const btn = $('approvals-notify');
  if (!btn) return;
  btn.classList.toggle('on', notifyEnabled);
  btn.setAttribute('aria-pressed', String(notifyEnabled));
  btn.title = notifyEnabled ? 'Desktop notifications on' : 'Notify me of new approvals';
}

async function toggleNotify() {
  if (!notifySupported()) return;
  if (notifyEnabled) {
    notifyEnabled = false;
    localStorage.setItem(NOTIFY_PREF_KEY, '0');
  } else {
    let perm = Notification.permission;
    if (perm === 'default') { try { perm = await Notification.requestPermission(); } catch { perm = 'denied'; } }
    notifyEnabled = perm === 'granted';
    localStorage.setItem(NOTIFY_PREF_KEY, notifyEnabled ? '1' : '0');
  }
  reflectNotifyToggle();
}

function maybeNotify(count) {
  if (!primedCount) { primedCount = true; prevPending = count; return; } // don't fire on first load
  const increased = count > prevPending;
  prevPending = count;
  if (!increased || !notifyEnabled || !notifySupported() || Notification.permission !== 'granted') return;
  if (!document.hidden) return; // only when the tab isn't focused
  try {
    const n = new Notification('ExtraHop — approval needed', {
      body: `${count} write action${count === 1 ? '' : 's'} awaiting your review.`,
      tag: 'eh-approvals', // collapse duplicates
    });
    n.onclick = () => { window.focus(); n.close(); };
  } catch { /* notification may be blocked */ }
}

// ---- Stream + reconnect state (C5) ----
function setStreamState(connected) {
  const status = $('approvals-status');
  if (status) status.classList.toggle('hidden', connected);
}

function onStreamMessage(ev) {
  let msg;
  try { msg = JSON.parse(ev.data); } catch { return; }
  if (typeof msg.pendingCount === 'number') {
    updateBadge(msg.pendingCount);
    maybeNotify(msg.pendingCount);
  }
  // The stream carries only the count; the panel (when open) needs the full list.
  if (isApprovalsOpen()) refreshApprovals();
}

function connectStream() {
  try { stream?.close(); } catch { /* ignore */ }
  stream = new EventSource('/api/actions/stream'); // auto-reconnects on error
  stream.onmessage = onStreamMessage;
  stream.onopen = () => setStreamState(true);
  stream.onerror = () => setStreamState(false);
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
  const notifyBtn = $('approvals-notify');
  if (notifyBtn) {
    if (!notifySupported()) notifyBtn.classList.add('hidden');
    else {
      notifyEnabled = localStorage.getItem(NOTIFY_PREF_KEY) === '1' && Notification.permission === 'granted';
      reflectNotifyToggle();
      notifyBtn.addEventListener('click', toggleNotify);
    }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshApprovals();
  });
  connectStream();
  startFallbackPoll();
  refreshApprovals(); // initial load (the stream snapshot also updates the badge)
}
