import { getBackendUpdate, runBackendUpdate } from './api.js';
import { dom } from './dom.js';
import { state } from './state.js';
import { refreshPreflight } from './status.js';

let updateDialog = null;

function renderBadge(status) {
  state.backendUpdate = status || null;
  const available = Boolean(status?.updateAvailable || status?.status === 'updating');
  dom.backendUpdateBadge.classList.toggle('hidden', !available);
  dom.backendUpdateBadge.disabled = status?.status === 'updating';
  dom.backendUpdateBadge.classList.toggle('updating', status?.status === 'updating');
  dom.backendUpdateText.textContent = status?.status === 'updating'
    ? `Updating ${status.backend?.label || 'backend'}…`
    : `${status?.backend?.label || 'Backend'} update available`;
  dom.backendUpdateBadge.title = status?.message || '';
}

export async function refreshBackendUpdate(options = {}) {
  try {
    renderBadge(await getBackendUpdate(options));
  } catch {
    renderBadge(null); // Update availability is advisory; readiness remains authoritative.
  }
}

export function isBackendUpdateDialogOpen() {
  return Boolean(updateDialog);
}

export function closeBackendUpdateDialog() {
  updateDialog?.close();
}

function showBackendUpdateDialog(status) {
  closeBackendUpdateDialog();
  const overlay = document.createElement('div');
  overlay.className = 'modal backend-update-modal';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'backend-update-title');

  const card = document.createElement('div');
  card.className = 'modal-card confirm-card backend-update-card';
  card.innerHTML = `
    <div class="modal-head"><span id="backend-update-title"></span></div>
    <div class="confirm-body">
      <p class="backend-update-summary"></p>
      <div class="backend-update-versions">
        <span>Installed <strong class="backend-update-installed"></strong></span>
        <span>Available <strong class="backend-update-latest"></strong></span>
      </div>
      <p class="backend-update-guidance"></p>
      <code class="backend-update-command"></code>
      <p class="backend-update-note hidden"></p>
      <div class="confirm-status backend-update-status" aria-live="polite"></div>
    </div>
    <div class="modal-foot confirm-actions">
      <button type="button" class="btn-secondary slim backend-update-cancel">Cancel</button>
      ${status.managed ? '<button type="button" class="btn-primary slim backend-update-action"></button>' : ''}
    </div>`;
  card.querySelector('#backend-update-title').textContent = `${status.backend.label} update available`;
  card.querySelector('.backend-update-summary').textContent = status.managed
    ? `The Investigator can update ${status.backend.label} in the background and reconnect it automatically.`
    : `Update ${status.backend.label} from a terminal using the command below.`;
  card.querySelector('.backend-update-installed').textContent = status.installedVersion;
  card.querySelector('.backend-update-latest').textContent = status.latestVersion;
  card.querySelector('.backend-update-guidance').textContent = status.managed
    ? 'Any idle Pi harness processes will be stopped first. Active investigations must finish before the update can begin.'
    : 'The Investigator will not run this command for Claude Code.';
  card.querySelector('.backend-update-command').textContent = status.command;
  const note = card.querySelector('.backend-update-note');
  if (status.note) {
    note.textContent = status.note;
    note.classList.remove('hidden');
  }

  const cancelBtn = card.querySelector('.backend-update-cancel');
  const actionBtn = card.querySelector('.backend-update-action');
  const statusEl = card.querySelector('.backend-update-status');
  let completed = false;
  overlay.appendChild(card);
  document.body.appendChild(overlay);

  const cleanup = () => {
    overlay.remove();
    updateDialog = null;
  };
  updateDialog = { close: () => { if (!actionBtn.disabled) cleanup(); } };
  cancelBtn.addEventListener('click', cleanup);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay && !actionBtn.disabled) cleanup();
  });

  if (!status.managed) {
    cancelBtn.textContent = 'Close';
  } else {
    actionBtn.textContent = `Update ${status.backend.label}`;
    actionBtn.addEventListener('click', async () => {
      if (completed) {
        cleanup();
        return;
      }
      cancelBtn.disabled = true;
      actionBtn.disabled = true;
      statusEl.classList.remove('error');
      statusEl.textContent = `Updating ${status.backend.label}… Keep this window open.`;
      renderBadge({ ...status, status: 'updating' });
      let result;
      try {
        result = await runBackendUpdate();
      } catch (err) {
        result = { ok: false, data: { error: `Could not reach the local app: ${err.message}` } };
      }
      const { ok, data } = result;
      if (!ok) {
        cancelBtn.disabled = false;
        actionBtn.disabled = false;
        statusEl.textContent = data.error || `Could not update ${status.backend.label}.`;
        statusEl.classList.add('error');
        renderBadge(data.updateAvailable === false ? null : { ...status, status: 'available' });
        return;
      }
      delete state.catalogs[status.backend.id];
      renderBadge(null);
      refreshPreflight();
      statusEl.textContent = data.message || `${status.backend.label} was updated and will reconnect on the next turn.`;
      cancelBtn.classList.add('hidden');
      actionBtn.disabled = false;
      actionBtn.textContent = 'Close';
      completed = true;
    });
  }
  requestAnimationFrame(() => cancelBtn.focus());
}

export function initBackendUpdate() {
  dom.backendUpdateBadge.addEventListener('click', () => {
    if (state.backendUpdate?.updateAvailable) showBackendUpdateDialog(state.backendUpdate);
  });
}
