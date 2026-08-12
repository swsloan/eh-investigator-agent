// Attended approval prompt (#137). When a write is proposed while the user has
// the session on screen (the record arrives stamped presence: 'attended'), the
// delivery escalates from a passive tray badge to a prompt at proposal time —
// they are right there, so ask. The modal reuses the shared action card, so
// approve/reject (including the destructive type-to-confirm and the
// session-busy gate) behave exactly as they do in the tray; dismissing it just
// defers the decision back to the tray. Unattended proposals never open this —
// they follow the tray + notification path and can never block anything.
import { $ } from './dom.js';
import { state } from './state.js';
import { actionCard, applyActionEvent } from './actions.js';

const promptIds = new Set(); // ids of proposals currently being prompted
let lastFocused = null;

export function isActionPromptOpen() {
  return !$('action-prompt-modal')?.classList.contains('hidden');
}

export function closeActionPrompt() {
  promptIds.clear();
  const modal = $('action-prompt-modal');
  if (modal && !modal.classList.contains('hidden')) {
    modal.classList.add('hidden');
    if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
  }
  lastFocused = null;
}

/** Open (or extend) the prompt for an attended proposal in the active session. */
export function maybePromptForAction(action) {
  if (!action || action.status !== 'proposed' || action.presence !== 'attended') return;
  if (state.replaying) return;
  if (!state.session || (action.sessionId && action.sessionId !== state.session.id)) return;
  if (!isActionPromptOpen()) lastFocused = document.activeElement;
  promptIds.add(action.id);
  renderActionPrompt();
  if (promptIds.size) {
    $('action-prompt-modal')?.classList.remove('hidden');
    $('action-prompt-close')?.focus();
  }
}

/** Reflect a decided/updated action into the prompt; close it when empty. */
export function updateActionPrompt(action) {
  if (!action || !promptIds.has(action.id)) return;
  if (action.status !== 'proposed') promptIds.delete(action.id);
  if (!promptIds.size) { closeActionPrompt(); return; }
  renderActionPrompt();
}

/** Re-render the open prompt (e.g. the turn ended, so buttons become usable). */
export function refreshActionPrompt() {
  if (isActionPromptOpen()) renderActionPrompt();
}

function renderActionPrompt() {
  const body = $('action-prompt-body');
  if (!body) return;
  // state.actions is authoritative — drop anything decided or expired elsewhere.
  const actions = (state.actions || []).filter((a) => promptIds.has(a.id) && a.status === 'proposed');
  for (const id of [...promptIds]) {
    if (!actions.some((a) => a.id === id)) promptIds.delete(id);
  }
  if (!actions.length) { closeActionPrompt(); return; }
  const note = $('action-prompt-note');
  if (note) {
    note.textContent = state.running
      ? 'The agent proposed a change and is still working. Review it now — you can decide as soon as the turn finishes.'
      : 'The agent proposed a change. Nothing runs until you approve it here or in the tray.';
  }
  body.replaceChildren(...actions.map((action) => actionCard(action, {
    sessionRunning: state.running,
    onResult: (updated) => {
      applyActionEvent({ action: updated });
      updateActionPrompt(updated);
    },
  })));
}

export function initActionPrompt() {
  $('action-prompt-close')?.addEventListener('click', closeActionPrompt);
}
