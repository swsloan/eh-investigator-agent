import express from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BACKENDS, detectBackends, getBackend, resolveBackendId } from './lib/backends/index.js';
import { createChallengerCoordinator } from './lib/challenger-coordinator.js';
import { createMemoryCoordinator } from './lib/memory-coordinator.js';
import { BackendUpdateManager } from './lib/backend-updates.js';
import { ExcliBroker } from './lib/excli-broker.js';
import { ActionBroker } from './lib/action-broker.js';
import { ActionIndex } from './lib/action-index.js';
import { listActionsAcrossWorkspaces } from './lib/action-store.js';
import { ReversingLabsBroker } from './lib/reversinglabs-broker.js';
import { ResearchBroker } from './lib/research-broker.js';
import { localOriginGuard } from './lib/local-origin.js';
import { redactText, redactValue } from './lib/redaction.js';
import { securityHeaders } from './lib/security-headers.js';
import { restoreSessionsFromWorkspaces } from './lib/session-store.js';
import {
  activateEnvSecrets, buildAgentEnv, credentialsConfigured,
  loadConfig, loadDotEnv, resolveConfig, reversingLabsEnabled, saveConfig,
} from './lib/settings.js';
import { createSecretStore } from './lib/secrets.js';
import { writeEmbedderEnv } from './lib/embedder-env.js';
import { runEvalInApp } from './lib/eval-runner.js';
import { runInjectionProbes } from './lib/injection-probe.js';
import { buildDashboard } from './eval/dashboard/build.js';
import { createFalkorClient } from './lib/falkor-client.js';
import { startDriftWatch } from './lib/memory-graph.js';
import { createMemoryLlmProxyHandler, resolveMemoryProxyConfig } from './lib/memory-llm-proxy.js';
import { evalRouter } from './routes/eval.js';
import { memoryGraphRouter } from './routes/memory-graph.js';
import { filesRouter } from './routes/files.js';
import { healthRouter } from './routes/health.js';
import { modelsRouter } from './routes/models.js';
import { sessionsRouter } from './routes/sessions.js';
import { settingsRouter } from './routes/settings.js';
import { actionsRouter } from './routes/actions.js';
import { backendUpdatesRouter } from './routes/backend-updates.js';

const ROOT = import.meta.dirname;
const WORKSPACES = path.join(ROOT, 'workspaces');
const BASE_PORT = Number(process.env.PORT || 3100);
const LISTEN_HOST = process.env.HOST || '127.0.0.1';
const PORT_STEP = 100;
const PORT_ATTEMPTS = 10;

const envFile = path.join(ROOT, '.env');
const secretStore = createSecretStore();
const envSecrets = loadDotEnv(envFile);

fs.mkdirSync(WORKSPACES, { recursive: true });

let config = loadConfig(undefined, {
  envConfig: envSecrets.extrahop,
  integrationConfig: envSecrets.integrations,
  secretStore,
});
activateEnvSecrets(secretStore, envSecrets.secrets, 'env');

function warnOnInsecureTls(settings) {
  if (settings.extrahop?.insecure) {
    console.warn('[security] WARNING: ExtraHop TLS certificate verification is disabled by explicit configuration.');
  }
  if (settings.integrations?.reversingLabs?.insecure) {
    console.warn('[security] WARNING: ReversingLabs TLS certificate verification is disabled by explicit configuration.');
  }
}
warnOnInsecureTls(config);

// Memory (Graphiti) is opt-in and can be toggled via env for headless/container
// installs, mirroring how ExtraHop creds accept env config.
if (process.env.MEMORY_ENABLED !== undefined) {
  config = { ...config, memory: { ...config.memory, enabled: /^(1|true|yes|on)$/i.test(process.env.MEMORY_ENABLED) } };
}
if (process.env.MEMORY_MCP_URL) {
  config = { ...config, memory: { ...config.memory, url: process.env.MEMORY_MCP_URL } };
}

/** MCP servers exposed to backends that support them (Claude Code today). */
function memoryMcpServers(settings) {
  if (!settings.memory?.enabled || !settings.memory?.url) return {};
  return { graphiti: { type: 'http', url: settings.memory.url } };
}

// First run with no backend chosen: adopt the sole installed backend, or the
// default. A configured-but-missing backend is never silently swapped —
// preflight reports it instead.
const availability = await detectBackends();
if (!config.backend) {
  config = { ...config, backend: resolveBackendId('', availability) };
  saveConfig(config);
}

/** The stored config flattened to the active backend's model preferences. */
const prefs = () => resolveConfig(config);
const activeBackend = () => getBackend(prefs().backend);

// Sync the app-managed embedder env file the Graphiti sidecar reads at startup,
// so a persisted embedder config is reflected even after a hand-edit of
// config.json. Best-effort; never fatal to boot.
writeEmbedderEnv(prefs().memory?.embedder);

const catalogs = new Map(); // backend id -> model catalog
function catalogFor(backendId) {
  if (!catalogs.has(backendId)) {
    catalogs.set(backendId, getBackend(backendId).createModelCatalog({ root: ROOT }));
  }
  return catalogs.get(backendId);
}

const sessions = new Map(); // id -> AgentSession subclass instance
const sseClients = new Map(); // sessionId -> Set<res>
const redact = (value) => redactValue(value, secretStore);
const excliBroker = new ExcliBroker({
  root: ROOT,
  sessions,
  getConfig: () => config,
  secretStore,
});
excliBroker.start();
// ReversingLabs Spectra Analyze enrichment. Same brokered-CLI pattern as excli:
// the broker holds the API token and serves the local `reversinglabs-interface`
// over a per-run unix socket; the token never enters the agent's env.
const reversingLabsBroker = new ReversingLabsBroker({
  root: ROOT,
  sessions,
  getConfig: () => config,
  secretStore,
});
reversingLabsBroker.start();
// Web research (Brave / DuckDuckGo). Always available — DuckDuckGo needs no
// account; the broker enforces the configured provider plus SSRF and
// secret/internal-host exfiltration guards. Secrets stay out of the agent env.
const researchBroker = new ResearchBroker({
  root: ROOT,
  sessions,
  getConfig: () => config,
  secretStore,
});
researchBroker.start();
// Governed write path: the agent proposes write actions here (read-only socket);
// a human approves them via /api/actions, and only then does the server-side
// executor run the write. Depends on excliBroker for the capability catalog and
// workspace resolution; emits SSE via broadcast.
const actionBroker = new ActionBroker({
  root: ROOT,
  excli: excliBroker,
  broadcast: (sessionId, event) => broadcast(sessionId, event),
});
actionBroker.start();
const challenger = createChallengerCoordinator({
  getConfig: prefs,
  getBackend: activeBackend,
  getModelCatalog: () => catalogFor(prefs().backend),
  secretStore,
});
const memory = createMemoryCoordinator({ getConfig: prefs });
// Backend self-update (managed backends only — e.g. Pi's `pi update --self`).
// Claude Code has no managed-update policy; it updates via its own SDK. A
// backend is "busy" while any session on it is actively running a turn.
const backendUpdates = new BackendUpdateManager({
  getActiveBackend: activeBackend,
  sessions,
  getModelCatalog: catalogFor,
  detectBackends,
  isBackendBusy: (backendId) => [...sessions.values()].some(
    (session) => session.backend === backendId && session.running,
  ),
});

// Cross-session approval dashboard (Phase B): an in-memory index of open actions
// + a global SSE fan-out, so the badge/panel update in real time without polling.
const globalActionClients = new Set(); // res objects subscribed to /api/actions/stream
const actionIndex = new ActionIndex();
const ACTION_EVENTS = new Set(['action_proposed', 'action_decided', 'action_result']);
// Resolve a session's current title, or null if it no longer exists (lets the
// index self-heal deleted sessions).
const actionSessionInfo = (id) => (sessions.has(id)
  ? { title: sessions.get(id).title || 'New session', running: !!sessions.get(id).running }
  : null);

function broadcast(sessionId, event) {
  const clients = sseClients.get(sessionId);
  if (clients) {
    const data = `data: ${JSON.stringify(redact(event))}\n\n`;
    for (const res of clients) res.write(data);
  }
  // Mirror action lifecycle events onto the global stream (all subscribers,
  // regardless of which session they're viewing).
  if (ACTION_EVENTS.has(event.type)) {
    actionIndex.apply(event.action);
    if (globalActionClients.size) {
      const { pendingCount } = actionIndex.snapshot(actionSessionInfo);
      const data = `data: ${JSON.stringify(redact({ type: 'action_changed', pendingCount }))}\n\n`;
      for (const res of globalActionClients) res.write(data);
    }
  }
}

/**
 * Create (or restore) a session. Restored sessions keep the backend stamped
 * into their state file — history lives inside that harness and cannot cross
 * over — while new sessions use the active backend.
 */

/**
 * Full session env: broker socket + memory config (buildAgentEnv), plus Claude
 * backend auth. 'apiKey' injects ANTHROPIC_API_KEY (secret store); 'subscription'
 * omits it and supplies CLAUDE_CODE_OAUTH_TOKEN (from `claude setup-token`) so
 * the headless container uses the Pro/Max plan. Centralized so every place that
 * (re)builds session env — createSession AND onConfigChanged — stays consistent.
 */
function buildSessionEnv(settings, backendId) {
  const env = buildAgentEnv(settings, {
    brokerSocketPath: excliBroker.socketPath,
    reversingLabsBrokerSocketPath: reversingLabsBroker.socketPath,
    reversingLabsEnabled: reversingLabsEnabled(settings, secretStore),
    researchBrokerSocketPath: researchBroker.socketPath,
    actionBrokerSocketPath: actionBroker.socketPath,
  });
  const secrets = secretStore.get?.() || {};
  const claudeSubscription = backendId === 'claude' && settings.claudeAuth === 'subscription';
  if (secrets.anthropicApiKey && !claudeSubscription) env.ANTHROPIC_API_KEY = secrets.anthropicApiKey;
  if (claudeSubscription && secrets.claudeOauthToken) env.CLAUDE_CODE_OAUTH_TOKEN = secrets.claudeOauthToken;
  return { env, claudeSubscription };
}

function createSession(id = crypto.randomUUID(), { backend: backendId } = {}) {
  const backend = getBackend(backendId) || activeBackend();
  const isActive = backend.id === prefs().backend;
  const settings = prefs();
  const { env: agentEnv, claudeSubscription } = buildSessionEnv(settings, backend.id);
  const session = new backend.Session(id, WORKSPACES, {
    model: (isActive && settings.mainModel) || undefined,
    thinking: (isActive && settings.mainReasoning) || undefined,
    modelPinned: false,
    env: agentEnv,
    subscriptionAuth: claudeSubscription,
    mcpServers: memoryMcpServers(settings),
    redact,
  });
  session.on('event', (event) => broadcast(id, event));
  challenger.attachSession(session);
  memory.attachSession(session);
  sessions.set(id, session);
  return session;
}

// Restore sessions persisted by previous runs, and backfill workspaces whose
// state file was lost. Backends may contribute richer recovery (Pi rebuilds
// from its JSONL history).
function recoverState(workspace, opts) {
  for (const backend of BACKENDS) {
    const state = backend.recoverSessionState?.(workspace, opts);
    if (state) return state;
  }
  return null;
}
restoreSessionsFromWorkspaces(WORKSPACES, createSession, { recoverState, redact });

// Seed the open-action index once from the restored sessions (source of truth is
// the file store; the index is kept current thereafter by the broadcast fan-out).
actionIndex.seed(listActionsAcrossWorkspaces(
  [...sessions.values()].map((s) => ({ sessionId: s.id, sessionTitle: s.title || 'New session', workspace: s.workspace })),
).actions);

/** One-shot throwaway backend call to name the session after its first message. */
async function generateTitle(session, userText) {
  if (session.titleGenerated) return;
  session.titleGenerated = true; // claim immediately; never retry-loop on failure
  const backend = getBackend(session.backend) || activeBackend();
  const settings = prefs();
  const model = settings.lightModel || backend.defaultLightModel || settings.mainModel;
  const reasoning = await catalogFor(backend.id).lowestReasoningForModel(model);
  const redactedUserText = redactText(userText.slice(0, 2000), secretStore);
  const prompt =
    'Summarize the following request as a session title of 3-6 plain words. ' +
    'Reply with ONLY the title — no quotes, no punctuation, no preamble.\n\n' +
    redactedUserText;
  try {
    const stdout = await backend.runOneShot({ prompt, model, reasoning, cwd: os.tmpdir() });
    const title = redactText(stdout.trim().split('\n').pop().replace(/^["'#\s]+|["'.\s]+$/g, '').slice(0, 60), secretStore);
    if (title) session.setTitle(title); // emits session_meta to SSE clients
  } catch (err) {
    console.error(`[title:${session.id.slice(0, 8)}]`, redactText(err.message || 'title generation failed', secretStore));
  }
}

/**
 * After a settings save: blank sessions have no real conversation yet, so keep
 * their defaults fresh — and if the backend changed, recreate them on the new
 * backend so "New session" is never stranded on the old one.
 */
function onConfigChanged() {
  const settings = prefs();
  // Re-emit the embedder env file so a Settings → Memory change lands where the
  // Graphiti sidecar will read it on its next restart.
  writeEmbedderEnv(settings.memory?.embedder);
  warnOnInsecureTls(settings);
  for (const session of [...sessions.values()]) {
    if (session.promptCount !== 0 || session.running) continue;
    let target = session;
    if (session.backend !== settings.backend) {
      sessions.delete(session.id);
      session.dispose();
      try {
        fs.rmSync(session.stateFile, { force: true });
      } catch { /* best effort */ }
      target = createSession(session.id);
    } else {
      const { env, claudeSubscription } = buildSessionEnv(settings, target.backend);
      target.applyDefaults({
        model: settings.mainModel || '',
        thinking: settings.mainReasoning || '',
        env,
      });
      target.options.subscriptionAuth = claudeSubscription; // keep auth mode in sync with the new settings
    }
    target.emit('event', {
      type: 'session_state',
      ...(target.agentState || {}),
      requestedModel: target.options.model || '',
      requestedThinking: target.options.thinking || '',
      modelPinned: target.modelPinned,
    });
  }
}

const memoryProxyConfig = resolveMemoryProxyConfig();

const app = express();
app.use(securityHeaders);

// Anthropic proxy for Graphiti memory extraction. The graphiti sidecar points
// its Anthropic base URL here and authenticates with the shared MEMORY_PROXY_TOKEN;
// we swap in the real, UI-managed key from the secret store (fallback to env).
// This lets the Anthropic key be set/rotated in Settings → Memory without
// editing .env or restarting the sidecar. Mounted before express.json so the
// request/response bodies stream through untouched.
app.use('/memory-llm', createMemoryLlmProxyHandler({
  getAnthropicApiKey: () => secretStore.get?.().anthropicApiKey || process.env.ANTHROPIC_API_KEY || '',
  proxyConfig: memoryProxyConfig,
  redactError: (message) => redactText(message, secretStore),
}));

app.use('/api', localOriginGuard);
app.use(express.json({ limit: '2mb' }));
app.use((req, res, next) => {
  const json = res.json.bind(res);
  res.json = (body) => json(redact(body));
  next();
});
app.use(express.static(path.join(ROOT, 'public')));

// Locally served vendor assets (no CDN dependency at runtime).
app.use('/vendor/marked.min.js', express.static(path.join(ROOT, 'node_modules/marked/marked.min.js')));
app.use('/vendor/purify.min.js', express.static(path.join(ROOT, 'node_modules/dompurify/dist/purify.min.js')));
app.use('/vendor/hljs', express.static(path.join(ROOT, 'node_modules/@highlightjs/cdn-assets')));

app.use('/api/settings', settingsRouter({
  getConfig: () => config,
  setConfig: (next) => { config = next; },
  secretStore,
  onConfigChanged,
}));
app.use('/api/models', modelsRouter({
  getActiveBackend: activeBackend,
  getModelCatalog: catalogFor,
}));
app.use('/api/backend-update', backendUpdatesRouter({ manager: backendUpdates }));
app.use('/api/sessions', sessionsRouter({
  sessions,
  sseClients,
  createSession,
  generateTitle,
  getConfig: prefs,
  getActiveBackend: activeBackend,
  getModelCatalog: catalogFor,
  secretStore,
  brokerSocketPath: excliBroker.socketPath,
  buildSessionEnv,
  challenger,
  redact,
}));
app.use('/api/actions', actionsRouter({
  sessions,
  executeApproved: (action, opts) => excliBroker.executeApproved(action, opts),
  broadcast, // responses + SSE are redacted centrally (res.json override + broadcast)
  actionIndex,
  getSessionInfo: actionSessionInfo,
  globalActionClients,
  redact, // /stream writes SSE directly (bypasses the res.json redactor)
}));
app.use('/api/sessions', filesRouter({ sessions }));
app.use('/api', healthRouter({
  getConfig: () => config,
  sessions,
  root: ROOT,
  getActiveBackend: activeBackend,
  getModelCatalog: catalogFor,
  secretStore,
  excliBroker,
  reversingLabsBroker,
  researchBroker,
}));

// In-app eval: run the labeled cases through the app's own session machinery
// (read-only, memory off) and score them — no external script needed.
function disposeEvalSession(session) {
  sessions.delete(session.id);
  try { session.abort(); } catch { /* best effort */ }
  try { session.dispose(); } catch { /* best effort */ }
  try { fs.rmSync(session.workspace, { recursive: true, force: true }); } catch { /* best effort */ }
}
// Persisted eval data store (reports, label overrides, built dashboard). Under
// /app/data (config_data volume) in Docker via EH_EVAL_DATA_DIR, so in-app runs,
// label edits, and the dashboard all share one store that survives restarts.
const EVAL_DATA_DIR = process.env.EH_EVAL_DATA_DIR || path.join(ROOT, 'eval', 'reports');
const EVAL_CASES_DIR = path.join(ROOT, 'eval', 'cases');
const EVAL_DASHBOARD_DIR = path.join(EVAL_DATA_DIR, 'dashboard');
const EVAL_OVERRIDES = path.join(EVAL_DATA_DIR, 'label-overrides.json');
fs.mkdirSync(EVAL_DATA_DIR, { recursive: true });
const buildEvalDashboard = () => buildDashboard({ dataDir: EVAL_DATA_DIR, outDir: EVAL_DASHBOARD_DIR });
app.use('/eval-dashboard', express.static(EVAL_DASHBOARD_DIR));
app.use('/api/eval', evalRouter({
  reportsDir: EVAL_DATA_DIR,
  casesDir: EVAL_CASES_DIR,
  overridesPath: EVAL_OVERRIDES,
  buildDashboard: buildEvalDashboard,
  getSession: (id) => sessions.get(id),
  redact,
  startEval: ({ runId, backendId, gateTarget, costCeiling, accuracyFloor, caseIds, maxParallel, mode, timestamp, onProgress }) => runEvalInApp({
    createSession,
    disposeSession: disposeEvalSession,
    casesDir: EVAL_CASES_DIR,
    reportsDir: EVAL_DATA_DIR,
    overridesPath: EVAL_OVERRIDES,
    backendId,
    runId,
    timestamp,
    onProgress,
    gateTarget: gateTarget ?? 0.05,
    costCeiling,
    accuracyFloor: accuracyFloor ?? 0.8,
    caseIds,
    maxParallel: maxParallel ?? 3,
    mode: mode ?? 'live',
    meta: { skill_version: 'evidence-ladder', model: prefs().mainModel || '' },
  }).then((r) => { try { buildEvalDashboard(); } catch { /* dashboard build is best-effort */ } return r; }),
  startInjectionProbe: ({ runId, backendId, probeIds, maxParallel, timestamp, onProgress }) => runInjectionProbes({
    createSession,
    disposeSession: disposeEvalSession,
    probesDir: path.join(ROOT, 'eval', 'injection-probes'),
    reportsDir: path.join(EVAL_DATA_DIR, 'injection-probes'),
    backendId,
    runId,
    timestamp,
    probeIds,
    maxParallel: maxParallel ?? 3,
    onProgress,
    meta: { skill_version: 'evidence-ladder', model: prefs().mainModel || '' },
  }),
}));

// Read-only memory-graph viz (v1: contextual recall). Reads FalkorDB directly
// via GRAPH.RO_QUERY; the viz never mutates memory. Also runs a lightweight
// drift watch that warns if untyped [Entity] nodes reappear (memory-quality
// backstop). FALKORDB_URI defaults to the compose service host.
const MEMORY_ENV_GROUP = process.env.EH_MEMORY_GROUP_ID || '';
const falkor = createFalkorClient({
  url: process.env.FALKORDB_URI || 'redis://falkordb:6379',
  password: process.env.FALKORDB_PASSWORD || '',
});
app.use('/api/memory/graph', memoryGraphRouter({
  getConfig: prefs,
  client: falkor,
  envGroup: MEMORY_ENV_GROUP,
  redact: (v) => redactText(String(v), secretStore),
}));
// Drift watch: warn if untyped [Entity] nodes reappear. Watch the configured
// environment group, or every namespace if none is pinned.
let falkorGraphs = [];
falkor.listGraphs().then((g) => { falkorGraphs = g; }).catch(() => { /* memory may be off */ });
startDriftWatch({
  client: falkor,
  groups: () => (MEMORY_ENV_GROUP ? [MEMORY_ENV_GROUP] : falkorGraphs),
});

app.use((err, req, res, next) => {
  if (!err) return next();
  if (res.headersSent) return next(err);
  if (err instanceof multer.MulterError) {
    const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    return res.status(status).json({ error: err.message });
  }
  const status = err.message === 'Session not found' ? 404 : (err.statusCode || 400);
  res.status(status).json({ error: redactText(err.message || 'Request failed', secretStore) });
});

let server = null;

/** Bind to the base port, stepping +100 (3100, 3200, …) when it's in use. */
function listen(port, attemptsLeft) {
  server = app.listen(port, LISTEN_HOST, () => {
    console.log(`ExtraHop Investigation Agent UI → http://localhost:${port}`);
    console.log(`Agent backend: ${activeBackend().label}`);
    console.log(credentialsConfigured(config, secretStore)
      ? `ExtraHop credentials configured (host: ${config.extrahop.host || 'not set!'})`
      : 'No ExtraHop credentials yet — set them in the in-app Settings (gear icon) or .env.');
  });
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE' && attemptsLeft > 1) {
      console.warn(`Port ${port} is in use — trying ${port + PORT_STEP}.`);
      listen(port + PORT_STEP, attemptsLeft - 1);
      return;
    }
    console.error(err.code === 'EADDRINUSE'
      ? `No free port found between ${BASE_PORT} and ${port} (step ${PORT_STEP}).`
      : `Could not start server: ${err.message}`);
    process.exit(1);
  });
}
listen(BASE_PORT, PORT_ATTEMPTS);

function shutdown() {
  for (const res of globalActionClients) { try { res.end(); } catch { /* already closed */ } }
  globalActionClients.clear();
  for (const s of sessions.values()) s.dispose();
  excliBroker.stop();
  actionBroker.stop();
  reversingLabsBroker.stop();
  researchBroker.stop();
  server?.close();
  process.exit(0);
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
