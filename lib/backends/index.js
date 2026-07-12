import { piBackend } from './pi/index.js';
import { claudeBackend } from './claude/index.js';

/**
 * Backend registry. A backend is a small descriptor object:
 *   { id, label, defaultModelLabel, defaultModelMeta, defaultLightModel,
 *     reasoningLevels, Session, createModelCatalog, runOneShot, detect,
 *     preflightChecks, recoverSessionState }
 * Everything backend-specific lives behind this contract; the server, routes,
 * and frontend only ever see the descriptor.
 */
export const BACKENDS = [piBackend, claudeBackend];

export const DEFAULT_BACKEND_ID = 'pi';

const DETECT_TTL_MS = 60_000;
let detectCache = null;

export function getBackend(id) {
  return BACKENDS.find((backend) => backend.id === id) || null;
}

export function backendIds() {
  return BACKENDS.map((backend) => backend.id);
}

/** Union of every backend's reasoning levels, for storage-level validation. */
export function reasoningLevelUnion() {
  const levels = new Set();
  for (const backend of BACKENDS) {
    for (const level of backend.reasoningLevels) levels.add(level);
  }
  return [...levels];
}

/** The backend descriptor fields that are safe and useful for the browser. */
export function publicBackendInfo(backend) {
  return {
    id: backend.id,
    label: backend.label,
    defaultModelLabel: backend.defaultModelLabel,
    defaultModelMeta: backend.defaultModelMeta,
    reasoningLevels: backend.reasoningLevels,
  };
}

/** Probe which backends are installed. Cached briefly; `force` re-probes. */
export async function detectBackends({ force = false } = {}) {
  if (!force && detectCache && detectCache.expiresAt > Date.now()) return detectCache.results;
  const entries = await Promise.all(
    BACKENDS.map(async (backend) => [backend.id, await backend.detect()]),
  );
  const results = Object.fromEntries(entries);
  detectCache = { results, expiresAt: Date.now() + DETECT_TTL_MS };
  return results;
}

/**
 * Pick the backend to run: the configured one if set, otherwise the sole
 * installed backend, otherwise the default. Never silently falls back when
 * the configured backend is missing — preflight reports that loudly instead.
 */
export function resolveBackendId(configuredId, availability = {}) {
  if (configuredId && getBackend(configuredId)) return configuredId;
  const installed = BACKENDS.filter((backend) => availability[backend.id]?.ok);
  if (installed.length === 1) return installed[0].id;
  return DEFAULT_BACKEND_ID;
}
