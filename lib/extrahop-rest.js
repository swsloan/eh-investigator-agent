// Server-side ExtraHop REST client.
//
// Why this exists: some platform capabilities have no excli tool. Detection
// tuning rules are the first — `GET /detections/rules/hiding` enumerates the
// rules that hide detections, and nothing in the CLI surface exposes it. Without
// it the agent cannot know what `search_detections` is NOT returning, so "no
// detections found" is unfalsifiable.
//
// Credential boundary: this runs in the app, never in the agent's shell. The app
// already holds the ExtraHop credentials (secretStore); the invariant is that the
// AGENT never sees them, and a broker calling out from here is the same trust zone
// as the excli broker. Callers must go through a broker, not hand this to a tool.
//
// Auth mirrors what excli does internally, from the same settings:
//   self-managed (EDA/ECA) — `Authorization: ExtraHop apikey=<key>`
//   RevealX 360            — OAuth2 client credentials -> short-lived bearer
//
// Uses node:https rather than fetch because appliances routinely present
// self-signed certificates and the `insecure` setting has to be honourable
// (same reason lib/research/fetch.js uses node:https).

import https from 'node:https';
import { rx360ApiHostFromTenantId, rx360TenantIdFromTarget } from './settings.js';

const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024; // tuning-rule lists are small; cap anyway
const USER_AGENT = 'ExtraHop-Investigation-Agent/1.0';

/** Tokens are short-lived; cache per (host, clientId) so a burst of reads costs
 *  one token exchange. Keyed on the id, never the secret. */
// A host setting is a host, not a URL. `new URL('https://' + host + '/api/v1')`
// happily reinterprets anything richer, and the failure modes are severe:
//   trusted.example@evil.example -> host becomes evil.example, so the API key
//                                   header is sent to an attacker-chosen server
//   eda.lab?x=1 / eda.lab#f      -> the API path folds into a query/fragment
//   https://eda.lab              -> host becomes literally "https"
// Accept a hostname or IPv4, or a bracketed IPv6 literal, with an optional port.
const HOST_RE = /^(\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?)(:\d{1,5})?$/;

function assertPlainHost(host, label) {
  const value = String(host || '').trim();
  if (!HOST_RE.test(value)) {
    throw new Error(`${label} must be a hostname or IP with an optional port — got something that looks like a URL. Remove any scheme, path, query, or "@".`);
  }
  // Belt and braces: the parsed host must be exactly what was configured, so a
  // form the regex did not anticipate still cannot redirect the request.
  let parsed;
  try { parsed = new URL(`https://${value}/`); } catch { throw new Error(`${label} is not a usable host.`); }
  if (parsed.host !== value.toLowerCase() || parsed.username || parsed.password) {
    throw new Error(`${label} must be a bare hostname or IP with an optional port.`);
  }
  return value;
}

const tokenCache = new Map();
/** Token exchanges in flight, so concurrent reads share one. */
const inflightTokens = new Map();

export function clearTokenCache() { tokenCache.clear(); inflightTokens.clear(); }

/**
 * Work out where to send requests and how to authenticate, from the same config
 * and secrets excli uses. Throws with an actionable message when unconfigured —
 * the agent sees that text, so it must never contain a credential.
 */
export function resolveRestTarget(cfg = {}, secretStore = null) {
  const eh = cfg.extrahop || {};
  const secrets = secretStore?.get?.() || {};
  if (eh.family === 'rx360') {
    const tenantId = rx360TenantIdFromTarget(eh.host);
    if (!tenantId) throw new Error('RevealX 360 tenant is not configured. Set it in Settings → ExtraHop.');
    if (!secrets.clientId || !secrets.clientSecret) {
      throw new Error('RevealX 360 API credentials are not configured. Set the client ID and secret in Settings → ExtraHop.');
    }
    const host = assertPlainHost(rx360ApiHostFromTenantId(tenantId), 'The RevealX 360 API host');
    return {
      host,
      baseUrl: `https://${host}/api/v1`,
      auth: { mode: 'oauth2', clientId: secrets.clientId, clientSecret: secrets.clientSecret },
      insecure: false, // RevealX 360 is a public endpoint with a real certificate
    };
  }
  if (!eh.host) throw new Error('ExtraHop host is not configured. Set it in Settings → ExtraHop.');
  if (!secrets.apiKey) throw new Error('ExtraHop API key is not configured. Set it in Settings → ExtraHop.');
  // Validate BEFORE the key is attached to anything: this is what stops a
  // malformed setting from mailing the credential somewhere else.
  const host = assertPlainHost(eh.host, 'The ExtraHop host');
  return {
    host,
    baseUrl: `https://${host}/api/v1`,
    auth: { mode: 'apikey', apiKey: secrets.apiKey },
    insecure: Boolean(eh.insecure),
  };
}

/** One HTTPS request/response as text. Injectable so tests never touch a socket. */
export function httpsRequest({
  url, method = 'GET', headers = {}, body = null, insecure = false,
  timeoutMs = DEFAULT_TIMEOUT_MS, signal = null,
}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    if (target.protocol !== 'https:') {
      reject(new Error('ExtraHop REST requests must use HTTPS.'));
      return;
    }
    // Check the signal BEFORE creating the request. Destroying a fresh request
    // before its 'error' handler is attached makes Node emit an unhandled
    // 'error', which takes the whole app process down — the brokers run here.
    if (signal?.aborted) {
      reject(new Error('ExtraHop request aborted.'));
      return;
    }
    const req = https.request(target, {
      method,
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', ...headers },
      rejectUnauthorized: !insecure,
      timeout: timeoutMs,
    }, (res) => {
      const chunks = [];
      let size = 0;
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_RESPONSE_BYTES) {
          req.destroy(new Error('ExtraHop response exceeded the size limit.'));
          return;
        }
        chunks.push(chunk);
      });
      let settled = false;
      res.on('end', () => {
        settled = true;
        resolve({
          status: res.statusCode || 0,
          headers: res.headers,
          text: Buffer.concat(chunks).toString('utf8'),
        });
      });
      // A response that errors or dies before `end` would otherwise leave this
      // promise pending forever, and a hung read of "what is suppressed" is
      // indistinguishable from "nothing is suppressed".
      res.on('error', (err) => reject(err));
      res.on('aborted', () => reject(new Error('ExtraHop response was aborted before it completed.')));
      res.on('close', () => {
        if (!settled) reject(new Error('ExtraHop response closed before it completed.'));
      });
    });
    req.on('timeout', () => req.destroy(new Error(`ExtraHop request timed out after ${timeoutMs}ms.`)));
    // Node surfaces a bad certificate here; say so plainly, since the fix is a
    // setting rather than anything the agent can do.
    req.on('error', (err) => {
      const code = err?.code || '';
      if (/^(DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT_IN_CHAIN|ERR_TLS_CERT_ALTNAME_INVALID|UNABLE_TO_VERIFY_LEAF_SIGNATURE)$/.test(code)) {
        reject(new Error(`ExtraHop TLS certificate was rejected (${code}). Enable "allow self-signed" in Settings → ExtraHop if that is expected.`));
        return;
      }
      reject(err);
    });
    // Only now that 'error' is handled is it safe to destroy on abort.
    if (signal) signal.addEventListener('abort', () => req.destroy(new Error('ExtraHop request aborted.')), { once: true });
    if (body != null) req.write(body);
    req.end();
  });
}

/** Fetch (and cache) a RevealX 360 bearer token via client-credentials. */
async function getAccessToken(target, { request, signal, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const key = `${target.host}|${target.auth.clientId}`;
  const hit = tokenCache.get(key);
  // Refresh a minute early so a token cannot expire mid-flight.
  if (hit && hit.expiresAt - 60_000 > Date.now()) return hit.token;
  // Concurrent reads would otherwise each miss the cache and each buy a token.
  // Share one exchange; drop the entry on failure so the next call retries.
  let shared = inflightTokens.get(key);
  if (!shared) {
    // Deliberately NOT given the caller's signal: whoever happens to start the
    // exchange must not be able to cancel it for everyone else waiting on it.
    // The client's own timeout bounds it instead.
    shared = exchangeToken(target, key, { request, timeoutMs: DEFAULT_TIMEOUT_MS })
      .finally(() => inflightTokens.delete(key));
    inflightTokens.set(key, shared);
    // A rejection is consumed by every waiter below; keep an inert catch so a
    // late-arriving caller cannot trip an unhandled rejection.
    shared.catch(() => {});
  }
  // Each caller applies its OWN cancellation and deadline to its wait.
  return awaitWithDeadline(shared, { signal, timeoutMs });
}

/** Resolve `promise`, but give up on this caller's own signal or deadline. */
function awaitWithDeadline(promise, { signal, timeoutMs }) {
  if (!signal && !Number.isFinite(timeoutMs)) return promise;
  return new Promise((resolve, reject) => {
    let done = false;
    const settle = (fn) => (v) => { if (!done) { done = true; cleanup(); fn(v); } };
    const timer = Number.isFinite(timeoutMs)
      ? setTimeout(settle(() => reject(new Error(`ExtraHop token exchange timed out after ${timeoutMs}ms.`))), timeoutMs)
      : null;
    const onAbort = settle(() => reject(new Error('ExtraHop request aborted.')));
    function cleanup() {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
    if (signal?.aborted) { onAbort(); return; }
    signal?.addEventListener('abort', onAbort, { once: true });
    promise.then(settle(resolve), settle(reject));
  });
}

async function exchangeToken(target, key, { request, signal, timeoutMs }) {
  // RFC 6749 §2.3.1 requires the client id and secret to be form-urlencoded
  // before they are joined with ":" and Base64-encoded, or a credential
  // containing ":" or "&" authenticates as something else entirely.
  const id = encodeURIComponent(target.auth.clientId);
  const secret = encodeURIComponent(target.auth.clientSecret);
  const basic = Buffer.from(`${id}:${secret}`).toString('base64');
  const res = await request({
    url: `https://${target.host}/oauth2/token`,
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
    insecure: false,
    timeoutMs,
    signal,
  });
  if (res.status !== 200) {
    // Deliberately does not echo the response body: a token endpoint error can
    // repeat the credential back at us.
    throw new Error(`RevealX 360 token request failed (HTTP ${res.status}). Check the client ID and secret in Settings → ExtraHop.`);
  }
  let parsed;
  try { parsed = JSON.parse(res.text); } catch { throw new Error('RevealX 360 token response was not JSON.'); }
  const token = parsed?.access_token;
  if (!token) throw new Error('RevealX 360 token response carried no access_token.');
  const ttlMs = Number(parsed.expires_in) > 0 ? Number(parsed.expires_in) * 1000 : 10 * 60_000;
  tokenCache.set(key, { token, expiresAt: Date.now() + ttlMs });
  return token;
}

/**
 * GET a REST path (e.g. `/detections/rules/hiding`) and return parsed JSON.
 * `request` is injectable for tests. Errors are phrased for the analyst and
 * never carry a credential.
 */
export async function extrahopGet(apiPath, {
  cfg, secretStore, signal = null, request = httpsRequest, timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  if (typeof apiPath !== 'string' || !apiPath.startsWith('/')) {
    throw new Error('ExtraHop REST path must start with "/".');
  }
  const target = resolveRestTarget(cfg, secretStore);
  const headers = {};
  if (target.auth.mode === 'oauth2') {
    headers.Authorization = `Bearer ${await getAccessToken(target, { request, signal, timeoutMs })}`;
  } else {
    headers.Authorization = `ExtraHop apikey=${target.auth.apiKey}`;
  }

  const res = await request({
    url: `${target.baseUrl}${apiPath}`,
    method: 'GET',
    headers,
    insecure: target.insecure,
    timeoutMs,
    signal,
  });

  if (res.status === 401 || res.status === 403) {
    throw new Error(`ExtraHop refused the request (HTTP ${res.status}). The configured credential may lack the privilege this read needs.`);
  }
  if (res.status === 404) throw new Error(`ExtraHop has no such resource (HTTP 404): ${apiPath}`);
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`ExtraHop returned HTTP ${res.status} for ${apiPath}.`);
  }
  if (!res.text.trim()) return null;
  try {
    return JSON.parse(res.text);
  } catch {
    throw new Error(`ExtraHop returned a non-JSON body for ${apiPath}.`);
  }
}
