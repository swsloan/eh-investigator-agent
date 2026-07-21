import { domainToASCII } from 'node:url';
import ipaddr from 'ipaddr.js';
import { DOMParser, parseHTML } from 'linkedom';
import { fetchReadable } from './fetch.js';

export const CANONICAL_OPERATIONS = new Set(['cve', 'kev', 'epss', 'attack', 'rfc', 'iana', 'rdap']);

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_BYTES = 12 * 1024 * 1024;
const DEFAULT_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_RESULTS = 50;
const CVE_RE = /^CVE-\d{4}-\d{4,}$/i;
const ATTACK_RE = /^(?:T\d{4}(?:\.\d{3})?|TA\d{4}|G\d{4}|S\d{4}|C\d{4}|M\d{4})$/i;

const URLS = {
  cve: 'https://cveawg.mitre.org/api/cve/',
  kev: 'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json',
  epss: 'https://api.first.org/data/v1/epss',
  attack: 'https://attack.mitre.org/',
  rfcApi: 'https://datatracker.ietf.org/api/v1/doc/document/',
  rfcInfo: 'https://www.rfc-editor.org/info/',
  ianaService: 'https://www.iana.org/assignments/service-names-port-numbers/service-names-port-numbers.csv',
  ianaProtocol: 'https://www.iana.org/assignments/protocol-numbers/protocol-numbers-1.csv',
  ianaMedia: 'https://www.iana.org/assignments/media-types/media-types.xml',
  rdapDns: 'https://data.iana.org/rdap/dns.json',
  rdapIpv4: 'https://data.iana.org/rdap/ipv4.json',
  rdapIpv6: 'https://data.iana.org/rdap/ipv6.json',
  rdapAsn: 'https://data.iana.org/rdap/asn.json',
};

const PROVIDERS = {
  cve: { name: 'CVE Program', publisher: 'CVE Program' },
  kev: { name: 'CISA Known Exploited Vulnerabilities', publisher: 'CISA' },
  epss: { name: 'Exploit Prediction Scoring System', publisher: 'FIRST' },
  attack: { name: 'MITRE ATT&CK', publisher: 'MITRE' },
  rfc: { name: 'RFC Index', publisher: 'IETF / RFC Editor' },
  iana: { name: 'IANA Protocol Registries', publisher: 'IANA' },
  rdap: { name: 'Registration Data Access Protocol', publisher: 'IANA / authoritative RDAP service' },
};

function clean(value = '') {
  return String(value).replace(/\s+/g, ' ').trim();
}

function boundedText(value, max = 4_000) {
  const text = clean(value);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function boundedArray(value, max = MAX_RESULTS) {
  return Array.isArray(value) ? value.slice(0, max) : [];
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function singleLine(value, label, max = 253) {
  const normalized = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
  if (!normalized || normalized.length > max || /[\r\n\0]/.test(normalized)) {
    throw new Error(`${label} requires a single-line value of 1-${max} characters.`);
  }
  return normalized;
}

function countFrom(input, fallback = 10, maximum = MAX_RESULTS) {
  return Math.min(maximum, Math.max(1, Number.parseInt(input?.count, 10) || fallback));
}

function resourceSlug(value) {
  const parts = String(value || '').split('/').filter(Boolean);
  return parts.at(-1) || '';
}

function stripMarkup(value) {
  if (!value) return '';
  const { document } = parseHTML(`<main>${String(value)}</main>`);
  return clean(document.querySelector('main')?.textContent || value);
}

function makeEnvelope(provider, query, results, {
  sourceUrl,
  retrievedAt,
  warnings = [],
  metadata,
} = {}) {
  const source = PROVIDERS[provider];
  return {
    schemaVersion: 1,
    kind: 'canonical',
    provider,
    query,
    retrievedAt,
    source: { ...source, url: sourceUrl },
    results,
    warnings: warnings.filter(Boolean),
    ...(metadata ? { metadata } : {}),
  };
}

function responseHeader(response, name) {
  return response?.headers?.get?.(name) || response?.headers?.[name.toLowerCase()] || '';
}

async function responseBody(response, label, maxBytes) {
  if (!response || response.ok === false || (response.status && (response.status < 200 || response.status >= 300))) {
    throw new Error(`${label} request failed with HTTP ${response?.status || 'unknown'}.`);
  }
  const declared = Number.parseInt(responseHeader(response, 'content-length'), 10);
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error(`${label} response exceeded the ${maxBytes}-byte limit.`);
  }
  const body = typeof response.arrayBuffer === 'function'
    ? Buffer.from(await response.arrayBuffer())
    : Buffer.from(await response.text(), 'utf8');
  if (body.length > maxBytes) throw new Error(`${label} response exceeded the ${maxBytes}-byte limit.`);
  return body.toString('utf8');
}

function combineSignal(signal, timeoutMs) {
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error('Canonical research request timed out.')), timeoutMs);
  timer.unref?.();
  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    },
  };
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"') quoted = true;
    else if (character === ',') {
      row.push(field);
      field = '';
    } else if (character === '\n') {
      row.push(field.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      field = '';
    } else field += character;
  }
  if (field || row.length) {
    row.push(field.replace(/\r$/, ''));
    rows.push(row);
  }
  const headers = rows.shift()?.map(clean) || [];
  return rows.filter((item) => item.some((value) => value !== '')).map((item) => Object.fromEntries(
    headers.map((header, index) => [header, clean(item[index] || '')]),
  ));
}

function cveDescription(container) {
  const descriptions = container?.descriptions || [];
  return boundedText(descriptions.find((item) => item.lang === 'en')?.value || descriptions[0]?.value);
}

function cveMetrics(containers) {
  const metrics = containers.flatMap((container) => container?.metrics || []);
  const normalized = [];
  for (const metric of metrics) {
    const cvss = metric?.cvssV4_0 || metric?.cvssV3_1 || metric?.cvssV3_0 || metric?.cvssV2_0;
    if (!cvss) continue;
    normalized.push({
      version: cvss.version || '',
      score: cvss.baseScore,
      severity: cvss.baseSeverity || '',
      vector: cvss.vectorString || '',
      source: metric.source || '',
    });
  }
  return normalized.slice(0, 10);
}

function cveProblems(containers) {
  return unique(containers.flatMap((container) => container?.problemTypes || [])
    .flatMap((problem) => problem?.descriptions || [])
    .map((item) => item.cweId || item.description))
    .slice(0, 20);
}

function cveAffected(container) {
  return boundedArray(container?.affected, 30).map((item) => ({
    vendor: boundedText(item.vendor, 200),
    product: boundedText(item.product, 200),
    package: boundedText(item.packageName, 200),
    versions: boundedArray(item.versions, 20).map((version) => ({
      version: boundedText(version.version, 100),
      status: boundedText(version.status, 40),
      lessThan: boundedText(version.lessThan || version.lessThanOrEqual, 100),
      versionType: boundedText(version.versionType, 40),
    })),
  }));
}

function cveReferences(containers) {
  const seen = new Set();
  const results = [];
  for (const reference of containers.flatMap((container) => container?.references || [])) {
    const url = String(reference?.url || '');
    if (!/^https?:\/\//i.test(url) || seen.has(url)) continue;
    seen.add(url);
    results.push({ url, tags: boundedArray(reference.tags, 10).map(clean) });
    if (results.length >= 30) break;
  }
  return results;
}

function normalizeCve(record) {
  const cna = record?.containers?.cna || {};
  const containers = [cna, ...boundedArray(record?.containers?.adp, 10)];
  const metadata = record?.cveMetadata || {};
  const solutions = containers.flatMap((container) => container?.solutions || [])
    .map((item) => boundedText(item.value)).filter(Boolean).slice(0, 10);
  const workarounds = containers.flatMap((container) => container?.workarounds || [])
    .map((item) => boundedText(item.value)).filter(Boolean).slice(0, 10);
  return {
    id: metadata.cveId || '',
    state: metadata.state || '',
    title: boundedText(cna.title, 500),
    description: cveDescription(cna),
    datePublished: metadata.datePublished || '',
    dateUpdated: metadata.dateUpdated || '',
    assigner: metadata.assignerShortName || '',
    metrics: cveMetrics(containers),
    weaknesses: cveProblems(containers),
    affected: cveAffected(cna),
    solutions,
    workarounds,
    references: cveReferences(containers),
  };
}

function normalizeRfc(document) {
  const name = String(document?.name || '').toLowerCase();
  const number = name.match(/^rfc(\d+)$/)?.[1] || '';
  return {
    id: number ? `RFC ${number}` : name.toUpperCase(),
    number: number ? Number(number) : null,
    title: boundedText(document?.title, 500),
    abstract: boundedText(stripMarkup(document?.abstract), 4_000),
    pages: document?.pages ?? null,
    stream: resourceSlug(document?.stream),
    standardLevel: resourceSlug(document?.std_level),
    states: boundedArray(document?.states, 12).map(resourceSlug),
    published: document?.time || '',
    updated: document?.rev || '',
    infoUrl: number ? `${URLS.rfcInfo}rfc${number}` : '',
    documentUrl: number ? `https://www.rfc-editor.org/rfc/rfc${number}.html` : '',
  };
}

function attackPath(identifier) {
  const id = identifier.toUpperCase();
  if (id.startsWith('T') && !id.startsWith('TA')) {
    const [parent, child] = id.split('.');
    return `techniques/${parent}/${child ? `${child}/` : ''}`;
  }
  const prefixes = {
    TA: 'tactics',
    G: 'groups',
    S: 'software',
    C: 'campaigns',
    M: 'mitigations',
  };
  const prefix = id.startsWith('TA') ? 'TA' : id[0];
  return `${prefixes[prefix]}/${id}/`;
}

function attackFields(document) {
  const fields = {};
  for (const node of document.querySelectorAll('.card-data .card-title, .card-data .h5')) {
    const label = clean(node.textContent).replace(/:$/, '');
    if (!label || fields[label]) continue;
    const parent = node.parentElement;
    const full = clean(parent?.textContent);
    const value = clean(full.slice(clean(node.textContent).length));
    if (value) fields[label] = value;
  }
  const cardText = clean(document.querySelector('.card-data')?.textContent);
  const known = ['ID', 'Sub-techniques', 'Tactic', 'Platforms', 'Version', 'Created', 'Last Modified'];
  for (const label of known) {
    if (fields[label]) continue;
    const start = cardText.indexOf(`${label}:`);
    if (start < 0) continue;
    const contentStart = start + label.length + 1;
    const next = known.map((candidate) => cardText.indexOf(`${candidate}:`, contentStart))
      .filter((index) => index >= 0).sort((a, b) => a - b)[0] ?? cardText.length;
    fields[label] = clean(cardText.slice(contentStart, next));
  }
  return fields;
}

function normalizeAttack(identifier, html, url) {
  const { document } = parseHTML(html);
  const fields = attackFields(document);
  const heading = clean(document.querySelector('h1')?.textContent);
  if (!heading) throw new Error(`MITRE ATT&CK did not return an object for ${identifier}.`);
  const descriptionNode = document.querySelector('.description-body');
  return {
    id: fields.ID || identifier,
    name: heading.replace(new RegExp(`^${identifier}\\s*[:–—-]?\\s*`, 'i'), ''),
    type: attackPath(identifier).split('/')[0].replace(/s$/, ''),
    description: boundedText(descriptionNode?.textContent, 8_000),
    tactics: String(fields.Tactic || '').split(',').map(clean).filter(Boolean),
    platforms: String(fields.Platforms || '').split(',').map(clean).filter(Boolean),
    subtechniques: boundedText(fields['Sub-techniques'], 1_000),
    version: fields.Version || '',
    created: fields.Created || '',
    modified: fields['Last Modified'] || '',
    url,
  };
}

function portMatches(portField, query) {
  if (!/^\d+$/.test(query)) return false;
  const port = Number(query);
  return String(portField || '').split(',').some((part) => {
    const [start, end = start] = part.trim().split('-').map(Number);
    return Number.isFinite(start) && port >= start && port <= end;
  });
}

function rankMatches(items, query, fields, exact) {
  const needle = query.toLowerCase();
  return items.map((item, index) => {
    const values = fields(item).map((value) => String(value || '').toLowerCase());
    const exactHit = exact?.(item) || values.some((value) => value === needle);
    const prefixHit = values.some((value) => value.startsWith(needle));
    const containsHit = values.some((value) => value.includes(needle));
    return { item, index, score: exactHit ? 0 : prefixHit ? 1 : containsHit ? 2 : 99 };
  }).filter((match) => match.score < 99)
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .map((match) => match.item);
}

function normalizeIanaService(row) {
  return {
    service: row['Service Name'],
    port: row['Port Number'],
    transport: row['Transport Protocol'],
    description: boundedText(row.Description, 500),
    reference: boundedText(row.Reference, 500),
    registered: row['Registration Date'],
    modified: row['Modification Date'],
  };
}

function normalizeIanaProtocol(row) {
  return {
    number: row.Decimal,
    keyword: row.Keyword,
    protocol: row.Protocol,
    ipv6ExtensionHeader: row['IPv6 Extension Header'],
    reference: boundedText(row.Reference, 500),
  };
}

function normalizeIanaMedia(record) {
  const name = clean(record.querySelector('name')?.textContent);
  const file = clean(record.querySelector('file')?.textContent);
  const references = [...record.querySelectorAll('xref')].map((node) => node.getAttribute('data') || node.getAttribute('type'));
  return { name, mediaType: file || name, references: unique(references).slice(0, 10) };
}

function normalizeRdapEvents(value) {
  return boundedArray(value?.events, 20).map((event) => ({
    action: boundedText(event?.eventAction, 100),
    date: event?.eventDate || '',
  })).filter((event) => event.action || event.date);
}

function vcardName(entity) {
  const values = entity?.vcardArray?.[1];
  if (!Array.isArray(values)) return '';
  const field = values.find((item) => Array.isArray(item) && item[0] === 'fn');
  return boundedText(field?.[3], 300);
}

function normalizeRdap(record, query, responseUrl) {
  return {
    query,
    objectClass: boundedText(record?.objectClassName, 40),
    handle: boundedText(record?.handle, 200),
    name: boundedText(record?.ldhName || record?.unicodeName || record?.name, 300),
    status: boundedArray(record?.status, 20).map((item) => boundedText(item, 100)),
    country: boundedText(record?.country, 10),
    type: boundedText(record?.type, 100),
    startAddress: boundedText(record?.startAddress, 100),
    endAddress: boundedText(record?.endAddress, 100),
    startAutnum: record?.startAutnum ?? null,
    endAutnum: record?.endAutnum ?? null,
    port43: boundedText(record?.port43, 253),
    events: normalizeRdapEvents(record),
    nameservers: boundedArray(record?.nameservers, 30).map((item) => ({
      name: boundedText(item?.ldhName || item?.unicodeName, 253),
      status: boundedArray(item?.status, 10).map((status) => boundedText(status, 100)),
    })).filter((item) => item.name),
    entities: boundedArray(record?.entities, 30).map((entity) => ({
      handle: boundedText(entity?.handle, 200),
      name: vcardName(entity),
      roles: boundedArray(entity?.roles, 10).map((role) => boundedText(role, 100)),
    })).filter((item) => item.handle || item.name || item.roles.length),
    notices: boundedArray(record?.notices, 10).map((notice) => ({
      title: boundedText(notice?.title, 300),
      description: boundedArray(notice?.description, 5).map((item) => boundedText(item, 500)),
    })),
    responseUrl,
  };
}

function rdapQuery(input) {
  const supplied = input?.query ?? input?.value ?? input?.domain ?? input?.ip ?? input?.asn;
  const value = singleLine(supplied, 'RDAP lookup', 253);
  const explicitType = String(input?.type || (input?.domain ? 'domain' : input?.ip ? 'ip' : input?.asn ? 'asn' : '')).toLowerCase();
  if (ipaddr.isValid(value)) return { type: 'ip', value: ipaddr.process(value).toString() };
  if (explicitType === 'asn' || /^AS\d+$/i.test(value)) {
    const number = Number(String(value).replace(/^AS/i, ''));
    if (!Number.isSafeInteger(number) || number < 0 || number > 4_294_967_295) throw new Error('RDAP ASN must be between 0 and 4294967295.');
    return { type: 'asn', value: String(number) };
  }
  if (explicitType && explicitType !== 'domain') throw new Error('RDAP type must be domain, ip, or asn.');
  const domain = domainToASCII(value.replace(/\.$/, '')).toLowerCase();
  if (!domain || domain.length > 253 || !domain.includes('.') || domain.split('.').some((label) => (
    !label || label.length > 63 || !/^[a-z0-9-]+$/.test(label) || label.startsWith('-') || label.endsWith('-')
  ))) throw new Error('RDAP domain must be a valid public domain name.');
  return { type: 'domain', value: domain };
}

function rdapBaseFromDns(bootstrap, domain) {
  const tld = domain.split('.').at(-1);
  const service = boundedArray(bootstrap?.services, 10_000).find(([keys]) => (
    Array.isArray(keys) && keys.some((key) => String(key).toLowerCase() === tld)
  ));
  return service?.[1]?.find((url) => /^https:\/\//i.test(url)) || '';
}

function rdapBaseFromIp(bootstrap, value) {
  const address = ipaddr.parse(value);
  let best = null;
  for (const [prefixes, urls] of boundedArray(bootstrap?.services, 10_000)) {
    for (const prefix of prefixes || []) {
      try {
        const [network, length] = ipaddr.parseCIDR(prefix);
        if (network.kind() === address.kind() && address.match([network, length]) && (!best || length > best.length)) {
          best = { length, url: (urls || []).find((url) => /^https:\/\//i.test(url)) || '' };
        }
      } catch { /* ignore malformed bootstrap entries */ }
    }
  }
  return best?.url || '';
}

function rdapBaseFromAsn(bootstrap, value) {
  const number = Number(value);
  const service = boundedArray(bootstrap?.services, 10_000).find(([ranges]) => (ranges || []).some((range) => {
    const [start, end = start] = String(range).split('-').map(Number);
    return Number.isFinite(start) && number >= start && number <= end;
  }));
  return service?.[1]?.find((url) => /^https:\/\//i.test(url)) || '';
}

export class CanonicalResearchService {
  constructor({
    fetchFn = globalThis.fetch,
    fetchRdapFn = fetchReadable,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxBytes = DEFAULT_MAX_BYTES,
    cacheTtlMs = DEFAULT_CACHE_TTL_MS,
    now = () => new Date(),
  } = {}) {
    this.fetchFn = fetchFn;
    this.fetchRdapFn = fetchRdapFn;
    this.timeoutMs = timeoutMs;
    this.maxBytes = maxBytes;
    this.cacheTtlMs = cacheTtlMs;
    this.now = now;
    this.cache = new Map();
  }

  retrievedAt() {
    return this.now().toISOString();
  }

  async fetchText(url, { signal, accept = 'application/json', label = 'Canonical source', maxBytes = this.maxBytes } = {}) {
    const combined = combineSignal(signal, this.timeoutMs);
    try {
      const response = await this.fetchFn(url, {
        method: 'GET',
        redirect: 'error',
        headers: { Accept: accept, 'User-Agent': 'ExtraHop-Investigation-Agent/1.0' },
        signal: combined.signal,
      });
      return await responseBody(response, label, maxBytes);
    } finally {
      combined.dispose();
    }
  }

  async fetchJson(url, options = {}) {
    const text = await this.fetchText(url, options);
    try { return JSON.parse(text); } catch { throw new Error(`${options.label || 'Canonical source'} returned invalid JSON.`); }
  }

  async cached(key, loader) {
    const current = this.cache.get(key);
    const now = this.now().getTime();
    if (current && current.expiresAt > now) return current.value;
    const pending = Promise.resolve().then(loader);
    this.cache.set(key, { value: pending, expiresAt: now + this.cacheTtlMs });
    try {
      const value = await pending;
      this.cache.set(key, { value, expiresAt: this.now().getTime() + this.cacheTtlMs });
      return value;
    } catch (error) {
      this.cache.delete(key);
      throw error;
    }
  }

  async cve(input, { signal } = {}) {
    const id = singleLine(input?.cve || input?.id || input?.query, 'CVE lookup', 32).toUpperCase();
    if (!CVE_RE.test(id)) throw new Error('CVE lookup requires an identifier such as CVE-2024-3400.');
    const url = `${URLS.cve}${encodeURIComponent(id)}`;
    const record = await this.fetchJson(url, { signal, label: 'CVE Program' });
    return makeEnvelope('cve', { cve: id }, [normalizeCve(record)], {
      sourceUrl: url,
      retrievedAt: this.retrievedAt(),
    });
  }

  async kev(input, { signal } = {}) {
    const id = singleLine(input?.cve || input?.id || input?.query, 'CISA KEV lookup', 32).toUpperCase();
    if (!CVE_RE.test(id)) throw new Error('CISA KEV lookup requires an identifier such as CVE-2024-3400.');
    const catalog = await this.cached('kev', () => this.fetchJson(URLS.kev, { signal, label: 'CISA KEV' }));
    const item = boundedArray(catalog?.vulnerabilities, 100_000).find((entry) => String(entry?.cveID).toUpperCase() === id);
    const results = item ? [{
      id: item.cveID,
      vendor: boundedText(item.vendorProject, 300),
      product: boundedText(item.product, 300),
      name: boundedText(item.vulnerabilityName, 500),
      description: boundedText(item.shortDescription, 4_000),
      requiredAction: boundedText(item.requiredAction, 2_000),
      dateAdded: item.dateAdded || '',
      dueDate: item.dueDate || '',
      knownRansomwareCampaignUse: item.knownRansomwareCampaignUse || 'Unknown',
      notes: boundedText(item.notes, 2_000),
    }] : [];
    return makeEnvelope('kev', { cve: id }, results, {
      sourceUrl: URLS.kev,
      retrievedAt: this.retrievedAt(),
      warnings: item ? [] : [`${id} was not present in the retrieved CISA KEV catalog. Absence does not establish that exploitation has not occurred.`],
      metadata: { catalogVersion: catalog?.catalogVersion || '', dateReleased: catalog?.dateReleased || '' },
    });
  }

  async epss(input, { signal } = {}) {
    const id = singleLine(input?.cve || input?.id || input?.query, 'EPSS lookup', 32).toUpperCase();
    if (!CVE_RE.test(id)) throw new Error('EPSS lookup requires an identifier such as CVE-2024-3400.');
    const url = `${URLS.epss}?${new URLSearchParams({ cve: id })}`;
    const response = await this.fetchJson(url, { signal, label: 'FIRST EPSS' });
    const results = boundedArray(response?.data, 5).map((item) => ({
      id: String(item.cve || id).toUpperCase(),
      score: Number(item.epss),
      percentile: Number(item.percentile),
      date: item.date || '',
    }));
    return makeEnvelope('epss', { cve: id }, results, {
      sourceUrl: url,
      retrievedAt: this.retrievedAt(),
      warnings: results.length ? [] : [`FIRST EPSS returned no score for ${id}.`],
    });
  }

  async attack(input, { signal } = {}) {
    const id = singleLine(input?.id || input?.query, 'MITRE ATT&CK lookup', 16).toUpperCase();
    if (!ATTACK_RE.test(id)) throw new Error('MITRE ATT&CK lookup requires an exact ID such as T1059, T1059.001, TA0002, G0007, S0002, C0001, or M1047.');
    const url = new URL(attackPath(id), URLS.attack).href;
    const body = await this.fetchText(url, { signal, accept: 'text/html', label: 'MITRE ATT&CK', maxBytes: 4 * 1024 * 1024 });
    return makeEnvelope('attack', { id }, [normalizeAttack(id, body, url)], {
      sourceUrl: url,
      retrievedAt: this.retrievedAt(),
    });
  }

  async rfc(input, { signal } = {}) {
    const raw = singleLine(input?.rfc || input?.number || input?.query, 'RFC lookup', 120);
    const count = countFrom(input, 10, 20);
    const number = raw.match(/^(?:RFC\s*)?(\d+)$/i)?.[1];
    let url;
    let documents;
    if (number) {
      url = `${URLS.rfcApi}rfc${number}/`;
      documents = [await this.fetchJson(url, { signal, label: 'IETF Datatracker RFC index' })];
    } else {
      const parameters = new URLSearchParams({ type__slug: 'rfc', title__icontains: raw, limit: String(count) });
      url = `${URLS.rfcApi}?${parameters}`;
      const response = await this.fetchJson(url, { signal, label: 'IETF Datatracker RFC index' });
      documents = boundedArray(response?.objects, count);
    }
    return makeEnvelope('rfc', number ? { rfc: `RFC ${number}` } : { title: raw, count }, documents.map(normalizeRfc), {
      sourceUrl: url,
      retrievedAt: this.retrievedAt(),
      warnings: documents.length ? [] : [`No RFC title matched “${raw}”.`],
    });
  }

  async iana(input, { signal } = {}) {
    const aliases = {
      service: 'service', port: 'service', 'service-name': 'service',
      protocol: 'protocol', 'protocol-number': 'protocol',
      media: 'media-type', 'media-type': 'media-type', mimetype: 'media-type',
    };
    const registryInput = singleLine(input?.registry, 'IANA lookup registry', 40).toLowerCase();
    const registry = aliases[registryInput];
    if (!registry) throw new Error('IANA registry must be service, protocol, or media-type.');
    const query = singleLine(input?.query || input?.value, 'IANA lookup', 100);
    const count = countFrom(input, 20, MAX_RESULTS);
    let sourceUrl;
    let matches;
    if (registry === 'service') {
      sourceUrl = URLS.ianaService;
      const rows = await this.cached('iana-service', async () => parseCsv(await this.fetchText(sourceUrl, {
        signal, accept: 'text/csv,text/plain', label: 'IANA service registry',
      })));
      const transport = String(input?.protocol || input?.transport || '').trim().toLowerCase();
      const candidates = transport ? rows.filter((row) => row['Transport Protocol'].toLowerCase() === transport) : rows;
      matches = rankMatches(candidates, query, (row) => [row['Service Name'], row['Port Number'], row.Description], (row) => portMatches(row['Port Number'], query))
        .slice(0, count).map(normalizeIanaService);
    } else if (registry === 'protocol') {
      sourceUrl = URLS.ianaProtocol;
      const rows = await this.cached('iana-protocol', async () => parseCsv(await this.fetchText(sourceUrl, {
        signal, accept: 'text/csv,text/plain', label: 'IANA protocol registry',
      })));
      matches = rankMatches(rows, query, (row) => [row.Decimal, row.Keyword, row.Protocol])
        .slice(0, count).map(normalizeIanaProtocol);
    } else {
      sourceUrl = URLS.ianaMedia;
      const entries = await this.cached('iana-media', async () => {
        const xml = await this.fetchText(sourceUrl, { signal, accept: 'application/xml,text/xml', label: 'IANA media-type registry' });
        const document = new DOMParser().parseFromString(xml, 'text/xml');
        return [...document.querySelectorAll('record')].map(normalizeIanaMedia).filter((item) => item.mediaType);
      });
      matches = rankMatches(entries, query, (entry) => [entry.name, entry.mediaType])
        .slice(0, count);
    }
    return makeEnvelope('iana', { registry, query, count }, matches, {
      sourceUrl,
      retrievedAt: this.retrievedAt(),
      warnings: matches.length ? [] : [`No ${registry} registry entry matched “${query}”.`],
    });
  }

  async rdap(input, { signal } = {}) {
    const query = rdapQuery(input);
    const bootstrapUrl = query.type === 'domain' ? URLS.rdapDns
      : query.type === 'asn' ? URLS.rdapAsn
        : ipaddr.parse(query.value).kind() === 'ipv6' ? URLS.rdapIpv6 : URLS.rdapIpv4;
    const bootstrap = await this.cached(`rdap-${query.type}-${bootstrapUrl}`, () => this.fetchJson(bootstrapUrl, {
      signal, label: 'IANA RDAP bootstrap registry',
    }));
    const base = query.type === 'domain' ? rdapBaseFromDns(bootstrap, query.value)
      : query.type === 'asn' ? rdapBaseFromAsn(bootstrap, query.value)
        : rdapBaseFromIp(bootstrap, query.value);
    if (!base) throw new Error(`IANA RDAP bootstrap data did not identify an authoritative service for ${query.value}.`);
    const suffix = query.type === 'domain' ? 'domain' : query.type === 'asn' ? 'autnum' : 'ip';
    const responseUrl = new URL(`${suffix}/${encodeURIComponent(query.value)}`, base.endsWith('/') ? base : `${base}/`).href;
    const fetched = await this.fetchRdapFn(responseUrl, {
      signal,
      timeoutMs: this.timeoutMs,
      maxBytes: 512 * 1024,
      maxChars: 512 * 1024,
    });
    let record;
    try { record = typeof fetched?.text === 'string' ? JSON.parse(fetched.text) : fetched; } catch {
      throw new Error('Authoritative RDAP service returned invalid JSON.');
    }
    return makeEnvelope('rdap', query, [normalizeRdap(record, query, fetched?.resolvedUrl || responseUrl)], {
      sourceUrl: fetched?.resolvedUrl || responseUrl,
      retrievedAt: this.retrievedAt(),
      warnings: ['RDAP registration data is external context. Names, roles, and status do not establish that an observed asset or actor has the same identity or intent.'],
      metadata: { bootstrapUrl, authoritativeBase: base },
    });
  }

  async execute(operation, input = {}, options = {}) {
    if (!CANONICAL_OPERATIONS.has(operation)) throw new Error(`Unknown canonical research operation: ${operation}.`);
    return this[operation](input, options);
  }
}

export const canonicalSourceUrls = Object.freeze({ ...URLS });
