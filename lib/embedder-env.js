import fs from 'node:fs';
import path from 'node:path';
import { normalizeEmbedder } from './settings.js';

// The Graphiti sidecar reads its embedder config from this env file at startup
// (compose `env_file`, required:false). The app owns and rewrites it whenever
// Settings → Memory → Embedder changes; a memory-stack restart applies it.
// In the container this points at the bind-mounted runtime dir; locally it
// resolves to the repo copy. Absent values fall back to config.yaml defaults.
export const EMBEDDER_ENV_PATH = process.env.EH_EMBEDDER_ENV_PATH
  || path.resolve(import.meta.dirname, '..', 'graphiti', 'runtime', 'embedder.env');

/**
 * Render the app-managed embedder env file. Values are already sanitized by
 * normalizeEmbedder (no newlines/quotes/spaces), so plain KEY=value is safe.
 */
export function renderEmbedderEnv(rawEmbedder = {}) {
  const embedder = normalizeEmbedder(rawEmbedder);
  return [
    '# Managed by the ExtraHop Investigation Agent — Settings → Memory → Embedder.',
    '# Read by the Graphiti sidecar at startup; restart the memory stack to apply:',
    '#   docker compose up -d graphiti-mcp',
    '# Safe to edit by hand; the app overwrites it when the embedder settings change.',
    `EMBEDDER_MODEL=${embedder.model}`,
    `EMBEDDER_DIMENSIONS=${embedder.dimensions}`,
    `OPENAI_API_URL=${embedder.endpoint}`,
    '',
  ].join('\n');
}

/**
 * Write the embedder env file in place (no atomic rename) so a single-file bind
 * mount keeps its inode. Best-effort: a failure here (e.g. read-only mount, no
 * memory stack) must never break settings persistence, so we log and move on.
 * Returns true on success.
 */
export function writeEmbedderEnv(rawEmbedder = {}, file = EMBEDDER_ENV_PATH) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, renderEmbedderEnv(rawEmbedder));
    return true;
  } catch (err) {
    console.warn(`[embedder-env] could not write ${file}: ${err.message}`);
    return false;
  }
}
