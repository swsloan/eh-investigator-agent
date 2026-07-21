import ipaddr from 'ipaddr.js';
import { CANONICAL_OPERATIONS, CanonicalResearchService } from './canonical.js';
import { fetchReadable, isPublicAddress, validateResearchUrl } from './fetch.js';
import { searchBrave, searchDuckDuckGo } from './providers.js';

const PROVIDERS = new Set(['auto', 'duckduckgo', 'brave', 'claude']);
const FRESHNESS = new Set(['', 'day', 'week', 'month', 'year']);
const PRIVATE_HOSTNAME_RE = /\b(?:localhost|[a-z0-9.-]+\.(?:local|internal|lan|corp))\b/i;

export function researchSettings(config = {}, secretStore = null) {
  const webResearch = config.integrations?.webResearch || {};
  const requested = webResearch.provider;
  const provider = PROVIDERS.has(requested) ? requested : 'auto';
  const braveConfigured = Boolean(secretStore?.get?.().braveApiKey);
  const effectiveProvider = provider === 'auto'
    ? (braveConfigured ? 'brave' : (config.backend === 'claude' ? 'claude' : 'duckduckgo'))
    : provider;
  return { provider, effectiveProvider, braveConfigured };
}

function normalizeSearchInput(input = {}) {
  const query = typeof input.query === 'string' ? input.query.trim() : '';
  if (!query || query.length > 500 || /[\r\n\0]/.test(query)) {
    throw new Error('Research search requires a single-line query of 1-500 characters.');
  }
  const count = Math.min(10, Math.max(1, Number.parseInt(input.count, 10) || 8));
  const freshness = FRESHNESS.has(input.freshness) ? input.freshness : '';
  return { query, count, freshness };
}

function configuredExtraHopHostname(config = {}) {
  const value = String(config.extrahop?.host || '').trim();
  if (!value) return '';
  try { return new URL(value.includes('://') ? value : `https://${value}`).hostname.toLowerCase(); } catch { return ''; }
}

function containsNonPublicAddress(value) {
  const text = String(value);
  const candidates = [
    ...(text.match(/(?:^|[^\d.])((?:\d{1,3}\.){3}\d{1,3})(?=$|[^\d.])/g) || [])
      .map((candidate) => candidate.match(/(?:\d{1,3}\.){3}\d{1,3}/)?.[0]),
    ...(text.match(/[\[\]a-f0-9:%]*:[a-f0-9:%:]+/gi) || [])
      .filter((candidate) => (candidate.match(/:/g) || []).length >= 2),
  ].filter(Boolean);
  return candidates.some((candidate) => {
    const address = candidate.replace(/^\[/, '').replace(/\]$/, '').split('%')[0];
    return ipaddr.isValid(address) && !isPublicAddress(address);
  });
}

export class ResearchService {
  constructor({
    getConfig = () => ({}),
    secretStore = null,
    duckOptions = {},
    braveOptions = {},
    fetchOptions = {},
    canonicalOptions = {},
    canonicalService = null,
  } = {}) {
    this.getConfig = getConfig;
    this.secretStore = secretStore;
    this.duckOptions = duckOptions;
    this.braveOptions = braveOptions;
    this.fetchOptions = fetchOptions;
    this.canonical = canonicalService || new CanonicalResearchService(canonicalOptions);
  }

  status() {
    const settings = researchSettings(this.getConfig(), this.secretStore);
    return {
      ok: settings.effectiveProvider !== 'brave' || settings.braveConfigured,
      ...settings,
      canonicalResolvers: [...CANONICAL_OPERATIONS],
      message: settings.effectiveProvider === 'brave'
        ? (settings.braveConfigured ? 'Brave Search is configured.' : 'Brave Search is selected but its API key is missing.')
        : settings.effectiveProvider === 'claude'
          ? 'Claude Code built-in web search is selected.'
          : 'DuckDuckGo HTML search is the zero-account fallback.',
    };
  }

  validateExternalValue(value) {
    const text = String(value);
    for (const secret of this.secretStore?.values?.() || []) {
      if (secret && text.includes(secret)) {
        throw new Error('Research request rejected input containing a configured secret.');
      }
    }
    const host = configuredExtraHopHostname(this.getConfig());
    if ((host && text.toLowerCase().includes(host)) || PRIVATE_HOSTNAME_RE.test(text) || containsNonPublicAddress(text)) {
      throw new Error('Research request rejected input that appears to contain an internal hostname or non-public address.');
    }
  }

  validateQuery(query) {
    this.validateExternalValue(query);
  }

  validatePayload(payload, depth = 0) {
    if (depth > 8) throw new Error('Research request exceeded the input nesting limit.');
    if (typeof payload === 'string' || typeof payload === 'number') {
      this.validateExternalValue(payload);
      return;
    }
    if (Array.isArray(payload)) {
      for (const item of payload) this.validatePayload(item, depth + 1);
      return;
    }
    if (payload && typeof payload === 'object') {
      for (const value of Object.values(payload)) this.validatePayload(value, depth + 1);
    }
  }

  async search(input, { signal } = {}) {
    const request = normalizeSearchInput(input);
    this.validateQuery(request.query);
    const settings = researchSettings(this.getConfig(), this.secretStore);
    let response;
    if (settings.effectiveProvider === 'claude') {
      throw new Error('Claude Code web search is selected; use the built-in WebSearch capability instead of ./research-interface search.');
    }
    if (settings.effectiveProvider === 'brave') {
      try {
        response = await searchBrave(request, this.secretStore?.get?.().braveApiKey, {
          ...this.braveOptions,
          signal,
        });
      } catch (err) {
        if (signal?.aborted) throw err;
        // Keep research available when Brave rejects a request (for example,
        // exhausted credits or a transient API failure). Do not pass provider
        // error text through to the agent because it can contain network detail.
        response = await searchDuckDuckGo(request, { ...this.duckOptions, signal });
        response.warnings = [
          'Brave Search was unavailable; fell back to DuckDuckGo HTML.',
          ...(response.warnings || []),
        ];
      }
    } else {
      response = await searchDuckDuckGo(request, { ...this.duckOptions, signal });
    }
    return {
      schemaVersion: 1,
      kind: 'search',
      provider: response.provider,
      query: request.query,
      retrievedAt: new Date().toISOString(),
      results: response.results,
      warnings: response.warnings || [],
    };
  }

  async execute(operation, payload = {}, { signal } = {}) {
    if (operation === 'status') return this.status();
    if (operation === 'search') return this.search(payload, { signal });
    if (CANONICAL_OPERATIONS.has(operation)) {
      this.validatePayload(payload);
      return this.canonical.execute(operation, payload, { signal });
    }
    if (operation === 'fetch') {
      const value = typeof payload.url === 'string' ? payload.url.trim() : '';
      if (!value || value.length > 2_048 || /[\r\n\0]/.test(value)) {
        throw new Error('Research fetch requires a URL of 1-2048 characters.');
      }
      const url = validateResearchUrl(value);
      let externalValue = url.href;
      try { externalValue = decodeURIComponent(externalValue); } catch { /* retain encoded URL */ }
      this.validateExternalValue(externalValue);
      return fetchReadable(url.href, { ...this.fetchOptions, signal });
    }
    throw new Error('Unknown research operation. Use status, search, fetch, cve, kev, epss, attack, rfc, iana, or rdap.');
  }
}
