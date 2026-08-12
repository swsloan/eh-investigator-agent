// Safety / boundary event log (issue #32) — the "safety" facet of agent auditing,
// split from the #30 activity trail. A per-session, reviewable record that the
// guarded boundary HELD: prompt-injection attempts flagged (not obeyed) in
// untrusted telemetry, secret-redaction hits, SSRF/exfiltration guard blocks, and
// refused write-class (read-only) excli calls. It lets a reviewer confirm nothing
// turned the agent against the user, and see exactly what the adversarial
// telemetry tried.
//
// TWO hard invariants:
//   1. Observe-only. Recording an event NEVER changes guard behavior — every tap
//      records and then does exactly what it did before. A safety-log failure is
//      swallowed, never allowed to disrupt a guard.
//   2. No secrets/payloads. The log records flags, reasons, counts, and short
//      non-reversible fingerprints — never the raw injected text or a secret. This
//      module strips detail to an allowlist, and the session's own redactor runs
//      over every event on top of that (defense in depth). A threat-model note in
//      docs/DESIGN-safety-log.md covers why no payload text is retained.

import crypto from 'node:crypto';

export const SAFETY_EVENT = 'safety_event';
export const SAFETY_KINDS = [
  'injection_suspected', // untrusted telemetry contained text resembling instructions
  'write_refused',       // a write-class excli call was denied on the read-only path
  'secret_redacted',     // secret material was detected and redacted before it spread
  'ssrf_blocked',        // research fetch to a local/internal/non-public destination denied
  'exfil_blocked',       // outbound content/size guard denied a research fetch
  'unattended_proposal', // a write was proposed with no human present (#137) — awaits deferred review
];

// Only these fields may ride on a safety event; anything else is dropped, so a
// caller can never accidentally attach a payload or secret.
const ALLOWED_FIELDS = new Set(['flags', 'source', 'tool', 'reason', 'host', 'kinds', 'count', 'fingerprint']);

/** A short, non-reversible fingerprint of adversarial text: reviewers can count
 * and correlate occurrences without the payload ever being stored. */
export function fingerprint(text) {
  return crypto.createHash('sha256').update(String(text || '')).digest('hex').slice(0, 16);
}

/** Coerce detail to the allowlist and bounded scalars — the payload/secret guard. */
export function sanitizeDetail(detail = {}) {
  const out = {};
  for (const [k, v] of Object.entries(detail || {})) {
    if (!ALLOWED_FIELDS.has(k)) continue;
    if (Array.isArray(v)) out[k] = v.slice(0, 20).map((x) => String(x).slice(0, 120));
    else if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    else if (v != null) out[k] = String(v).slice(0, 200);
  }
  return out;
}

/**
 * Record a safety event on a session. Observe-only and never throws — a failure
 * to record must not disrupt the guard that called it. `detail` is sanitized to
 * the payload-free allowlist before it is stored. Returns true if recorded.
 */
export function recordSafetyEvent(session, kind, detail = {}) {
  if (!session || typeof session.recordEvent !== 'function' || !SAFETY_KINDS.includes(kind)) return false;
  try {
    session.recordEvent({ type: SAFETY_EVENT, kind, at: Date.now(), ...sanitizeDetail(detail) });
    return true;
  } catch {
    return false; // a safety-log write must never break a security guard
  }
}

/**
 * Aggregate the safety events out of a session transcript into a summary. Pure.
 * Returns { total, by_kind, injection_flags (union of distinct patterns seen),
 * events[] } — every event already payload-free.
 */
export function summarizeSafetyEvents(events = []) {
  const safety = (Array.isArray(events) ? events : []).filter((e) => e && e.type === SAFETY_EVENT);
  const byKind = Object.fromEntries(SAFETY_KINDS.map((k) => [k, 0]));
  const injectionFlags = new Set();
  for (const e of safety) {
    if (e.kind in byKind) byKind[e.kind]++;
    if (e.kind === 'injection_suspected') for (const f of e.flags || []) injectionFlags.add(f);
  }
  return {
    total: safety.length,
    by_kind: byKind,
    injection_flags: [...injectionFlags],
    events: safety
      .map((e) => ({ kind: e.kind, at: e.at || null, ...sanitizeDetail(e) }))
      .sort((a, b) => (a.at || 0) - (b.at || 0)),
  };
}
