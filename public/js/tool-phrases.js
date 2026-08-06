// What a tool call is *for*, in a sentence.
//
// The tool stream used to render `JSON.stringify(args).slice(0,160)`, so an analyst
// watching a five-minute turn saw a stack of grey cards full of braces and could not
// tell a device sweep from a DNS lookup. Everything here is derived client-side from
// the call the agent already made — no new events, no prompt changes.
//
// Kept as its own module because the live-activity view renders the same stream.

const RECORD_LABEL = {
  dns: 'DNS', cifs: 'SMB', smb: 'SMB', http: 'HTTP', ssl: 'TLS', tls: 'TLS',
  ldap: 'LDAP', kerberos_request: 'Kerberos', kerberos: 'Kerberos', flow: 'flow',
  dhcp: 'DHCP', ftp: 'FTP', ssh: 'SSH', rdp: 'RDP', sip: 'SIP', db: 'database',
};

const EXTRAHOP_PHRASES = {
  search_devices: 'Searching devices',
  get_device: 'Looking up a device',
  search_devicegroups: 'Searching device groups',
  list_devices_in_devicegroup: 'Listing devices in a group',
  search_detections: 'Searching detections',
  get_detection: 'Opening a detection',
  update_detection: 'Updating a detection',
  search_detectionactivity: 'Searching detection activity',
  get_detectiontypemetadata: 'Reading detection-type metadata',
  search_records: 'Searching records',
  execute_metric_query: 'Querying metrics',
  search_metric_catalog: 'Searching the metric catalog',
  download_pcap: 'Downloading a packet capture',
  create_investigation: 'Creating an investigation',
  get_appliance_metadata: 'Reading appliance metadata',
  search_devicetags: 'Searching device tags',
  list_devicetags_for_device: 'Listing tags on a device',
  assign_devicetag_to_devices: 'Tagging devices',
  unassign_devicetag_from_devices: 'Removing a device tag',
  get_extrahop_help_docs_url: 'Looking up ExtraHop documentation',
};

const RL_PHRASES = {
  reputation: 'Checking file reputation',
  details: 'Fetching sample details',
  ticore: 'Fetching the TiCore report',
  search: 'Searching malware samples',
  'search-count': 'Counting malware-sample matches',
  'sample-status': 'Checking sample status',
  status: 'Checking ReversingLabs status',
  probe: 'Testing the ReversingLabs connection',
};

const RESEARCH_PHRASES = {
  cve: 'Looking up a CVE',
  kev: 'Checking the KEV catalog',
  epss: 'Checking EPSS scoring',
  attack: 'Looking up an ATT&CK technique',
  rfc: 'Looking up an RFC',
  iana: 'Looking up an IANA registry entry',
  rdap: 'Looking up domain registration',
  fetch: 'Fetching a page',
  status: 'Checking research status',
};

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The command string of a bash tool call, or ''. */
function commandOf(args) {
  return args && typeof args === 'object' && typeof args.command === 'string' ? args.command : '';
}

/** The first bare word after `<interface> ` — the verb the broker dispatches on. */
function verbFor(command, interfaceName) {
  const m = command.match(new RegExp(`(?:^|[^a-z0-9_-])(?:\\./)?${interfaceName}\\s+([a-z0-9_-]+)\\b`, 'i'));
  return m?.[1]?.toLowerCase() || '';
}

/**
 * The `-json '{...}'` payload these interfaces take. Returns null when it is absent
 * or unparseable — a phrase is a nicety, so anything doubtful just degrades to the
 * plainer wording rather than guessing.
 */
export function jsonArg(command) {
  const at = command.indexOf('-json');
  if (at === -1) return null;
  const rest = command.slice(at + '-json'.length).trimStart();
  const quote = rest[0];
  if (quote !== "'" && quote !== '"') return null;
  const end = rest.indexOf(quote, 1);
  if (end === -1) return null;
  try {
    const parsed = JSON.parse(rest.slice(1, end));
    // Arrays are `typeof 'object'` but carry none of the query fields read below.
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch { return null; }
}

/**
 * `from` is a negative millisecond offset from now on every ExtraHop query the
 * agent writes. A positive value is an absolute epoch, which says nothing about
 * duration, so it earns no phrase.
 */
export function humanWindow(from) {
  const raw = Number(from);
  if (!Number.isFinite(raw) || raw >= 0) return '';
  const ms = Math.abs(raw);
  const day = 86_400_000, hour = 3_600_000, minute = 60_000;
  if (ms >= day) return `over the last ${plural(Math.round(ms / day), 'day')}`;
  if (ms >= hour) return `over the last ${plural(Math.round(ms / hour), 'hour')}`;
  if (ms >= minute) return `over the last ${plural(Math.round(ms / minute), 'minute')}`;
  return '';
}

function recordKinds(payload) {
  const types = Array.isArray(payload?.types) ? payload.types : [];
  const names = types
    .map((t) => String(t || '').replace(/^~/, '').toLowerCase())
    .filter(Boolean)
    .map((t) => RECORD_LABEL[t] || t.replace(/_/g, ' '));
  return [...new Set(names)];
}

function metricSubject(payload) {
  const specs = Array.isArray(payload?.metric_specs) ? payload.metric_specs : [];
  const names = specs.map((s) => String(s?.name || '')).filter(Boolean);
  if (names.length && names.every((n) => /bytes|throughput/i.test(n))) return 'traffic';
  if (names.length === 1) return names[0].replace(/_/g, ' ');
  if (names.length > 1) return `${names.length} metrics`;
  const category = String(payload?.metric_category || '');
  return category ? category.replace(/_/g, ' ') : '';
}

function extrahopPhrase(command) {
  const verb = verbFor(command, 'excli-interface');
  const base = EXTRAHOP_PHRASES[verb];
  if (!base) return verb ? '' : 'Running an ExtraHop query';
  const payload = jsonArg(command);
  if (!payload) return base;
  const window = humanWindow(payload.from);

  if (verb === 'search_records') {
    const kinds = recordKinds(payload);
    const what = kinds.length ? `${kinds.join(' + ')} records` : 'records';
    return ['Searching', what, window].filter(Boolean).join(' ');
  }
  if (verb === 'execute_metric_query') {
    const subject = metricSubject(payload);
    const per = payload.object_type ? `per ${String(payload.object_type).replace(/_/g, ' ')}` : '';
    return ['Querying', subject || 'metrics', per, window].filter(Boolean).join(' ');
  }
  return [base, window].filter(Boolean).join(' ');
}

function researchPhrase(command) {
  const verb = verbFor(command, 'research-interface');
  if (verb === 'search') {
    const query = jsonArg(command)?.query;
    return query ? `Searching the web for “${String(query).slice(0, 60)}”` : 'Searching the web';
  }
  return RESEARCH_PHRASES[verb] || 'Researching';
}

function fileName(path) {
  return String(path || '').split('/').filter(Boolean).pop() || String(path || '');
}

/**
 * A one-line statement of intent for a tool call, or '' when nothing better than the
 * raw arguments can honestly be said (the caller then falls back to those).
 */
export function phraseFor(toolName, args) {
  const name = String(toolName || '');
  const command = commandOf(args);

  if (command) {
    if (/(?:^|[^a-z0-9_-])(?:\.\/)?excli-interface\b/i.test(command)) return extrahopPhrase(command);
    if (/(?:^|[^a-z0-9_-])(?:\.\/)?research-interface\b/i.test(command)) return researchPhrase(command);
    if (/(?:^|[^a-z0-9_-])(?:\.\/)?reversinglabs-interface\b/i.test(command)) {
      return RL_PHRASES[verbFor(command, 'reversinglabs-interface')] || 'Querying ReversingLabs';
    }
    if (/(?:^|[^a-z0-9_-])(?:\.\/)?investigation-plan\b/i.test(command)) return 'Updating the investigation plan';
    if (/(?:^|[^a-z0-9_-])(?:\.\/)?propose-action\b/i.test(command)) return 'Proposing an action for approval';
    return ''; // an ordinary shell command already reads as itself
  }

  const lower = name.toLowerCase();
  if (lower === 'websearch' || lower === 'searchweb') {
    const query = args?.query;
    return query ? `Searching the web for “${String(query).slice(0, 60)}”` : 'Searching the web';
  }
  if (lower === 'webfetch') return args?.url ? `Fetching ${String(args.url).slice(0, 60)}` : 'Fetching a page';
  if (lower === 'read') return args?.path || args?.file_path ? `Reading ${fileName(args.path || args.file_path)}` : '';
  if (lower === 'write') return args?.path || args?.file_path ? `Writing ${fileName(args.path || args.file_path)}` : '';
  if (lower === 'edit') return args?.path || args?.file_path ? `Editing ${fileName(args.path || args.file_path)}` : '';
  if (lower === 'glob' || lower === 'grep') return args?.pattern ? `Searching files for ${String(args.pattern).slice(0, 40)}` : '';
  return '';
}

// ---- What came back ---------------------------------------------------------
// The result of a call is the part an analyst is actually waiting for, and it used
// to be visible only by expanding the card into a wall of JSON. These summaries
// report the shape the payload really has — counts, and emptiness where emptiness
// is the finding — and stop there. Anything requiring a name the payload does not
// contain (which object was the top talker, say) is left to the agent's own prose
// rather than guessed at here.
//
// Returned as segments so the caller can build DOM text nodes: no markup, nothing
// to escape, and the key fact can be emphasised wherever it falls in the sentence.

const num = (n) => Number(n).toLocaleString();

/** First JSON value in a stdout blob, tolerating leading or trailing noise. */
export function parseJsonOutput(output) {
  const text = String(output || '').trim();
  if (!text) return null;
  try { return JSON.parse(text); } catch { /* fall through to a bracket scan */ }
  const start = text.search(/[[{]/);
  if (start === -1) return null;
  const open = text[start];
  const close = open === '{' ? '}' : ']';
  const end = text.lastIndexOf(close);
  if (end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}

const isObj = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/** Every stat across the sensors envelope ExtraHop metric queries come back in. */
function metricStats(value) {
  if (!Array.isArray(value?.sensors)) return [];
  return value.sensors.flatMap((sensor) => {
    const response = sensor?.response || sensor;
    return Array.isArray(response?.stats) ? response.stats : [];
  });
}

function countPhrase(n, singular, pluralWord, tail) {
  const word = n === 1 ? singular : pluralWord;
  return [{ text: num(n), strong: true }, { text: ` ${word}${tail ? ` ${tail}` : ''}` }];
}

/**
 * A sentence about what a finished call returned, as segments, or null when the
 * output is not a shape worth claiming anything about.
 */
export function resultSummary({ output, isError } = {}) {
  const text = String(output || '').trim();
  if (!text) return null;

  if (isError) {
    const firstLine = text.split('\n').find((l) => l.trim());
    return firstLine ? [{ text: 'Failed: ' }, { text: firstLine.trim().slice(0, 140), strong: true }] : null;
  }

  const value = parseJsonOutput(text);
  if (!isObj(value)) {
    if (Array.isArray(value)) return countPhrase(value.length, 'item', 'items', 'returned');
    return null;
  }

  if (Array.isArray(value.detections)) {
    return value.detections.length === 0
      ? [{ text: 'No detections', strong: true }, { text: ' in this window' }]
      : countPhrase(value.detections.length, 'detection', 'detections', 'returned');
  }
  if (Array.isArray(value.activity)) return countPhrase(value.activity.length, 'activity entry', 'activity entries', 'returned');
  if (Array.isArray(value.records)) {
    const total = Number(value.total);
    const segs = value.records.length === 0
      ? [{ text: 'No records', strong: true }, { text: ' matched' }]
      : countPhrase(value.records.length, 'record', 'records', 'returned');
    if (Number.isFinite(total) && total > value.records.length) segs.push({ text: ` of ${num(total)} matching` });
    return segs;
  }
  if (Array.isArray(value.devices)) {
    return value.devices.length === 0
      ? [{ text: 'No devices', strong: true }, { text: ' matched' }]
      : countPhrase(value.devices.length, 'device', 'devices', 'returned');
  }
  if (Array.isArray(value.entities)) return countPhrase(value.entities.length, 'entity', 'entities', 'returned');
  if (Array.isArray(value.metrics)) return countPhrase(value.metrics.length, 'metric', 'metrics', 'in the catalog');
  if (Array.isArray(value.results)) return countPhrase(value.results.length, 'result', 'results', 'returned');

  const stats = metricStats(value);
  if (stats.length) {
    const points = stats.reduce((sum, s) => sum + (Array.isArray(s?.values) ? s.values.length : 1), 0);
    const objects = new Set(stats.map((s) => s?.oid).filter((o) => o !== undefined && o !== null)).size;
    const segs = countPhrase(points, 'data point', 'data points', '');
    if (objects > 1) segs.push({ text: ` across ${num(objects)} objects` });
    return segs;
  }

  // A single device record: `entityPresentation` recognises these by the same fields.
  if (value.device_class !== undefined || value.extrahop_id !== undefined
    || value.ipaddr4 !== undefined || value.macaddr !== undefined) {
    const label = value.display_name || value.name || value.ipaddr4 || value.macaddr;
    return label ? [{ text: 'Device ' }, { text: String(label).slice(0, 60), strong: true }] : null;
  }

  return null;
}
