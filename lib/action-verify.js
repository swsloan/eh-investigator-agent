// Post-write read-back verification for governed writes (Phase 3, issue #23).
//
// A green "executed" only means the appliance ACCEPTED the write — not that the
// desired state now holds. docs/NOTES-write-path-validation.md documents the
// concrete trap: `update_detection` setting `ticket_id` returns HTTP 200 yet the
// value never persists when ticket tracking is unconfigured (accepted ≠
// persisted). This module formalizes the manual read-back the agent used to do by
// hand: for a write capability, it names a read-only capability to observe the
// target, derives the explicit desired after-state from the write params, and
// compares the two so the UI can distinguish `verified` from `verification_failed`.
//
// Everything here is PURE. The excli I/O (running the read probes) lives in the
// broker; this module only maps capabilities to probes and classifies the
// observations, so it is unit-testable without a live appliance.

/** Unwrap an excli read result into the underlying record object. Tolerant of
 * `{detection:{…}}` / `{data:{…}}` wrappers, a bare object, or a single-element
 * array — excli tools vary, and we never want a shape surprise to read as a
 * mismatch. Returns null when nothing object-shaped is present. */
export function unwrapRecord(raw) {
  let v = raw;
  if (Array.isArray(v)) v = v.length === 1 ? v[0] : (v.length ? v : null);
  if (!v || typeof v !== 'object') return null;
  for (const key of ['detection', 'data', 'result', 'record']) {
    if (v[key] && typeof v[key] === 'object' && !Array.isArray(v[key])) return v[key];
  }
  return v;
}

/** Extract the set of tag names from a `list_devicetags_for_device` result,
 * tolerant of `[{name}]`, `[{tag}]`, `["name"]`, or a `{tags:[…]}` wrapper. */
export function tagNames(raw) {
  let list = raw;
  if (list && !Array.isArray(list) && typeof list === 'object') {
    list = list.tags || list.data || list.result || [];
  }
  if (!Array.isArray(list)) return [];
  const names = [];
  for (const t of list) {
    if (typeof t === 'string') names.push(t);
    else if (t && typeof t === 'object') {
      const n = t.name ?? t.tag ?? t.tag_name;
      if (typeof n === 'string') names.push(n);
    }
  }
  return names;
}

/** Loose scalar match for a desired vs. observed field. Treats null/undefined/''
 * as the same "empty" (unsetting a field), and compares everything else by
 * string form so `123` (number) and `"123"` (string) agree — appliances are
 * inconsistent about numeric vs. string echoes. */
export function matchesValue(desired, observed) {
  const empty = (x) => x === null || x === undefined || x === '';
  if (empty(desired)) return empty(observed);
  if (empty(observed)) return false;
  return String(desired) === String(observed);
}

// A "subject" is a stable string key identifying one probe target within an
// action (a detection, or one device in a multi-device tag write), so before-
// and after-observations line up and multi-target writes verify every target.

// --- Verifier registry ---------------------------------------------------------
// Each entry maps a write capability to:
//   probes(params)  -> [{ capability, params, subject }]  read-only observations
//   desired(params) -> a plain object describing the intended after-state (stored
//                      on the action record and shown in the UI)
//   check(params, observationsBySubject) -> { ok, mismatches:[{subject,field,desired,observed}] }
// `observationsBySubject` maps subject -> the unwrapped record (or null if the
// read failed / target missing). A capability absent from the registry is
// "unsupported": the write still executes and terminates as `executed`, exactly
// as before Phase 3 (backward compatible).

const DETECTION_FIELDS = ['status', 'assignee', 'resolution', 'ticket_id', 'ai_disposition'];

const VERIFIERS = {
  update_detection: {
    probes(params) {
      return [{ capability: 'get_detection', params: { id: params.id }, subject: 'detection' }];
    },
    desired(params) {
      const out = {};
      for (const f of DETECTION_FIELDS) if (f in params) out[f] = params[f];
      return out;
    },
    check(params, obs) {
      const record = unwrapRecord(obs.detection);
      const mismatches = [];
      if (!record) {
        return { ok: false, mismatches: [{ subject: 'detection', field: '*', desired: 'detection readable', observed: 'not found' }] };
      }
      for (const f of DETECTION_FIELDS) {
        if (!(f in params)) continue;
        if (!matchesValue(params[f], record[f])) {
          mismatches.push({ subject: 'detection', field: f, desired: params[f], observed: record[f] ?? null });
        }
      }
      return { ok: mismatches.length === 0, mismatches };
    },
  },

  assign_devicetag_to_devices: devicetagVerifier(true),
  unassign_devicetag_from_devices: devicetagVerifier(false),
};

/** Build the assign/unassign verifier: after the write, the tag must be present
 * (assign) or absent (unassign) on every target device. Reversible and reads back
 * via `list_devicetags_for_device`, one probe per device. */
function devicetagVerifier(shouldBePresent) {
  return {
    probes(params) {
      return deviceIds(params).map((id) => ({
        capability: 'list_devicetags_for_device',
        params: { id },
        subject: `device:${id}`,
      }));
    },
    desired(params) {
      return { tag: params.tag, present: shouldBePresent, deviceIds: deviceIds(params) };
    },
    check(params, obs) {
      const tag = params.tag;
      const mismatches = [];
      for (const id of deviceIds(params)) {
        const subject = `device:${id}`;
        const record = obs[subject];
        if (record === undefined) continue; // no observation captured for this device
        const present = tagNames(record).includes(tag);
        if (present !== shouldBePresent) {
          mismatches.push({
            subject,
            field: 'tag',
            desired: shouldBePresent ? `"${tag}" present` : `"${tag}" absent`,
            observed: present ? `"${tag}" present` : `"${tag}" absent`,
          });
        }
      }
      return { ok: mismatches.length === 0, mismatches };
    },
  };
}

/** Normalize the `device_ids` write param (array, CSV string, or single value)
 * into an array of ids. */
function deviceIds(params) {
  const raw = params?.device_ids;
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') return raw.split(',').map((s) => s.trim()).filter(Boolean);
  if (raw !== undefined && raw !== null) return [raw];
  return [];
}

/** The verifier descriptor for a capability, or null when none is registered
 * (unsupported → write executes and terminates as `executed`). */
export function verifierFor(capabilityId) {
  return VERIFIERS[String(capabilityId || '').trim().toLowerCase()] || null;
}

/** True when we know how to read back and confirm this capability's effect. */
export function isVerifiable(capabilityId) {
  return verifierFor(capabilityId) !== null;
}

/**
 * Classify a completed read-back. Pure. `observationsBySubject` maps each probe
 * subject to its unwrapped record (or null when the read failed / target gone).
 * Returns:
 *   { status: 'verified' | 'verification_failed' | 'unsupported',
 *     mismatches, desired, detail }
 * `unsupported` means no verifier — the caller keeps the pre-Phase-3 `executed`.
 */
export function classifyVerification(capabilityId, params, observationsBySubject = {}) {
  const verifier = verifierFor(capabilityId);
  if (!verifier) return { status: 'unsupported', mismatches: [], desired: null, detail: 'No read-back verifier for this capability.' };
  const desired = verifier.desired(params || {});
  const { ok, mismatches } = verifier.check(params || {}, observationsBySubject);
  if (ok) return { status: 'verified', mismatches: [], desired, detail: 'Desired state observed in read-back.' };
  return { status: 'verification_failed', mismatches, desired, detail: summarizeMismatches(mismatches) };
}

/** One-line human summary of what didn't match, for the audit record + UI. */
export function summarizeMismatches(mismatches = []) {
  if (!mismatches.length) return 'Read-back did not confirm the desired state.';
  return mismatches
    .map((m) => {
      const where = m.subject && m.subject !== 'detection' ? `${m.subject} ` : '';
      return `${where}${m.field}: wanted ${fmt(m.desired)}, observed ${fmt(m.observed)}`;
    })
    .join('; ');
}

function fmt(v) {
  if (v === null || v === undefined) return 'none';
  if (typeof v === 'string') return v;
  return JSON.stringify(v);
}

// --- Async orchestration (thin I/O over the pure core) -------------------------
// These take an injected `observe(probes) -> { subject: { ok, record, error } }`
// (the broker's read-back runner) so they stay testable with a mock. They keep
// the excli I/O in the broker and the classification pure, and are shared by the
// decide route (before-capture + read-back) and crash recovery (read-back only).

/** The explicit desired after-state derived from a write's params, or null when
 * the capability is unsupported. Stored on the action record + shown in the UI. */
export function desiredStateFor(capabilityId, params) {
  const verifier = verifierFor(capabilityId);
  return verifier ? verifier.desired(params || {}) : null;
}

/**
 * Observe the target(s) of a write and return `{ subject: record|null }` (raw
 * excli JSON per probe; null when that probe's read failed or returned nothing).
 * Returns null when the capability has no verifier (unsupported). Used for both
 * the before-execution snapshot and the post-execution read-back.
 */
export async function readbackState(capabilityId, params, observe) {
  const verifier = verifierFor(capabilityId);
  if (!verifier) return null;
  const probes = verifier.probes(params || {});
  const results = (await observe(probes)) || {};
  const bySubject = {};
  for (const p of probes) {
    const r = results[p.subject];
    bySubject[p.subject] = r && r.ok ? (r.record ?? null) : null;
  }
  return bySubject;
}

/**
 * Read back a completed write and classify it. Returns the action-store patch the
 * caller persists: `{ actionStatus: 'verified'|'verification_failed', afterState,
 * verification }`. Shared by the decide route (post-execute) and crash recovery
 * (resolving an interrupted `executing`/`verifying`). Never throws — a read-back
 * that cannot run resolves to `verification_failed` (we never claim `verified`
 * without observing the desired state).
 */
export async function verifyWrite(capabilityId, params, observe) {
  let afterState = null;
  let readError = '';
  try {
    afterState = await readbackState(capabilityId, params, observe);
  } catch (err) {
    readError = err?.message || 'read-back failed';
    afterState = null;
  }
  const v = classifyVerification(capabilityId, params, afterState || {});
  const verified = v.status === 'verified';
  const detail = readError ? `read-back could not run: ${readError}` : v.detail;
  return {
    actionStatus: verified ? 'verified' : 'verification_failed',
    afterState,
    verification: {
      status: verified ? 'verified' : 'failed',
      checkedAt: new Date().toISOString(),
      detail,
      mismatches: v.mismatches,
    },
  };
}

/**
 * Precondition revalidation immediately before execution: for a verifiable write,
 * every target must be readable in the before-snapshot. An unreadable target
 * means it was deleted, is inaccessible, or the appliance is unreachable — in any
 * case we refuse to execute a write proposed against state we can no longer
 * confirm (target drift). Returns { ok, detail }.
 */
export function preconditionOk(capabilityId, beforeBySubject) {
  if (!verifierFor(capabilityId) || !beforeBySubject) return { ok: true, detail: '' };
  const missing = Object.entries(beforeBySubject).filter(([, rec]) => rec === null).map(([s]) => s);
  if (missing.length) {
    return { ok: false, detail: `target not confirmable before execution (${missing.join(', ')}) — it may have been deleted or the appliance was unreachable` };
  }
  return { ok: true, detail: '' };
}
