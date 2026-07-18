import crypto from 'node:crypto';
import fs from 'node:fs';
import { Readable } from 'node:stream';

export const LOCAL_MEMORY_PROXY_TOKEN = 'eh-memory-proxy-local';

// The only Anthropic operation the Graphiti memory extractor is known to call.
// Kept intentionally tight (fail-closed). If a future Graphiti/SDK version needs
// another Messages-family operation (e.g. 'POST /v1/messages/count_tokens'), add
// it here — a blocked operation is logged (see logBlockedOperation) so it never
// fails silently.
const DEFAULT_ALLOWED_OPERATIONS = new Map([
  ['POST', new Set(['/v1/messages'])],
]);

const DEFAULT_MAX_BODY_BYTES = 4 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 90_000;
const DEFAULT_MAX_REQUESTS_PER_MINUTE = 120;
const DEFAULT_MAX_CONCURRENT = 8;
const STRONG_TOKEN_MIN_LENGTH = 32;
const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'content-encoding',
  'content-length',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

class RequestTooLargeError extends Error {}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function bool(value) {
  return /^(1|true|yes|on)$/i.test(String(value || ''));
}

function readTokenFile(tokenFile, readFile = fs.readFileSync) {
  try {
    const token = String(readFile(tokenFile, 'utf8')).trim();
    if (!token) throw new Error('file is empty');
    return token;
  } catch (error) {
    throw new Error(`Unable to read EH_MEMORY_PROXY_TOKEN_FILE (${tokenFile}): ${error.message}`);
  }
}

/**
 * Resolve the proxy deployment profile and token once at startup. The familiar
 * local default is preserved for the loopback-only Compose profile. Hardened,
 * remote, and explicitly strong-token deployments fail closed instead.
 */
export function resolveMemoryProxyConfig(env = process.env, { readFile = fs.readFileSync } = {}) {
  const profile = String(env.EH_DEPLOYMENT_PROFILE || 'local').trim().toLowerCase();
  const supportedProfiles = new Set(['local', 'hardened', 'remote', 'shared']);
  if (!supportedProfiles.has(profile)) {
    throw new Error(`Unsupported EH_DEPLOYMENT_PROFILE: ${profile}`);
  }

  const tokenFile = String(env.EH_MEMORY_PROXY_TOKEN_FILE || '').trim();
  const token = tokenFile
    ? readTokenFile(tokenFile, readFile)
    : String(env.EH_MEMORY_PROXY_TOKEN || LOCAL_MEMORY_PROXY_TOKEN);
  const requireStrongToken = profile !== 'local' || bool(env.EH_MEMORY_PROXY_REQUIRE_STRONG);

  if (requireStrongToken && (token === LOCAL_MEMORY_PROXY_TOKEN || token.length < STRONG_TOKEN_MIN_LENGTH)) {
    throw new Error(
      `EH_DEPLOYMENT_PROFILE=${profile} requires a non-default memory proxy token of at least ${STRONG_TOKEN_MIN_LENGTH} characters`,
    );
  }

  return {
    profile,
    token,
    tokenSource: tokenFile ? 'file' : (env.EH_MEMORY_PROXY_TOKEN ? 'environment' : 'local-default'),
    maxBodyBytes: positiveInteger(env.EH_MEMORY_PROXY_MAX_BODY_BYTES, DEFAULT_MAX_BODY_BYTES),
    timeoutMs: positiveInteger(env.EH_MEMORY_PROXY_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
    maxRequestsPerMinute: positiveInteger(
      env.EH_MEMORY_PROXY_MAX_REQUESTS_PER_MINUTE,
      DEFAULT_MAX_REQUESTS_PER_MINUTE,
    ),
    maxConcurrent: positiveInteger(env.EH_MEMORY_PROXY_MAX_CONCURRENT, DEFAULT_MAX_CONCURRENT),
  };
}

/** Hash both values before comparison so timingSafeEqual always receives equal lengths. */
export function tokensMatch(candidate, expected) {
  const left = crypto.createHash('sha256').update(String(candidate || ''), 'utf8').digest();
  const right = crypto.createHash('sha256').update(String(expected || ''), 'utf8').digest();
  return crypto.timingSafeEqual(left, right);
}

// Split the mounted request into the operation path (matched against the
// allowlist) and the original query string (forwarded verbatim to upstream, as
// the pre-hardening proxy did — Anthropic ignores unknown params, but dropping a
// caller-supplied query would silently change request semantics).
function parseOperation(req, mountPath) {
  const original = new URL(req.originalUrl || req.url || '/', 'http://memory-proxy.local');
  if (!original.pathname.startsWith(mountPath)) return { pathname: '', search: '' };
  return { pathname: original.pathname.slice(mountPath.length) || '/', search: original.search };
}

function operationAllowed(method, pathname, allowedOperations) {
  return allowedOperations.get(method)?.has(pathname) === true;
}

function readBoundedBody(req, maxBodyBytes, signal) {
  const declaredLength = Number.parseInt(req.headers['content-length'], 10);
  if (Number.isFinite(declaredLength) && declaredLength > maxBodyBytes) {
    throw new RequestTooLargeError('request body exceeds the configured limit');
  }

  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;

    const cleanup = () => {
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('error', onError);
      req.off('aborted', onAborted);
      req.off('close', onClose);
      signal?.removeEventListener('abort', onAbort);
    };
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    };
    const onData = (chunk) => {
      size += chunk.length;
      if (size > maxBodyBytes) {
        req.resume();
        finish(reject, new RequestTooLargeError('request body exceeds the configured limit'));
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = () => finish(resolve, Buffer.concat(chunks));
    const onError = (error) => finish(reject, error);
    const onAborted = () => finish(reject, new Error('client aborted request'));
    // 'aborted' is deprecated and may not fire; 'close' always does. Without it a
    // disconnect that emits neither 'end' nor 'error' would leave this promise
    // unsettled, so the handler's finally never runs and a concurrency slot leaks.
    const onClose = () => finish(reject, new Error('client closed request before body completed'));
    // A stalled-but-open upload emits none of the above, so the read would hang on
    // a concurrency slot indefinitely. The handler's request deadline aborts this
    // signal to bound it; drain what arrived and reject with the abort reason.
    const onAbort = () => {
      req.resume();
      finish(reject, signal?.reason instanceof Error ? signal.reason : new Error('request body read aborted'));
    };

    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }

    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
    req.on('aborted', onAborted);
    req.on('close', onClose);
  });
}

function sendJson(res, status, body, extraHeaders = {}) {
  // Nothing to send once headers are out or the socket is gone (e.g. the client
  // disconnected mid-request); writing to a destroyed response would throw.
  if (res.headersSent || res.writableEnded || res.destroyed) return;
  for (const [name, value] of Object.entries(extraHeaders)) res.setHeader(name, value);
  res.status(status).json(body);
}

function pipeUpstreamBody(upstream, res) {
  return new Promise((resolve, reject) => {
    if (!upstream.body) {
      res.end();
      resolve();
      return;
    }

    const source = typeof upstream.body.getReader === 'function'
      ? Readable.fromWeb(upstream.body)
      : upstream.body;
    const cleanup = () => {
      source.removeListener?.('error', onError);
      res.removeListener('finish', onFinish);
      res.removeListener('close', onClose);
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const onFinish = () => {
      cleanup();
      resolve();
    };
    const onClose = () => {
      if (!res.writableFinished) {
        const error = new Error('Downstream connection closed before the proxy response completed.');
        cleanup();
        source.unpipe?.(res);
        source.destroy?.();
        reject(error);
      }
    };

    source.once?.('error', onError);
    res.once('finish', onFinish);
    res.once('close', onClose);
    source.pipe(res);
  });
}

/**
 * Create the internal Graphiti -> Anthropic proxy handler. State used for rate
 * and concurrency limiting is intentionally local to this handler instance.
 */
export function createMemoryLlmProxyHandler({
  getAnthropicApiKey,
  proxyConfig,
  fetchImpl = globalThis.fetch,
  redactError = (message) => message,
  mountPath = '/memory-llm',
  allowedOperations = DEFAULT_ALLOWED_OPERATIONS,
  logBlockedOperation = () => {},
  now = Date.now,
} = {}) {
  if (typeof getAnthropicApiKey !== 'function') throw new TypeError('getAnthropicApiKey is required');
  if (!proxyConfig?.token) throw new TypeError('proxyConfig.token is required');
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl is required');

  let windowStartedAt = now();
  let requestsInWindow = 0;
  let activeRequests = 0;

  return async function memoryLlmProxy(req, res) {
    if (!tokensMatch(req.headers['x-api-key'], proxyConfig.token)) {
      return sendJson(res, 403, { error: 'forbidden' });
    }

    const method = String(req.method || '').toUpperCase();
    const { pathname, search } = parseOperation(req, mountPath);
    if (!operationAllowed(method, pathname, allowedOperations)) {
      // Surface the denied operation so a legitimate op a future Graphiti/SDK
      // version starts issuing is visible in logs instead of silently 404ing
      // memory extraction. See DEFAULT_ALLOWED_OPERATIONS.
      logBlockedOperation(method, pathname);
      if (!allowedOperations.has(method)) res.setHeader('allow', [...allowedOperations.keys()].join(', '));
      return sendJson(res, method === 'POST' ? 404 : 405, { error: 'memory proxy operation not allowed' });
    }

    const realKey = String(getAnthropicApiKey() || '');
    if (!realKey) {
      return sendJson(res, 503, { error: 'No Anthropic API key configured. Set it in Settings → Memory.' });
    }

    const timestamp = now();
    if (timestamp - windowStartedAt >= 60_000) {
      windowStartedAt = timestamp;
      requestsInWindow = 0;
    }
    if (requestsInWindow >= proxyConfig.maxRequestsPerMinute) {
      const retryAfter = Math.max(1, Math.ceil((60_000 - (timestamp - windowStartedAt)) / 1000));
      return sendJson(res, 429, { error: 'memory proxy rate limit exceeded' }, { 'retry-after': retryAfter });
    }
    if (activeRequests >= proxyConfig.maxConcurrent) {
      return sendJson(res, 429, { error: 'memory proxy concurrency limit exceeded' }, { 'retry-after': 1 });
    }

    requestsInWindow += 1;
    activeRequests += 1;
    const controller = new AbortController();
    // Start the deadline BEFORE reading the body: a stalled-but-open upload would
    // otherwise hang in readBoundedBody with no timer and hold its concurrency slot
    // until the OS socket timeout. The same controller bounds the read, the upstream
    // fetch, and the response pipe.
    const timeout = setTimeout(() => controller.abort(new Error('upstream timeout')), proxyConfig.timeoutMs);
    // Cancel in-flight work if either side disconnects. 'aborted' on req is
    // deprecated/unreliable, and a client that drops after finishing the upload
    // (but before the upstream returns) only surfaces on res 'close' — watch both.
    const abortForDisconnect = () => controller.abort(new Error('client aborted request'));
    req.once('aborted', abortForDisconnect);
    res.once('close', abortForDisconnect);
    try {
      let body;
      try {
        body = await readBoundedBody(req, proxyConfig.maxBodyBytes, controller.signal);
      } catch (error) {
        if (error instanceof RequestTooLargeError) {
          return sendJson(res, 413, { error: 'memory proxy request body too large' });
        }
        if (controller.signal.aborted) {
          return sendJson(res, 504, { error: 'memory LLM proxy timed out reading the request body' });
        }
        return sendJson(res, 400, { error: 'unable to read memory proxy request' });
      }

      const upstream = await fetchImpl(`https://api.anthropic.com${pathname}${search}`, {
        method,
        headers: {
          'content-type': req.headers['content-type'] || 'application/json',
          accept: req.headers.accept || 'application/json',
          'anthropic-version': req.headers['anthropic-version'] || '2023-06-01',
          ...(req.headers['anthropic-beta'] ? { 'anthropic-beta': req.headers['anthropic-beta'] } : {}),
          'x-api-key': realKey,
        },
        body,
        signal: controller.signal,
      });
      res.status(upstream.status);
      upstream.headers.forEach((value, name) => {
        if (!HOP_BY_HOP_HEADERS.has(name.toLowerCase())) res.setHeader(name, value);
      });
      await pipeUpstreamBody(upstream, res);
    } catch (error) {
      if (res.headersSent) {
        res.destroy(error);
      } else if (controller.signal.aborted) {
        sendJson(res, 504, { error: 'memory LLM upstream timed out or was cancelled' });
      } else {
        sendJson(res, 502, { error: redactError(error.message || 'memory LLM proxy failed') });
      }
    } finally {
      clearTimeout(timeout);
      req.off('aborted', abortForDisconnect);
      res.off('close', abortForDisconnect);
      activeRequests -= 1;
    }
  };
}
