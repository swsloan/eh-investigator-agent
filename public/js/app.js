import { listSessions } from './api.js';
import { initComposer } from './composer.js';
import { dom } from './dom.js';
import { initEval } from './eval.js';
import { initInvestigationPlan } from './plan-ribbon.js';
import { closeMemory, initMemory, isMemoryOpen } from './memory.js';
import { closeTopology, initTopology, isTopologyOpen } from './topology.js';
import {
  closeDownloadMenu,
  closeViewer,
  initFileViewer,
  isDownloadMenuOpen,
  isViewerOpen,
  openGeneratedHtmlViewer,
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
import { closeApprovals, initApprovals, isApprovalsOpen } from './approvals.js';
import { closeActionPrompt, initActionPrompt, isActionPromptOpen } from './action-prompt.js';
import { initTheme } from './theme.js';
import { closeBackendUpdateDialog, initBackendUpdate, isBackendUpdateDialogOpen, refreshBackendUpdate } from './backend-update.js';
import { initAuth } from './auth.js';
import { initActivity } from './activity.js';
import { initRightPanel, registerRpPanel } from './right-panel.js';

function initEscapeHandling() {
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (isBackendUpdateDialogOpen()) closeBackendUpdateDialog();
    else if (isActionPromptOpen()) closeActionPrompt(); // defers the decision to the tray
    else if (isApprovalsOpen()) closeApprovals();
    else if (isDownloadMenuOpen()) closeDownloadMenu();
    else if (isMemoryOpen()) closeMemory();
    else if (isTopologyOpen()) closeTopology();
    else if (isTopologyOpen()) closeTopology();
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
  refreshBackendUpdate();
  try { await refreshSettingsState(); } catch { /* settings modal will surface save/load errors later */ }
  const list = await listSessions();
  if (list.length) {
    switchSession(list.sort((a, b) => b.createdAt - a.createdAt)[0]);
  } else {
    await newSession();
  }
}

export function startApp() {
  initAuth();
  initTheme({ refreshPreview: refreshThemedReportPreview });
  initFileViewer();
  initInvestigationPlan({ openGeneratedHtml: openGeneratedHtmlViewer });
  initSettings();
  initComposer();
  initActivity();
  initSessionStream({ refreshFiles, loadSessions });
  initSessionMenus();
  initApprovals();
  initActionPrompt();
  initEval();
  initMemory();
  initTopology();
  // Files is a docked grid column rather than an overlay, so "opening" it is just
  // closing the two that are. Registered last, after the panels that own themselves.
  registerRpPanel('files', { open: () => {}, close: () => {} });
  initRightPanel();
  initBackendUpdate();
  initEscapeHandling();
  boot();
}

startApp();
