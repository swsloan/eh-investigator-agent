import fs from 'node:fs';
import path from 'node:path';
import {
  canSummarizeEvidenceValue,
  hasEvidenceSummaryContent,
} from './evidence-summary.js';
import {
  classifyWorkspaceJsonArtifact,
  isInvestigationReportArtifact,
  isResearchSummaryArtifact,
  isReversingLabsSummaryArtifact,
  isWorkspaceJsonArtifactCandidate,
} from './workspace-artifacts.js';

const MAX_CLASSIFY_BYTES = 10 * 1024 * 1024;
const PRESENTATION_CACHE = new WeakMap();
const MARKDOWN_RE = /\.(?:md|markdown)$/i;
const HTML_RE = /\.(?:html|htm)$/i;
const PACKET_RE = /\.(?:pcap|pcapng|cap)(?:\.gz)?$/i;
const IMAGE_RE = /\.(?:png|jpe?g|gif|webp|svg|ico)$/i;
const SOURCE_LABELS = new Map([
  ['py', ['PYTHON', 'code']],
  ['js', ['JAVASCRIPT', 'code']],
  ['mjs', ['JAVASCRIPT', 'code']],
  ['ts', ['TYPESCRIPT', 'code']],
  ['tsx', ['TYPESCRIPT', 'code']],
  ['jsx', ['JAVASCRIPT', 'code']],
  ['sh', ['SHELL', 'code']],
  ['sql', ['SQL', 'code']],
  ['css', ['CSS', 'code']],
  ['json', ['JSON', 'text']],
  ['jsonl', ['JSONL', 'text']],
  ['ndjson', ['NDJSON', 'text']],
  ['csv', ['CSV', 'text']],
  ['tsv', ['TSV', 'text']],
  ['txt', ['TEXT', 'text']],
  ['log', ['LOG', 'text']],
  ['yaml', ['YAML', 'text']],
  ['yml', ['YAML', 'text']],
  ['xml', ['XML', 'text']],
  ['ini', ['CONFIG', 'text']],
  ['conf', ['CONFIG', 'text']],
  ['toml', ['CONFIG', 'text']],
  ['env', ['CONFIG', 'text']],
]);

function baseJsonPresentation(artifactKind) {
  const presentations = {
    detections: { kind: 'detection', tag: 'DETECTION', icon: 'detection', sortPriority: 20 },
    metrics: { kind: 'metrics', tag: 'METRICS', icon: 'metrics', sortPriority: 20 },
    records: { kind: 'records', tag: 'RECORDS', icon: 'records', sortPriority: 20 },
    entities: { kind: 'entity', tag: 'ENTITY', icon: 'entity', sortPriority: 20 },
    'research-search': { kind: 'web-search', tag: 'WEB SEARCH', icon: 'web-search', sortPriority: 10 },
    'research-source': { kind: 'web-source', tag: 'WEB SOURCE', icon: 'web-search', sortPriority: 30 },
    'research-status': { kind: 'research-status', tag: 'RESEARCH STATUS', icon: 'web-search', sortPriority: 40 },
    reversinglabs: { kind: 'rl-result', tag: 'RL RESULT', icon: 'reversinglabs', sortPriority: 20 },
    'packet-info': { kind: 'packet-info', tag: 'PACKET INFO', icon: 'packets', sortPriority: 30 },
  };
  return presentations[artifactKind] || null;
}

function readKnownJson(session, file) {
  if (file.size <= 0 || file.size > MAX_CLASSIFY_BYTES) return { ok: false, value: null };
  try {
    return {
      ok: true,
      value: JSON.parse(fs.readFileSync(session.resolveFile(file.path), 'utf8')),
    };
  } catch {
    return { ok: false, value: null };
  }
}

function readKnownText(session, file) {
  if (file.size <= 0 || file.size > MAX_CLASSIFY_BYTES) return '';
  try { return fs.readFileSync(session.resolveFile(file.path), 'utf8'); } catch { return ''; }
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function detectionPresentation(value, fallback) {
  if (!isObject(value)) return fallback;
  if (Array.isArray(value.detections)) {
    return { kind: 'detection-list', tag: 'DETECTIONS', icon: 'detection', sortPriority: 10 };
  }
  if (Array.isArray(value.activity)) {
    return {
      kind: 'detection-activity',
      tag: 'DETECTION ACTIVITY',
      icon: 'activity',
      sortPriority: 30,
      forceHidden: true,
    };
  }
  if (value.display_name && value.type && !value.id && !value.title) {
    return {
      kind: 'detection-type',
      tag: 'DETECTION TYPE',
      icon: 'catalog',
      sortPriority: 40,
      forceHidden: true,
    };
  }
  return fallback;
}

function metricStats(value) {
  if (!Array.isArray(value?.sensors)) return [];
  return value.sensors.flatMap((sensor) => {
    const response = sensor?.response || sensor;
    return Array.isArray(response?.stats) ? response.stats : [];
  });
}

function metricPresentation(value, fallback) {
  if (!isObject(value)) return fallback;
  if (Array.isArray(value.metrics)) {
    return { kind: 'metric-catalog', tag: 'METRIC CATALOG', icon: 'catalog', sortPriority: 40 };
  }
  const stats = metricStats(value);
  if (!stats.length) return fallback;
  const times = new Set(stats.map((stat) => stat?.time).filter((item) => item !== undefined && item !== null));
  if (times.size > 1) {
    return { kind: 'metric-series', tag: 'METRIC SERIES', icon: 'metrics', sortPriority: 10 };
  }
  if (stats.length === 1) {
    return { kind: 'metric-total', tag: 'METRIC TOTAL', icon: 'metrics', sortPriority: 30 };
  }
  return { kind: 'metric-aggregate', tag: 'METRIC AGGREGATE', icon: 'metrics', sortPriority: 20 };
}

function entityPresentation(value, fallback) {
  const single = isObject(value) ? value : null;
  const devices = Array.isArray(value?.devices) ? value.devices : null;
  const looksLikeDevice = (item) => isObject(item) && (
    item.device_class !== undefined || item.extrahop_id !== undefined
    || item.ipaddr4 !== undefined || item.macaddr !== undefined
  );
  if (single && looksLikeDevice(single)) {
    return { kind: 'device', tag: 'DEVICE', icon: 'device', sortPriority: 10 };
  }
  if (devices) {
    return { kind: 'device-list', tag: 'DEVICES', icon: 'device', sortPriority: 10 };
  }
  if (Array.isArray(value?.entities)) {
    return { kind: 'entity-list', tag: 'ENTITIES', icon: 'entity', sortPriority: 20 };
  }
  return fallback;
}

function reversingLabsPresentation(value, fallback) {
  if (!isObject(value) || value.kind !== 'reversinglabs') return fallback;
  const byOperation = {
    'sample-status': ['rl-status', 'RL STATUS'],
    reputation: ['rl-reputation', 'RL REPUTATION'],
    details: ['rl-details', 'RL DETAILS'],
    ticore: ['rl-analysis', 'RL ANALYSIS'],
    search: ['rl-search', 'RL SEARCH'],
    'search-count': ['rl-search-count', 'RL SEARCH COUNT'],
    probe: ['rl-probe', 'RL PROBE'],
  };
  const [kind, tag] = byOperation[value.operation] || ['rl-result', 'RL RESULT'];
  return { kind, tag, icon: 'reversinglabs', sortPriority: 20 };
}

function specializeJsonPresentation(artifactKind, value, fallback) {
  if (isObject(value) && typeof value.message === 'string' && Object.keys(value).length === 1) {
    return { kind: 'query-error', tag: 'QUERY ERROR', icon: 'error', sortPriority: 90, forceHidden: true };
  }
  if (artifactKind === 'detections') return detectionPresentation(value, fallback);
  if (artifactKind === 'metrics') return metricPresentation(value, fallback);
  if (artifactKind === 'entities') return entityPresentation(value, fallback);
  if (artifactKind === 'reversinglabs') return reversingLabsPresentation(value, fallback);
  if (artifactKind === 'research-source' || artifactKind === 'research-status') return fallback;
  if (artifactKind === 'packet-info' && isObject(value) && value.filepath && value.bytes_written !== undefined) {
    return { kind: 'pcap-download', tag: 'PCAP DOWNLOAD', icon: 'packets', sortPriority: 30 };
  }
  return fallback;
}

export function classifyWorkspaceFile(session, file) {
  const relPath = String(file?.path || '').replaceAll('\\', '/');
  const lower = relPath.toLowerCase();
  const empty = Number(file?.size || 0) === 0;
  // Files the agent writes at the workspace root are its investigation outputs.
  // They surface directly rather than being folded into "Show N more…", which
  // otherwise buried unrecognized-but-important root artifacts.
  const rootLevel = !relPath.includes('/');
  let presentation;

  if (MARKDOWN_RE.test(lower)) {
    presentation = isResearchSummaryArtifact(file.path, readKnownText(session, file))
      ? { kind: 'research-summary', tag: 'RESEARCH SUMMARY', icon: 'web-search', parsed: !empty, sortPriority: 0 }
      : { kind: 'note', tag: 'NOTE', icon: 'markdown', parsed: !empty, sortPriority: 10 };
  } else if (HTML_RE.test(lower)) {
    const content = readKnownText(session, file);
    if (isReversingLabsSummaryArtifact(file.path, content)) {
      presentation = { kind: 'rl-summary', tag: 'RL SUMMARY', icon: 'reversinglabs', parsed: !empty, sortPriority: 0 };
    } else if (isInvestigationReportArtifact(file.path, content)) {
      presentation = { kind: 'report', tag: 'REPORT', icon: 'report', parsed: !empty, sortPriority: 0 };
    } else {
      presentation = { kind: 'html', tag: 'HTML', icon: 'html', parsed: !empty, sortPriority: 10 };
    }
  }
  else if (PACKET_RE.test(lower)) presentation = { kind: 'packets', tag: 'PACKET CAPTURE', icon: 'packets', parsed: !empty, sortPriority: 0 };
  else {
    const artifactCandidate = isWorkspaceJsonArtifactCandidate(lower);
    if (artifactCandidate) {
      const json = readKnownJson(session, file);
      const artifactKind = classifyWorkspaceJsonArtifact(lower, json.ok ? json.value : undefined);
      const evidence = baseJsonPresentation(artifactKind);
      if (!evidence) {
        const ext = path.posix.extname(lower).slice(1);
        const [tag, icon] = SOURCE_LABELS.get(ext) || ['FILE', 'text'];
        presentation = { kind: ext || 'file', tag, icon, parsed: false, sortPriority: 50 };
      } else {
        const specialized = json.ok ? specializeJsonPresentation(artifactKind, json.value, evidence) : evidence;
        const summarizable = json.ok && canSummarizeEvidenceValue(file.path, json.value);
        let parsed = false;
        if (summarizable) {
          try { parsed = hasEvidenceSummaryContent(file.path, json.value); } catch { parsed = false; }
        }
        presentation = {
          ...specialized,
          parsed: specialized.forceHidden ? false : parsed,
          summarizable,
        };
      }
    } else if (lower.startsWith('evidence/packets/') && lower.endsWith('-tshark.txt')) {
      presentation = { kind: 'packet-analysis', tag: 'PACKET ANALYSIS', icon: 'packets', parsed: false, sortPriority: 20 };
    } else if (lower.startsWith('evidence/packets/') && lower.endsWith('-payloads.txt')) {
      presentation = { kind: 'packet-payloads', tag: 'PAYLOADS', icon: 'packets', parsed: false, sortPriority: 10 };
    } else if (IMAGE_RE.test(lower)) presentation = { kind: 'image', tag: 'IMAGE', icon: 'image', parsed: false, sortPriority: 50 };
    else {
      const ext = path.posix.extname(lower).slice(1);
      const [tag, icon] = SOURCE_LABELS.get(ext) || ['FILE', 'text'];
      presentation = { kind: ext || 'file', tag, icon, parsed: false, sortPriority: 50 };
    }
  }

  return {
    ...file,
    ...presentation,
    empty,
    reveal: !empty && (rootLevel || (Boolean(presentation.parsed) && !presentation.forceHidden)),
    primaryReport: false,
  };
}

export function presentWorkspaceFiles(session, files = session.listFiles()) {
  let cache = PRESENTATION_CACHE.get(session);
  if (!cache) {
    cache = new Map();
    PRESENTATION_CACHE.set(session, cache);
  }
  const presented = files.map((file) => {
    const fingerprint = `${file.size}:${Math.round(file.mtime)}`;
    const cached = cache.get(file.path);
    if (cached?.fingerprint === fingerprint) return { ...cached.file, ...file, primaryReport: false };
    const classified = classifyWorkspaceFile(session, file);
    cache.set(file.path, { fingerprint, file: classified });
    return classified;
  });
  const primaryReport = presented
    .filter((file) => file.kind === 'report' && file.reveal)
    .sort((a, b) => b.mtime - a.mtime)[0];
  if (primaryReport) primaryReport.primaryReport = true;
  return presented;
}
