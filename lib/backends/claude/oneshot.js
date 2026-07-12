import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk';
import { reasoningOptions } from './models.js';
import { buildScrubbedEnv } from '../../secrets.js';

const DEFAULT_ONESHOT_TIMEOUT_MS = 240_000;

/**
 * Run a single tool-less, non-persisted Claude turn and return its text.
 * Used for session-title generation and challenger reviews.
 */
export async function runOneShot({
  prompt,
  model = '',
  reasoning = 'off',
  cwd,
  env = process.env,
  timeoutMs = DEFAULT_ONESHOT_TIMEOUT_MS,
  queryFn = sdkQuery,
} = {}) {
  const abortController = new AbortController();
  const timer = setTimeout(() => abortController.abort(), timeoutMs);
  timer.unref?.();

  const options = {
    cwd,
    env: buildScrubbedEnv(env),
    tools: [],
    settingSources: [],
    persistSession: false,
    maxTurns: 1,
    abortController,
    ...(model ? { model } : {}),
    ...reasoningOptions(reasoning),
  };

  try {
    let text = '';
    for await (const message of queryFn({ prompt, options })) {
      if (message.type !== 'result') continue;
      if (message.subtype === 'success' && !message.is_error) {
        text = message.result || '';
      } else {
        const detail = (message.errors || []).join('; ') || message.subtype || 'unknown error';
        throw new Error(`Claude one-shot call failed: ${detail}`);
      }
    }
    return text;
  } catch (err) {
    if (abortController.signal.aborted) {
      throw new Error(`Claude one-shot call timed out after ${Math.round(timeoutMs / 1000)}s`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
