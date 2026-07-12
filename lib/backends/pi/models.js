import { execFile as execFileCallback } from 'node:child_process';

export const REASONING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'];

const DEFAULT_MODEL_LIST_TIMEOUT_MS = Number(process.env.PI_MODEL_LIST_TIMEOUT_MS || 45_000);
const DEFAULT_MODEL_CACHE_TTL_MS = Number(process.env.PI_MODEL_CACHE_TTL_MS || 5 * 60_000);

export function parsePiModelList(stdout) {
  const models = [];
  for (const line of String(stdout || '').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('provider ')) continue;
    const [provider, id, context, maxOut, thinking, images] = trimmed.split(/\s+/);
    if (!provider || !id || !context || !maxOut || !thinking) continue;
    if (thinking !== 'yes' && thinking !== 'no') continue;
    if (images && images !== 'yes' && images !== 'no') continue;
    models.push({
      provider,
      id,
      value: `${provider}/${id}`,
      context,
      maxOut,
      thinking: thinking === 'yes',
      images: images === 'yes',
    });
  }
  return models;
}

export function modelKey(value) {
  return String(value || '').trim().replace(/:(?:off|minimal|low|medium|high|xhigh)$/, '');
}

export function findModel(models, value) {
  const key = modelKey(value);
  if (!key) return null;
  return models.find((model) => model.value === key || model.id === key) || null;
}

/** Model catalog backed by `pi --list-models`, cached for unfiltered listings. */
export function createModelCatalog({
  root,
  execFile = execFileCallback,
  timeoutMs = DEFAULT_MODEL_LIST_TIMEOUT_MS,
  cacheTtlMs = DEFAULT_MODEL_CACHE_TTL_MS,
} = {}) {
  let cache = null;

  function list(search = '') {
    const query = typeof search === 'string' ? search.trim() : '';
    const canUseCache = !query && cache && cache.expiresAt > Date.now();
    if (canUseCache) return Promise.resolve(cache.models);

    const args = ['--list-models'];
    if (query) args.push(query);
    return new Promise((resolve, reject) => {
      execFile('pi', args, {
        cwd: root,
        timeout: timeoutMs,
        maxBuffer: 1024 * 1024,
      }, (err, stdout = '', stderr = '') => {
        if (err) {
          err.stderr = stderr;
          reject(err);
          return;
        }
        const models = parsePiModelList(stdout);
        if (!query) cache = { expiresAt: Date.now() + cacheTtlMs, models };
        resolve(models);
      });
    });
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
    if (!value) return 'off';
    try {
      const model = findModel(await list(), value);
      return model?.thinking ? 'minimal' : 'off';
    } catch {
      return 'off';
    }
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
