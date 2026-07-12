import { listSessions } from './api.js';
import { initComposer } from './composer.js';
import { dom } from './dom.js';
import { initEval } from './eval.js';
import { closeMemory, initMemory, isMemoryOpen } from './memory.js';
import {
  closeDownloadMenu,
  closeViewer,
  initFileViewer,
  isDownloadMenuOpen,
  isViewerOpen,
  refreshFiles,
  refreshThemedReportPreview,
} from './files.js';
import {
  closeActiveCustomSelect,
  closeActiveModelCombo,
  closeSessionModelModal,
  closeSettings,
  hasActiveCustomSelect,
  hasActiveModelCombo,
  initSettings,
  refreshBackendInfo,
  refreshSettingsState,
} from './settings.js';
import { initSessionStream } from './sse.js';
import {
  closeSessionMenu,
  hasOpenSessionMenu,
  initSessionMenus,
  loadSessions,
  newSession,
  switchSession,
} from './sessions.js';
import { refreshPreflight } from './status.js';
import { initTheme } from './theme.js';

function initEscapeHandling() {
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (isDownloadMenuOpen()) closeDownloadMenu();
    else if (isMemoryOpen()) closeMemory();
    else if (hasOpenSessionMenu()) closeSessionMenu();
    else if (isViewerOpen()) closeViewer();
    else if (hasActiveCustomSelect()) closeActiveCustomSelect();
    else if (hasActiveModelCombo()) closeActiveModelCombo();
    else if (!dom.sessionModelModal.classList.contains('hidden')) closeSessionModelModal();
    else closeSettings();
  });
}

async function boot() {
  refreshPreflight();
  refreshBackendInfo();
  try { await refreshSettingsState(); } catch { /* settings modal will surface save/load errors later */ }
  const list = await listSessions();
  if (list.length) {
    switchSession(list.sort((a, b) => b.createdAt - a.createdAt)[0]);
  } else {
    await newSession();
  }
}

export function startApp() {
  initTheme({ refreshPreview: refreshThemedReportPreview });
  initFileViewer();
  initSettings();
  initComposer();
  initSessionStream({ refreshFiles, loadSessions });
  initSessionMenus();
  initEval();
  initMemory();
  initEscapeHandling();
  boot();
}

startApp();
