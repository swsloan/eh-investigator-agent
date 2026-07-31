// Attack overlay (Slice C): turn an investigation's verdict into events drawable
// on the network map, staged by MITRE ATT&CK tactic.
//
// Pure — no I/O. The route reads verdict.json from a session workspace and hands
// it here with the snapshot's device list; this module decides WHAT to draw.
//
// Two facts drive the design (both verified, see docs/DESIGN-network-topology.md):
//
//   1. `verdict.json.timeline[]` historically carries no structured actors — the
//      devices are prose inside `detail` ("KALI (172.16.206.22) issues repeated
//      curl GETs to CA.acmelegal.lab"). Slice C adds OPTIONAL `src`/`dst`/`tactic`
//      for new investigations; for everything already on disk we fall back to
//      extracting entities from the text. So binding is best-effort by design, and
//      an unbindable event is reported as unbound rather than silently dropped.
//   2. `time` is explicitly allowed to be a range or a phase like "ongoing", so it
//      is NOT reliably parseable. Ordering must degrade to the author's own
//      sequence rather than throwing away events it can't parse.

import { extractIps } from './conclusion-quality.js';

// MITRE ATT&CK tactics in kill-chain order. The map stages events along this, and
// the vocabulary matches the flow strip in the investigation report templates so a
// reader moving between the report and the map sees the same words.
export const TACTICS = [
  'Reconnaissance',
  'Resource Development',
  'Initial Access',
  'Execution',
  'Persistence',
  'Privilege Escalation',
  'Defense Evasion',
  'Credential Access',
  'Discovery',
  'Lateral Movement',
  'Collection',
  'Command and Control',
  'Exfiltration',
  'Impact',
];

const TACTIC_INDEX = new Map(TACTICS.map((t, i) => [t.toLowerCase(), i]));

// Phrases that reliably imply a tactic, for events that predate the `tactic` field.
// Ordered most-specific first: "ransom note" must win over the bare word "scan".
const TACTIC_HINTS = [
  [/ransom|encrypt(ion|ed|ing)?\b|wiper|destruct/i, 'Impact'],
  [/exfil|data (theft|staging|stage)|mass (file|document) (read|access)|staged for/i, 'Exfiltration'],
  [/collect|mass read|document read|staging/i, 'Collection'],
  [/lateral|psexec|wmi|wsman|powershell remot|smb exec|rdp (into|to)/i, 'Lateral Movement'],
  [/kerberoast|credential|hash|ntlm|password|ticket|golden|silver ticket/i, 'Credential Access'],
  // `admin-access` and `admin access` are both common in write-ups.
  [/privilege|escalat|admin[-\s](access|rights)|scm probe|sudo|uac/i, 'Privilege Escalation'],
  [/persist|scheduled task|service creat|autorun|registry run/i, 'Persistence'],
  // `\bc2\b` alone matches the "c2" inside hostnames like `nlqawdc2.` (the dot is a
  // word boundary), so require a boundary on BOTH sides and anchor the rest.
  [/beacon|(?:^|[^a-z0-9])c2(?![a-z0-9])|command[- ]and[- ]control|callback/i, 'Command and Control'],
  [/enumerat|scan|sweep|discovery|share list|probe/i, 'Discovery'],
  [/phish|exploit|initial access|drive-by|malicious attachment/i, 'Initial Access'],
  [/recon/i, 'Reconnaissance'],
];

function str(v) {
  return v == null ? '' : String(v).trim();
}

/**
 * Normalize a tactic label to canonical ATT&CK spelling, or '' when unrecognized.
 * Tolerates case, underscores, and hyphens ("lateral_movement" → "Lateral Movement").
 */
export function normalizeTactic(value) {
  const raw = str(value).replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').toLowerCase();
  if (!raw) return '';
  const idx = TACTIC_INDEX.get(raw);
  return idx === undefined ? '' : TACTICS[idx];
}

/**
 * The tactic for one timeline event: the author's explicit `tactic` when present,
 * else inferred from the event text. Inference is a convenience for verdicts written
 * before the field existed — `inferred: true` is reported so the UI can mark it.
 */
export function tacticFor(entry) {
  const explicit = normalizeTactic(entry?.tactic);
  if (explicit) return { tactic: explicit, inferred: false };
  const text = `${str(entry?.event)} ${str(entry?.detail)}`;
  for (const [re, tactic] of TACTIC_HINTS) {
    if (re.test(text)) return { tactic, inferred: true };
  }
  return { tactic: '', inferred: false };
}

/** Hostnames in free text: dotted labels that aren't IPs (e.g. `dc1.acme.lab`). */
export function extractHosts(text) {
  const out = new Set();
  const re = /\b([a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)+)\b/gi;
  let m;
  while ((m = re.exec(String(text || '')))) {
    const value = m[1];
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(value)) continue;     // an IP, handled separately
    if (/\.(json|html|md|txt|pcap|csv|log)$/i.test(value)) continue; // an evidence filename
    out.add(value.toLowerCase());
  }
  return [...out];
}

/**
 * Index a snapshot's devices for lookup by every handle an author might write:
 * IP, hostname (full and short), and OID. Returns `resolve(token) -> key | ''`.
 */
export function deviceIndex(devices = []) {
  const byToken = new Map();
  const put = (token, key) => {
    const t = str(token).toLowerCase();
    // First writer wins, so a short-name collision can't hijack an exact match.
    if (t && !byToken.has(t)) byToken.set(t, key);
  };
  for (const d of devices) {
    const key = str(d?.key);
    if (!key) continue;
    put(key, key);
    put(d?.ip, key);
    put(d?.oid, key);
    const name = str(d?.name).toLowerCase();
    if (name) {
      put(name, key);
      const short = name.split('.')[0];
      if (short && short !== name) put(short, key);
    }
  }
  return (token) => byToken.get(str(token).toLowerCase()) || '';
}

/**
 * Bind one timeline entry to device keys.
 *
 * Structured `src`/`dst` win outright. Otherwise we scan the event text for IPs and
 * hostnames that match real devices in the snapshot — in text order, so the first
 * mentioned entity is treated as the actor. That heuristic is why `inferred` is
 * surfaced: a map that silently guesses direction would be asserting something the
 * investigation never said.
 */
export function bindEntry(entry, resolve) {
  const explicitSrc = resolve(entry?.src);
  const explicitDst = resolve(entry?.dst);
  if (explicitSrc || explicitDst) {
    return { src: explicitSrc, dst: explicitDst, entities: [explicitSrc, explicitDst].filter(Boolean), inferred: false };
  }

  // Author-listed entities (unordered) before falling back to prose scanning.
  const listed = (Array.isArray(entry?.entities) ? entry.entities : []).map(resolve).filter(Boolean);
  if (listed.length) {
    return { src: listed[0] || '', dst: listed[1] || '', entities: [...new Set(listed)], inferred: false };
  }

  const text = `${str(entry?.event)} ${str(entry?.detail)}`;
  const tokens = [...extractIps(text), ...extractHosts(text)];
  // Preserve mention order: whoever appears first in the sentence is the actor.
  const ordered = tokens
    .map((t) => ({ t, at: text.toLowerCase().indexOf(String(t).toLowerCase()) }))
    .filter((o) => o.at >= 0)
    .sort((a, b) => a.at - b.at)
    .map((o) => resolve(o.t))
    .filter(Boolean);
  const entities = [...new Set(ordered)];
  return { src: entities[0] || '', dst: entities[1] || '', entities, inferred: entities.length > 0 };
}

/**
 * A sortable key for `time`, tolerating the contract's deliberate looseness (an
 * exact stamp, a range like "04:00–05:00", or a phase like "ongoing"). Unparseable
 * values return null so the caller can fall back to the author's own ordering
 * rather than discarding the event.
 */
export function timeKey(value) {
  const parsed = parseTime(value);
  return parsed.kind === 'none' ? null : parsed.value;
}

/**
 * Parse `time` into `{ kind, value }`:
 *   'absolute' — a full date+time, value = epoch ms
 *   'clock'    — a bare time of day, value = ms since midnight
 *   'none'     — a phrase like "ongoing"; unorderable on its own
 *
 * The two numeric kinds live in DIFFERENT spaces and must never be compared
 * directly: an epoch stamp is ~1.8e12 while 04:00 is 1.4e7, so a naive sort throws
 * a mid-attack event to the front. `orderEvents` reconciles them.
 */
export function parseTime(value) {
  const raw = str(value);
  if (!raw) return { kind: 'none', value: null };
  const start = raw.split(/[–—]|\s+to\s+/)[0].trim(); // a range sorts by its start
  // Require a date component before trusting Date.parse: it happily reads "04:00"
  // as today, which would fabricate an absolute stamp out of a clock time.
  if (/\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4}|[A-Za-z]{3}\s+\d{1,2}/.test(start)) {
    const ms = Date.parse(start);
    if (Number.isFinite(ms)) return { kind: 'absolute', value: ms };
  }
  const clock = start.match(/^~?(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (clock) {
    return { kind: 'clock', value: (Number(clock[1]) * 3600 + Number(clock[2]) * 60 + Number(clock[3] || 0)) * 1000 };
  }
  return { kind: 'none', value: null };
}

const DAY_MS = 86_400_000;

/**
 * Put timeline events in the order they actually happened.
 *
 * Real verdicts mix formats freely: several ISO stamps, then a bare `04:00–05:00`,
 * then `ongoing`. Sorting the raw numbers puts the bare clock time first, which
 * misreads the attack. Instead, walk in the ANALYST'S order carrying the last
 * absolute date, and anchor each clock-only entry to that date (rolling to the next
 * day if the clock has gone backwards) — which is exactly how a person reads it.
 * Entries with no parseable time simply hold their written position.
 *
 * Pure and exported for testing.
 */
export function orderEvents(events = []) {
  let anchor = null;   // epoch ms of the last absolute stamp seen
  let cursor = null;   // monotonically increasing sort key
  const keyed = events.map((e, order) => {
    const parsed = parseTime(e.time);
    let sortKey;
    if (parsed.kind === 'absolute') {
      anchor = parsed.value;
      sortKey = parsed.value;
    } else if (parsed.kind === 'clock' && anchor !== null) {
      const midnight = Math.floor(anchor / DAY_MS) * DAY_MS;
      sortKey = midnight + parsed.value;
      if (sortKey < anchor) sortKey += DAY_MS; // clock rolled past midnight
    } else if (parsed.kind === 'clock') {
      sortKey = parsed.value; // no date anywhere yet — clock-only timeline
    } else {
      sortKey = cursor === null ? -Infinity : cursor; // "ongoing": hold position
    }
    if (cursor === null || sortKey > cursor) cursor = sortKey;
    return { e, order, sortKey };
  });
  keyed.sort((a, b) => (a.sortKey === b.sortKey ? a.order - b.order : a.sortKey - b.sortKey));
  return keyed.map((k) => k.e);
}

/**
 * Build the drawable overlay for one investigation.
 *
 * @param {object} verdict  parsed evidence/verdict.json
 * @param {Array}  devices  the snapshot's devices ({key, name, ip, oid})
 * @param {object} [meta]   { sessionId, title }
 * @returns {{id,title,disposition,confidence,techniques,events,stages,bound,unbound,entities}}
 */
export function buildOverlay(verdict, devices = [], meta = {}) {
  const v = verdict && typeof verdict === 'object' ? verdict : {};
  const resolve = deviceIndex(devices);
  const raw = Array.isArray(v.timeline) ? v.timeline : [];

  const events = raw.map((entry, order) => {
    const { tactic, inferred: tacticInferred } = tacticFor(entry);
    const bound = bindEntry(entry, resolve);
    return {
      order,
      time: str(entry?.time),
      timeKey: timeKey(entry?.time),
      event: str(entry?.event),
      detail: str(entry?.detail),
      evidence: str(entry?.evidence),
      tactic,
      tacticInferred,
      stage: tactic ? TACTIC_INDEX.get(tactic.toLowerCase()) : null,
      src: bound.src,
      dst: bound.dst,
      entities: bound.entities,
      // True when the map inferred the actors from prose rather than being told.
      inferred: bound.inferred,
    };
  });

  // Chronological, reconciling mixed time formats against the analyst's own order —
  // never drop or misplace an event just because its timestamp is a phrase.
  const ordered = orderEvents(events);
  ordered.forEach((e, i) => { e.seq = i; });
  events.length = 0;
  events.push(...ordered);

  const entities = [...new Set(events.flatMap((e) => e.entities))];
  const stages = TACTICS
    .map((t) => ({ tactic: t, count: events.filter((e) => e.tactic === t).length }))
    .filter((s) => s.count > 0);

  return {
    id: str(meta.sessionId),
    title: str(meta.title) || str(v.disposition) || 'Investigation',
    disposition: str(v.disposition),
    confidence: str(v.confidence),
    techniques: (Array.isArray(v.attack_techniques) ? v.attack_techniques : []).map(str).filter(Boolean),
    events,
    stages,
    entities,
    bound: events.filter((e) => e.entities.length).length,
    unbound: events.filter((e) => !e.entities.length).length,
  };
}
