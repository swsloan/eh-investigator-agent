import { createSession, deleteSession, listSessions, renameSession, setSessionSaved } from './api.js';
import { openPromoteDialog } from './eval.js';
import { resetStreamRendering, setHasMessages, updateUsage } from './chat.js';
import { $, dom } from './dom.js';
import { closeViewer, refreshFiles } from './files.js';
import { clearActionsTray, refreshActions } from './actions.js';
import { connect } from './sse.js';
import { newUsage, state } from './state.js';

const MENU_SVG = `
  <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
    <circle cx="12" cy="5" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="12" cy="19" r="1.7"/>
  </svg>`;

let deleteDialog = null;

export function closeSessionMenu() {
  if (!state.openSessionMenu) return;
  state.openSessionMenu.remove();
  state.openSessionMenu = null;
}

export function hasOpenSessionMenu() {
  return Boolean(state.openSessionMenu);
}

async function handleRename(session, item) {
  closeSessionMenu();
  const titleEl = item.querySelector('.session-title');
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'session-rename-input';
  input.value = session.title;
  input.maxLength = 120;
  titleEl.replaceWith(input);
  input.focus();
  input.select();

  let done = false;
  const finish = async (commit) => {
    if (done) return;
    done = true;
    const title = input.value.trim();
    if (commit && title && title !== session.title) {
      const { ok, data } = await renameSession(session.id, title);
      if (ok) {
        session.title = data.session?.title || title;
        if (state.session?.id === session.id) state.session.title = session.title;
      }
    }
    loadSessions();
  };
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') finish(true);
    else if (event.key === 'Escape') finish(false);
    event.stopPropagation();
  });
  input.addEventListener('blur', () => finish(true));
  input.addEventListener('click', (event) => event.stopPropagation());
}

function showDeleteSessionDialog(session) {
  if (deleteDialog) deleteDialog.close(false);

  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal session-delete-modal';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'session-delete-title');

    const card = document.createElement('div');
    card.className = 'modal-card confirm-card';
    card.innerHTML = `
      <div class="modal-head">
        <span id="session-delete-title">Delete session</span>
      </div>
      <div class="confirm-body">
        <p>This removes the conversation and workspace files for <strong class="confirm-session-name"></strong>.</p>
        <p class="confirm-warning">This cannot be undone.</p>
        <div class="confirm-status" aria-live="polite"></div>
      </div>
      <div class="modal-foot confirm-actions">
        <button type="button" class="btn-secondary slim confirm-cancel">Cancel</button>
        <button type="button" class="btn-danger slim confirm-delete">Delete session</button>
      </div>`;
    card.querySelector('.confirm-session-name').textContent = session.title || 'this session';
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    const cancelBtn = card.querySelector('.confirm-cancel');
    const deleteBtn = card.querySelector('.confirm-delete');
    const status = card.querySelector('.confirm-status');

    const cleanup = (result) => {
      document.removeEventListener('keydown', onKeydown);
      overlay.removeEventListener('click', onOverlayClick);
      overlay.remove();
      deleteDialog = null;
      resolve(result);
    };
    const onKeydown = (event) => {
      if (event.key === 'Escape') cleanup(false);
    };
    const onOverlayClick = (event) => {
      if (event.target === overlay) cleanup(false);
    };
    deleteDialog = { close: cleanup };

    cancelBtn.addEventListener('click', () => cleanup(false));
    deleteBtn.addEventListener('click', async () => {
      cancelBtn.disabled = true;
      deleteBtn.disabled = true;
      status.textContent = 'Deleting...';
      const { ok, data } = await deleteSession(session.id);
      if (!ok) {
        cancelBtn.disabled = false;
        deleteBtn.disabled = false;
        status.textContent = data.error || 'Could not delete the session.';
        status.classList.add('error');
        return;
      }
      cleanup(true);
    });
    overlay.addEventListener('click', onOverlayClick);
    document.addEventListener('keydown', onKeydown);
    requestAnimationFrame(() => cancelBtn.focus());
  });
}

async function handleToggleSaved(session) {
  closeSessionMenu();
  const { ok } = await setSessionSaved(session.id, !session.saved);
  if (ok) loadSessions();
}

async function handleDelete(session) {
  closeSessionMenu();
  const deleted = await showDeleteSessionDialog(session);
  if (!deleted) return;
  if (state.session?.id === session.id) {
    state.session = null;
    const remaining = (await listSessions()).sort((a, b) => b.createdAt - a.createdAt);
    if (remaining.length) switchSession(remaining[0]);
    else await newSession();
    return;
  }
  loadSessions();
}

function openSessionMenu(session, item, anchor) {
  const reopening = state.openSessionMenu?.dataset.sessionId === session.id;
  closeSessionMenu();
  if (reopening) return;
  const menu = document.createElement('div');
  menu.className = 'session-menu';
  menu.dataset.sessionId = session.id;
  menu.setAttribute('role', 'menu');
  for (const [label, handler] of [
    [session.saved ? 'Unsave' : 'Save for review', () => handleToggleSaved(session)],
    ['Rename', () => handleRename(session, item)],
    ['Promote to eval case', () => { closeSessionMenu(); openPromoteDialog(session); }],
    ['Delete', () => handleDelete(session)],
  ]) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('role', 'menuitem');
    btn.textContent = label;
    if (label === 'Delete') btn.classList.add('danger');
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      handler();
    });
    menu.appendChild(btn);
  }
  document.body.appendChild(menu);
  const rect = anchor.getBoundingClientRect();
  menu.style.top = `${Math.min(rect.bottom + 4, window.innerHeight - menu.offsetHeight - 8)}px`;
  menu.style.left = `${rect.left}px`;
  state.openSessionMenu = menu;
}

export async function loadSessions() {
  const list = await listSessions();
  // Saved-for-review sessions pin to the top, then most-recent first.
  const sorted = list.sort((a, b) => (Number(!!b.saved) - Number(!!a.saved)) || (b.createdAt - a.createdAt));
  const visible = sorted.slice(0, 100);
  const label = document.querySelector('.session-list-label');
  if (label) label.textContent = sorted.length > 100 ? `(100 of ${sorted.length} Sessions)` : 'Sessions';
  dom.sessionListEl.innerHTML = '';
  for (const session of visible) {
    const item = document.createElement('div');
    item.className = 'session-item' + (state.session && session.id === state.session.id ? ' active' : '') + (session.saved ? ' saved' : '');
    if (session.saved) {
      const star = document.createElement('span');
      star.className = 'session-star';
      star.textContent = '★';
      star.title = 'Saved for review';
      item.appendChild(star);
    }
    const title = document.createElement('span');
    title.className = 'session-title';
    title.textContent = session.title;
    item.title = session.title;
    item.appendChild(title);

    const menuBtn = document.createElement('button');
    menuBtn.type = 'button';
    menuBtn.className = 'session-menu-btn';
    menuBtn.title = 'Session options';
    menuBtn.setAttribute('aria-label', `Options for ${session.title}`);
    menuBtn.innerHTML = MENU_SVG;
    menuBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      openSessionMenu(session, item, menuBtn);
    });
    item.appendChild(menuBtn);

    item.addEventListener('click', () => switchSession(session));
    dom.sessionListEl.appendChild(item);
  }
}

function updateSessionFooter() {
  const footer = $('files-footer');
  if (footer) footer.textContent = state.session?.id || '';
}

function resetChatView() {
  dom.chatEl.querySelectorAll('.msg').forEach((el) => el.remove());
  dom.emptyState.classList.remove('hidden');
  resetStreamRendering();
  state.usage = newUsage();
  state.agentModel = null;
  state.sessionRequestedModel = '';
  state.sessionRequestedReasoning = '';
  state.sessionModelPinned = false;
  state.knownFiles = null;
  state.openDirs = new Set();
  setHasMessages(false);
  closeViewer();
  updateUsage();
  dom.filesList.innerHTML = '<div class="files-empty">No files yet. Upload evidence or ask the agent to produce a report.</div>';
}

export function switchSession(session) {
  if (state.session && session.id === state.session.id) return;
  closeSessionMenu();
  state.session = session;
  // Invalidate anything still in flight for the session we just left.
  state.sessionGeneration += 1;
  resetChatView();
  updateSessionFooter();
  state.sessionRequestedModel = session.model || '';
  state.sessionRequestedReasoning = session.reasoning || '';
  state.sessionModelPinned = !!session.modelPinned;
  state.agentModel = session.agentState?.model || null;
  updateUsage();
  clearActionsTray(); // drop the previous session's actions before fetching this one's
  connect(session.id);
  refreshFiles();
  refreshActions(session.id);
  loadSessions();
}

export async function newSession() {
  const session = await createSession();
  state.session = null;
  switchSession(session);
}

export function initSessionMenus() {
  document.addEventListener('click', (event) => {
    if (state.openSessionMenu && !state.openSessionMenu.contains(event.target)) closeSessionMenu();
  });
}
