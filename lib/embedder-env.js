import fs from 'node:fs';
import path from 'node:path';
import { normalizeEmbedder, sanitizeGroupId } from './settings.js';

// The Graphiti sidecar reads its runtime config from this env file at startup
// (compose `env_file`, required:false). The app owns and rewrites it whenever
// Settings → Memory changes; a memory-stack restart applies it. It carries the
// embedder settings AND the memory namespace (GRAPHITI_GROUP_ID) — the group
// lives here rather than in compose so the UI can own it and so a stack recreate
// cannot silently switch namespaces.
// In the container this points at the bind-mounted runtime dir; locally it
// resolves to the repo copy. Absent values fall back to config.yaml defaults.
export const GRAPHITI_RUNTIME_ENV_PATH = process.env.EH_EMBEDDER_ENV_PATH
  || path.resolve(import.meta.dirname, '..', 'graphiti', 'runtime', 'embedder.env');

/**
 * Render the app-managed graphiti runtime env file from the memory config
 * (`{ embedder, groupId }`). Embedder values are sanitized by normalizeEmbedder
 * and the group by sanitizeGroupId (both reject newlines/quotes/spaces), so
 * plain KEY=value is safe against env-file injection.
 *
 * An empty/invalid groupId is omitted entirely so config.yaml's ${…} fallback
 * still applies — never write a blank GRAPHITI_GROUP_ID, which would hand the
 * sidecar an empty namespace.
 */
export function renderGraphitiRuntimeEnv(memory = {}) {
  const embedder = normalizeEmbedder(memory.embedder);
  const groupId = sanitizeGroupId(memory.groupId);
  return [
    '# Managed by the ExtraHop Investigation Agent — Settings → Memory.',
    '# Read by the Graphiti sidecar at startup; restart the memory stack to apply:',
    '#   docker compose up -d graphiti-mcp',
    '# Safe to edit by hand; the app overwrites it when the memory settings change.',
    `EMBEDDER_MODEL=${embedder.model}`,
    `EMBEDDER_DIMENSIONS=${embedder.dimensions}`,
    `OPENAI_API_URL=${embedder.endpoint}`,
    ...(groupId ? [`GRAPHITI_GROUP_ID=${groupId}`] : []),
    '',
  ].join('\n');
}

/**
 * Write the runtime env file in place (no atomic rename) so a single-file bind
 * mount keeps its inode. Best-effort: a failure here (e.g. read-only mount, no
 * memory stack) must never break settings persistence, so we log and move on.
 * Returns true on success.
 */
export function writeGraphitiRuntimeEnv(memory = {}, file = GRAPHITI_RUNTIME_ENV_PATH) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, renderGraphitiRuntimeEnv(memory));
    return true;
  } catch (err) {
    console.warn(`[graphiti-runtime-env] could not write ${file}: ${err.message}`);
    return false;
  }
}
