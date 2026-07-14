const RL_OPERATIONS = new Set([
  'probe', 'sample-status', 'reputation', 'details', 'ticore', 'search', 'search-count',
]);

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function nonEmpty(value) {
  return value !== undefined && value !== null && value !== ''
    && !(Array.isArray(value) && value.length === 0);
}

function firstValue(value, keys) {
  for (const key of keys) {
    const candidate = key.split('.').reduce((current, part) => current?.[part], value);
    if (nonEmpty(candidate)) return candidate;
  }
  return '';
}

function text(value) {
  if (!nonEmpty(value)) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function unique(values) {
  return [...new Set(values.map((value) => text(value).trim()).filter(Boolean))];
}

function responseItems(response) {
  if (Array.isArray(response)) return response;
  if (!isObject(response)) return [];
  for (const key of ['results', 'samples', 'items', 'records']) {
    if (Array.isArray(response[key])) return response[key];
  }
  if (isObject(response.data)) return responseItems(response.data);
  return [];
}

function responseCount(response, fallback = 0) {
  const candidate = firstValue(response, ['count', 'total_count', 'totalCount', 'total', 'result_count']);
  const number = Number(candidate);
  return Number.isFinite(number) ? number : fallback;
}

function collectTags(item) {
  const raw = item?.tags;
  if (Array.isArray(raw)) return unique(raw);
  if (!isObject(raw)) return [];
  return unique(Object.values(raw).flatMap((value) => Array.isArray(value) ? value : []));
}

function normalizeClassification(value) {
  const raw = text(value).trim();
  const compact = raw.toLowerCase().replace(/[\s_-]+/g, '');
  if (compact === 'malicious') return { label: raw || 'malicious', token: 'malicious' };
  if (compact === 'suspicious') return { label: raw || 'suspicious', token: 'suspicious' };
  if (compact === 'goodware' || compact === 'benign' || compact === 'known') {
    return { label: raw || 'goodware', token: compact === 'goodware' ? 'goodware' : 'known' };
  }
  if (compact === 'notfound' || compact === 'missing') return { label: raw || 'not found', token: 'notfound' };
  if (raw) return { label: raw, token: 'unknown' };
  return { label: 'Not reported', token: 'unknown' };
}

function normalizeHashAlgorithm(value, hash = '') {
  const raw = text(value).trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  if (['md5', 'sha1', 'sha256', 'sha512'].includes(raw)) return raw;
  const lengths = { 32: 'md5', 40: 'sha1', 64: 'sha256', 128: 'sha512' };
  return lengths[text(hash).trim().length] || '';
}

function summarizeItem(item, batch = {}) {
  const classification = normalizeClassification(firstValue(item, [
    'classification', 'status', 'verdict', 'sample_status',
  ]));
  const hashes = Object.fromEntries(['md5', 'sha1', 'sha256', 'sha512', 'imphash']
    .map((key) => [key, text(item?.[key]).trim()])
    .filter(([, value]) => value));
  const hashValue = text(firstValue(item, ['hash_value', 'hash', 'sample_hash'])).trim();
  const hashAlgorithm = normalizeHashAlgorithm(
    firstValue(item, ['hash_type', 'algorithm']) || batch.algorithm || batch.response?.hash_type,
    hashValue,
  );
  if (hashValue && hashAlgorithm && !hashes[hashAlgorithm]) hashes[hashAlgorithm] = hashValue;
  return {
    classification,
    threat: text(firstValue(item, [
      'classification_result', 'threatname', 'threat_name', 'malware.name', 'family',
    ])).trim(),
    filename: text(firstValue(item, [
      'proposed_filename', 'filename', 'file_name', 'identification_name',
    ])).trim(),
    fileType: unique([item?.file_type, item?.file_subtype]).join(' '),
    fileSize: Number.isFinite(Number(item?.file_size)) ? Number(item.file_size) : null,
    riskScore: nonEmpty(item?.riskscore) ? text(item.riskscore) : text(item?.risk_score),
    firstSeen: text(firstValue(item, ['local_first_seen', 'firstseen', 'first_seen'])),
    lastSeen: text(firstValue(item, ['local_last_seen', 'lastseen', 'last_seen'])),
    extractedFiles: nonEmpty(item?.extracted_file_count) ? text(item.extracted_file_count) : '',
    hashes,
    hashValue,
    hashAlgorithm,
    status: text(firstValue(item, ['status', 'sample_status'])).trim(),
    tags: collectTags(item),
    requestedHashes: Array.isArray(batch.requestedHashes) ? batch.requestedHashes : [],
    raw: item,
  };
}

export function isReversingLabsEnvelope(value) {
  return isObject(value)
    && Number(value.schemaVersion) >= 1
    && value.kind === 'reversinglabs'
    && RL_OPERATIONS.has(value.operation)
    && isObject(value.data);
}

export function summarizeReversingLabsEnvelope(value, { sourcePath = '' } = {}) {
  if (!isReversingLabsEnvelope(value)) {
    throw new Error('This file does not match the supported ReversingLabs response schema.');
  }

  const batches = Array.isArray(value.data.batches) ? value.data.batches : [];
  let items = batches.flatMap((batch) => responseItems(batch.response).map((item) => (
    summarizeItem(isObject(item) ? item : { value: item }, batch)
  )));
  if (!items.length && value.operation === 'ticore' && isObject(value.data.response)) {
    items = [summarizeItem(value.data.response, {
      requestedHashes: value.data.hash ? [value.data.hash] : [],
    })];
  }
  if (!items.length && value.operation === 'search' && isObject(value.data.response)) {
    items = responseItems(value.data.response).map((item) => summarizeItem(item));
  }

  const requestedHashes = unique([
    ...(Array.isArray(value.data.requestedHashes) ? value.data.requestedHashes : []),
    ...batches.flatMap((batch) => Array.isArray(batch.requestedHashes) ? batch.requestedHashes : []),
    value.data.hash,
  ]);
  const query = text(value.data.request?.query).trim();
  const responses = batches.length ? batches.map((batch) => batch.response) : [value.data.response];
  const reportedCount = responses.reduce((sum, response) => sum + responseCount(response, 0), 0);
  const resultCount = reportedCount || items.length;
  const classifications = items.reduce((counts, item) => {
    const key = item.classification.token;
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
  const returnedHashes = new Set(items.map((item) => item.hashValue.toLowerCase()).filter(Boolean));
  const unreturnedHashes = requestedHashes.filter((hash) => !returnedHashes.has(hash.toLowerCase()));
  const statusRows = value.operation === 'sample-status'
    ? [
      ...requestedHashes.map((hash) => {
        const item = items.find((candidate) => candidate.hashValue.toLowerCase() === hash.toLowerCase());
        return item || {
          classification: { label: 'No response', token: 'missing' },
          hashValue: hash,
          hashAlgorithm: normalizeHashAlgorithm('', hash),
          status: '',
          hashes: {},
        };
      }),
      ...items.filter((item) => item.hashValue
        && !requestedHashes.some((hash) => hash.toLowerCase() === item.hashValue.toLowerCase())),
    ]
    : [];
  const statusCounts = statusRows.reduce((counts, item) => {
    const key = item.status || 'no_response';
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
  const algorithmCounts = requestedHashes.reduce((counts, hash) => {
    const algorithm = normalizeHashAlgorithm('', hash) || 'unknown';
    counts[algorithm] = (counts[algorithm] || 0) + 1;
    return counts;
  }, {});
  const operationsScope = value.data.request?.cloud === true ? 'Cloud' : 'Local appliance';

  return {
    operation: value.operation,
    source: text(value.source || 'ReversingLabs Spectra Analyze'),
    retrievedAt: text(value.retrievedAt),
    sourcePath,
    requestedHashes,
    query,
    scope: ['search', 'search-count'].includes(value.operation) ? operationsScope : 'Local appliance',
    items,
    resultCount,
    requestedCount: requestedHashes.length,
    classifications,
    statusRows,
    statusCounts,
    algorithmCounts,
    statusResponseCount: items.length,
    unreturnedHashes,
    materialResultCount: items.filter((item) => item.classification.token !== 'notfound').length,
    notice: text(value.notice),
    missingHashPolicy: text(value.missingHashPolicy),
    request: isObject(value.data.request) ? value.data.request : null,
  };
}

function escapeHtml(value) {
  return text(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character]));
}

function formatBytes(value) {
  if (!Number.isFinite(value)) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let amount = value;
  let unit = 0;
  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024;
    unit += 1;
  }
  return `${amount.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function formatTimestamp(value) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return text(value) || 'Unknown';
  return date.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC');
}

function itemDetails(item) {
  const rows = [
    ['Threat', item.threat],
    ['Filename', item.filename],
    ['File type', item.fileType],
    ['File size', formatBytes(item.fileSize)],
    ['Risk score', item.riskScore],
    ['First seen (RL)', formatTimestamp(item.firstSeen)],
    ['Last seen (RL)', formatTimestamp(item.lastSeen)],
    ['Extracted files', item.extractedFiles],
  ].filter(([, value]) => nonEmpty(value) && value !== 'Unknown');
  const hashes = Object.entries(item.hashes).map(([key, value]) => (
    `<div class="hash-row"><span>${escapeHtml(key)}</span><code>${escapeHtml(value)}</code></div>`
  )).join('');
  const tags = item.tags.slice(0, 24).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join('');
  return `
    <article class="result-card" data-class="${escapeHtml(item.classification.token)}">
      <div class="result-head">
        <span class="classification">${escapeHtml(item.classification.label)}</span>
        ${item.threat ? `<strong>${escapeHtml(item.threat)}</strong>` : ''}
      </div>
      ${rows.length ? `<dl>${rows.map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`).join('')}</dl>` : ''}
      ${hashes ? `<div class="hashes">${hashes}</div>` : ''}
      ${tags ? `<div class="tags">${tags}</div>` : ''}
    </article>`;
}

function friendlyStatus(value) {
  return text(value).replaceAll('_', ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}

function friendlyHashAlgorithm(value) {
  return text(value || 'unknown').toUpperCase().replace(/^SHA(1|256|512)$/, 'SHA-$1');
}

function sampleStatusCard(summary) {
  const notFound = Number(summary.statusCounts.not_found || 0);
  const noResponse = summary.unreturnedHashes.length;
  const rows = summary.statusRows.map((item) => `
    <tr>
      <td><code>${escapeHtml(item.hashValue || 'Unknown hash')}</code></td>
      <td>${escapeHtml(friendlyHashAlgorithm(item.hashAlgorithm))}</td>
      <td>${escapeHtml(friendlyStatus(item.status || 'no_response'))}</td>
    </tr>`).join('');
  return `
    <section class="operation">
      <div class="operation-head">
        <div><span class="eyebrow">${escapeHtml(summary.scope)}</span><h2>Sample status</h2></div>
        <div class="operation-count"><strong>${escapeHtml(summary.statusResponseCount)}</strong><span>status responses</span></div>
      </div>
      <div class="status-overview">
        <div><span>Requested</span><strong>${escapeHtml(summary.requestedCount)}</strong></div>
        <div><span>Not found</span><strong>${escapeHtml(notFound)}</strong></div>
        <div><span>No response</span><strong>${escapeHtml(noResponse)}</strong></div>
      </div>
      <div class="status-note">Not found means absent from the queried scope. It is not a benign or known-good verdict.</div>
      <div class="status-table table-wrap"><table>
        <thead><tr><th>Hash</th><th>Algorithm</th><th>Status</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
    </section>`;
}

function operationCard(summary) {
  if (summary.operation === 'sample-status') return sampleStatusCard(summary);
  const subject = summary.query
    ? `<div class="query"><span>Query</span><code>${escapeHtml(summary.query)}</code></div>`
    : summary.requestedHashes.length
      ? `<div class="query"><span>Requested</span><code>${escapeHtml(summary.requestedHashes.join(', '))}</code></div>`
      : '';
  const resultText = summary.items.length
    ? summary.items.map(itemDetails).join('')
    : `<div class="empty">No item rows were returned. This means unknown/not found unless the vendor response explicitly says otherwise.</div>`;
  return `
    <section class="operation">
      <div class="operation-head">
        <div><span class="eyebrow">${escapeHtml(summary.scope)}</span><h2>${escapeHtml(summary.operation)}</h2></div>
        <div class="operation-count"><strong>${escapeHtml(summary.resultCount)}</strong><span>result${summary.resultCount === 1 ? '' : 's'}</span></div>
      </div>
      ${subject}
      <div class="results">${resultText}</div>
    </section>`;
}

export function renderReversingLabsSummaryDocument(template, envelopes, {
  generatedAt = new Date().toISOString(),
} = {}) {
  const summaries = envelopes.map(({ value, sourcePath }) => (
    summarizeReversingLabsEnvelope(value, { sourcePath })
  ));
  if (!summaries.length) throw new Error('No successful ReversingLabs response files were found.');

  const operations = unique(summaries.map((summary) => summary.operation));
  const subjects = unique(summaries.flatMap((summary) => {
    if (summary.query) return [summary.query];
    if (summary.operation === 'sample-status' && summary.requestedHashes.length > 1) {
      return [`${summary.requestedHashes.length} requested hashes`];
    }
    if (summary.requestedHashes.length <= 5) return summary.requestedHashes;
    return [`${summary.requestedHashes.length} requested hashes`];
  }));
  const allItems = summaries.flatMap((summary) => summary.items);
  const classificationCounts = allItems.reduce((counts, item) => {
    counts[item.classification.token] = (counts[item.classification.token] || 0) + 1;
    return counts;
  }, {});
  const classificationText = Object.entries(classificationCounts)
    .map(([label, count]) => `${count} ${label}`)
    .join(' · ') || 'No item verdicts returned';
  const provenance = summaries.map((summary, index) => `
    <tr>
      <td><span class="evidence-id">RL${index + 1}</span></td>
      <td>${escapeHtml(summary.operation)}</td>
      <td>${escapeHtml(summary.scope)}</td>
      <td>${escapeHtml(formatTimestamp(summary.retrievedAt))}</td>
      <td><code>${escapeHtml(summary.sourcePath)}</code></td>
    </tr>`).join('');
  const replacements = new Map([
    ['{{RL_TITLE}}', 'RL Summary'],
    ['{{RL_OPERATIONS}}', escapeHtml(operations.join(' + '))],
    ['{{RL_SUBJECTS}}', escapeHtml(subjects.join(', ') || 'See collected operations below')],
    ['{{RL_GENERATED_AT}}', escapeHtml(formatTimestamp(generatedAt))],
    ['{{RL_SOURCE_COUNT}}', escapeHtml(summaries.length)],
    ['{{RL_ITEM_COUNT}}', escapeHtml(allItems.length)],
    ['{{RL_CLASSIFICATIONS}}', escapeHtml(classificationText)],
    ['<!-- RL_OPERATION_SECTIONS -->', summaries.map(operationCard).join('\n')],
    ['<!-- RL_PROVENANCE_ROWS -->', provenance],
  ]);
  let output = template;
  for (const [marker, replacement] of replacements) output = output.replaceAll(marker, replacement);
  const missing = [...replacements.keys()].filter((marker) => output.includes(marker));
  if (missing.length) throw new Error(`RL Summary template still contains unresolved markers: ${missing.join(', ')}`);
  return output;
}
