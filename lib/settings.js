import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_BACKEND_ID, backendIds, getBackend, reasoningLevelUnion } from './backends/index.js';
import {
  EXTRA_HOP_SECRET_FIELDS, REVERSING_LABS_ENV_KEYS, RESEARCH_ENV_KEYS,
  scrubExtraHopEnv, scrubReversingLabsEnv, scrubResearchEnv,
} from './secrets.js';
import { normalizeReversingLabsBaseUrl } from './reversinglabs/client.js';
import { researchSettings } from './research/service.js';

const RESEARCH_PROVIDERS = new Set(['auto', 'duckduckgo', 'brave', 'claude']);

// Location of the persisted (non-secret) settings. Overridable via env so a
// container can point it at a mounted volume; defaults to the repo root for
// local runs.
const CONFIG_PATH = process.env.EH_CONFIG_PATH || path.resolve(import.meta.dirname, '..', 'config.json');

// Per-backend model preferences. Model strings are not portable between
// backends ('opus' vs 'anthropic/claude-...'), so each backend keeps its own
// section and switching back later restores what you had.
const PREF_DEFAULTS = {
  mainModel: '', // model for the investigation agent; empty = backend default
  mainReasoning: '', // reasoning level for the main session; empty = backend default
  lightModel: '', // model for session-title summarization; empty = backend's cheap default
  challenger: {
    model: '', // empty = main/default
    reasoning: 'high',
  },
};

const DEFAULTS = {
  backend: '', // '' = auto-select at startup (the sole installed backend, else pi)
  backends: Object.fromEntries(backendIds().map((id) => [id, structuredClone(PREF_DEFAULTS)])),
  // Claude Code sign-in: 'apiKey' (ANTHROPIC_API_KEY, metered) or 'subscription'
  // (Claude Pro/Max OAuth via an in-container `claude /login`). Default apiKey so
  // the backend works out of the box; subscription requires the login to exist,
  // and in that mode the app hides the API key so Code uses the login instead.
  claudeAuth: 'apiKey',
  challenger: {
    enabled: false,
    automatic: false,
  },
  evidence: {
    defaultView: 'rendered', // 'code' | 'split' | 'rendered'
  },
  memory: {
    enabled: false, // Graphiti temporal-memory MCP server (opt-in)
    url: 'http://graphiti-mcp:8000/mcp', // MCP HTTP endpoint
  },
  extrahop: {
    family: 'enterprise', // 'enterprise' (API key) | 'rx360' (OAuth2 client)
    host: '',
    insecure: false, // RxEnterprise only: skip TLS verification
  },
  // Third-party enrichment integrations. Secret keys live in the secret store
  // (never here); only non-secret settings are persisted.
  integrations: {
    reversingLabs: {
      enabled: false, // ReversingLabs Spectra Analyze enrichment (opt-in)
      host: '', // Spectra Analyze HTTPS origin
      insecure: false, // skip TLS verification for the Spectra Analyze host
      allowCloud: false, // permit Spectra Intelligence cloud search/lookups
    },
    webResearch: {
      // Always available (DuckDuckGo needs no account). 'auto' prefers Brave
      // when a key is set, else Claude's native search on the Claude backend,
      // else DuckDuckGo HTML.
      provider: 'auto', // 'auto' | 'duckduckgo' | 'brave' | 'claude'
    },
  },
};

function normalizeResearchProvider(value) {
  return RESEARCH_PROVIDERS.has(value) ? value : 'auto';
}

function normalizeWebResearch(raw = {}, envWr = {}) {
  return { provider: normalizeResearchProvider(raw.provider ?? envWr.provider) };
}

function parseOptionalBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string' || !value.trim()) return undefined;
  if (/^(1|true|yes|on)$/i.test(value.trim())) return true;
  if (/^(0|false|no|off)$/i.test(value.trim())) return false;
  return undefined;
}

function normalizeReversingLabs(raw = {}, envRl = {}) {
  const merged = { ...DEFAULTS.integrations.reversingLabs, ...envRl, ...raw };
  return {
    enabled: Boolean(merged.enabled),
    host: typeof merged.host === 'string' ? merged.host.trim() : '',
    insecure: Boolean(merged.insecure),
    allowCloud: Boolean(merged.allowCloud),
  };
}

function normalizeMemory(raw = {}) {
  return {
    enabled: Boolean(raw.enabled),
    url: (typeof raw.url === 'string' && raw.url.trim()) || DEFAULTS.memory.url,
  };
}

const REASONING_SUFFIX_RE = new RegExp(`^(.*):(${reasoningLevelUnion().join('|')})$`);
const EVIDENCE_VIEW_MODES = new Set(['code', 'split', 'rendered']);

function reasoningLevelsFor(backendId) {
  const backend = getBackend(backendId);
  return new Set(['', ...(backend ? backend.reasoningLevels : reasoningLevelUnion())]);
}

function splitModelReasoning(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  const match = raw.match(REASONING_SUFFIX_RE);
  if (!match) return { model: raw, reasoning: '' };
  return { model: match[1].trim(), reasoning: match[2] };
}

function normalizeFamily(value) {
  return value === 'rx360' ? 'rx360' : 'enterprise';
}

function normalizeEvidenceDefaultView(value) {
  return EVIDENCE_VIEW_MODES.has(value) ? value : DEFAULTS.evidence.defaultView;
}

function normalizePrefs(raw = {}, backendId) {
  const levels = reasoningLevelsFor(backendId);
  const main = splitModelReasoning(raw.mainModel);
  const challengerModel = splitModelReasoning(raw.challenger?.model);
  return {
    mainModel: main.model,
    mainReasoning: levels.has(raw.mainReasoning) ? raw.mainReasoning : (levels.has(main.reasoning) ? main.reasoning : ''),
    lightModel: splitModelReasoning(raw.lightModel).model,
    challenger: {
      model: challengerModel.model,
      reasoning: levels.has(raw.challenger?.reasoning) && raw.challenger?.reasoning
        ? raw.challenger.reasoning
        : (levels.has(challengerModel.reasoning) && challengerModel.reasoning
          ? challengerModel.reasoning
          : PREF_DEFAULTS.challenger.reasoning),
    },
  };
}

function parseBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return false;
  return /^(1|true|yes|on)$/i.test(value.trim());
}

function stripConfigSecrets(cfg) {
  const clean = structuredClone(cfg || {});
  if (clean.extrahop) {
    for (const key of EXTRA_HOP_SECRET_FIELDS) delete clean.extrahop[key];
  }
  // The RL token is a secret; never let it live in the persisted config.
  if (clean.integrations?.reversingLabs) {
    delete clean.integrations.reversingLabs.apiToken;
    delete clean.integrations.reversingLabs.reversingLabsApiToken;
  }
  // Likewise for the Brave Search API key.
  if (clean.integrations?.webResearch) {
    delete clean.integrations.webResearch.braveApiKey;
  }
  return clean;
}

function legacySecretsFromConfig(cfg) {
  const out = {};
  const eh = cfg?.extrahop || {};
  for (const key of EXTRA_HOP_SECRET_FIELDS) {
    if (typeof eh[key] === 'string' && eh[key]) out[key] = eh[key];
  }
  const rl = cfg?.integrations?.reversingLabs || {};
  const legacyToken = rl.apiToken || rl.reversingLabsApiToken;
  if (typeof legacyToken === 'string' && legacyToken) out.reversingLabsApiToken = legacyToken;
  const wr = cfg?.integrations?.webResearch || {};
  if (typeof wr.braveApiKey === 'string' && wr.braveApiKey) out.braveApiKey = wr.braveApiKey;
  return out;
}

/**
 * Configs written before backend selection existed carried flat Pi model
 * fields at the root. Fold them into the pi section once.
 */
function migrateFlatModelPrefs(cfg) {
  if (cfg.backends || !(cfg.mainModel || cfg.mainReasoning || cfg.lightModel
    || cfg.challenger?.model || cfg.challenger?.reasoning)) return cfg;
  return {
    ...cfg,
    backend: cfg.backend || DEFAULT_BACKEND_ID,
    backends: {
      [DEFAULT_BACKEND_ID]: {
        mainModel: cfg.mainModel,
        mainReasoning: cfg.mainReasoning,
        lightModel: cfg.lightModel,
        challenger: {
          model: cfg.challenger?.model,
          reasoning: cfg.challenger?.reasoning,
        },
      },
    },
  };
}

function normalizeConfig(rawCfg, envConfig = {}, integrationConfig = {}) {
  const cfg = migrateFlatModelPrefs(stripConfigSecrets(rawCfg));
  const rawEh = cfg.extrahop || {};
  return {
    backend: getBackend(cfg.backend) ? cfg.backend : '',
    integrations: {
      reversingLabs: normalizeReversingLabs(
        cfg.integrations?.reversingLabs,
        integrationConfig.reversingLabs,
      ),
      webResearch: normalizeWebResearch(
        cfg.integrations?.webResearch,
        integrationConfig.webResearch,
      ),
    },
    backends: Object.fromEntries(backendIds().map((id) => [
      id, normalizePrefs(cfg.backends?.[id] || {}, id),
    ])),
    claudeAuth: cfg.claudeAuth === 'subscription' ? 'subscription' : 'apiKey',
    challenger: {
      enabled: Boolean(cfg.challenger?.enabled),
      automatic: Boolean(cfg.challenger?.automatic),
    },
    evidence: {
      defaultView: normalizeEvidenceDefaultView(cfg.evidence?.defaultView),
    },
    memory: normalizeMemory(cfg.memory),
    extrahop: {
      ...DEFAULTS.extrahop,
      ...envConfig,
      ...rawEh,
      family: rawEh.family ? normalizeFamily(rawEh.family) : normalizeFamily(envConfig.family),
      host: typeof rawEh.host === 'string' ? rawEh.host : (envConfig.host || ''),
      insecure: typeof rawEh.insecure === 'boolean' ? rawEh.insecure : Boolean(envConfig.insecure),
    },
  };
}

/**
 * Flatten the stored config into the shape consumers work with: the active
 * backend's model preferences at the root. Routes, the challenger, and title
 * generation only ever see this view; only settings storage and the settings
 * UI know about the per-backend sections.
 */
export function resolveConfig(cfg) {
  const backend = getBackend(cfg.backend) ? cfg.backend : DEFAULT_BACKEND_ID;
  const prefs = cfg.backends?.[backend] || structuredClone(PREF_DEFAULTS);
  return {
    backend,
    claudeAuth: cfg.claudeAuth === 'subscription' ? 'subscription' : 'apiKey',
    mainModel: prefs.mainModel || '',
    mainReasoning: prefs.mainReasoning || '',
    lightModel: prefs.lightModel || '',
    challenger: {
      enabled: Boolean(cfg.challenger?.enabled),
      automatic: Boolean(cfg.challenger?.automatic),
      model: prefs.challenger?.model || '',
      reasoning: prefs.challenger?.reasoning || PREF_DEFAULTS.challenger.reasoning,
    },
    evidence: {
      defaultView: normalizeEvidenceDefaultView(cfg.evidence?.defaultView),
    },
    memory: normalizeMemory(cfg.memory),
    extrahop: cfg.extrahop,
    integrations: {
      reversingLabs: normalizeReversingLabs(cfg.integrations?.reversingLabs),
      webResearch: normalizeWebResearch(cfg.integrations?.webResearch),
    },
  };
}

export function parseEnvAssignments(text) {
  const out = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    let value = match[2].trim();
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.endsWith(quote)) {
      value = value.slice(1, -1);
    }
    out[match[1]] = value;
  }
  return out;
}

function envConfigFromAssignments(assignments) {
  const extrahop = {};
  const integrations = { reversingLabs: {}, webResearch: {} };
  const secrets = {};
  if (typeof assignments.EH_RESEARCH_PROVIDER === 'string') {
    integrations.webResearch.provider = normalizeResearchProvider(assignments.EH_RESEARCH_PROVIDER.trim().toLowerCase());
  }
  if (typeof assignments.BRAVE_SEARCH_API_KEY === 'string' && assignments.BRAVE_SEARCH_API_KEY) {
    secrets.braveApiKey = assignments.BRAVE_SEARCH_API_KEY;
  }
  if (typeof assignments.RL_ENABLED === 'string') {
    integrations.reversingLabs.enabled = parseBoolean(assignments.RL_ENABLED);
  }
  if (typeof assignments.RL_BASE_URL === 'string') {
    integrations.reversingLabs.host = assignments.RL_BASE_URL.trim();
  }
  if (typeof assignments.RL_VERIFY_SSL === 'string') {
    const verifySsl = parseOptionalBoolean(assignments.RL_VERIFY_SSL);
    if (typeof verifySsl === 'boolean') integrations.reversingLabs.insecure = !verifySsl;
  }
  if (typeof assignments.RL_ALLOW_CLOUD === 'string') {
    integrations.reversingLabs.allowCloud = parseBoolean(assignments.RL_ALLOW_CLOUD);
  }
  const rlToken = assignments.RL_API_TOKEN || assignments.REVERSINGLABS_API_TOKEN;
  if (typeof rlToken === 'string' && rlToken) secrets.reversingLabsApiToken = rlToken;
  if (typeof assignments.EXTRAHOP_HOST === 'string') extrahop.host = assignments.EXTRAHOP_HOST.trim();
  if (typeof assignments.EXTRAHOP_FAMILY === 'string') extrahop.family = normalizeFamily(assignments.EXTRAHOP_FAMILY);
  if (typeof assignments.EXTRAHOP_INSECURE === 'string') extrahop.insecure = parseBoolean(assignments.EXTRAHOP_INSECURE);
  if (typeof assignments.EXTRAHOP_API_KEY === 'string' && assignments.EXTRAHOP_API_KEY) {
    secrets.apiKey = assignments.EXTRAHOP_API_KEY;
    extrahop.family ||= 'enterprise';
  }
  if (typeof assignments.EXTRAHOP_CLIENT_ID === 'string' && assignments.EXTRAHOP_CLIENT_ID) {
    secrets.clientId = assignments.EXTRAHOP_CLIENT_ID;
    extrahop.family = 'rx360';
  }
  if (typeof assignments.EXTRAHOP_CLIENT_SECRET === 'string' && assignments.EXTRAHOP_CLIENT_SECRET) {
    secrets.clientSecret = assignments.EXTRAHOP_CLIENT_SECRET;
    extrahop.family = 'rx360';
  }
  return { extrahop, integrations, secrets };
}

const INTEGRATION_ENV_KEYS = new Set([...REVERSING_LABS_ENV_KEYS, ...RESEARCH_ENV_KEYS]);

export function loadDotEnv(file, { env = process.env } = {}) {
  const fromProcess = {};
  for (const key of Object.keys(env)) {
    if (key.startsWith('EXTRAHOP_') || INTEGRATION_ENV_KEYS.has(key)) fromProcess[key] = env[key];
  }
  let assignments = { ...fromProcess };
  if (fs.existsSync(file)) {
    const parsed = parseEnvAssignments(fs.readFileSync(file, 'utf8'));
    if (EXTRA_HOP_SECRET_FIELDS.some((field) => {
      const envKey = field === 'apiKey'
        ? 'EXTRAHOP_API_KEY'
        : field === 'clientId'
          ? 'EXTRAHOP_CLIENT_ID'
          : 'EXTRAHOP_CLIENT_SECRET';
      return Object.prototype.hasOwnProperty.call(parsed, envKey);
    })) {
      delete assignments.EXTRAHOP_API_KEY;
      delete assignments.EXTRAHOP_CLIENT_ID;
      delete assignments.EXTRAHOP_CLIENT_SECRET;
    }
    // A file-defined RL token wins over an inherited one.
    if (Object.prototype.hasOwnProperty.call(parsed, 'RL_API_TOKEN')
      || Object.prototype.hasOwnProperty.call(parsed, 'REVERSINGLABS_API_TOKEN')) {
      delete assignments.RL_API_TOKEN;
      delete assignments.REVERSINGLABS_API_TOKEN;
    }
    // A file-defined Brave key wins over an inherited one.
    if (Object.prototype.hasOwnProperty.call(parsed, 'BRAVE_SEARCH_API_KEY')) {
      delete assignments.BRAVE_SEARCH_API_KEY;
    }
    for (const [key, value] of Object.entries(parsed)) {
      if (key.startsWith('EXTRAHOP_') || INTEGRATION_ENV_KEYS.has(key)) assignments[key] = value;
      else env[key] = value;
    }
  }
  scrubExtraHopEnv(env);
  scrubReversingLabsEnv(env);
  scrubResearchEnv(env);
  return envConfigFromAssignments(assignments);
}

export function loadConfig(file = CONFIG_PATH, { envConfig = {}, integrationConfig = {}, secretStore = null } = {}) {
  let rawCfg = {};
  let loaded = false;
  try {
    rawCfg = JSON.parse(fs.readFileSync(file, 'utf8'));
    loaded = true;
  } catch {
    // First run.
  }

  const legacySecrets = legacySecretsFromConfig(rawCfg);
  const hasLegacySecrets = Object.keys(legacySecrets).length > 0;
  if (hasLegacySecrets && secretStore) {
    secretStore.update(legacySecrets, { persist: true, source: 'settings' });
  }

  const config = normalizeConfig(rawCfg, envConfig, integrationConfig);
  if (hasLegacySecrets && loaded) saveConfig(config, file);
  return config;
}

export function saveConfig(cfg, file = CONFIG_PATH) {
  const tmp = `${file}.${process.pid}.tmp`;
  const clean = stripConfigSecrets(cfg);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true }); // ensure the (possibly volume-mounted) dir exists
    fs.writeFileSync(tmp, JSON.stringify(clean, null, 2) + '\n', { mode: 0o600 });
    fs.renameSync(tmp, file);
    fs.chmodSync(file, 0o600);
  } catch (err) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      // Best effort cleanup.
    }
    throw err;
  }
}

export function activateEnvSecrets(secretStore, envSecrets, source = 'env') {
  if (!secretStore || secretStore.hasAny() || !Object.keys(envSecrets || {}).length) return false;
  secretStore.update(envSecrets, { persist: false, source });
  return true;
}

/**
 * Sanitized, per-environment memory namespace derived from the ExtraHop host.
 * FalkorDB's RediSearch rejects hyphens/dots in the group_id (D3), so reduce to
 * lowercase alphanumeric. An explicit EH_MEMORY_GROUP_ID env wins so a single
 * value can be shared with the graphiti sidecar (avoids app/sidecar drift).
 */
export function deriveGroupId(host, env = process.env) {
  if (env.EH_MEMORY_GROUP_ID) return env.EH_MEMORY_GROUP_ID;
  const base = String(host || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  return base ? `eh${base}` : 'ehdefault';
}

export function buildAgentEnv(cfg, {
  brokerSocketPath,
  reversingLabsBrokerSocketPath,
  reversingLabsEnabled: rlEnabled = false,
  researchBrokerSocketPath,
  actionBrokerSocketPath,
} = {}) {
  const env = {};
  if (brokerSocketPath) env.EH_EXCLI_BROKER_SOCKET = brokerSocketPath;
  // Governed write path: the agent can propose write actions for human approval.
  // The socket is inert to writes — it only records proposals.
  if (actionBrokerSocketPath) env.EH_ACTION_BROKER_SOCKET = actionBrokerSocketPath;
  // Only expose the RL broker socket when the integration is enabled AND
  // configured, so the agent's interface is inert otherwise.
  if (rlEnabled && reversingLabsBrokerSocketPath) {
    env.EH_REVERSINGLABS_BROKER_SOCKET = reversingLabsBrokerSocketPath;
  }
  // Web research is always available (DuckDuckGo needs no account); the broker
  // enforces the configured provider and all SSRF/exfil guards.
  if (researchBrokerSocketPath) env.EH_RESEARCH_BROKER_SOCKET = researchBrokerSocketPath;
  // Expose memory config to the Pi backend's extension (Claude uses mcpServers).
  if (cfg?.memory?.enabled && cfg?.memory?.url) {
    env.EH_MEMORY_MCP_URL = cfg.memory.url;
    env.EH_MEMORY_GROUP_ID = deriveGroupId(cfg?.extrahop?.host);
  }
  return env;
}

/** The RL host + token are present and syntactically valid. */
export function reversingLabsConfigured(cfg, secretStore) {
  const integration = cfg.integrations?.reversingLabs || {};
  const token = secretStore?.get?.().reversingLabsApiToken;
  if (!integration.host || typeof token !== 'string' || !token.trim()) return false;
  try {
    normalizeReversingLabsBaseUrl(integration.host);
    return true;
  } catch {
    return false;
  }
}

/** RL is switched on in Settings AND fully configured. */
export function reversingLabsEnabled(cfg, secretStore) {
  return Boolean(cfg.integrations?.reversingLabs?.enabled && reversingLabsConfigured(cfg, secretStore));
}

export function buildExcliEnv(cfg, secretStore, baseEnv = process.env) {
  const env = { ...baseEnv };
  scrubExtraHopEnv(env);
  const eh = cfg.extrahop || {};
  const secrets = secretStore?.get?.() || {};
  if (eh.host) env.EXTRAHOP_HOST = eh.host;
  if (eh.family === 'rx360') {
    if (secrets.clientId) env.EXTRAHOP_CLIENT_ID = secrets.clientId;
    if (secrets.clientSecret) env.EXTRAHOP_CLIENT_SECRET = secrets.clientSecret;
  } else {
    if (secrets.apiKey) env.EXTRAHOP_API_KEY = secrets.apiKey;
    if (eh.insecure) env.EXTRAHOP_INSECURE = 'true';
  }
  return env;
}

export function credentialsConfigured(cfg, secretStore) {
  const eh = cfg.extrahop || {};
  const secrets = secretStore?.get?.() || {};
  if (!eh.host) return false;
  return eh.family === 'rx360'
    ? Boolean(secrets.clientId && secrets.clientSecret)
    : Boolean(secrets.apiKey);
}

export function publicSettings(cfg, secretStore) {
  const eh = cfg.extrahop || {};
  const secrets = secretStore?.get?.() || {};
  const resolved = resolveConfig(cfg);
  const rl = resolved.integrations?.reversingLabs || {};
  const research = researchSettings(resolved, secretStore);
  return {
    backend: resolved.backend,
    integrations: {
      reversingLabs: {
        enabled: Boolean(rl.enabled),
        host: rl.host || '',
        insecure: Boolean(rl.insecure),
        allowCloud: Boolean(rl.allowCloud),
        apiTokenSet: Boolean(secrets.reversingLabsApiToken),
        configured: reversingLabsConfigured(cfg, secretStore),
      },
      webResearch: {
        provider: research.provider,
        effectiveProvider: research.effectiveProvider,
        braveApiKeySet: Boolean(secrets.braveApiKey),
      },
    },
    claudeAuth: resolved.claudeAuth,
    backends: structuredClone(cfg.backends || DEFAULTS.backends),
    challenger: {
      enabled: Boolean(cfg.challenger?.enabled),
      automatic: Boolean(cfg.challenger?.automatic),
    },
    evidence: {
      defaultView: normalizeEvidenceDefaultView(cfg.evidence?.defaultView),
    },
    memory: normalizeMemory(cfg.memory),
    anthropicKeySet: Boolean(secrets.anthropicApiKey),
    claudeOauthTokenSet: Boolean(secrets.claudeOauthToken),
    extrahop: {
      family: eh.family || 'enterprise',
      host: eh.host || '',
      insecure: Boolean(eh.insecure),
      apiKeySet: Boolean(secrets.apiKey),
      clientIdSet: Boolean(secrets.clientId),
      clientSecretSet: Boolean(secrets.clientSecret),
      source: secretStore?.source || 'memory',
    },
  };
}

/**
 * Merge a settings update from the browser. Secret fields: undefined/'' = keep
 * existing, the literal string '-' = clear, anything else = new value.
 */
export function applyUpdate(cfg, body, { secretStore = null } = {}) {
  const next = normalizeConfig(cfg);
  if (typeof body.backend === 'string' && getBackend(body.backend)) {
    next.backend = body.backend;
  }
  if (body.claudeAuth === 'subscription' || body.claudeAuth === 'apiKey') {
    next.claudeAuth = body.claudeAuth;
  }
  if (body.backends && typeof body.backends === 'object') {
    for (const id of backendIds()) {
      const patch = body.backends[id];
      if (!patch || typeof patch !== 'object') continue;
      const levels = reasoningLevelsFor(id);
      const prefs = next.backends[id];
      if (typeof patch.mainModel === 'string') {
        const main = splitModelReasoning(patch.mainModel);
        prefs.mainModel = main.model;
        if (main.reasoning && levels.has(main.reasoning)) prefs.mainReasoning = main.reasoning;
      }
      if (typeof patch.mainReasoning === 'string' && levels.has(patch.mainReasoning)) {
        prefs.mainReasoning = patch.mainReasoning;
      }
      if (typeof patch.lightModel === 'string') prefs.lightModel = splitModelReasoning(patch.lightModel).model;
      if (patch.challenger && typeof patch.challenger === 'object') {
        if (typeof patch.challenger.model === 'string') {
          prefs.challenger.model = splitModelReasoning(patch.challenger.model).model;
        }
        if (typeof patch.challenger.reasoning === 'string' && levels.has(patch.challenger.reasoning)) {
          prefs.challenger.reasoning = patch.challenger.reasoning;
        }
      }
    }
  }
  if (body.challenger && typeof body.challenger === 'object') {
    if (typeof body.challenger.enabled === 'boolean') next.challenger.enabled = body.challenger.enabled;
    if (typeof body.challenger.automatic === 'boolean') next.challenger.automatic = body.challenger.automatic;
  }
  if (body.evidence && typeof body.evidence === 'object' && EVIDENCE_VIEW_MODES.has(body.evidence.defaultView)) {
    next.evidence.defaultView = body.evidence.defaultView;
  }
  if (body.memory && typeof body.memory === 'object') {
    if (typeof body.memory.enabled === 'boolean') next.memory.enabled = body.memory.enabled;
    if (typeof body.memory.url === 'string' && body.memory.url.trim()) next.memory.url = body.memory.url.trim();
  }
  const eh = body.extrahop || {};
  if (eh.family === 'enterprise' || eh.family === 'rx360') next.extrahop.family = eh.family;
  if (typeof eh.host === 'string') next.extrahop.host = eh.host.trim();
  if (typeof eh.insecure === 'boolean') next.extrahop.insecure = eh.insecure;

  const reversingLabs = body.integrations?.reversingLabs || {};
  if (!next.integrations) next.integrations = { reversingLabs: normalizeReversingLabs(), webResearch: normalizeWebResearch() };
  if (!next.integrations.webResearch) next.integrations.webResearch = normalizeWebResearch();
  if (typeof reversingLabs.enabled === 'boolean') next.integrations.reversingLabs.enabled = reversingLabs.enabled;
  if (typeof reversingLabs.host === 'string') next.integrations.reversingLabs.host = reversingLabs.host.trim();
  if (typeof reversingLabs.insecure === 'boolean') next.integrations.reversingLabs.insecure = reversingLabs.insecure;
  if (typeof reversingLabs.allowCloud === 'boolean') next.integrations.reversingLabs.allowCloud = reversingLabs.allowCloud;

  const webResearch = body.integrations?.webResearch || {};
  if (typeof webResearch.provider === 'string' && RESEARCH_PROVIDERS.has(webResearch.provider)) {
    next.integrations.webResearch.provider = webResearch.provider;
  }

  const secretPatch = {};
  for (const key of EXTRA_HOP_SECRET_FIELDS) {
    const val = eh[key];
    if (typeof val !== 'string' || val === '') continue;
    secretPatch[key] = val === '-' ? '' : val.trim();
  }
  // RL token: '' = keep, '-' = clear, else set (same convention as the rest).
  if (typeof reversingLabs.apiToken === 'string' && reversingLabs.apiToken !== '') {
    secretPatch.reversingLabsApiToken = reversingLabs.apiToken === '-' ? '' : reversingLabs.apiToken.trim();
  }
  // Brave Search API key: same '' keep / '-' clear / else set convention.
  if (typeof webResearch.braveApiKey === 'string' && webResearch.braveApiKey !== '') {
    secretPatch.braveApiKey = webResearch.braveApiKey === '-' ? '' : webResearch.braveApiKey.trim();
  }
  // Anthropic API key (powers the Claude backend + memory extraction). Same
  // convention: '' = keep, '-' = clear, else set.
  if (typeof body.anthropicApiKey === 'string' && body.anthropicApiKey !== '') {
    secretPatch.anthropicApiKey = body.anthropicApiKey === '-' ? '' : body.anthropicApiKey.trim();
  }
  // Claude Code subscription token (from `claude setup-token`), used in
  // subscription mode. Same convention: '' = keep, '-' = clear, else set.
  if (typeof body.claudeOauthToken === 'string' && body.claudeOauthToken !== '') {
    secretPatch.claudeOauthToken = body.claudeOauthToken === '-' ? '' : body.claudeOauthToken.trim();
  }
  if (secretStore && Object.keys(secretPatch).length) {
    secretStore.update(secretPatch, { persist: true, source: 'settings' });
  }

  return stripConfigSecrets(next);
}
