import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk';
import { buildScrubbedEnv } from '../../secrets.js';

// Used only when SDK initialization cannot discover the models available to
// the signed-in Claude account. Aliases are resolved by Claude Code.

export const DEFAULT_CONTEXT_WINDOW = 200_000;

export const REASONING_LEVELS = ['off', 'low', 'medium', 'high', 'xhigh', 'max'];

const DEFAULT_MODEL_LIST_TIMEOUT_MS = Number(process.env.CLAUDE_MODEL_LIST_TIMEOUT_MS || 15_000);
const DEFAULT_MODEL_CACHE_TTL_MS = Number(process.env.CLAUDE_MODEL_CACHE_TTL_MS || 5 * 60_000);

export const CLAUDE_MODELS = [
  {
    provider: 'anthropic',
    id: 'opus',
    value: 'opus',
    context: '200k',
    maxOut: '64k',
    thinking: true,
    images: true,
    contextWindow: DEFAULT_CONTEXT_WINDOW,
  },
  {
    provider: 'anthropic',
    id: 'sonnet',
    value: 'sonnet',
    context: '200k',
    maxOut: '64k',
    thinking: true,
    images: true,
    contextWindow: DEFAULT_CONTEXT_WINDOW,
  },
  {
    provider: 'anthropic',
    id: 'haiku',
    value: 'haiku',
    context: '200k',
    maxOut: '64k',
    thinking: true,
    images: true,
    contextWindow: DEFAULT_CONTEXT_WINDOW,
  },
];

export function modelKey(value) {
  return String(value || '').trim().replace(/:(?:off|low|medium|high|xhigh|max)$/, '');
}

function modelBaseKey(value) {
  return modelKey(value).replace(/\[[^\]]+\]$/, '');
}

export function findModel(models, value) {
  const key = modelKey(value);
  if (!key) return null;
  const exact = models.find((model) => (
    model.value === key || model.id === key || model.resolvedModel === key
  ));
  if (exact) return exact;
  const baseKey = modelBaseKey(key);
  const baseMatches = models.filter((model) => modelBaseKey(model.value) === baseKey);
  return baseMatches.length === 1 ? baseMatches[0] : null;
}

export function contextWindowForModel(value = '') {
  const match = modelKey(value).match(/\[(\d+)([km])\]$/i);
  if (match) {
    const multiplier = match[2].toLowerCase() === 'm' ? 1_000_000 : 1_000;
    return Number(match[1]) * multiplier;
  }
  return DEFAULT_CONTEXT_WINDOW;
}

/**
 * Map an app reasoning level onto Claude Agent SDK query options.
 * '' = model default (adaptive thinking), 'off' = thinking disabled,
 * anything else = effort level with adaptive thinking.
 */
export function reasoningOptions(level) {
  if (!level) return {};
  if (level === 'off') return { thinking: { type: 'disabled' } };
  return { effort: level };
}

/** Convert SDK ModelInfo into the backend-neutral shape consumed by the UI. */
export function mapSdkModel(model) {
  const value = typeof model?.value === 'string' ? model.value.trim() : '';
  if (!value) return null;
  const supportedEffortLevels = Array.isArray(model.supportedEffortLevels)
    ? model.supportedEffortLevels.filter((level) => REASONING_LEVELS.includes(level))
    : [];
  const capabilityReported = typeof model.supportsEffort === 'boolean'
    || typeof model.supportsAdaptiveThinking === 'boolean';
  const thinking = model.supportsEffort === true
    || model.supportsAdaptiveThinking === true
    || !capabilityReported;
  const contextWindow = contextWindowForModel(value);
  const context = contextWindow === DEFAULT_CONTEXT_WINDOW
    ? ''
    : `${Math.round(contextWindow / 1_000_000)}m`;

  return {
    provider: 'anthropic',
    id: value,
    value,
    resolvedModel: typeof model.resolvedModel === 'string' ? model.resolvedModel : '',
    displayName: typeof model.displayName === 'string' ? model.displayName : value,
    description: typeof model.description === 'string' ? model.description : '',
    context, // Derived only when the SDK value carries a qualifier such as [1m].
    maxOut: '',
    thinking,
    images: true,
    contextWindow,
    supportedEffortLevels,
    supportsAdaptiveThinking: model.supportsAdaptiveThinking === true,
    supportsFastMode: model.supportsFastMode === true,
    supportsAutoMode: model.supportsAutoMode === true,
  };
}

function initializationOnlyPrompt() {
  let release;
  const done = new Promise((resolve) => { release = resolve; });
  return {
    prompt: {
      async *[Symbol.asyncIterator]() {
        await done;
      },
    },
    release,
  };
}

async function discoverModels({ root, queryFn, timeoutMs, env }) {
  const input = initializationOnlyPrompt();
  const abortController = new AbortController();
  let sdkQueryInstance;
  let timer;

  try {
    sdkQueryInstance = queryFn({
      prompt: input.prompt,
      options: {
        cwd: root,
        env: buildScrubbedEnv(env),
        tools: [],
        settingSources: [],
        persistSession: false,
        abortController,
      },
    });
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        abortController.abort();
        reject(new Error(`Claude model discovery timed out after ${Math.round(timeoutMs / 1000)}s`));
      }, timeoutMs);
      timer.unref?.();
    });
    const supported = await Promise.race([sdkQueryInstance.supportedModels(), timeout]);
    if (!Array.isArray(supported)) throw new Error('Claude Code returned an invalid model catalog');
    // The UI already has an unpinned "Claude default" option. Keeping the
    // SDK's explicit default row would present the same choice twice.
    const models = supported.map(mapSdkModel).filter((model) => model && model.value !== 'default');
    if (!models.length) throw new Error('Claude Code returned no supported models');
    return [...new Map(models.map((model) => [model.value, model])).values()];
  } finally {
    clearTimeout(timer);
    input.release();
    abortController.abort();
    sdkQueryInstance?.close?.();
  }
}

/** SDK-backed model catalog, cached and coalesced with a static safe fallback. */
export function createModelCatalog({
  root,
  queryFn = sdkQuery,
  env = process.env,
  fallbackModels = CLAUDE_MODELS,
  timeoutMs = DEFAULT_MODEL_LIST_TIMEOUT_MS,
  cacheTtlMs = DEFAULT_MODEL_CACHE_TTL_MS,
  onDiscoveryError = (err) => console.warn(`Claude model discovery failed; using fallback catalog: ${err.message}`),
} = {}) {
  let cache = null;
  let pending = null;

  async function load() {
    if (cache && cache.expiresAt > Date.now()) return cache.models;
    if (pending) return pending;
    pending = discoverModels({ root, queryFn, timeoutMs, env })
      .catch((err) => {
        onDiscoveryError?.(err);
        return fallbackModels;
      })
      .then((models) => {
        cache = { expiresAt: Date.now() + cacheTtlMs, models };
        return models;
      })
      .finally(() => { pending = null; });
    return pending;
  }

  async function list(search = '') {
    const models = await load();
    const query = typeof search === 'string' ? search.trim().toLowerCase() : '';
    if (!query) return models;
    return models.filter((model) => [
      model.value,
      model.id,
      model.resolvedModel,
      model.displayName,
      model.description,
    ].some((field) => String(field || '').toLowerCase().includes(query)));
  }

  async function resolveSelection(value) {
    const key = modelKey(value);
    if (!key) return null;
    const model = findModel(await list(), key);
    if (!model) {
      const err = new Error(`Model not found: ${key}`);
      err.statusCode = 400;
      throw err;
    }
    return model;
  }

  async function lowestReasoningForModel(value) {
    return 'off';
  }

  function clearCache() {
    cache = null;
  }

  return {
    list,
    resolveSelection,
    lowestReasoningForModel,
    clearCache,
  };
}
