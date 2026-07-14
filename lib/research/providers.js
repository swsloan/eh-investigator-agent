import { parseHTML } from 'linkedom';

const DDG_ENDPOINT = 'https://html.duckduckgo.com/html/';
const BRAVE_ENDPOINT = 'https://api.search.brave.com/res/v1/web/search';
const DEFAULT_TIMEOUT_MS = 15_000;
const USER_AGENT = 'Mozilla/5.0 (compatible; ExtraHop-Investigation-Agent/1.0)';

function timeoutSignal(timeoutMs) {
  return AbortSignal.timeout(Math.max(1, timeoutMs || DEFAULT_TIMEOUT_MS));
}

function normalizeUrl(value) {
  try {
    const url = new URL(value, DDG_ENDPOINT);
    const target = url.hostname.endsWith('duckduckgo.com') && url.pathname.startsWith('/l/')
      ? url.searchParams.get('uddg')
      : url.href;
    const normalized = new URL(target || url.href);
    if (!['http:', 'https:'].includes(normalized.protocol)) return '';
    return normalized.href;
  } catch {
    return '';
  }
}

function cleanText(value = '') {
  return String(value).replace(/\s+/g, ' ').trim();
}

export function parseDuckDuckGoHtml(html, limit = 8) {
  const { document } = parseHTML(String(html || ''));
  const blocked = /unfortunately, bots|anomaly-modal|challenge-form/i.test(String(html || ''));
  if (blocked) throw new Error('DuckDuckGo blocked the automated search request. Try native web search or configure Brave in Settings.');

  const results = [];
  for (const row of document.querySelectorAll('.result')) {
    const anchor = row.querySelector('.result__a');
    const url = normalizeUrl(anchor?.getAttribute('href') || '');
    const title = cleanText(anchor?.textContent);
    if (!url || !title) continue;
    results.push({
      rank: results.length + 1,
      title,
      url,
      domain: new URL(url).hostname,
      snippet: cleanText(row.querySelector('.result__snippet')?.textContent),
      publishedAt: null,
    });
    if (results.length >= limit) break;
  }
  return results;
}

function duckFreshness(value) {
  return ({ day: 'd', week: 'w', month: 'm', year: 'y' })[value] || '';
}

function braveFreshness(value) {
  return ({ day: 'pd', week: 'pw', month: 'pm', year: 'py' })[value] || '';
}

export async function searchDuckDuckGo({ query, count = 8, freshness = '' }, {
  fetchFn = globalThis.fetch,
  endpoint = DDG_ENDPOINT,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const url = new URL(endpoint);
  url.searchParams.set('q', query);
  url.searchParams.set('kl', 'us-en');
  url.searchParams.set('kp', '-1');
  const df = duckFreshness(freshness);
  if (df) url.searchParams.set('df', df);

  let response;
  try {
    response = await fetchFn(url, {
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.8',
        'User-Agent': USER_AGENT,
      },
      redirect: 'error',
      signal: timeoutSignal(timeoutMs),
    });
  } catch (err) {
    throw new Error(`DuckDuckGo search failed: ${err.message || 'network error'}`);
  }
  if (!response.ok) throw new Error(`DuckDuckGo search failed with HTTP ${response.status}.`);
  const html = await response.text();
  const results = parseDuckDuckGoHtml(html, count);
  return {
    provider: 'duckduckgo',
    results,
    warnings: results.length ? [] : ['DuckDuckGo returned no parsed results. This may mean no match or a changed/blocked HTML response.'],
  };
}

export function normalizeBraveResults(payload, limit = 8) {
  return (payload?.web?.results || []).slice(0, limit).map((item, index) => {
    const url = normalizeUrl(item.url || '');
    return {
      rank: index + 1,
      title: cleanText(item.title),
      url,
      domain: url ? new URL(url).hostname : '',
      snippet: cleanText([item.description, ...(item.extra_snippets || [])].filter(Boolean).join(' ')),
      publishedAt: item.page_age || item.age || null,
    };
  }).filter((item) => item.url && item.title);
}

export async function searchBrave({ query, count = 8, freshness = '' }, apiKey, {
  fetchFn = globalThis.fetch,
  endpoint = BRAVE_ENDPOINT,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  if (!apiKey) throw new Error('Brave Search is selected but its API key is not configured in Settings.');
  const url = new URL(endpoint);
  url.searchParams.set('q', query);
  url.searchParams.set('count', String(count));
  url.searchParams.set('extra_snippets', 'true');
  url.searchParams.set('safesearch', 'moderate');
  const recent = braveFreshness(freshness);
  if (recent) url.searchParams.set('freshness', recent);

  let response;
  try {
    response = await fetchFn(url, {
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip',
        'User-Agent': USER_AGENT,
        'X-Subscription-Token': apiKey,
      },
      signal: timeoutSignal(timeoutMs),
    });
  } catch (err) {
    throw new Error(`Brave Search failed: ${err.message || 'network error'}`);
  }
  if (!response.ok) {
    const hint = response.status === 401 || response.status === 403
      ? ' Check the Brave API key in Settings.'
      : '';
    throw new Error(`Brave Search failed with HTTP ${response.status}.${hint}`);
  }
  const payload = await response.json();
  return {
    provider: 'brave',
    results: normalizeBraveResults(payload, count),
    warnings: [],
  };
}
