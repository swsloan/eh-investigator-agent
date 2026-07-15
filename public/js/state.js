export function newUsage() {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0 };
}

export const state = {
  session: null,
  eventSource: null,
  running: false,
  idleStatus: { state: 'ok', text: 'Ready', title: 'Ready' },
  backendUpdate: null,
  replaying: false,
  pendingFiles: [],
  usage: newUsage(),
  agentModel: null,
  sessionRequestedModel: '',
  sessionRequestedReasoning: '',
  sessionModelPinned: false,
  knownFiles: null,
  workspaceFiles: new Map(),
  actions: [], // proposed write actions for the active session (governed write path)
  hasMessages: false,
  openDirs: new Set(),
  expandedHiddenDirs: new Set(),
  viewingPath: null,
  viewingIsHtml: false,
  viewingIsJson: false,
  viewingFile: null,
  summaryPaneLayout: 'split',
  evidenceDefaultView: 'rendered',
  webResearchProvider: '', // resolved provider from public settings: 'brave' | 'duckduckgo'
  summaryCache: new Map(),
  currentAgentMsg: null,
  pendingReplayAssistantBoundary: false,
  blocks: new Map(),
  toolCards: new Map(),
  challengerCards: new Map(),
  renderQueued: false,
  settingsFamily: 'enterprise',
  backend: null, // active backend info {id, label, defaultModelLabel, defaultModelMeta, reasoningLevels}
  backendOptions: [], // [{id, label, available, message}] for the settings picker
  settingsBackend: '', // backend whose prefs the settings modal is showing
  settingsPrefs: {}, // per-backend prefs sections from GET /api/settings
  settingsSnapshot: null, // last complete public settings response, reused when opening the modal
  appVersion: null, // {version, commit, dirty, display} from /api/health
  catalogs: {}, // backendId -> {backend, models, error, loaded}
  preflightChecks: [],
  wiresharkAvailable: false,
  activeModelCombo: null,
  activeCustomSelect: null,
  openSessionMenu: null,
  dragDepth: 0,
};
