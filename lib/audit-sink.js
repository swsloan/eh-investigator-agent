// Pluggable external audit sink (issue #30, Slice C, design layer 4).
//
// At session seal, the signed seal DIGEST is emitted to a destination the app
// cannot later alter — a customer SIEM/webhook, or an append-only file on a WORM
// mount. That external, independent record of (sessionId, keyId, root) is what
// defeats a host-compromised attacker who holds the signing key and re-forges a
// whole valid chain: the forged chain's root won't match what was anchored
// externally. Layers 1–3 are on-box tamper-evidence; THIS is the trust anchor.
//
// The digest carries no secret and no payload — only the seal's public identifiers
// (keyId, root hash) plus the session id and time — so anchoring it is always safe.
//
// Emission is best-effort: it never throws and never blocks the seal, because a
// down SIEM must not break the ability to seal a record locally.

import fs from 'node:fs';
import path from 'node:path';

const HTTP_TIMEOUT_MS = 8000;

/** The non-secret, anchorable digest of a seal. */
export function sealDigest(sessionId, seal = {}) {
  return {
    type: 'audit_seal',
    sessionId,
    keyId: seal.keyId || null,
    root: seal.root || null,
    alg: seal.alg || 'ed25519',
    sealedAt: seal.at || new Date().toISOString(),
  };
}

/**
 * Resolve the sink config, environment-first (a sink is deployment-specific, like
 * the memory-proxy/auth tokens), falling back to app config `audit.sink`.
 *   EH_AUDIT_SINK      = none | file | http   (default none)
 *   EH_AUDIT_SINK_PATH = append-only JSONL path (file)
 *   EH_AUDIT_SINK_URL  = POST endpoint (http)
 *   EH_AUDIT_SINK_TOKEN= optional bearer for the http endpoint
 * A production token belongs in the secret store / a secret env, not app config.
 */
export function resolveAuditSinkConfig(env = process.env, appConfig = {}) {
  const type = (env.EH_AUDIT_SINK || appConfig?.audit?.sink?.type || 'none').trim();
  if (type === 'file') return { type, path: env.EH_AUDIT_SINK_PATH || appConfig?.audit?.sink?.path || '' };
  if (type === 'http') {
    return {
      type,
      url: env.EH_AUDIT_SINK_URL || appConfig?.audit?.sink?.url || '',
      token: env.EH_AUDIT_SINK_TOKEN || appConfig?.audit?.sink?.token || '',
    };
  }
  return { type: 'none' };
}

/**
 * Create a sink whose `emit(digest)` dispatches to the currently-configured
 * destination. `getConfig()` is re-read on every emit so a config change takes
 * effect without a restart. Returns { ok, type, emitted, error }; never throws.
 */
export function createAuditSink(getConfig = () => ({ type: 'none' }), { logger = console, fetchImpl = fetch } = {}) {
  async function emit(digest) {
    let cfg;
    try { cfg = getConfig() || { type: 'none' }; } catch { cfg = { type: 'none' }; }
    const type = cfg.type || 'none';
    try {
      if (type === 'none') return { ok: true, type, emitted: false };
      if (type === 'file') return emitFile(cfg, digest);
      if (type === 'http') return await emitHttp(cfg, digest, fetchImpl);
      logger?.warn?.(`[audit-sink] unknown sink type "${type}" — seal not anchored`);
      return { ok: false, type, emitted: false, error: 'unknown sink type' };
    } catch (err) {
      // Never let an anchoring failure break sealing.
      logger?.warn?.(`[audit-sink] emit to ${type} failed: ${err?.message || err}`);
      return { ok: false, type, emitted: false, error: err?.message || String(err) };
    }
  }
  return { emit };
}

function emitFile(cfg, digest) {
  if (!cfg.path) return { ok: false, type: 'file', emitted: false, error: 'no EH_AUDIT_SINK_PATH configured' };
  fs.mkdirSync(path.dirname(cfg.path), { recursive: true });
  fs.appendFileSync(cfg.path, `${JSON.stringify(digest)}\n`);
  return { ok: true, type: 'file', emitted: true };
}

async function emitHttp(cfg, digest, fetchImpl) {
  if (!cfg.url) return { ok: false, type: 'http', emitted: false, error: 'no EH_AUDIT_SINK_URL configured' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  try {
    const res = await fetchImpl(cfg.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(cfg.token ? { authorization: `Bearer ${cfg.token}` } : {}) },
      body: JSON.stringify(digest),
      signal: controller.signal,
    });
    return { ok: !!res.ok, type: 'http', emitted: !!res.ok, status: res.status };
  } finally {
    clearTimeout(timer);
  }
}
