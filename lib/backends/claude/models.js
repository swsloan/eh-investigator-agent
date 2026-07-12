// Claude Code exposes a small fixed model set (aliases resolved by the CLI to
// the newest snapshot). A static catalog replaces Pi's multi-provider listing.

export const DEFAULT_CONTEXT_WINDOW = 200_000;

export const REASONING_LEVELS = ['off', 'low', 'medium', 'high', 'xhigh', 'max'];

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

export function findModel(models, value) {
  const key = modelKey(value);
  if (!key) return null;
  return models.find((model) => model.value === key || model.id === key) || null;
}

export function contextWindowForModel() {
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

/**
 * Catalog facade matching the Pi catalog's interface. Claude Code's model set
 * is static, so listing is synchronous and never shells out.
 */
export function createModelCatalog({ models = CLAUDE_MODELS } = {}) {
  function list(search = '') {
    const query = typeof search === 'string' ? search.trim().toLowerCase() : '';
    if (!query) return Promise.resolve(models);
    return Promise.resolve(models.filter((model) =>
      model.value.toLowerCase().includes(query) || model.id.toLowerCase().includes(query)));
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

  // All Claude models support thinking; the lowest useful level is 'off'
  // (thinking disabled) for cheap one-shot calls such as title generation.
  async function lowestReasoningForModel() {
    return 'off';
  }

  function clearCache() {}

  return {
    list,
    resolveSelection,
    lowestReasoningForModel,
    clearCache,
  };
}
