// Agent activity audit trail (issue #30, Phase 5) — Slice A: append-only hash
// chain + offline verifier. See docs/DESIGN-audit-trail.md for the threat model
// and the honest tamper-EVIDENT (not tamper-proof) boundary.
//
// One append-only JSONL trail per session at <workspace>/audit/trail.jsonl. Each
// stored line is `{ ...payload, prevHash, hash }` where
//   hash = SHA-256( prevHash ‖ "\n" ‖ canonical(payload) )
// so recomputing the chain detects any edit, reorder, or mid-trail deletion and
// points at the first bad entry. (Tail-truncation produces a valid shorter chain;
// pinning the head is the job of the signed seal — Slice B.) Payloads are run
// through the central redactor BEFORE hashing (layer 2), so no secret enters the
// digest and verification matches exactly what is stored. Capture is observe-only.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const GENESIS = 'GENESIS';
const TRAIL_DIR = 'audit';
const TRAIL_FILE = 'trail.jsonl';

// The vocabulary of entry types the trail records (a projection of the session
// event stream + action lifecycle + verdict). `seal` is written by Slice B.
export const AUDIT_ENTRY_TYPES = [
  'tool_call', 'extrahop_query', 'action_proposed', 'action_decided',
  'action_result', 'memory_capture', 'safety_event', 'verdict', 'seal',
];

/** Deterministic JSON: object keys sorted recursively, so the same payload always
 * hashes identically regardless of insertion order. */
export function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v === undefined ? null : v);
}

/** hash = SHA-256(prevHash ‖ "\n" ‖ canonical(payload)). */
export function hashPayload(prevHash, payload) {
  return crypto.createHash('sha256').update(`${prevHash}\n${canonical(payload)}`).digest('hex');
}

export function trailPath(workspace) {
  return path.join(workspace, TRAIL_DIR, TRAIL_FILE);
}

/** Read a workspace's trail JSONL text (or '' when none) — for export/verify
 * without needing the writer instance. */
export function readTrail(workspace) {
  try { return fs.readFileSync(trailPath(workspace), 'utf8'); } catch { return ''; }
}

/**
 * Verify a trail (its raw JSONL text). Pure — no filesystem, so it works on an
 * exported record offline. Returns:
 *   { ok:true, entries, head } when the chain is intact, or
 *   { ok:false, brokenAt, reason } pointing at the first bad line (0-indexed).
 * (Signature verification of the seal is added in Slice B; this checks the chain.)
 */
export function verifyTrail(text) {
  const lines = String(text || '').split('\n').map((l) => l.trim()).filter(Boolean);
  let prev = GENESIS;
  let expectedSeq = 1;
  for (let i = 0; i < lines.length; i++) {
    let entry;
    try { entry = JSON.parse(lines[i]); } catch { return { ok: false, brokenAt: i, reason: 'entry is not valid JSON (corrupt or truncated line)' }; }
    if (!entry || typeof entry !== 'object') return { ok: false, brokenAt: i, reason: 'entry is not an object' };
    const { hash, prevHash, ...payload } = entry;
    if (prevHash !== prev) return { ok: false, brokenAt: i, reason: 'prevHash does not chain to the prior entry (reorder or deletion)' };
    if (hashPayload(prevHash, payload) !== hash) return { ok: false, brokenAt: i, reason: 'entry hash mismatch (content was altered)' };
    if (payload.seq !== expectedSeq) return { ok: false, brokenAt: i, reason: `seq out of order (expected ${expectedSeq}, got ${payload.seq})` };
    prev = hash;
    expectedSeq += 1;
  }
  return { ok: true, entries: lines.length, head: prev };
}

/**
 * Append-only writer. Keeps an in-memory chain head per workspace, seeded from the
 * file's last line so it is correct across restarts. `redact` is the central
 * redactor (applied to the payload before hashing — layer 2). Never throws out of
 * `append`: audit capture must not disrupt the session it observes.
 */
export class AuditTrail {
  constructor({ redact = (x) => x, logger = console } = {}) {
    this.redact = redact;
    this.logger = logger;
    this.heads = new Map(); // workspace -> { hash, seq }
  }

  headFor(workspace) {
    if (this.heads.has(workspace)) return this.heads.get(workspace);
    const head = this._loadHead(workspace);
    this.heads.set(workspace, head);
    return head;
  }

  _loadHead(workspace) {
    try {
      const lines = fs.readFileSync(trailPath(workspace), 'utf8').split('\n').map((l) => l.trim()).filter(Boolean);
      if (!lines.length) return { hash: GENESIS, seq: 0 };
      const last = JSON.parse(lines[lines.length - 1]);
      return { hash: last.hash, seq: last.seq };
    } catch {
      return { hash: GENESIS, seq: 0 };
    }
  }

  /**
   * Append one entry. `entry` carries a `type` (from AUDIT_ENTRY_TYPES) plus
   * semantic fields (summary, ref, outcome, …). seq/at/actor are stamped here.
   * Returns the stored line, or null on failure (logged, never thrown).
   */
  append(workspace, entry = {}) {
    try {
      const head = this.headFor(workspace);
      const seq = head.seq + 1;
      const payload = this.redact({
        seq,
        at: entry.at || new Date().toISOString(),
        actor: entry.actor || 'local', // per-user attribution deferred to #24
        ...stripReserved(entry),
      });
      const prevHash = head.hash;
      const hash = hashPayload(prevHash, payload);
      const line = { ...payload, prevHash, hash };
      const dir = path.join(workspace, TRAIL_DIR);
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      fs.appendFileSync(trailPath(workspace), `${JSON.stringify(line)}\n`, { mode: 0o600 });
      this.heads.set(workspace, { hash, seq });
      return line;
    } catch (err) {
      this.logger?.warn?.(`[audit-trail] append failed: ${err?.message || err}`);
      return null;
    }
  }

  /** Read the full trail text for export/verification (or '' when none). */
  read(workspace) {
    try { return fs.readFileSync(trailPath(workspace), 'utf8'); } catch { return ''; }
  }
}

// seq/at/actor/prevHash/hash are stamped/computed by the writer; a caller can't
// override them (that would let a caller forge chain fields).
function stripReserved(entry) {
  const { seq, at, actor, prevHash, hash, ...rest } = entry || {};
  return rest;
}
