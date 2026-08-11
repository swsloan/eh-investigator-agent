// Detection tuning rules — READ ONLY.
//
// Why this is worth its own surface: `search_detections` silently excludes
// detections hidden by a tuning rule. Without a way to enumerate those rules,
// "no detections found" cannot be distinguished from "detections exist but are
// suppressed", so a negative finding is unfalsifiable — and a suppression added
// by mistake (or by an adversary who talked someone into it) degrades every later
// investigation invisibly.
//
// The excli/exmcp tool surface has no read path for these (0.0.111 has no tuning
// tools at all; 0.0.158 added create + preview only), so this goes over REST.
//
// Read-only by construction: the operations here map to GET requests, and nothing
// in this module can create, modify, or delete a rule. Writing a tuning rule is a
// governed action for the propose/approve path, not something to bolt on here.

import { extrahopGet } from './extrahop-rest.js';

/** REST collection for detection hiding (tuning) rules. */
export const HIDING_RULES_PATH = '/detections/rules/hiding';

export const TUNING_OPERATIONS = ['status', 'list', 'get'];

/**
 * Every active tuning rule, plus a count so a caller can state the scope of what
 * is being hidden without re-deriving it.
 *
 * Rules are returned verbatim. The field set belongs to the ExtraHop REST API and
 * differs by firmware, so this deliberately does not remap or summarise it —
 * inventing a schema here would be a second source of truth that silently rots.
 * Callers should inspect the keys of one rule before aggregating over all of them.
 */
export async function listTuningRules(deps = {}) {
  const body = await extrahopGet(HIDING_RULES_PATH, deps);
  const rules = Array.isArray(body) ? body : body?.rules;
  // Coercing an unrecognised shape to an empty list would assert "nothing is
  // suppressed" on data we did not understand — the same false negative as
  // reporting zero rules when the read failed. Fail loudly instead.
  if (!Array.isArray(rules)) {
    throw new Error('ExtraHop returned an unexpected tuning-rule list response; the payload had no rules array.');
  }
  return { count: rules.length, rules };
}

/** One tuning rule by id. */
export async function getTuningRule(id, deps = {}) {
  if (!Number.isInteger(id) && !/^\d+$/.test(String(id ?? ''))) {
    throw new Error('A tuning rule id must be an integer.');
  }
  return extrahopGet(`${HIDING_RULES_PATH}/${Number(id)}`, deps);
}

/**
 * Dispatch one read operation. `status` answers whether this is usable at all
 * without touching the network, so the agent can tell "not configured" apart from
 * "configured and there are no rules" — two very different findings.
 */
export async function executeTuningOperation(operation, payload = {}, deps = {}) {
  switch (operation) {
    case 'status': {
      try {
        const { resolveRestTarget } = await import('./extrahop-rest.js');
        const target = resolveRestTarget(deps.cfg, deps.secretStore);
        return { configured: true, host: target.host, auth: target.auth.mode, readOnly: true };
      } catch (err) {
        return { configured: false, reason: err.message, readOnly: true };
      }
    }
    case 'list':
      return listTuningRules(deps);
    case 'get':
      return getTuningRule(payload?.id, deps);
    default:
      throw new Error(`Unknown tuning operation "${operation}". Supported: ${TUNING_OPERATIONS.join(', ')}.`);
  }
}
