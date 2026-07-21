import fs from 'node:fs';
import path from 'node:path';
import { summarizeReversingLabsEnvelope } from './reversinglabs-summary.js';
import {
  classifySummarizableJsonArtifact,
  isSummarizableArtifactKind,
  isWorkspaceJsonArtifactCandidate,
} from './workspace-artifacts.js';

export const EVIDENCE_SUMMARY_LIMITS = Object.freeze({
  sourceBytes: 50 * 1024 * 1024,
  rows: 500,
  preferredColumns: 32,
  cells: 8_000,
  flattenDepth: 4,
  flattenFieldsPerRow: 128,
  metricTransformPoints: 10_000,
  metricChartPoints: 500,
  htmlBytes: 512 * 1024,
});
export const CSV_EXPORT_LIMITS = Object.freeze({
  rows: 25_000,
  columns: 64,
  cells: 100_000,
  flattenDepth: 1,
  flattenFieldsPerRow: 128,
  columnDiscoveryRows: 1_000,
  structuredDepth: 4,
  structuredItems: 128,
  structuredNodes: 1_000,
  cellBytes: 64 * 1024,
  outputBytes: 16 * 1024 * 1024,
  chunkBytes: 64 * 1024,
});
const MAX_TEXT = 360;
const MAX_STRUCTURED_ITEMS = 32;
const MAX_DETAIL_TEXT = 16_000;
const MAX_URL_TEXT = 2_048;
const MAX_METRIC_VALUE_NODES = 10_000;
const MAX_METRIC_TRANSFORM_NODES = 250_000;
const MAX_METRIC_FACETS_PER_POINT = 256;
const MAX_METRIC_TRANSFORM_FACETS = 10_000;
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const CSV_ARRAY_KEYS = ['records', 'devices', 'entities', 'detections', 'activity', 'metrics', 'stats', 'sensors', 'items', 'results', 'data'];
const DETECTION_CATEGORY_LABELS = new Map([
  ['sec', 'Security'],
  ['sec.action', 'Actions on Objective'],
  ['sec.attack', 'Attack'],
  ['sec.botnet', 'Botnet'],
  ['sec.caution', 'Caution'],
  ['sec.command', 'Command & Control'],
  ['sec.cryptomining', 'Cryptomining'],
  ['sec.dos', 'Denial of Service'],
  ['sec.exfil', 'Exfiltration'],
  ['sec.exploit', 'Exploitation'],
  ['sec.hardening', 'Hardening'],
  ['sec.ids', 'IDS'],
  ['sec.lateral', 'Lateral Movement'],
  ['sec.ransomware', 'Ransomware'],
  ['sec.recon', 'Reconnaissance'],
  ['perf', 'Performance'],
  ['perf.auth', 'Authorization & Access Control'],
  ['perf.db', 'Database'],
  ['perf.network', 'Network Infrastructure'],
  ['perf.service', 'Service Degradation'],
  ['perf.storage', 'Storage'],
  ['perf.virtual', 'Desktop & App Virtualization'],
  ['perf.web', 'Web Application'],
]);
const DETECTION_PARENT_CATEGORIES = new Set(['sec', 'perf']);

function requestError(message, statusCode = 400) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function normalizeRelPath(relPath) {
  const normalized = String(relPath || '').replaceAll('\\', '/').replace(/^\/+/, '');
  if (!normalized || normalized.includes('\0')) {
    throw requestError('Choose a workspace file to summarize.');
  }
  return normalized;
}

export function canSummarizeEvidencePath(relPath) {
  let normalized;
  try {
    normalized = normalizeRelPath(relPath);
  } catch {
    return false;
  }
  if (path.posix.extname(normalized).toLowerCase() !== '.json') return false;
  return isSummarizableArtifactKind(classifySummarizableJsonArtifact(normalized));
}

export function canSummarizeEvidenceValue(relPath, value) {
  try {
    return Boolean(classifySummarizableJsonArtifact(normalizeRelPath(relPath), value));
  } catch {
    return false;
  }
}

export function canExportJsonAsCsvPath(relPath) {
  try {
    return path.posix.extname(normalizeRelPath(relPath)).toLowerCase() === '.json';
  } catch {
    return false;
  }
}

function html(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]));
}

function compactNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(abs >= 10_000_000_000 ? 0 : 1)}B`;
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}K`;
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(2).replace(/\.?0+$/, '');
}

function formatNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value ?? '');
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 }).format(n);
}

function epochMs(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n > 10_000_000_000) return n;
  if (n > 1_000_000_000) return n * 1000;
  return null;
}

function dateParts(value) {
  const ms = epochMs(value);
  return ms ? new Date(ms) : null;
}

function formatTime(value) {
  const date = dateParts(value);
  if (!date) return value === 0 ? 'Not ended' : String(value ?? '');
  return date.toISOString().replace('T', ' ').replace('.000Z', ' UTC');
}

function formatBannerTime(value) {
  const date = dateParts(value);
  if (!date) return '';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
}

function formatAxisTime(ms, spanMs) {
  const date = new Date(ms);
  const opts = spanMs <= 6 * HOUR_MS
    ? { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }
    : spanMs <= 7 * DAY_MS
      ? { month: 'short', day: 'numeric', hour: '2-digit', hourCycle: 'h23' }
      : spanMs <= 370 * DAY_MS
        ? { month: 'short', day: 'numeric' }
        : { month: 'short', year: 'numeric' };
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...opts }).format(date);
}

function formatDuration(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return '';
  if (n >= DAY_MS) return `${compactNumber(n / DAY_MS)}d`;
  if (n >= HOUR_MS) return `${compactNumber(n / HOUR_MS)}h`;
  if (n >= MINUTE_MS) return `${compactNumber(n / MINUTE_MS)}m`;
  if (n >= 1000) return `${compactNumber(n / 1000)}s`;
  return `${compactNumber(n)}ms`;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function typedValue(value) {
  if (!isPlainObject(value)) return undefined;
  if (Object.prototype.hasOwnProperty.call(value, 'value')) return value.value;
  if (Object.prototype.hasOwnProperty.call(value, 'str')) return value.str;
  if (Object.prototype.hasOwnProperty.call(value, 'addr')) return value.addr;
  return undefined;
}

function shorten(value, max = MAX_TEXT) {
  const s = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  return `${s.slice(0, max - 3).trimEnd()}...`;
}

function structuredPreview(value) {
  if (Array.isArray(value)) {
    if (!value.length) return '';
    const visibleItems = value.slice(0, MAX_STRUCTURED_ITEMS);
    if (visibleItems.every((item) => item === null || ['string', 'number', 'boolean'].includes(typeof item))) {
      const visible = visibleItems
        .map((item) => displayValue(item))
        .filter(Boolean)
        .join(', ');
      const omitted = value.length - Math.min(value.length, MAX_STRUCTURED_ITEMS);
      return shorten(`${visible}${omitted ? ` … (${formatNumber(omitted)} more items)` : ''}`);
    }
    return `[Array with ${formatNumber(value.length)} items]`;
  }
  if (isPlainObject(value)) {
    return `[Object with ${formatNumber(Object.keys(value).length)} properties]`;
  }
  return shorten(String(value ?? ''));
}

function markdownishText(value) {
  return String(value ?? '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\\\./g, '.');
}

function safeMarkdownUrl(value) {
  const raw = String(value ?? '').trim();
  if (!raw || raw.length > MAX_URL_TEXT || /[\u0000-\u001f\s]/.test(raw)) return '';
  if (raw.startsWith('/') || raw.startsWith('#')) return raw;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? raw : '';
  } catch {
    return '';
  }
}

function renderFormattedText(value) {
  return String(value ?? '').split(/(`[^`]*`)/g).map((part) => {
    if (part.startsWith('`') && part.endsWith('`')) {
      return `<code>${html(part.slice(1, -1))}</code>`;
    }
    return html(part)
      .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  }).join('');
}

function renderInlineMarkdown(value) {
  const input = String(value ?? '');
  const linkPattern = /\[([^\]\n]+)\]\(([^)\s]+)\)/g;
  let out = '';
  let index = 0;
  for (const match of input.matchAll(linkPattern)) {
    out += renderFormattedText(input.slice(index, match.index));
    const url = safeMarkdownUrl(match[2]);
    if (url) {
      const external = /^https?:\/\//i.test(url);
      const attrs = external ? ' target="_blank" rel="noopener noreferrer"' : '';
      out += `<a href="${html(url)}"${attrs}>${renderFormattedText(match[1])}</a>`;
    } else {
      out += renderFormattedText(match[1]);
    }
    index = match.index + match[0].length;
  }
  out += renderFormattedText(input.slice(index));
  return out;
}

function renderMarkdownLines(value) {
  return String(value ?? '').split('\n').map((line) => renderInlineMarkdown(line.trim())).join('<br>');
}

function renderMarkdownDescription(value) {
  const text = String(value ?? '').replace(/\r\n?/g, '\n').replace(/\\\./g, '.').trim();
  if (!text) return '';
  return text.split(/\n{2,}/).map((block) => {
    const lines = block.split('\n').map((line) => line.trimEnd()).filter((line) => line.trim());
    const bulletItems = lines.map((line) => line.match(/^\s*[-*+]\s+(.+)$/));
    if (lines.length && bulletItems.every(Boolean)) {
      return `<ul>${bulletItems.map((match) => `<li>${renderInlineMarkdown(match[1])}</li>`).join('')}</ul>`;
    }
    const numberedItems = lines.map((line) => line.match(/^\s*\d+[.)]\s+(.+)$/));
    if (lines.length && numberedItems.every(Boolean)) {
      return `<ol>${numberedItems.map((match) => `<li>${renderInlineMarkdown(match[1])}</li>`).join('')}</ol>`;
    }
    return `<p>${renderMarkdownLines(lines.join('\n'))}</p>`;
  }).join('');
}

function renderBoundedMarkdownDescription(value) {
  const input = String(value ?? '');
  const visible = input.slice(0, MAX_DETAIL_TEXT);
  const omitted = input.length - visible.length;
  return `${omitted ? renderLimitNotice([
    `Description truncated from ${formatNumber(input.length)} to ${formatNumber(visible.length)} characters; ${formatNumber(omitted)} characters were omitted.`,
  ]) : ''}${renderMarkdownDescription(visible)}`;
}

function isEnumishKey(key) {
  return /(^|\.)(role|status|resolution|severity|category|categories|type|object_type|metric_category|stat_name|endpoint|family)$/i.test(key);
}

function displayCase(value, key = '') {
  const text = String(value ?? '');
  const letters = text.match(/[A-Za-z]/g)?.join('') || '';
  if (isEnumishKey(key) && letters && letters === letters.toLowerCase()) return text.toUpperCase();
  return text;
}

function displayValue(value, key = '') {
  const typed = typedValue(value);
  if (typed !== undefined) return displayValue(typed, key);
  if (value === null || value === undefined || value === '') return '';
  if (/time|timestamp|seen|discover|mod_time/i.test(key)) return formatTime(value);
  if (typeof value === 'number') return formatNumber(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') return displayCase(shorten(markdownishText(value)), key);
  if (Array.isArray(value)) {
    return displayCase(structuredPreview(value), key);
  }
  if (isPlainObject(value)) return structuredPreview(value);
  return shorten(String(value));
}

function createFlattenStats() {
  return { omittedFields: 0, depthLimited: 0, fieldsWritten: 0 };
}

function flattenObject(value, prefix = '', out = {}, depth = 0, stats = null) {
  if (!isPlainObject(value)) return out;
  for (const key in value) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
    if (stats && stats.fieldsWritten >= EVIDENCE_SUMMARY_LIMITS.flattenFieldsPerRow) {
      stats.omittedFields += 1;
      continue;
    }
    const raw = value[key];
    const nextKey = prefix ? `${prefix}.${key}` : key;
    const typed = typedValue(raw);
    if (typed !== undefined) {
      out[nextKey] = typed;
      if (stats) stats.fieldsWritten += 1;
    } else if (isPlainObject(raw) && depth < (stats ? EVIDENCE_SUMMARY_LIMITS.flattenDepth : 1)) {
      flattenObject(raw, nextKey, out, depth + 1, stats);
    } else if (isPlainObject(raw) && stats) {
      stats.depthLimited += 1;
      out[nextKey] = `[Nested object omitted at depth ${EVIDENCE_SUMMARY_LIMITS.flattenDepth}]`;
      stats.fieldsWritten += 1;
    } else {
      out[nextKey] = raw;
      if (stats) stats.fieldsWritten += 1;
    }
  }
  return out;
}

function nonEmpty(value) {
  return value !== undefined && value !== null && value !== '' && !(Array.isArray(value) && value.length === 0);
}

function sourceTitle(sourcePath) {
  return path.posix.basename(sourcePath);
}

function classifyEvidence(relPath, value) {
  const normalized = normalizeRelPath(relPath);
  const kind = classifySummarizableJsonArtifact(normalized, value);
  if (kind) return kind;
  throw requestError('Summaries are available for records, metrics, detections, entities, research search JSON, and ReversingLabs response JSON.');
}

export function classifyEvidenceValue(relPath, value) {
  return classifyEvidence(relPath, value);
}

function allColumns(rows, priority = []) {
  const seen = new Set();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (nonEmpty(row[key])) seen.add(key);
    }
  }
  const priorityRank = new Map(priority.map((key, index) => [key, index]));
  return [...seen].sort((a, b) => {
    const ar = priorityRank.has(a) ? priorityRank.get(a) : 10_000;
    const br = priorityRank.has(b) ? priorityRank.get(b) : 10_000;
    if (ar !== br) return ar - br;
    return a.localeCompare(b);
  });
}

function renderLimitNotice(parts) {
  const items = parts.filter(Boolean);
  return items.length
    ? `<div class="summary-limit-notice" role="note">${items.map(html).join(' ')}</div>`
    : '';
}

function formatTableOmissions(omittedRows, omittedColumns) {
  const dimensions = [];
  if (omittedRows > 0) dimensions.push(`${formatNumber(omittedRows)} ${omittedRows === 1 ? 'row' : 'rows'}`);
  if (omittedColumns > 0) dimensions.push(`${formatNumber(omittedColumns)} ${omittedColumns === 1 ? 'column' : 'columns'}`);
  if (!dimensions.length) return '';
  const verb = dimensions.length === 1 && (omittedRows === 1 || omittedColumns === 1) ? 'was' : 'were';
  return `${dimensions.join(' and ')} ${verb} omitted by summary limits.`;
}

function tableViewport(columnCount, rowCount) {
  const candidateRows = Math.min(rowCount, EVIDENCE_SUMMARY_LIMITS.rows);
  const columnsForAllRows = Math.floor(EVIDENCE_SUMMARY_LIMITS.cells / Math.max(1, candidateRows));
  const visibleColumnCount = Math.min(
    columnCount,
    Math.max(EVIDENCE_SUMMARY_LIMITS.preferredColumns, columnsForAllRows),
  );
  const visibleRowCount = Math.min(
    candidateRows,
    Math.floor(EVIDENCE_SUMMARY_LIMITS.cells / Math.max(1, visibleColumnCount)),
  );
  return { visibleColumnCount, visibleRowCount };
}

function renderTable(columns, rows, {
  empty = 'No rows found.',
  totalRows = rows.length,
  flattenStats = null,
} = {}) {
  if (!rows.length || !columns.length) return `<div class="summary-empty">${html(empty)}</div>`;
  const { visibleColumnCount, visibleRowCount } = tableViewport(columns.length, rows.length);
  const visibleColumns = columns.slice(0, visibleColumnCount);
  const visibleRows = rows.slice(0, visibleRowCount);
  const head = visibleColumns.map((column) => `<th>${html(column)}</th>`).join('');
  const body = visibleRows.map((row) => (
    `<tr>${visibleColumns.map((column) => `<td>${html(displayValue(row[column], column))}</td>`).join('')}</tr>`
  )).join('');
  const notices = [];
  const omittedRows = Math.max(0, totalRows - visibleRows.length);
  const omittedColumns = Math.max(0, columns.length - visibleColumns.length);
  if (omittedRows > 0 || omittedColumns > 0) {
    notices.push(
      `Showing ${formatNumber(visibleRows.length)} of ${formatNumber(totalRows)} rows and ${formatNumber(visibleColumns.length)} of ${formatNumber(columns.length)} columns (${formatNumber(visibleRows.length * visibleColumns.length)} cells).`,
    );
    notices.push(formatTableOmissions(omittedRows, omittedColumns));
  }
  if (flattenStats?.omittedFields) {
    notices.push(`${formatNumber(flattenStats.omittedFields)} fields were omitted after the ${formatNumber(EVIDENCE_SUMMARY_LIMITS.flattenFieldsPerRow)}-field per-row flattening limit.`);
  }
  if (flattenStats?.depthLimited) {
    notices.push(`${formatNumber(flattenStats.depthLimited)} nested objects were replaced at the depth-${formatNumber(EVIDENCE_SUMMARY_LIMITS.flattenDepth)} flattening limit.`);
  }
  return `${renderLimitNotice(notices)}<div class="summary-table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function renderPropertyTable(value) {
  const flattenStats = createFlattenStats();
  const entries = Object.entries(flattenObject(value, '', {}, 0, flattenStats)).filter(([, raw]) => nonEmpty(raw));
  if (!entries.length) return '<div class="summary-empty">No entity properties were present.</div>';
  const rows = entries.map(([property, raw]) => ({ property, value: displayValue(raw, property) }));
  return renderTable(['property', 'value'], rows, { flattenStats });
}

function renderHeroCards(cards) {
  return `<div class="summary-heroes">${cards.slice(0, 4).map(({ label, value }) => `
    <div class="summary-hero">
      <span>${html(label)}</span>
      <strong>${html(value)}</strong>
    </div>`).join('')}</div>`;
}

function renderBanner(title, kind) {
  return `
    <div class="summary-banner">
      <span>${html(kind)}</span>
      <strong>${html(title)}</strong>
    </div>`;
}

function renderShell({ title, kind, body }) {
  return `<div class="summary-inline">${renderBanner(title, kind)}<div class="summary-content">${body}</div></div>`;
}

function recordPayload(record) {
  if (!isPlainObject(record)) return { value: record };
  if (isPlainObject(record._source)) {
    return {
      timestamp: record._source.timestamp,
      ...record._source,
      _type: record._type,
      _id: record._id,
      appliance: record.appliance,
    };
  }
  return record;
}

function recordsFromValue(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.records)) return value.records;
  return [];
}

function boundedFlattenRows(items, transform = (item) => item) {
  const flattenStats = createFlattenStats();
  const rows = items.slice(0, EVIDENCE_SUMMARY_LIMITS.rows).map((item) => {
    const rowStats = createFlattenStats();
    const transformed = transform(item);
    const row = isPlainObject(transformed)
      ? flattenObject(transformed, '', {}, 0, rowStats)
      : { value: transformed };
    flattenStats.omittedFields += rowStats.omittedFields;
    flattenStats.depthLimited += rowStats.depthLimited;
    return row;
  });
  return { rows, totalRows: items.length, flattenStats };
}

function rowsFromRecords(records, { bounded = false } = {}) {
  if (bounded) return boundedFlattenRows(records, recordPayload);
  return records.map((record) => flattenObject(recordPayload(record)));
}

function renderRecordsSummary(sourcePath, value) {
  const records = recordsFromValue(value);
  const table = rowsFromRecords(records, { bounded: true });
  const { rows } = table;
  const columns = allColumns(rows, [
    'timestamp', 'start_time', 'end_time', '_type', 'clientAddr', 'serverAddr',
    'client.value', 'server.value', 'host', 'uri', 'method', 'statusCode',
    'rspBytes', 'reqBytes', 'flowId', 'title',
  ]);
  return renderShell({
    title: sourceTitle(sourcePath),
    kind: 'Records',
    body: renderTable(columns, rows, { ...table, empty: 'No records were present in this file.' }),
  });
}

function safeWebUrl(value) {
  try {
    const raw = String(value || '');
    if (raw.length > MAX_URL_TEXT) return '';
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '';
  } catch {
    return '';
  }
}

function displayIsoTime(value) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return '';
  return date.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC');
}

function researchProviderLabel(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'brave') return 'Brave';
  if (normalized === 'duckduckgo' || normalized === 'duckduckgo-html') return 'DuckDuckGo';
  if (normalized === 'cve') return 'CVE Program';
  if (normalized === 'kev') return 'CISA KEV';
  if (normalized === 'epss') return 'FIRST EPSS';
  if (normalized === 'attack') return 'MITRE ATT&CK';
  if (normalized === 'rfc') return 'RFC Editor';
  if (normalized === 'iana') return 'IANA';
  if (normalized === 'rdap') return 'RDAP';
  return value ? String(value) : 'Unknown';
}

function renderResearchSearchSummary(sourcePath, value) {
  if (!isPlainObject(value) || value.kind !== 'search' || !Array.isArray(value.results)) {
    throw requestError('This research search file does not match the supported search-results schema.');
  }
  const results = value.results;
  const visibleResults = results.slice(0, EVIDENCE_SUMMARY_LIMITS.rows);
  const provider = researchProviderLabel(value.provider);
  const retrieved = displayIsoTime(value.retrievedAt) || 'Unknown';
  let warningCount = 0;
  const visibleWarnings = [];
  for (const warning of Array.isArray(value.warnings) ? value.warnings : []) {
    if (!nonEmpty(warning)) continue;
    warningCount += 1;
    if (visibleWarnings.length < MAX_STRUCTURED_ITEMS) visibleWarnings.push(warning);
  }
  const cards = visibleResults.map((result, index) => {
    const rank = Number.isFinite(Number(result?.rank)) ? Number(result.rank) : index + 1;
    const url = safeWebUrl(result?.url);
    const title = shorten(result?.title || result?.domain || result?.url || `Result ${rank}`);
    const titleHtml = url
      ? `<a href="${html(url)}" target="_blank" rel="noopener noreferrer">${html(title)}</a>`
      : `<span>${html(title)}</span>`;
    const published = displayIsoTime(result?.publishedAt);
    return `
      <article class="summary-research-result">
        <div class="summary-research-rank">${html(rank)}</div>
        <div class="summary-research-result-body">
          <h3>${titleHtml}</h3>
          <div class="summary-research-meta">
            ${result?.domain ? `<span>${html(shorten(result.domain))}</span>` : ''}
            ${published ? `<span>Published ${html(published)}</span>` : ''}
          </div>
          ${result?.snippet ? `<p>${html(shorten(result.snippet))}</p>` : ''}
          ${url ? `<a class="summary-research-url" href="${html(url)}" target="_blank" rel="noopener noreferrer">${html(shorten(url))}</a>` : ''}
        </div>
      </article>`;
  }).join('');
  return renderShell({
    title: sourceTitle(sourcePath),
    kind: 'Research Search',
    body: `
      <div class="summary-research-query">
        <span>Query</span>
        <strong>${html(shorten(value.query || 'Not recorded', MAX_DETAIL_TEXT))}</strong>
      </div>
      ${renderHeroCards([
        { label: 'Provider', value: provider },
        { label: 'Results', value: formatNumber(results.length) },
        { label: 'Retrieved', value: retrieved },
      ])}
      ${renderLimitNotice([
        visibleResults.length < results.length
          ? `Showing ${formatNumber(visibleResults.length)} of ${formatNumber(results.length)} research results; ${formatNumber(results.length - visibleResults.length)} were omitted by the row limit.`
          : '',
        visibleWarnings.length < warningCount
          ? `Showing ${formatNumber(visibleWarnings.length)} of ${formatNumber(warningCount)} warnings; ${formatNumber(warningCount - visibleWarnings.length)} were omitted.`
          : '',
      ])}
      <div class="summary-research-results">${cards || '<div class="summary-empty">No search results were returned.</div>'}</div>
      ${visibleWarnings.length ? `<div class="summary-research-warnings"><strong>Warnings</strong><ul>${visibleWarnings.map((warning) => `<li>${html(shorten(warning))}</li>`).join('')}</ul></div>` : ''}`,
  });
}

function renderCanonicalChips(items) {
  const visible = items.filter(nonEmpty).slice(0, MAX_STRUCTURED_ITEMS);
  return visible.length ? `<div class="summary-chips">${visible.map((item) => `<span>${html(shorten(item))}</span>`).join('')}</div>` : '';
}

function renderCanonicalLinks(items) {
  const links = [];
  for (const item of items || []) {
    const raw = typeof item === 'string' ? item : item?.url;
    const url = safeWebUrl(raw);
    if (!url) continue;
    links.push(`<li><a href="${html(url)}" target="_blank" rel="noopener noreferrer">${html(shorten(item?.label || url))}</a></li>`);
    if (links.length >= MAX_STRUCTURED_ITEMS) break;
  }
  return links.length ? `<div class="summary-canonical-links"><strong>References</strong><ul>${links.join('')}</ul></div>` : '';
}

function sourceLink(url, label) {
  return url ? { url, label } : null;
}

function renderCanonicalWarnings(warnings) {
  const visible = (Array.isArray(warnings) ? warnings : []).filter(nonEmpty).slice(0, MAX_STRUCTURED_ITEMS);
  return visible.length
    ? `<div class="summary-research-warnings"><strong>Warnings</strong><ul>${visible.map((warning) => `<li>${html(shorten(warning, MAX_DETAIL_TEXT))}</li>`).join('')}</ul></div>`
    : '';
}

function canonicalQueryText(query) {
  if (!isPlainObject(query)) return shorten(query || 'Not recorded', MAX_DETAIL_TEXT);
  return Object.entries(query).filter(([, value]) => nonEmpty(value))
    .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : value}`)
    .join(' · ') || 'Not recorded';
}

function renderCanonicalSource(source) {
  const url = safeWebUrl(source?.url);
  if (!url) return '';
  const publisher = shorten(source?.publisher || source?.name || 'Canonical source');
  return `<div class="summary-canonical-source"><span>Canonical source</span><a href="${html(url)}" target="_blank" rel="noopener noreferrer">${html(publisher)}</a></div>`;
}

function renderCanonicalDescription(value) {
  return nonEmpty(value) ? `<div class="summary-description"><p>${html(shorten(value, MAX_DETAIL_TEXT))}</p></div>` : '';
}

function renderCveCanonical(result) {
  const metrics = Array.isArray(result?.metrics) ? result.metrics : [];
  const bestMetric = metrics.find((metric) => nonEmpty(metric?.score)) || {};
  const affected = (Array.isArray(result?.affected) ? result.affected : []).map((item) => ({
    vendor: item?.vendor,
    product: item?.product || item?.package,
    versions: (Array.isArray(item?.versions) ? item.versions : []).map((version) => {
      const range = version?.lessThan ? ` < ${version.lessThan}` : '';
      return `${version?.version || 'unspecified'}${range} (${version?.status || 'unknown'})`;
    }).join('; '),
  }));
  return `<article class="summary-canonical-card">
    <h3>${html(result?.id || 'CVE record')}${result?.title ? ` — ${html(shorten(result.title, 500))}` : ''}</h3>
    ${renderCanonicalChips([
      result?.state,
      nonEmpty(bestMetric.score) ? `CVSS ${bestMetric.version || ''} ${bestMetric.score}` : '',
      bestMetric.severity,
      result?.assigner ? `Assigner: ${result.assigner}` : '',
    ])}
    ${renderCanonicalDescription(result?.description)}
    ${result?.weaknesses?.length ? `<h4>Weaknesses</h4>${renderCanonicalChips(result.weaknesses)}` : ''}
    ${affected.length ? `<h4>Affected products</h4>${renderTable(['vendor', 'product', 'versions'], affected, { empty: 'No affected products were listed.' })}` : ''}
    ${(result?.solutions?.length || result?.workarounds?.length) ? `<h4>Mitigations</h4><ul class="summary-canonical-list">${[...(result.solutions || []), ...(result.workarounds || [])].slice(0, MAX_STRUCTURED_ITEMS).map((item) => `<li>${html(shorten(item, MAX_DETAIL_TEXT))}</li>`).join('')}</ul>` : ''}
    ${renderCanonicalLinks(result?.references)}
  </article>`;
}

function renderKevCanonical(result) {
  if (!result) return '<div class="summary-empty">This CVE was not present in the retrieved CISA KEV catalog.</div>';
  return `<article class="summary-canonical-card">
    <h3>${html(result.id || 'CISA KEV entry')} — ${html(shorten(result.name || 'Known exploited vulnerability', 500))}</h3>
    ${renderCanonicalChips([
      result.vendor,
      result.product,
      result.dateAdded ? `Added ${result.dateAdded}` : '',
      result.dueDate ? `Due ${result.dueDate}` : '',
      result.knownRansomwareCampaignUse ? `Ransomware use: ${result.knownRansomwareCampaignUse}` : '',
    ])}
    ${renderCanonicalDescription(result.description)}
    ${result.requiredAction ? `<div class="summary-canonical-callout"><span>Required action</span><strong>${html(shorten(result.requiredAction, MAX_DETAIL_TEXT))}</strong></div>` : ''}
  </article>`;
}

function percentValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `${(number * 100).toFixed(number >= 0.1 ? 1 : 2)}%` : 'Unknown';
}

function renderEpssCanonical(result) {
  if (!result) return '<div class="summary-empty">FIRST EPSS returned no score for this CVE.</div>';
  return `<article class="summary-canonical-card">
    <h3>${html(result.id || 'EPSS score')}</h3>
    ${renderHeroCards([
      { label: 'EPSS probability', value: percentValue(result.score) },
      { label: 'Percentile', value: percentValue(result.percentile) },
      { label: 'Score date', value: result.date || 'Unknown' },
    ])}
    <p class="summary-canonical-note">EPSS estimates the probability of exploitation activity in the next 30 days. It is prioritization context, not proof that this vulnerability was exploited here.</p>
  </article>`;
}

function renderAttackCanonical(result) {
  if (!result) return '<div class="summary-empty">No ATT&CK object was returned.</div>';
  return `<article class="summary-canonical-card">
    <h3>${html(result.id || 'ATT&CK object')} — ${html(shorten(result.name || '', 500))}</h3>
    ${renderCanonicalChips([
      result.type,
      ...(result.tactics || []),
      ...(result.platforms || []),
      result.version ? `Version ${result.version}` : '',
    ])}
    ${renderCanonicalDescription(result.description)}
    ${renderCanonicalLinks([sourceLink(result.url, 'Open this object in MITRE ATT&CK')])}
  </article>`;
}

function renderRfcCanonical(results) {
  return results.map((result) => `<article class="summary-canonical-card">
    <h3>${html(result.id || 'RFC')} — ${html(shorten(result.title || '', 500))}</h3>
    ${renderCanonicalChips([
      result.standardLevel,
      result.stream,
      nonEmpty(result.pages) ? `${result.pages} pages` : '',
      ...(result.states || []),
    ])}
    ${renderCanonicalDescription(result.abstract)}
    ${renderCanonicalLinks([
      sourceLink(result.infoUrl, 'RFC Editor information page'),
      sourceLink(result.documentUrl, 'Read the RFC'),
    ])}
  </article>`).join('');
}

function renderIanaCanonical(results) {
  const table = boundedFlattenRows(results);
  const columns = allColumns(table.rows, ['service', 'port', 'transport', 'number', 'keyword', 'protocol', 'mediaType', 'description', 'reference']);
  return renderTable(columns, table.rows, { ...table, empty: 'No IANA registry entries matched.' });
}

function renderRdapCanonical(result) {
  if (!result) return '<div class="summary-empty">No RDAP registration object was returned.</div>';
  const properties = [{
    objectClass: result.objectClass,
    handle: result.handle,
    name: result.name,
    country: result.country,
    type: result.type,
    startAddress: result.startAddress,
    endAddress: result.endAddress,
    startAutnum: result.startAutnum,
    endAutnum: result.endAutnum,
  }];
  const eventRows = Array.isArray(result.events) ? result.events : [];
  const entityRows = (Array.isArray(result.entities) ? result.entities : []).map((entity) => ({
    handle: entity.handle,
    name: entity.name,
    roles: Array.isArray(entity.roles) ? entity.roles.join(', ') : '',
  }));
  return `<article class="summary-canonical-card">
    <h3>${html(result.name || result.handle || result.query?.value || 'RDAP result')}</h3>
    ${renderCanonicalChips(result.status || [])}
    ${renderTable(allColumns(properties), properties)}
    ${eventRows.length ? `<h4>Registration events</h4>${renderTable(['action', 'date'], eventRows)}` : ''}
    ${entityRows.length ? `<h4>Public entities</h4>${renderTable(['handle', 'name', 'roles'], entityRows)}` : ''}
    ${result.nameservers?.length ? `<h4>Name servers</h4>${renderCanonicalChips(result.nameservers.map((item) => item.name))}` : ''}
    ${renderCanonicalLinks([sourceLink(result.responseUrl, 'Authoritative RDAP response')])}
  </article>`;
}

function renderCanonicalResults(provider, results) {
  if (provider === 'cve') return results.map(renderCveCanonical).join('');
  if (provider === 'kev') return renderKevCanonical(results[0]);
  if (provider === 'epss') return renderEpssCanonical(results[0]);
  if (provider === 'attack') return renderAttackCanonical(results[0]);
  if (provider === 'rfc') return renderRfcCanonical(results);
  if (provider === 'iana') return renderIanaCanonical(results);
  if (provider === 'rdap') return renderRdapCanonical(results[0]);
  return renderGenericJsonTable(results);
}

function renderCanonicalResearchSummary(sourcePath, value) {
  if (!isPlainObject(value) || value.kind !== 'canonical' || !Array.isArray(value.results)) {
    throw requestError('This canonical research file does not match the supported resolver schema.');
  }
  const provider = researchProviderLabel(value.provider);
  const retrieved = displayIsoTime(value.retrievedAt) || 'Unknown';
  return renderShell({
    title: sourceTitle(sourcePath),
    kind: provider,
    body: `
      <div class="summary-research-query">
        <span>Lookup</span>
        <strong>${html(shorten(canonicalQueryText(value.query), MAX_DETAIL_TEXT))}</strong>
      </div>
      ${renderHeroCards([
        { label: 'Resolver', value: provider },
        { label: 'Results', value: formatNumber(value.results.length) },
        { label: 'Retrieved', value: retrieved },
      ])}
      ${renderCanonicalSource(value.source)}
      <div class="summary-canonical-results">${renderCanonicalResults(value.provider, value.results)}</div>
      ${renderCanonicalWarnings(value.warnings)}`,
  });
}

function renderRlClassification(classification) {
  return `<span class="summary-rl-classification" data-class="${html(classification.token)}">${html(classification.label)}</span>`;
}

function friendlyRlValue(value) {
  return String(value || '').replace(/[_-]+/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}

function friendlyHashAlgorithm(value) {
  return String(value || 'unknown').toUpperCase().replace(/^SHA(1|256|512)$/, 'SHA-$1');
}

function renderRlStatusSummary(summary) {
  const notFound = Number(summary.statusCounts.not_found || 0);
  const noResponse = summary.unreturnedHashes.length;
  const statusEntries = Object.entries(summary.statusCounts);
  const algorithmEntries = Object.entries(summary.algorithmCounts);
  const breakdown = statusEntries.slice(0, MAX_STRUCTURED_ITEMS).map(([status, count]) => `
    <span data-status="${html(status)}"><strong>${html(formatNumber(count))}</strong>${html(friendlyRlValue(status))}</span>`).join('');
  const algorithms = algorithmEntries.slice(0, MAX_STRUCTURED_ITEMS).map(([algorithm, count]) => `
    <span><strong>${html(formatNumber(count))}</strong>${html(friendlyHashAlgorithm(algorithm))}</span>`).join('');
  const visibleRows = summary.statusRows.slice(0, EVIDENCE_SUMMARY_LIMITS.rows);
  const rows = visibleRows.map((item) => {
    const rawStatus = item.status || 'no_response';
    const classification = item.status
      ? { ...item.classification, label: friendlyRlValue(item.status) }
      : { label: 'No response', token: 'missing' };
    return `
      <tr data-status="${html(rawStatus)}">
        <td><code>${html(shorten(item.hashValue || 'Unknown hash'))}</code></td>
        <td>${html(friendlyHashAlgorithm(item.hashAlgorithm))}</td>
        <td>${renderRlClassification(classification)}</td>
      </tr>`;
  }).join('');
  return `
    ${renderHeroCards([
    { label: 'Requested hashes', value: formatNumber(summary.requestedCount) },
    { label: 'Status responses', value: formatNumber(summary.statusResponseCount) },
    { label: 'Not found', value: formatNumber(notFound) },
    { label: 'No response', value: formatNumber(noResponse) },
    ])}
    ${renderLimitNotice([
      visibleRows.length < summary.statusRows.length
        ? `Showing ${formatNumber(visibleRows.length)} of ${formatNumber(summary.statusRows.length)} hash status rows; ${formatNumber(summary.statusRows.length - visibleRows.length)} were omitted.`
        : '',
      statusEntries.length > MAX_STRUCTURED_ITEMS
        ? `${formatNumber(statusEntries.length - MAX_STRUCTURED_ITEMS)} status breakdown values were omitted.`
        : '',
      algorithmEntries.length > MAX_STRUCTURED_ITEMS
        ? `${formatNumber(algorithmEntries.length - MAX_STRUCTURED_ITEMS)} algorithm breakdown values were omitted.`
        : '',
    ])}
    <div class="summary-rl-status-overview">
      <div><span>Status breakdown</span><div class="summary-rl-status-chips">${breakdown}</div></div>
      <div><span>Hash algorithms</span><div class="summary-rl-status-chips">${algorithms}</div></div>
    </div>
    <div class="summary-rl-status-callout">
      <strong>${notFound === summary.requestedCount && noResponse === 0 ? 'No requested hashes were found in this ReversingLabs scope.' : 'Review the exact status for each requested hash.'}</strong>
      <span>Not found means absent from the queried scope. It is not a benign or known-good verdict.</span>
    </div>
    <div class="summary-rl-status-table-wrap">
      <table class="summary-rl-status-table">
        <thead><tr><th>Hash</th><th>Algorithm</th><th>Status</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function renderRlItem(item, index) {
  const details = [
    ['Threat', item.threat],
    ['Filename', item.filename],
    ['File type', item.fileType],
    ['File size', item.fileSize === null ? '' : `${formatNumber(item.fileSize)} bytes`],
    ['Risk score', item.riskScore],
    ['First seen (RL)', displayIsoTime(item.firstSeen)],
    ['Last seen (RL)', displayIsoTime(item.lastSeen)],
    ['Extracted files', item.extractedFiles],
  ].filter(([, raw]) => nonEmpty(raw)).map(([key, raw]) => [key, shorten(raw)]);
  const hashes = Object.entries(item.hashes || {}).slice(0, MAX_STRUCTURED_ITEMS);
  const tags = (item.tags || []).slice(0, 24);
  const label = shorten(item.filename || item.threat || item.hashes?.sha256 || item.hashes?.sha1
    || item.hashes?.md5 || `Result ${index + 1}`);
  return `
    <article class="summary-rl-result" data-class="${html(item.classification.token)}">
      <div class="summary-rl-result-head">
        <div>${renderRlClassification(item.classification)}<strong>${html(label)}</strong></div>
        ${item.riskScore ? `<span class="summary-rl-risk"><small>Risk score</small>${html(item.riskScore)}</span>` : ''}
      </div>
      ${details.length ? `<dl class="summary-rl-details">${details.map(([key, raw]) => `<dt>${html(key)}</dt><dd>${html(raw)}</dd>`).join('')}</dl>` : ''}
      ${hashes.length ? `<div class="summary-rl-hashes">${hashes.map(([key, raw]) => `<div><span>${html(shorten(key))}</span><code>${html(shorten(raw))}</code></div>`).join('')}</div>` : ''}
      ${tags.length ? `<div class="summary-rl-tags">${tags.map((tag) => `<span>${html(shorten(tag))}</span>`).join('')}</div>` : ''}
    </article>`;
}

function renderReversingLabsSummary(sourcePath, value) {
  let summary;
  try {
    summary = summarizeReversingLabsEnvelope(value, { sourcePath });
  } catch (error) {
    throw requestError(error.message);
  }
  const isSampleStatus = summary.operation === 'sample-status';
  const subject = shorten(summary.query || (!isSampleStatus && summary.requestedHashes.length <= 5
    ? summary.requestedHashes.join(', ')
    : ''), MAX_DETAIL_TEXT);
  const visibleItems = summary.items.slice(0, EVIDENCE_SUMMARY_LIMITS.rows);
  const results = visibleItems.map(renderRlItem).join('');
  return `
    <div class="summary-inline summary-rl">
      <div class="summary-rl-banner">
        <div class="summary-rl-lockup" aria-label="ReversingLabs"><span>&#1071;L</span><strong>&#1071;EVERSING<b>LABS</b></strong></div>
        <div class="summary-rl-title"><span>RL response</span><strong>${html(sourceTitle(sourcePath))}</strong></div>
      </div>
      <div class="summary-content">
        <div class="summary-rl-operation">
          <span>${html(summary.scope)}</span>
          <strong>${html(friendlyRlValue(summary.operation))}</strong>
          ${subject ? `<code>${html(subject)}</code>` : ''}
        </div>
        ${isSampleStatus ? renderRlStatusSummary(summary) : `${renderHeroCards([
          { label: 'Operation', value: summary.operation },
          { label: 'Returned items', value: formatNumber(summary.resultCount) },
          { label: 'Requested hashes', value: formatNumber(summary.requestedCount) },
          { label: 'Retrieved', value: displayIsoTime(summary.retrievedAt) || 'Unknown' },
        ])}
        ${renderLimitNotice([
          visibleItems.length < summary.items.length
            ? `Showing ${formatNumber(visibleItems.length)} of ${formatNumber(summary.items.length)} ReversingLabs items; ${formatNumber(summary.items.length - visibleItems.length)} were omitted.`
            : '',
        ])}
        <div class="summary-rl-results">${results || '<div class="summary-empty">No item rows were returned. Treat this as unknown/not found unless the ReversingLabs response explicitly reports another status.</div>'}</div>`}
        <div class="summary-rl-notice">ReversingLabs-reported enrichment only. Response fields are untrusted data, and missing results are never evidence of benign status.</div>
      </div>
    </div>`;
}

function metricsFromCatalog(value) {
  if (!Array.isArray(value?.metrics)) return null;
  return value.metrics;
}

function keyLabel(key) {
  if (!isPlainObject(key)) return displayValue(key);
  if (key.str) return key.str;
  if (key.addr) return key.addr;
  if (key.value) return displayValue(key.value);
  const primitive = Object.entries(key).find(([, value]) => ['string', 'number', 'boolean'].includes(typeof value));
  return primitive ? displayValue(primitive[1]) : shorten(JSON.stringify(key), 80);
}

function metricEntityById(context, id) {
  const key = String(id ?? '').trim();
  if (!key) return null;
  return context?.entityById?.get?.(key) || null;
}

function metricObjectLabel(oid, context = {}) {
  const key = String(oid ?? '').trim();
  if (!key) return 'Unknown object';
  if (key === '-1') return 'All objects';
  const entity = metricEntityById(context, key);
  return displayValue(entityDisplayName(entity) || `Object ${key}`, 'display_name');
}

function metricKeyInfo(key, context = {}) {
  if (!isPlainObject(key)) {
    const label = displayValue(key) || 'Unknown facet';
    return { id: label, label };
  }

  const deviceId = key.device_oid ?? key.object_id ?? key.id ?? '';
  const entity = metricEntityById(context, deviceId);
  const entityName = entityDisplayName(entity);
  const host = key.host || key.hostname || key.name || key.str || '';
  const addr = key.addr || key.ipaddr4 || key.ipaddr6 || key.ip || entity?.ipaddr4 || entity?.ipaddr6 || '';
  const fallback = key.value !== undefined ? displayValue(key.value) : keyLabel(key);
  const label = displayValue(entityName || host || addr || fallback || 'Unknown facet', 'display_name');
  const id = [
    deviceId ? `device:${deviceId}` : '',
    addr ? `addr:${addr}` : '',
    host ? `host:${host}` : '',
    fallback ? `value:${fallback}` : '',
  ].filter(Boolean).join('|') || label;
  return {
    id,
    label,
    host: displayValue(host, 'host'),
    ip: displayValue(addr, 'ipaddr4'),
    device_id: deviceId ? String(deviceId) : '',
    type: displayValue(key.key_type || key.type || '', 'type'),
  };
}

function createMetricTraversal(notices) {
  return { nodes: 0, nodeLimited: false, notices };
}

function canVisitMetricValue(value, state, depth) {
  if ((Array.isArray(value) || isPlainObject(value)) && depth > EVIDENCE_SUMMARY_LIMITS.flattenDepth) {
    state.notices.depthLimited += 1;
    return false;
  }
  if (state.nodes >= MAX_METRIC_VALUE_NODES) {
    if (!state.nodeLimited) {
      state.nodeLimited = true;
      state.notices.nodeLimited += 1;
    }
    return false;
  }
  if (state.notices.processedNodes >= MAX_METRIC_TRANSFORM_NODES) {
    state.notices.summaryNodeLimited = true;
    return false;
  }
  state.nodes += 1;
  state.notices.processedNodes += 1;
  return true;
}

function collectKeyValues(value, out = [], state, depth = 0) {
  if (!canVisitMetricValue(value, state, depth)) return out;
  if (Array.isArray(value)) {
    for (const item of value) collectKeyValues(item, out, state, depth + 1);
  } else if (isPlainObject(value)) {
    if (Object.prototype.hasOwnProperty.call(value, 'key') && Object.prototype.hasOwnProperty.call(value, 'value')) {
      const n = Number(value.value);
      if (Number.isFinite(n)) out.push({ key: keyLabel(value.key), value: n });
    }
    for (const item of Object.values(value)) collectKeyValues(item, out, state, depth + 1);
  }
  return out;
}

function collectMetricFacets(value, context = {}, out = [], state, depth = 0) {
  if (!canVisitMetricValue(value, state, depth)) return out;
  if (Array.isArray(value)) {
    for (const item of value) collectMetricFacets(item, context, out, state, depth + 1);
  } else if (isPlainObject(value)) {
    if (Object.prototype.hasOwnProperty.call(value, 'key') && Object.prototype.hasOwnProperty.call(value, 'value')) {
      const n = Number(value.value);
      if (Number.isFinite(n)) {
        if (out.length < MAX_METRIC_FACETS_PER_POINT && state.notices.transformedFacets < MAX_METRIC_TRANSFORM_FACETS) {
          out.push({ ...metricKeyInfo(value.key, context), value: n });
          state.notices.transformedFacets += 1;
        } else {
          state.notices.facetsLimited += 1;
        }
      }
    }
    for (const item of Object.values(value)) collectMetricFacets(item, context, out, state, depth + 1);
  }
  return out;
}

function recursiveNumberTotal(value, state, depth = 0) {
  if (!canVisitMetricValue(value, state, depth)) return 0;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + recursiveNumberTotal(item, state, depth + 1), 0);
  if (isPlainObject(value)) {
    if (Object.prototype.hasOwnProperty.call(value, 'value')) {
      const n = Number(value.value);
      return Number.isFinite(n) ? n : 0;
    }
    return Object.values(value).reduce((sum, item) => sum + recursiveNumberTotal(item, state, depth + 1), 0);
  }
  return 0;
}

function metricTotal(values, notices) {
  const keyed = collectKeyValues(values, [], createMetricTraversal(notices));
  if (Array.isArray(values) && typeof values[0] === 'number' && keyed.length) {
    return values[0];
  }
  if (keyed.length) return keyed.reduce((sum, item) => sum + item.value, 0);
  return recursiveNumberTotal(values, createMetricTraversal(notices));
}

function parseDurationMs(value) {
  const n = Number(value);
  if (Number.isFinite(n) && n > 0) return n;
  const match = String(value ?? '').trim().match(/^(\d+(?:\.\d+)?)\s*(ms|msec|millisecond|milliseconds|s|sec|second|seconds|m|min|minute|minutes|h|hr|hour|hours|d|day|days|w|week|weeks)$/i);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const unit = match[2].toLowerCase();
  if (unit.startsWith('ms') || unit.startsWith('millisecond')) return amount;
  if (unit === 's' || unit.startsWith('sec')) return amount * 1000;
  if (unit === 'm' || unit.startsWith('min')) return amount * MINUTE_MS;
  if (unit === 'h' || unit === 'hr' || unit.startsWith('hour')) return amount * HOUR_MS;
  if (unit === 'd' || unit.startsWith('day')) return amount * DAY_MS;
  if (unit === 'w' || unit.startsWith('week')) return amount * 7 * DAY_MS;
  return null;
}

function metricResponseSpanMs(response) {
  const from = epochMs(response?.from);
  const until = epochMs(response?.until);
  return from !== null && until !== null && until > from ? until - from : null;
}

function metricSampleIndexes(total) {
  const limit = EVIDENCE_SUMMARY_LIMITS.metricTransformPoints;
  if (total <= limit) return null;
  const indexes = new Set();
  for (let index = 0; index < limit; index += 1) {
    indexes.add(Math.round((index * (total - 1)) / (limit - 1)));
  }
  return indexes;
}

function extractMetricPoints(value, context = {}, notices = {}) {
  Object.assign(notices, {
    totalPoints: 0,
    transformedPoints: 0,
    depthLimited: 0,
    nodeLimited: 0,
    facetsLimited: 0,
    transformedFacets: 0,
    processedNodes: 0,
    summaryNodeLimited: false,
  });
  const points = [];
  const sensors = Array.isArray(value?.sensors) ? value.sensors : [];
  notices.totalPoints = sensors.reduce((total, sensor) => {
    const response = sensor.response || sensor;
    return total + (Array.isArray(response?.stats) ? response.stats.length : 0);
  }, 0);
  const sampleIndexes = metricSampleIndexes(notices.totalPoints);
  let globalIndex = 0;
  for (const sensor of sensors) {
    const response = sensor.response || sensor;
    const responseSpanMs = metricResponseSpanMs(response);
    for (const stat of Array.isArray(response?.stats) ? response.stats : []) {
      const include = !sampleIndexes || sampleIndexes.has(globalIndex);
      globalIndex += 1;
      if (!include) continue;
      const duration = parseDurationMs(stat.duration ?? response.duration ?? response.cycle);
      const oid = stat.oid ?? '';
      points.push({
        sensor: sensor.sensor_id ?? sensor.id ?? '',
        oid,
        object: metricObjectLabel(oid, context),
        time: stat.time ?? '',
        duration,
        total: metricTotal(stat.values, notices),
        facets: collectMetricFacets(stat.values, context, [], createMetricTraversal(notices)),
        responseSpanMs,
        windowTotal: Number.isFinite(duration) && Number.isFinite(responseSpanMs) && duration >= responseSpanMs * 0.75,
      });
    }
  }
  notices.transformedPoints = points.length;
  return points;
}

function aggregateBy(points, key) {
  const totals = new Map();
  for (const point of points) {
    const label = String(point[key] || 'unknown');
    totals.set(label, (totals.get(label) || 0) + Number(point.total || 0));
  }
  return [...totals.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
}

function aggregateMetricObjects(points) {
  const totals = new Map();
  for (const point of points) {
    const key = String((point.oid ?? point.object) || 'unknown');
    const current = totals.get(key) || {
      object: point.object || metricObjectLabel(point.oid),
      object_id: point.oid === undefined || point.oid === null ? '' : String(point.oid),
      total: 0,
      sensors: new Set(),
    };
    current.total += Number(point.total || 0);
    if (nonEmpty(point.sensor)) current.sensors.add(String(point.sensor));
    totals.set(key, current);
  }
  return [...totals.values()]
    .map((row) => ({
      object: row.object,
      total: row.total,
      sensors: row.sensors.size,
      object_id: row.object_id,
    }))
    .sort((a, b) => b.total - a.total || a.object.localeCompare(b.object));
}

function aggregateMetricFacets(points) {
  const totals = new Map();
  for (const point of points) {
    for (const facet of point.facets || []) {
      const current = totals.get(facet.id) || {
        entity: facet.label,
        total: 0,
        samples: 0,
        ip: facet.ip || '',
        host: facet.host || '',
        device_id: facet.device_id || '',
        type: facet.type || '',
      };
      current.total += Number(facet.value || 0);
      current.samples += 1;
      current.ip ||= facet.ip || '';
      current.host ||= facet.host || '';
      current.device_id ||= facet.device_id || '';
      current.type ||= facet.type || '';
      totals.set(facet.id, current);
    }
  }
  const rows = [...totals.values()]
    .sort((a, b) => b.total - a.total || a.entity.localeCompare(b.entity));
  const labelCounts = new Map();
  for (const row of rows) labelCounts.set(row.entity, (labelCounts.get(row.entity) || 0) + 1);
  return rows.map((row) => ({
    ...row,
    chart_label: labelCounts.get(row.entity) > 1 && row.ip ? `${row.entity} ${row.ip}` : row.entity,
  }));
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function inferBucketMs(normalized, durationHints = []) {
  const durations = durationHints
    .map(parseDurationMs)
    .filter((value) => Number.isFinite(value) && value > 0);
  if (durations.length) return median(durations);

  const times = [...new Set(normalized.map((point) => point.ms))]
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
  const deltas = times
    .slice(1)
    .map((time, index) => time - times[index])
    .filter((value) => value > 0);
  return median(deltas);
}

function maxAxisTickCount(span, innerWidth) {
  const minSpacing = span <= 6 * HOUR_MS
    ? 56
    : span <= 7 * DAY_MS
      ? 92
      : span <= 370 * DAY_MS
        ? 52
        : 76;
  return Math.max(3, Math.min(16, Math.floor(innerWidth / minSpacing) + 1));
}

function timeTicks(min, max, { innerWidth = 810, bucketMs = null } = {}) {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return [];
  const span = max - min;
  const maxTicks = maxAxisTickCount(span, innerWidth);
  const steps = [
    MINUTE_MS, 2 * MINUTE_MS, 5 * MINUTE_MS, 10 * MINUTE_MS, 15 * MINUTE_MS, 30 * MINUTE_MS,
    HOUR_MS, 2 * HOUR_MS, 3 * HOUR_MS, 4 * HOUR_MS, 6 * HOUR_MS, 8 * HOUR_MS, 12 * HOUR_MS,
    DAY_MS, 2 * DAY_MS, 3 * DAY_MS, 4 * DAY_MS, 7 * DAY_MS, 14 * DAY_MS,
    30 * DAY_MS, 90 * DAY_MS, 180 * DAY_MS, 365 * DAY_MS,
  ];
  const target = span / Math.max(1, maxTicks - 1);
  const minimumStep = Math.max(target, Number.isFinite(bucketMs) && bucketMs > 0 ? bucketMs : 0);
  const step = steps.find((candidate) => candidate >= minimumStep) || steps.at(-1);
  const ticks = [min];
  let next = Math.ceil(min / step) * step;
  if (next <= min) next += step;
  while (next < max && ticks.length < maxTicks - 1) {
    ticks.push(next);
    next += step;
  }
  if (ticks.at(-1) !== max) ticks.push(max);
  return ticks;
}

function evenlyDownsample(values, limit) {
  if (values.length <= limit) return values;
  const sampled = [];
  for (let index = 0; index < limit; index += 1) {
    sampled.push(values[Math.round((index * (values.length - 1)) / (limit - 1))]);
  }
  return sampled;
}

function renderLineChart(series, { bucketMs = null } = {}) {
  const width = 900;
  const height = 220;
  const pad = { top: 18, right: 28, bottom: 42, left: 62 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const normalizedAll = series
    .map((point) => ({ ...point, ms: epochMs(point.label) }))
    .filter((point) => point.ms !== null)
    .sort((a, b) => a.ms - b.ms);
  if (!normalizedAll.length) return '<div class="summary-empty">No plottable metric times were present.</div>';
  const normalized = evenlyDownsample(normalizedAll, EVIDENCE_SUMMARY_LIMITS.metricChartPoints);
  const minTime = Math.min(...normalized.map((point) => point.ms));
  const maxTime = Math.max(...normalized.map((point) => point.ms));
  const span = Math.max(1, maxTime - minTime);
  const inferredBucketMs = bucketMs ?? inferBucketMs(normalized);
  const max = normalized.reduce((best, point) => Math.max(best, Number(point.value) || 0), 1);
  const x = (ms) => pad.left + ((ms - minTime) / span) * innerW;
  const y = (value) => pad.top + innerH - (value / max) * innerH;
  const points = normalized.map((point) => `${x(point.ms).toFixed(1)},${y(point.value).toFixed(1)}`).join(' ');
  const yTicks = [0, 0.5, 1].map((ratio) => {
    const value = max * (1 - ratio);
    const yy = pad.top + innerH * ratio;
    return `<g><line x1="${pad.left}" x2="${width - pad.right}" y1="${yy}" y2="${yy}" class="summary-grid"/><text x="8" y="${yy + 4}">${html(compactNumber(value))}</text></g>`;
  }).join('');
  const xTicks = timeTicks(minTime, maxTime, { innerWidth: innerW, bucketMs: inferredBucketMs }).map((tick, index, ticks) => {
    const xx = x(tick);
    const anchor = index === 0 ? 'start' : index === ticks.length - 1 ? 'end' : 'middle';
    return `<g><line x1="${xx}" x2="${xx}" y1="${pad.top}" y2="${height - pad.bottom}" class="summary-grid summary-grid-x"/><text x="${xx}" y="${height - 13}" text-anchor="${anchor}">${html(formatAxisTime(tick, span))}</text></g>`;
  }).join('');
  const notice = normalized.length < normalizedAll.length
    ? renderLimitNotice([`Chart downsampled ${formatNumber(normalizedAll.length)} time points to ${formatNumber(normalized.length)} rendered points.`])
    : '';
  return `${notice}
    <svg class="summary-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Metric totals over time">
      ${yTicks}
      ${xTicks}
      <polyline points="${points}" fill="none" class="summary-line"/>
      ${normalized.map((point) => `<circle cx="${x(point.ms).toFixed(1)}" cy="${y(point.value).toFixed(1)}" r="3.2"><title>${html(`${formatTime(point.ms)}: ${formatNumber(point.value)}`)}</title></circle>`).join('')}
    </svg>`;
}

function renderBarChart(series) {
  const width = 900;
  const visible = series.slice(0, 14);
  const rowH = 16;
  const gap = 7;
  const pad = { top: 18, right: 96, bottom: 18, left: 172 };
  const height = pad.top + pad.bottom + visible.length * rowH + Math.max(0, visible.length - 1) * gap;
  const innerW = width - pad.left - pad.right;
  const max = Math.max(1, ...visible.map((point) => point.value));
  const bars = visible.map((point, index) => {
    const y = pad.top + index * (rowH + gap);
    const barW = Math.max(point.value > 0 ? 2 : 0, (point.value / max) * innerW);
    const barEnd = pad.left + barW;
    const valueX = Math.min(barEnd + 8, width - pad.right + 8);
    const midY = y + rowH / 2;
    return `
      <g>
        <rect x="${pad.left}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${rowH}" rx="5"/>
        <text x="${pad.left - 10}" y="${midY.toFixed(1)}" class="summary-bar-label">${html(shorten(point.label, 24))}</text>
        <text x="${valueX.toFixed(1)}" y="${midY.toFixed(1)}" class="summary-bar-value">${html(compactNumber(point.value))}</text>
        <title>${html(`${point.label}: ${formatNumber(point.value)}`)}</title>
      </g>`;
  }).join('');
  return `<svg class="summary-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Metric totals by object">${bars}</svg>`;
}

function renderMetricChart(points) {
  const times = new Set(points.map((point) => point.time).filter(nonEmpty));
  const wholeWindowPoints = points.filter((point) => point.windowTotal).length;
  const mostlyWholeWindow = points.length > 0 && wholeWindowPoints >= points.length * 0.75;
  if (times.size > 1 && !mostlyWholeWindow) {
    return renderLineChart([...aggregateBy(points, 'time')].sort((a, b) => Number(a.label) - Number(b.label)), {
      bucketMs: inferBucketMs(
        points.map((point) => ({ ms: epochMs(point.time) })).filter((point) => point.ms !== null),
        points.map((point) => point.duration),
      ),
    });
  }
  const facets = aggregateMetricFacets(points);
  if (facets.length) {
    return renderBarChart(facets.map((row) => ({ label: row.chart_label || row.entity, value: row.total })));
  }
  return renderBarChart(aggregateMetricObjects(points).map((row) => ({ label: row.object, value: row.total })));
}

function metricPresentation(points) {
  const times = new Set(points.map((point) => point.time).filter(nonEmpty));
  const wholeWindowPoints = points.filter((point) => point.windowTotal).length;
  const mostlyWholeWindow = points.length > 0 && wholeWindowPoints >= points.length * 0.75;
  const timeSeries = times.size > 1 && !mostlyWholeWindow;
  const facets = aggregateMetricFacets(points);
  const objects = aggregateMetricObjects(points);
  return {
    timeSeries,
    facets,
    objects,
    dimension: facets.length ? 'Facets' : 'Objects',
  };
}

function renderMetricBreakdownTable(presentation) {
  if (presentation.timeSeries) return '';
  if (presentation.facets.length) {
    const rows = presentation.facets.slice(0, 20);
    return renderTable(['entity', 'total', 'samples', 'ip', 'host', 'device_id', 'type'], rows, {
      empty: 'No metric facets were present.',
    });
  }
  const rows = presentation.objects.slice(0, 20);
  return renderTable(['object', 'total', 'sensors', 'object_id'], rows, {
    empty: 'No metric objects were present.',
  });
}

function renderGenericJsonTable(value, empty = 'No tabular JSON data was present.') {
  const table = genericRowsFromValue(value, { bounded: true });
  const columns = allColumns(table.rows);
  return renderTable(columns, table.rows, { ...table, empty });
}

function renderMetricsSummary(sourcePath, value, context = {}) {
  const catalogRows = metricsFromCatalog(value);
  if (catalogRows) {
    const table = boundedFlattenRows(Array.isArray(value?.metrics) ? value.metrics : []);
    return renderShell({
      title: sourceTitle(sourcePath),
      kind: 'Metrics',
      body: renderTable(allColumns(table.rows, ['display', 'metric_category', 'stat_name', 'object_type', 'type', 'dimension', 'units']), table.rows, {
        ...table,
        empty: 'No metric catalog entries were present.',
      }),
    });
  }

  const metricNotices = {};
  const points = extractMetricPoints(value, context, metricNotices);
  if (!points.length) {
    return renderShell({
      title: sourceTitle(sourcePath),
      kind: 'Metrics',
      body: renderGenericJsonTable(value),
    });
  }

  const totals = points.reduce((sum, point) => sum + Number(point.total || 0), 0);
  const peak = points.reduce((best, point) => Number(point.total || 0) > Number(best.total || 0) ? point : best, points[0] || {});
  const presentation = metricPresentation(points);
  const peakLabel = presentation.timeSeries
    ? compactNumber(peak.total || 0)
    : compactNumber((presentation.facets[0] || presentation.objects[0])?.total || peak.total || 0);
  return renderShell({
    title: sourceTitle(sourcePath),
    kind: 'Metrics',
    body: `
      ${renderLimitNotice([
        metricNotices.transformedPoints < metricNotices.totalPoints
          ? `Metric processing sampled ${formatNumber(metricNotices.transformedPoints)} of ${formatNumber(metricNotices.totalPoints)} points; ${formatNumber(metricNotices.totalPoints - metricNotices.transformedPoints)} points were omitted by the transformation limit.`
          : '',
        metricNotices.depthLimited
          ? `${formatNumber(metricNotices.depthLimited)} nested metric values were omitted at the depth-${formatNumber(EVIDENCE_SUMMARY_LIMITS.flattenDepth)} traversal limit.`
          : '',
        metricNotices.nodeLimited
          ? `${formatNumber(metricNotices.nodeLimited)} metric values reached the ${formatNumber(MAX_METRIC_VALUE_NODES)}-node traversal limit.`
          : '',
        metricNotices.summaryNodeLimited
          ? `Metric value traversal stopped after the ${formatNumber(MAX_METRIC_TRANSFORM_NODES)}-node summary limit.`
          : '',
        metricNotices.facetsLimited
          ? `${formatNumber(metricNotices.facetsLimited)} metric facets were omitted after the ${formatNumber(MAX_METRIC_FACETS_PER_POINT)}-facet per-point or ${formatNumber(MAX_METRIC_TRANSFORM_FACETS)}-facet summary limit.`
          : '',
      ])}
      ${renderHeroCards([
        { label: 'Sensors', value: formatNumber(new Set(points.map((point) => point.sensor).filter(nonEmpty)).size) },
        { label: presentation.timeSeries ? 'Buckets' : presentation.dimension, value: formatNumber(presentation.timeSeries ? points.length : (presentation.facets.length || presentation.objects.length)) },
        { label: 'Total', value: compactNumber(totals) },
        { label: presentation.timeSeries ? 'Peak' : 'Top', value: peakLabel },
      ])}
      <div class="summary-chart-wrap">${renderMetricChart(points)}</div>
      ${renderMetricBreakdownTable(presentation)}`,
  });
}

function detectionsFromValue(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.detections)) return value.detections;
  if (Array.isArray(value?.activity)) return value.activity;
  if (isPlainObject(value) && (value.title || value.type || value.id || value.description)) return [value];
  return [];
}

function riskScore(detection) {
  return riskInfo(detection)?.label || '';
}

function riskInfo(detection) {
  const sources = [
    detection.risk_score,
    detection.riskScore,
    detection.risk,
    detection.score,
    detection.severity,
    detection.properties?.risk_score,
    detection.properties?.riskScore,
  ];
  const found = sources.find((value) => value !== undefined && value !== null && value !== '');
  if (found === undefined) return null;
  const score = Number(found);
  if (!Number.isFinite(score)) return { label: displayValue(found), level: 'none' };
  const level = score < 35 ? 'low' : score < 80 ? 'medium' : 'high';
  return { label: displayValue(found), level };
}

function detectionTitle(detection) {
  return displayValue(detection.title || detection.type || `Detection ${detection.id || ''}`, 'title');
}

function detectionDate(detection) {
  return detection.start_time ?? detection.update_time ?? detection.mod_time ?? detection.end_time ?? detection.timestamp ?? '';
}

function detectionRows(detections, { bounded = false } = {}) {
  const source = bounded ? detections.slice(0, EVIDENCE_SUMMARY_LIMITS.rows) : detections;
  return source.map((detection) => ({
    id: detection.id ?? '',
    title: detection.title || '(untitled)',
    risk: riskScore(detection),
    status: detection.status || '',
    resolution: detection.resolution || '',
    type: detection.type || '',
    categories: detectionCategoryText(detection.categories),
    site: detection.site || detection.site_name || '',
    appliance: detection.appliance || detection.appliance_name || '',
    start_time: detection.start_time ?? '',
    end_time: detection.end_time ?? '',
  }));
}

function titleCaseText(value) {
  return String(value ?? '')
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function categoryFamily(key) {
  if (key === 'sec' || key.startsWith('sec.')) return 'sec';
  if (key === 'perf' || key.startsWith('perf.')) return 'perf';
  return 'other';
}

function detectionCategoryItems(values) {
  const list = Array.isArray(values)
    ? values
    : String(values || '').split(',').map((item) => item.trim()).filter(Boolean);
  if (!list.length) return [];
  const items = [];
  const seen = new Set();
  for (const raw of list.slice(0, MAX_STRUCTURED_ITEMS)) {
    const key = String(raw ?? '').trim().toLowerCase();
    if (!key || DETECTION_PARENT_CATEGORIES.has(key) || seen.has(key)) continue;
    seen.add(key);
    const family = categoryFamily(key);
    const fallback = key.includes('.') ? key.split('.').slice(1).join(' ') : key;
    items.push({
      key,
      family,
      label: DETECTION_CATEGORY_LABELS.get(key) || titleCaseText(fallback),
    });
  }
  return items;
}

function detectionCategoryText(values) {
  return detectionCategoryItems(values).map((item) => item.label).join(', ');
}

function renderDetectionCategoryChips(values) {
  const sourceCount = Array.isArray(values)
    ? values.length
    : String(values || '').split(',').map((item) => item.trim()).filter(Boolean).length;
  const items = detectionCategoryItems(values);
  if (!items.length) return '';
  const notice = sourceCount > MAX_STRUCTURED_ITEMS
    ? renderLimitNotice([`Showing the first ${formatNumber(MAX_STRUCTURED_ITEMS)} of ${formatNumber(sourceCount)} detection category values; ${formatNumber(sourceCount - MAX_STRUCTURED_ITEMS)} were omitted.`])
    : '';
  return `${notice}<div class="summary-chips summary-category-chips">${items.map((item) => (
    `<span class="summary-category-chip category-${html(item.family)}" title="${html(item.key)}">${html(item.label)}</span>`
  )).join('')}</div>`;
}

function mitreEntryLabel(entry) {
  if (!isPlainObject(entry)) return displayValue(entry);
  return [
    entry.name ? displayValue(entry.name, 'name') : '',
    entry.id ? displayValue(entry.id, 'id') : '',
  ].filter(Boolean).join(' ');
}

function renderMitreEntry(entry) {
  const label = mitreEntryLabel(entry);
  if (!label) return '';
  const url = isPlainObject(entry) ? safeMarkdownUrl(entry.url) : '';
  return url
    ? `<a href="${html(url)}" target="_blank" rel="noopener noreferrer">${html(label)}</a>`
    : `<span>${html(label)}</span>`;
}

function renderMitreGroup(label, entries) {
  const items = arrayValue(entries).map(renderMitreEntry).filter(Boolean);
  if (!items.length) return '';
  return `
    <div class="summary-mitre-group">
      <dt>${html(label)}</dt>
      <dd>${items.join('')}</dd>
    </div>`;
}

function renderMitreSection(detection) {
  const body = [
    renderMitreGroup('Tactics', detection.mitre_tactics || detection.mitreTactics),
    renderMitreGroup('Techniques', detection.mitre_techniques || detection.mitreTechniques),
  ].filter(Boolean).join('');
  if (!body) return '';
  return `
    <section class="summary-mitre">
      <h4>MITRE ATT&amp;CK</h4>
      <dl>${body}</dl>
    </section>`;
}

function arrayValue(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function participantRole(participant) {
  return String(participant?.role || participant?.endpoint || participant?.object_type || participant?.type || '').toLowerCase();
}

function collectParticipants(detection, side) {
  const sideKeys = side === 'offender'
    ? ['offenders', 'offender', 'clients', 'client', 'sources', 'source']
    : ['victims', 'victim', 'servers', 'server', 'targets', 'target'];
  const roleWords = side === 'offender' ? ['offender', 'client', 'source'] : ['victim', 'server', 'target'];
  const participants = [];
  let total = 0;
  const add = (participant) => {
    total += 1;
    if (participants.length < MAX_STRUCTURED_ITEMS) participants.push(participant);
  };
  for (const key of sideKeys) for (const participant of arrayValue(detection[key])) add(participant);
  for (const key of sideKeys) for (const participant of arrayValue(detection.properties?.[key])) add(participant);
  for (const participant of arrayValue(detection.participants)) {
    const role = participantRole(participant);
    if (roleWords.some((word) => role.includes(word))) add(participant);
  }
  const seen = new Set();
  const items = participants.filter((participant) => {
    const key = isPlainObject(participant)
      ? [participant.object_id, participant.id, participant.object_value, participant.hostname, participant.role].join('|')
      : `${typeof participant}:${String(participant)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { items, total };
}

function isDeviceParticipant(participant) {
  return String(participant?.object_type || participant?.type || '').toLowerCase() === 'device';
}

function participantDeviceId(participant) {
  if (!isPlainObject(participant) || !isDeviceParticipant(participant)) return '';
  const id = participant.object_id ?? participant.id ?? '';
  return id === undefined || id === null || id === '' ? '' : String(id);
}

function participantEntity(participant, context = {}) {
  const id = participantDeviceId(participant);
  if (!id) return null;
  const entity = context.entityById?.get?.(id) || null;
  if (!entity && context.pendingDeviceIds) context.pendingDeviceIds.add(id);
  return entity;
}

function entityDisplayName(entity) {
  if (!isPlainObject(entity)) return '';
  return entity.display_name
    || entity.custom_name
    || entity.default_name
    || entity.hostname
    || entity.name
    || '';
}

function participantPrimary(participant, context = {}) {
  if (!isPlainObject(participant)) return displayValue(participant);
  const entity = participantEntity(participant, context);
  const deviceId = participantDeviceId(participant);
  return displayValue(
    entityDisplayName(entity)
      || participant.display_name
      || participant.hostname
      || participant.object_name
      || participant.custom_name
      || participant.default_name
      || participant.name
      || deviceId
      || participantIpValue(participant)
      || 'Endpoint'
  );
}

function participantIpValue(participant, context = {}) {
  if (!isPlainObject(participant)) return '';
  const entity = participantEntity(participant, context);
  return participant.ipaddr4
    || participant.ipaddr6
    || participant.ip
    || participant.addr
    || participant.object_value
    || entity?.ipaddr4
    || entity?.ipaddr6
    || entity?.ip
    || '';
}

function participantDetails(participant, context = {}) {
  if (!isPlainObject(participant)) return [];
  const rows = [];
  const primary = participantPrimary(participant, context);
  const ip = displayValue(participantIpValue(participant, context));
  if (ip && ip !== primary) rows.push(['IP Address', ip]);
  if (participant.hostname && displayValue(participant.hostname) !== primary) rows.push(['Hostname', displayValue(participant.hostname)]);
  if (participant.object_type) rows.push(['Type', displayValue(participant.object_type, 'object_type')]);
  return rows;
}

function participantIcon(side) {
  if (side === 'victim') {
    return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></svg>';
  }
  return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 3c-4.1 0-7 2.8-7 6.8 0 2.2 1 3.8 2.6 5.1V20h8.8v-5.1C18 13.6 19 12 19 9.8 19 5.8 16.1 3 12 3Z"/><circle cx="9" cy="10" r="1.3"/><circle cx="15" cy="10" r="1.3"/><path d="M10 15h4M9 20v-3M12 20v-3M15 20v-3"/></svg>';
}

function renderParticipantCard(participant, side, context) {
  const details = participantDetails(participant, context);
  return `
    <div class="summary-party-card">
      <div class="summary-party-title">
        <span class="summary-party-icon summary-party-icon-${html(side)}">${participantIcon(side)}</span>
        <strong>${html(participantPrimary(participant, context))}</strong>
      </div>
      ${details.length ? `<dl>${details.map(([key, value]) => `<div><dt>${html(key)}</dt><dd>${html(value)}</dd></div>`).join('')}</dl>` : ''}
    </div>`;
}

function renderParticipantSide(label, side, participants, context) {
  return `
    <section class="summary-party-side">
      <h4>${html(label)}</h4>
      ${participants.length
        ? participants.map((participant) => renderParticipantCard(participant, side, context)).join('')
        : '<div class="summary-empty compact">No endpoints listed.</div>'}
    </section>`;
}

function renderDetectionDetail(detection, context = {}) {
  const offenders = collectParticipants(detection, 'offender');
  const victims = collectParticipants(detection, 'victim');
  const date = formatBannerTime(detectionDate(detection));
  const site = detection.site || detection.site_name || detection.appliance || detection.appliance_name || '';
  const status = detection.status || (detection.end_time ? 'Ended' : 'Ongoing');
  const risk = riskInfo(detection);
  return `
    <article class="summary-detection-card">
      <div class="summary-detection-head${risk ? '' : ' no-risk'}">
        ${risk ? `<div class="summary-risk-badge risk-${html(risk.level)}">
          <strong>${html(risk.label)}</strong>
          <span>Risk</span>
        </div>` : ''}
        <div class="summary-detection-title">
          <h3>${html(detectionTitle(detection))}</h3>
          ${renderDetectionCategoryChips(detection.categories)}
          ${site ? `<p>${html(`Site: ${displayValue(site)}`)}</p>` : ''}
        </div>
        <div class="summary-detection-time">
          ${date ? `<strong>${html(date)}</strong>` : ''}
          <span>${html(displayValue(status, 'status'))}</span>
        </div>
      </div>
      ${detection.description ? `<div class="summary-description">${renderBoundedMarkdownDescription(detection.description)}</div>` : ''}
      ${renderMitreSection(detection)}
      ${renderLimitNotice([
        offenders.items.length < offenders.total
          ? `Showing ${formatNumber(offenders.items.length)} of ${formatNumber(offenders.total)} offender entries; ${formatNumber(offenders.total - offenders.items.length)} were omitted.`
          : '',
        victims.items.length < victims.total
          ? `Showing ${formatNumber(victims.items.length)} of ${formatNumber(victims.total)} victim entries; ${formatNumber(victims.total - victims.items.length)} were omitted.`
          : '',
      ])}
      <div class="summary-parties">
        ${renderParticipantSide('Offender', 'offender', offenders.items, context)}
        ${renderParticipantSide('Victim', 'victim', victims.items, context)}
      </div>
    </article>`;
}

function renderDetectionsSummary(sourcePath, value, context = {}) {
  const detections = detectionsFromValue(value);
  if (detections.length === 1) {
    const detection = detections[0];
    const date = formatBannerTime(detectionDate(detection));
    return renderShell({
      title: [riskScore(detection), detectionTitle(detection), date].filter(Boolean).join(' - '),
      kind: 'Detection',
      body: renderDetectionDetail(detection, context),
    });
  }
  const rows = detectionRows(detections, { bounded: true });
  return renderShell({
    title: sourceTitle(sourcePath),
    kind: 'Detections',
    body: renderTable(allColumns(rows, ['id', 'title', 'risk', 'status', 'resolution', 'type', 'categories', 'site', 'appliance', 'start_time', 'end_time']), rows, {
      totalRows: detections.length,
      empty: 'No detections were present in this file.',
    }),
  });
}

function entitiesFromValue(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.devices)) return value.devices;
  if (Array.isArray(value?.entities)) return value.entities;
  if (isPlainObject(value) && (value.id || value.display_name || value.ipaddr4 || value.ipaddr6 || value.extrahop_id)) return [value];
  return [];
}

function entityRows(entities, { bounded = false } = {}) {
  if (bounded) return boundedFlattenRows(entities);
  return entities.map((entity) => flattenObject(entity));
}

function entityTitle(entity) {
  const name = entity.display_name || entity.custom_name || entity.default_name || entity.hostname || entity.id || 'Entity';
  const ip = entity.ipaddr4 || entity.ipaddr6 || '';
  return [displayValue(name, 'display_name'), displayValue(ip)].filter(Boolean).join(' ');
}

function renderEntitiesSummary(sourcePath, value) {
  const entities = entitiesFromValue(value);
  if (entities.length === 1) {
    return renderShell({
      title: entityTitle(entities[0]),
      kind: 'Entity',
      body: renderPropertyTable(entities[0]),
    });
  }
  const table = entityRows(entities, { bounded: true });
  const { rows } = table;
  return renderShell({
    title: sourceTitle(sourcePath),
    kind: 'Entities',
    body: renderTable(allColumns(rows, ['display_name', 'custom_name', 'default_name', 'ipaddr4', 'ipaddr6', 'role', 'vendor', 'model', 'critical', 'on_watchlist', 'last_seen_time', 'id']), rows, {
      ...table,
      empty: 'No entities were present in this file.',
    }),
  });
}

function genericRowItems(value) {
  if (Array.isArray(value)) return value;
  if (!isPlainObject(value)) return [value];
  for (const key of CSV_ARRAY_KEYS) {
    if (Array.isArray(value[key])) {
      if (value[key].length) return value[key].map((item) => key === 'records' ? recordPayload(item) : item);
    }
  }
  const arrayEntry = Object.entries(value).find(([, item]) => Array.isArray(item) && item.length);
  if (arrayEntry) return arrayEntry[1];
  return [value];
}

function genericRowsFromValue(value, { bounded = false } = {}) {
  const items = genericRowItems(value);
  if (bounded) return boundedFlattenRows(items);
  return items.map((item) => isPlainObject(item) ? flattenObject(item) : { value: item });
}

function summaryBody(sourcePath, kind, value, context = {}) {
  if (kind === 'records') return renderRecordsSummary(sourcePath, value);
  if (kind === 'metrics') return renderMetricsSummary(sourcePath, value, context);
  if (kind === 'detections') return renderDetectionsSummary(sourcePath, value, context);
  if (kind === 'entities') return renderEntitiesSummary(sourcePath, value);
  if (kind === 'research-search') return renderResearchSearchSummary(sourcePath, value);
  if (kind === 'research-canonical') return renderCanonicalResearchSummary(sourcePath, value);
  if (kind === 'reversinglabs') return renderReversingLabsSummary(sourcePath, value);
  return renderShell({ title: sourceTitle(sourcePath), kind: 'Evidence', body: renderGenericJsonTable(value) });
}

export function resolveEvidenceJsonFile(session, relPath, { requireSummarizable = false } = {}) {
  const sourcePath = normalizeRelPath(relPath);
  if (requireSummarizable && !isWorkspaceJsonArtifactCandidate(sourcePath)) {
    throw requestError('Summaries are available for JSON under evidence/records, evidence/metrics, evidence/detections, evidence/entities, normalized research results, or reversinglabs/.');
  }
  if (!requireSummarizable && !canExportJsonAsCsvPath(sourcePath)) {
    throw requestError('CSV export is available for JSON files.');
  }

  const abs = session.resolveFile(sourcePath);
  if (!fs.existsSync(abs) || !fs.lstatSync(abs).isFile()) {
    throw requestError('File not found.', 404);
  }

  const stat = fs.statSync(abs);
  if (stat.size > EVIDENCE_SUMMARY_LIMITS.sourceBytes) {
    throw requestError(`JSON file is too large to process (${formatNumber(stat.size)} bytes).`, 413);
  }

  return { sourcePath, abs, size: stat.size };
}

function readJsonFile(session, relPath, { requireSummarizable = false } = {}) {
  const { sourcePath, abs } = resolveEvidenceJsonFile(session, relPath, { requireSummarizable });

  try {
    const result = {
      sourcePath,
      value: JSON.parse(fs.readFileSync(abs, 'utf8')),
    };
    if (requireSummarizable && !canSummarizeEvidenceValue(sourcePath, result.value)) {
      throw requestError('Summaries are available for supported evidence JSON, normalized research results, and ReversingLabs responses.');
    }
    return result;
  } catch (err) {
    if (err?.statusCode) throw err;
    throw requestError('Could not parse this file as JSON.');
  }
}

function pendingBackfills(context = {}) {
  return [...(context.pendingDeviceIds || [])].map((id) => ({
    type: 'device',
    object_id: id,
  }));
}

export function summarizeEvidenceValue(relPath, value, context = {}) {
  const sourcePath = normalizeRelPath(relPath);
  const kind = classifyEvidence(sourcePath, value);
  const renderedHtml = summaryBody(sourcePath, kind, value, context);
  const generatedHtmlBytes = Buffer.byteLength(renderedHtml, 'utf8');
  const outputLimited = generatedHtmlBytes > EVIDENCE_SUMMARY_LIMITS.htmlBytes;
  const summaryHtml = outputLimited
    ? renderShell({
      title: sourceTitle(sourcePath),
      kind: 'Summary limited',
      body: renderLimitNotice([
        `Generated summary output was ${formatNumber(generatedHtmlBytes)} bytes and was omitted because it exceeded the ${formatNumber(EVIDENCE_SUMMARY_LIMITS.htmlBytes)}-byte HTML limit. Use the source or a narrower evidence query.`,
      ]),
    })
    : renderedHtml;
  return {
    sourcePath,
    kind,
    title: sourceTitle(sourcePath),
    html: summaryHtml,
    limits: {
      ...EVIDENCE_SUMMARY_LIMITS,
      generatedHtmlBytes,
      returnedHtmlBytes: Buffer.byteLength(summaryHtml, 'utf8'),
      outputLimited,
    },
    exportFormats: ['json', 'csv'],
    pendingBackfills: pendingBackfills(context),
  };
}

export function hasEvidenceSummaryContent(relPath, value) {
  const kind = classifyEvidence(relPath, value);
  if (kind === 'records') return recordsFromValue(value).length > 0;
  if (kind === 'metrics') {
    const catalog = metricsFromCatalog(value);
    return catalog ? catalog.length > 0 : extractMetricPoints(value).length > 0;
  }
  if (kind === 'detections') return detectionsFromValue(value).length > 0;
  if (kind === 'entities') return entitiesFromValue(value).length > 0;
  if (kind === 'research-search') {
    return isPlainObject(value) && value.kind === 'search'
      && Array.isArray(value.results) && value.results.length > 0;
  }
  if (kind === 'research-canonical') {
    return isPlainObject(value) && value.kind === 'canonical'
      && Array.isArray(value.results)
      && (value.results.length > 0 || (Array.isArray(value.warnings) && value.warnings.some(nonEmpty)));
  }
  if (kind === 'reversinglabs') {
    return summarizeReversingLabsEnvelope(value, { sourcePath: relPath }).resultCount > 0;
  }
  return false;
}

export function summarizeEvidenceFile(session, relPath, context = {}) {
  const { sourcePath, value } = loadEvidenceSummarySource(session, relPath);
  return summarizeEvidenceValue(sourcePath, value, context);
}

export function loadEvidenceSummarySource(session, relPath) {
  const { sourcePath, value } = readJsonFile(session, relPath, { requireSummarizable: true });
  return { sourcePath, value, kind: classifyEvidence(sourcePath, value) };
}

function csvPriority(kind) {
  if (kind === 'records') {
    return ['timestamp', 'start_time', 'end_time', '_type', 'clientAddr', 'serverAddr', 'client.value', 'server.value', 'host', 'uri', 'method', 'statusCode'];
  }
  if (kind === 'detections') {
    return ['id', 'title', 'risk', 'status', 'resolution', 'type', 'categories', 'site', 'appliance', 'start_time', 'end_time'];
  }
  if (kind === 'entities') {
    return ['display_name', 'custom_name', 'default_name', 'ipaddr4', 'ipaddr6', 'role', 'vendor', 'model', 'critical', 'on_watchlist', 'last_seen_time', 'id'];
  }
  return [];
}

function csvSource(value, kind) {
  if (kind === 'records') return { items: recordsFromValue(value), transform: recordPayload };
  if (kind === 'detections') return { items: detectionsFromValue(value), transform: (item) => detectionRows([item])[0] };
  if (kind === 'entities') return { items: entitiesFromValue(value), transform: (item) => item };
  if (Array.isArray(value)) return { items: value, transform: (item) => item };
  if (!isPlainObject(value)) return { items: [value], transform: (item) => item };
  for (const key of CSV_ARRAY_KEYS) {
    if (Array.isArray(value[key]) && value[key].length) {
      return {
        items: value[key],
        transform: key === 'records' ? recordPayload : (item) => item,
      };
    }
  }
  const arrayEntry = Object.entries(value).find(([, item]) => Array.isArray(item) && item.length);
  if (arrayEntry) return { items: arrayEntry[1], transform: (item) => item };
  return { items: [value], transform: (item) => item };
}

function flattenCsvObject(value, prefix = '', out = {}, depth = 0, stats = null) {
  if (!isPlainObject(value)) return out;
  for (const key in value) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
    if (stats && stats.fieldsWritten >= CSV_EXPORT_LIMITS.flattenFieldsPerRow) {
      stats.fieldsOmitted += 1;
      continue;
    }
    const raw = value[key];
    const nextKey = prefix ? `${prefix}.${key}` : key;
    const typed = typedValue(raw);
    if (typed !== undefined) {
      out[nextKey] = typed;
      if (stats) stats.fieldsWritten += 1;
    } else if (isPlainObject(raw) && depth < CSV_EXPORT_LIMITS.flattenDepth) {
      flattenCsvObject(raw, nextKey, out, depth + 1, stats);
    } else {
      out[nextKey] = raw;
      if (stats) stats.fieldsWritten += 1;
    }
  }
  return out;
}

function csvRow(item, transform, stats = null) {
  const transformed = transform(item);
  if (!isPlainObject(transformed)) return { value: transformed };
  return flattenCsvObject(transformed, '', {}, 0, stats);
}

function boundedCsvStructured(value, stats, depth = 0, budget = null) {
  const state = budget || { nodes: 0, chars: CSV_EXPORT_LIMITS.cellBytes };
  if (state.nodes >= CSV_EXPORT_LIMITS.structuredNodes || state.chars <= 0) {
    if (stats) stats.structuredValuesOmitted += 1;
    return '[CSV value budget reached]';
  }
  state.nodes += 1;
  if (typeof value === 'string') {
    const visible = value.slice(0, Math.max(0, state.chars));
    state.chars -= visible.length;
    if (visible.length < value.length && stats) stats.cellsTruncated += 1;
    return visible;
  }
  if (value === null || !['object'].includes(typeof value)) return value;
  if (depth >= CSV_EXPORT_LIMITS.structuredDepth) {
    if (stats) stats.nestingOmitted += 1;
    return `[Nested value omitted at depth ${CSV_EXPORT_LIMITS.structuredDepth}]`;
  }
  if (Array.isArray(value)) {
    const visible = [];
    const limit = Math.min(value.length, CSV_EXPORT_LIMITS.structuredItems);
    for (let index = 0; index < limit && state.chars > 0; index += 1) {
      visible.push(boundedCsvStructured(value[index], stats, depth + 1, state));
    }
    if (visible.length < value.length) {
      visible.push(`[${formatNumber(value.length - visible.length)} items omitted]`);
      if (stats) stats.structuredValuesOmitted += value.length - visible.length + 1;
    }
    return visible;
  }
  const visible = {};
  let seen = 0;
  let omitted = 0;
  for (const key in value) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
    if (seen >= CSV_EXPORT_LIMITS.structuredItems || state.chars <= 0) {
      omitted += 1;
      continue;
    }
    seen += 1;
    state.chars -= key.length;
    visible[key] = boundedCsvStructured(value[key], stats, depth + 1, state);
  }
  if (omitted) {
    visible.__csv_omitted__ = `${formatNumber(omitted)} properties`;
    if (stats) stats.structuredValuesOmitted += omitted;
  }
  return visible;
}

function csvCell(value, key = '', stats = null) {
  const initialCellTruncations = stats?.cellsTruncated || 0;
  const typed = typedValue(value);
  const raw = typed !== undefined ? typed : value;
  const text = isPlainObject(raw) || Array.isArray(raw)
    ? JSON.stringify(boundedCsvStructured(raw, stats))
    : displayValue(raw, key);
  const encode = (input) => {
    const escaped = input.replaceAll('"', '""');
    return /[",\n\r]/.test(escaped) ? `"${escaped}"` : escaped;
  };
  const rawText = String(text ?? '');
  let encoded = encode(rawText);
  let encodedLimited = false;
  if (Buffer.byteLength(encoded, 'utf8') > CSV_EXPORT_LIMITS.cellBytes) {
    encodedLimited = true;
    let low = 0;
    let high = rawText.length;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      const candidate = encode(`${rawText.slice(0, middle)}...`);
      if (Buffer.byteLength(candidate, 'utf8') <= CSV_EXPORT_LIMITS.cellBytes) low = middle;
      else high = middle - 1;
    }
    encoded = encode(`${rawText.slice(0, low)}...`);
  }
  if (stats) {
    const structuredLimited = stats.cellsTruncated > initialCellTruncations;
    stats.cellsTruncated = initialCellTruncations + (structuredLimited || encodedLimited ? 1 : 0);
  }
  return encoded;
}

function csvLine(row, columns, stats = null) {
  return `${columns.map((column) => csvCell(row[column], column, stats)).join(',')}\n`;
}

function csvStats() {
  return {
    fieldsWritten: 0,
    fieldsOmitted: 0,
    cellsTruncated: 0,
    nestingOmitted: 0,
    structuredValuesOmitted: 0,
  };
}

export function createCsvExportPlan(value, relPath = 'data.json') {
  const sourcePath = normalizeRelPath(relPath);
  const kind = canSummarizeEvidenceValue(sourcePath, value) ? classifyEvidence(sourcePath, value) : '';
  const { items, transform } = csvSource(value, kind);
  const totalRows = items.length;
  const discoveryRows = Math.min(totalRows, CSV_EXPORT_LIMITS.rows, CSV_EXPORT_LIMITS.columnDiscoveryRows);
  const discoveryStats = csvStats();
  const discovery = [];
  for (let index = 0; index < discoveryRows; index += 1) {
    const rowStats = csvStats();
    discovery.push(csvRow(items[index], transform, rowStats));
    discoveryStats.fieldsOmitted += rowStats.fieldsOmitted;
  }
  const discoveredColumns = allColumns(discovery, csvPriority(kind));
  const columns = discoveredColumns.slice(0, CSV_EXPORT_LIMITS.columns);
  const maxRowsByCells = columns.length
    ? Math.floor(CSV_EXPORT_LIMITS.cells / columns.length)
    : 0;
  const candidateRows = Math.min(totalRows, CSV_EXPORT_LIMITS.rows, maxRowsByCells);
  const exportStats = csvStats();
  const header = columns.length ? `${columns.map((column) => csvCell(column)).join(',')}\n` : '';
  let outputBytes = Buffer.byteLength(header, 'utf8');
  let exportedRows = 0;
  for (let index = 0; index < candidateRows; index += 1) {
    const rowStats = csvStats();
    const line = csvLine(csvRow(items[index], transform, rowStats), columns, rowStats);
    const bytes = Buffer.byteLength(line, 'utf8');
    if (outputBytes + bytes > CSV_EXPORT_LIMITS.outputBytes) break;
    outputBytes += bytes;
    exportedRows += 1;
    exportStats.fieldsOmitted += rowStats.fieldsOmitted;
    exportStats.cellsTruncated += rowStats.cellsTruncated;
    exportStats.nestingOmitted += rowStats.nestingOmitted;
    exportStats.structuredValuesOmitted += rowStats.structuredValuesOmitted;
  }
  const truncated = [];
  if (exportedRows < totalRows) truncated.push('rows');
  if (columns.length < discoveredColumns.length) truncated.push('columns');
  if (discoveryRows < totalRows) truncated.push('column-discovery');
  if (exportedRows < candidateRows) truncated.push('output');
  if (exportStats.fieldsOmitted || discoveryStats.fieldsOmitted) truncated.push('fields');
  if (exportStats.cellsTruncated) truncated.push('cells');
  if (exportStats.nestingOmitted) truncated.push('nesting');
  const metadata = {
    totalRows,
    exportedRows,
    omittedRows: totalRows - exportedRows,
    discoveredColumns: discoveredColumns.length,
    exportedColumns: columns.length,
    omittedDiscoveredColumns: discoveredColumns.length - columns.length,
    columnsDiscoveredFromRows: discoveryRows,
    columnDiscoveryComplete: discoveryRows >= totalRows,
    cells: exportedRows * columns.length,
    outputBytes,
    truncated: [...new Set(truncated)],
    fieldsOmitted: exportStats.fieldsOmitted,
    fieldsOmittedDuringColumnDiscovery: discoveryStats.fieldsOmitted,
    cellsTruncated: exportStats.cellsTruncated,
    nestingOmitted: exportStats.nestingOmitted,
    structuredValuesOmitted: exportStats.structuredValuesOmitted,
    limits: CSV_EXPORT_LIMITS,
  };
  function* chunks() {
    let pending = Buffer.alloc(0);
    const append = function* (text) {
      let buffer = Buffer.from(text, 'utf8');
      if (pending.length) {
        const remaining = CSV_EXPORT_LIMITS.chunkBytes - pending.length;
        pending = Buffer.concat([pending, buffer.subarray(0, remaining)]);
        buffer = buffer.subarray(remaining);
        if (pending.length >= CSV_EXPORT_LIMITS.chunkBytes) {
          yield pending;
          pending = Buffer.alloc(0);
        }
      }
      while (buffer.length >= CSV_EXPORT_LIMITS.chunkBytes) {
        yield buffer.subarray(0, CSV_EXPORT_LIMITS.chunkBytes);
        buffer = buffer.subarray(CSV_EXPORT_LIMITS.chunkBytes);
      }
      if (buffer.length) pending = Buffer.from(buffer);
    };
    yield* append(header);
    for (let index = 0; index < exportedRows; index += 1) {
      yield* append(csvLine(csvRow(items[index], transform, csvStats()), columns));
    }
    if (pending.length) yield pending;
  }
  return {
    sourcePath,
    filename: csvExportName(sourcePath),
    metadata,
    chunks,
  };
}

export function jsonValueToCsv(value, relPath = 'data.json') {
  const plan = createCsvExportPlan(value, relPath);
  return Buffer.concat([...plan.chunks()]).toString('utf8');
}

export function csvExportName(relPath) {
  const base = path.posix.basename(normalizeRelPath(relPath)).replace(/\.[^.]+$/, '');
  return `${base.replace(/[^A-Za-z0-9._-]+/g, '_') || 'export'}.csv`;
}

export function exportJsonFileAsCsv(session, relPath) {
  const { sourcePath, value } = readJsonFile(session, relPath);
  const plan = createCsvExportPlan(value, sourcePath);
  return {
    sourcePath,
    filename: plan.filename,
    metadata: plan.metadata,
    csv: Buffer.concat([...plan.chunks()]).toString('utf8'),
  };
}
