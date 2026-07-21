import { BoundedLruCache } from './bounded-lru.js';

export function newUsage() {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0 };
}

/** Snapshot of which session (and which visit to it) an async request belongs to. */
export function captureSessionScope() {
  if (!state.session) return null;
  return { sessionId: state.session.id, sessionGeneration: state.sessionGeneration };
}

/** False once the user has switched away from the session a request started in. */
export function isCurrentSessionScope(scope) {
  return Boolean(scope)
    && state.session?.id === scope.sessionId
    && state.sessionGeneration === scope.sessionGeneration;
}

export const state = {
  session: null,
  // Bumped on every session switch. In-flight async work captures the value it
  // started with and discards its result if the counter has moved on, so a slow
  // response from the previously viewed session can't overwrite the new one.
  sessionGeneration: 0,
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
  // Evidence summaries are large and previously accumulated for the life of the
  // page. Bounded by entry count and total bytes so browsing a long
  // investigation cannot grow this without limit.
  summaryCache: new BoundedLruCache({ maxEntries: 24, maxBytes: 4 * 1024 * 1024 }),
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
