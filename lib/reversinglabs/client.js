import https from 'node:https';

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_REQUEST_BYTES = 256 * 1024;
const DEFAULT_MAX_RESPONSE_BYTES = 10 * 1024 * 1024;
const MAX_TOKEN_LENGTH = 4_096;

function isJsonContentType(value) {
  return /^application\/(?:[^;]+\+)?json(?:\s*;|$)/i.test(String(value || '').trim());
}

export class ReversingLabsError extends Error {
  constructor(message, { code = 'RL_REQUEST_FAILED', status = null } = {}) {
    super(message);
    this.name = 'ReversingLabsError';
    this.code = code;
    this.status = Number.isInteger(status) ? status : null;
  }
}

export function normalizeReversingLabsBaseUrl(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw || /[\r\n\0]/.test(raw)) {
    throw new ReversingLabsError('ReversingLabs requires a Spectra Analyze host.', {
      code: 'RL_HOST_REQUIRED',
    });
  }
  let url;
  try {
    url = new URL(raw.includes('://') ? raw : `https://${raw}`);
  } catch {
    throw new ReversingLabsError('The configured ReversingLabs host is invalid.', {
      code: 'RL_HOST_INVALID',
    });
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
    || (url.pathname && url.pathname !== '/')) {
    throw new ReversingLabsError(
      'The ReversingLabs host must be an HTTPS origin without credentials, a path, a query, or a fragment.',
      { code: 'RL_HOST_INVALID' },
    );
  }
  url.pathname = '/';
  return url;
}

export function normalizeReversingLabsToken(token) {
  if (typeof token !== 'string' || !token.trim()) {
    throw new ReversingLabsError('ReversingLabs requires an API token in Settings → Integrations.', {
      code: 'RL_TOKEN_REQUIRED',
    });
  }
  const normalized = token.trim();
  if (normalized.length > MAX_TOKEN_LENGTH || /[\r\n\0]/.test(normalized)) {
    throw new ReversingLabsError('The configured ReversingLabs API token is invalid.', {
      code: 'RL_TOKEN_INVALID',
    });
  }
  return normalized;
}

export function isValidReversingLabsToken(token) {
  try {
    normalizeReversingLabsToken(token);
    return true;
  } catch {
    return false;
  }
}

function normalizedToken(secretStore) {
  return normalizeReversingLabsToken(secretStore?.get?.().reversingLabsApiToken);
}

export function reversingLabsClientStatus(config = {}, secretStore = null) {
  const settings = config.integrations?.reversingLabs || {};
  const enabled = settings.enabled === true;
  const allowCloud = settings.allowCloud === true;
  const insecure = settings.insecure === true;
  const rawToken = secretStore?.get?.().reversingLabsApiToken;
  const tokenPresent = Boolean(typeof rawToken === 'string' && rawToken);
  const tokenConfigured = isValidReversingLabsToken(rawToken);
  let hostConfigured = false;
  let hostValid = false;
  try {
    hostConfigured = Boolean(typeof settings.host === 'string' && settings.host.trim());
    if (hostConfigured) {
      normalizeReversingLabsBaseUrl(settings.host);
      hostValid = true;
    }
  } catch {
    hostValid = false;
  }
  const configured = enabled && hostValid && tokenConfigured;
  let message;
  if (!enabled) message = 'ReversingLabs is disabled.';
  else if (!hostConfigured) message = 'ReversingLabs is enabled but its Spectra Analyze host is missing.';
  else if (!hostValid) message = 'ReversingLabs is enabled but its Spectra Analyze host is invalid.';
  else if (!tokenPresent) message = 'ReversingLabs is enabled but its API token is missing.';
  else if (!tokenConfigured) message = 'ReversingLabs is enabled but its API token is invalid.';
  else message = 'ReversingLabs Spectra Analyze is configured.';
  return {
    ok: configured,
    enabled,
    configured,
    hostConfigured,
    tokenConfigured,
    allowCloud,
    tlsVerification: !insecure,
    message,
  };
}

/**
 * Minimal HTTPS JSON transport. It deliberately does not follow redirects and
 * never includes response bodies in thrown errors.
 */
export function requestReversingLabsJson({
  url,
  method,
  headers,
  body = null,
  insecure = false,
  signal = undefined,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES,
} = {}) {
  return new Promise((resolve, reject) => {
    const request = https.request(url, {
      method,
      headers,
      rejectUnauthorized: !insecure,
      signal,
    }, (response) => {
      const status = Number(response.statusCode) || 0;
      if (status >= 300 && status < 400) {
        response.resume();
        resolve({ status, headers: response.headers, data: null });
        return;
      }

      const contentLength = Number.parseInt(response.headers['content-length'], 10);
      if (Number.isFinite(contentLength) && contentLength > maxResponseBytes) {
        response.resume();
        reject(new ReversingLabsError('The ReversingLabs response exceeded the safe size limit.', {
          code: 'RL_RESPONSE_TOO_LARGE',
          status,
        }));
        return;
      }

      let size = 0;
      const chunks = [];
      response.on('data', (chunk) => {
        size += chunk.length;
        if (size > maxResponseBytes) {
          response.destroy(new ReversingLabsError(
            'The ReversingLabs response exceeded the safe size limit.',
            { code: 'RL_RESPONSE_TOO_LARGE', status },
          ));
          return;
        }
        chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (!text) {
          if (status >= 200 && status < 300) {
            reject(new ReversingLabsError('ReversingLabs returned an empty response instead of JSON.', {
              code: 'RL_INVALID_RESPONSE',
              status,
            }));
          } else {
            resolve({ status, headers: response.headers, data: null });
          }
          return;
        }
        if (!isJsonContentType(response.headers['content-type'])) {
          if (status >= 200 && status < 300) {
            reject(new ReversingLabsError('ReversingLabs returned a non-JSON response.', {
              code: 'RL_INVALID_RESPONSE',
              status,
            }));
          } else {
            resolve({ status, headers: response.headers, data: null });
          }
          return;
        }
        try {
          resolve({ status, headers: response.headers, data: JSON.parse(text) });
        } catch {
          if (status >= 200 && status < 300) {
            reject(new ReversingLabsError('ReversingLabs returned malformed JSON.', {
              code: 'RL_INVALID_RESPONSE',
              status,
            }));
          } else {
            resolve({ status, headers: response.headers, data: null });
          }
        }
      });
    });

    request.setTimeout(timeoutMs, () => {
      request.destroy(new ReversingLabsError('The ReversingLabs request timed out.', {
        code: 'RL_TIMEOUT',
      }));
    });
    const totalTimeout = globalThis.setTimeout(() => {
      request.destroy(new ReversingLabsError('The ReversingLabs request timed out.', {
        code: 'RL_TIMEOUT',
      }));
    }, timeoutMs);
    totalTimeout.unref?.();
    request.once('close', () => globalThis.clearTimeout(totalTimeout));
    request.on('error', reject);
    if (body) request.write(body);
    request.end();
  });
}

function httpError(status) {
  if (status >= 300 && status < 400) {
    return new ReversingLabsError('ReversingLabs returned a redirect; redirects are disabled.', {
      code: 'RL_REDIRECT_REJECTED', status,
    });
  }
  if (status === 400 || status === 422) {
    return new ReversingLabsError('ReversingLabs rejected the request.', {
      code: 'RL_BAD_REQUEST', status,
    });
  }
  if (status === 401 || status === 403) {
    return new ReversingLabsError('ReversingLabs authentication failed. Check the API token and its permissions.', {
      code: 'RL_AUTH_FAILED', status,
    });
  }
  if (status === 404) {
    return new ReversingLabsError('The requested ReversingLabs resource was not found.', {
      code: 'RL_NOT_FOUND', status,
    });
  }
  if (status === 408 || status === 504) {
    return new ReversingLabsError('The ReversingLabs request timed out.', {
      code: 'RL_TIMEOUT', status,
    });
  }
  if (status === 413) {
    return new ReversingLabsError('ReversingLabs rejected the request because it was too large.', {
      code: 'RL_REQUEST_TOO_LARGE', status,
    });
  }
  if (status === 429) {
    return new ReversingLabsError('ReversingLabs rate-limited the request. Retry later.', {
      code: 'RL_RATE_LIMITED', status,
    });
  }
  if (status >= 500) {
    return new ReversingLabsError('ReversingLabs could not complete the request.', {
      code: 'RL_SERVER_ERROR', status,
    });
  }
  return new ReversingLabsError('ReversingLabs returned an unexpected HTTP status.', {
    code: 'RL_HTTP_ERROR', status,
  });
}

export class ReversingLabsClient {
  constructor({
    getConfig = () => ({}),
    secretStore = null,
    request = requestReversingLabsJson,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxRequestBytes = DEFAULT_MAX_REQUEST_BYTES,
    maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES,
  } = {}) {
    this.getConfig = getConfig;
    this.secretStore = secretStore;
    this.request = request;
    this.timeoutMs = timeoutMs;
    this.maxRequestBytes = maxRequestBytes;
    this.maxResponseBytes = maxResponseBytes;
    this.activeRequests = new Set();
  }

  status() {
    return reversingLabsClientStatus(this.getConfig(), this.secretStore);
  }

  configuration() {
    const config = this.getConfig() || {};
    const settings = config.integrations?.reversingLabs || {};
    if (settings.enabled !== true) {
      throw new ReversingLabsError(
        'ReversingLabs is disabled. Enable and configure it in Settings → Integrations.',
        { code: 'RL_DISABLED' },
      );
    }
    return {
      baseUrl: normalizeReversingLabsBaseUrl(settings.host),
      token: normalizedToken(this.secretStore),
      insecure: settings.insecure === true,
      allowCloud: settings.allowCloud === true,
    };
  }

  async requestJson(path, { method = 'GET', body = null, query = null } = {}) {
    if (typeof path !== 'string' || !path.startsWith('/') || path.includes('://')
      || /[\r\n\0?#]/.test(path)) {
      throw new ReversingLabsError('The ReversingLabs client rejected an invalid API path.', {
        code: 'RL_PATH_INVALID',
      });
    }
    const { baseUrl, token, insecure } = this.configuration();
    const url = new URL(path, baseUrl);
    if (url.origin !== baseUrl.origin) {
      throw new ReversingLabsError('The ReversingLabs client rejected a cross-origin API path.', {
        code: 'RL_PATH_INVALID',
      });
    }
    if (query !== null) {
      if (!query || typeof query !== 'object' || Array.isArray(query)
        || Object.keys(query).length > 16) {
        throw new ReversingLabsError('The ReversingLabs client rejected invalid query parameters.', {
          code: 'RL_QUERY_INVALID',
        });
      }
      for (const [key, rawValue] of Object.entries(query)) {
        const value = typeof rawValue === 'string' ? rawValue : String(rawValue);
        if (!/^[a-z][a-z0-9_]{0,63}$/i.test(key) || !value || value.length > 2_048
          || /[\r\n\0]/.test(value)) {
          throw new ReversingLabsError('The ReversingLabs client rejected invalid query parameters.', {
            code: 'RL_QUERY_INVALID',
          });
        }
        url.searchParams.set(key, value);
      }
      if (url.href.length > 4_096) {
        throw new ReversingLabsError('The ReversingLabs query exceeded the safe size limit.', {
          code: 'RL_QUERY_INVALID',
        });
      }
    }

    let encodedBody = null;
    if (body !== null) {
      try { encodedBody = JSON.stringify(body); } catch {
        throw new ReversingLabsError('The ReversingLabs request body is not valid JSON data.', {
          code: 'RL_REQUEST_INVALID',
        });
      }
      if (Buffer.byteLength(encodedBody) > this.maxRequestBytes) {
        throw new ReversingLabsError('The ReversingLabs request exceeded the safe size limit.', {
          code: 'RL_REQUEST_TOO_LARGE',
        });
      }
    }

    const headers = {
      Accept: 'application/json',
      'Accept-Encoding': 'identity',
      Authorization: `Token ${token}`,
      'User-Agent': 'ExtraHop-Investigation-Agent/ReversingLabs-Integration',
    };
    if (encodedBody !== null) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = String(Buffer.byteLength(encodedBody));
    }

    const controller = new AbortController();
    this.activeRequests.add(controller);
    let response;
    try {
      response = await this.request({
        url,
        method,
        headers,
        body: encodedBody,
        insecure,
        signal: controller.signal,
        timeoutMs: this.timeoutMs,
        maxResponseBytes: this.maxResponseBytes,
      });
    } catch (err) {
      if (err instanceof ReversingLabsError) throw err;
      if (err?.name === 'AbortError' || err?.code === 'ABORT_ERR') {
        throw new ReversingLabsError('The ReversingLabs request was cancelled.', {
          code: 'RL_ABORTED',
        });
      }
      throw new ReversingLabsError('The ReversingLabs request could not connect securely.', {
        code: 'RL_CONNECTION_FAILED',
      });
    } finally {
      this.activeRequests.delete(controller);
    }

    const status = Number(response?.status ?? response?.statusCode);
    if (!Number.isInteger(status) || status < 100 || status > 599) {
      throw new ReversingLabsError('The ReversingLabs transport returned an invalid response.', {
        code: 'RL_INVALID_RESPONSE',
      });
    }
    if (status < 200 || status >= 300) throw httpError(status);
    return Object.prototype.hasOwnProperty.call(response || {}, 'data')
      ? response.data
      : response.body;
  }

  get(path, query = null) {
    return this.requestJson(path, { method: 'GET', query });
  }

  post(path, body) {
    return this.requestJson(path, { method: 'POST', body });
  }

  abortAll() {
    for (const controller of this.activeRequests) controller.abort();
  }
}
