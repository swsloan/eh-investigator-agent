// Merge analyst label overrides over the baked ground-truth cases. Baked cases
// (eval/cases/*.json) ship in the image; edits/sign-offs are persisted as an
// overrides file in the eval data dir, so they survive restarts and never touch
// the image. Humans adjudicate here; the harness only ever reads the result.
import fs from 'node:fs';
import path from 'node:path';
import { loadCases } from '../eval/harness/cases.js';

export function readOverrides(overridesPath) {
  try { return JSON.parse(fs.readFileSync(overridesPath, 'utf8')); } catch { return {}; }
}

// User-promoted cases live in the eval data dir (writable volume), NOT the baked
// eval/cases/ dir — so promoting a finished investigation into a case needs no
// image rebuild and survives restarts. Stored as a sibling of the overrides file.
function promotedStorePath(overridesPath) {
  return path.join(path.dirname(overridesPath), 'promoted-cases.json');
}

export function readPromoted(overridesPath) {
  try {
    const arr = JSON.parse(fs.readFileSync(promotedStorePath(overridesPath), 'utf8'));
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

/** Add (or replace by id) a promoted case in the persisted store. */
export function promoteCase(overridesPath, caseObj) {
  const all = readPromoted(overridesPath);
  const i = all.findIndex((c) => c.id === caseObj.id);
  if (i >= 0) all[i] = caseObj; else all.push(caseObj);
  const p = promotedStorePath(overridesPath);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(all, null, 2));
  return caseObj;
}

export function writeOverride(overridesPath, id, patch, who = 'analyst') {
  const all = readOverrides(overridesPath);
  const prev = all[id] || {};
  const next = { ...prev, ...patch, updated_at: new Date().toISOString() };
  if (patch.signed_off) { next.signed_by = who; next.signed_at = next.updated_at; }
  if (patch.signed_off === false) { delete next.signed_by; delete next.signed_at; }
  all[id] = next;
  fs.mkdirSync(path.dirname(overridesPath), { recursive: true });
  fs.writeFileSync(overridesPath, JSON.stringify(all, null, 2));
  return all[id];
}

/**
 * Ground-truth cases (baked eval/cases/ + user-promoted) with overrides merged
 * in; each carries signed_off + provenance. Baked cases win on id collision.
 */
export function loadMergedCases(casesDir, overridesPath) {
  const overrides = readOverrides(overridesPath);
  const baked = loadCases(casesDir);
  const bakedIds = new Set(baked.map((c) => c.id));
  const promoted = readPromoted(overridesPath)
    .filter((c) => c && c.id && !bakedIds.has(c.id))
    .map((c) => ({ ...c, promoted: true }));
  return [...baked, ...promoted].map((c) => {
    const o = overrides[c.id] || {};
    return {
      ...c,
      expected: { ...c.expected, ...(o.expected || {}) },
      notes: o.notes ?? c.notes,
      signed_off: !!o.signed_off,
      signed_by: o.signed_by || null,
      signed_at: o.signed_at || null,
      edited: Boolean(o.expected || o.notes),
      promoted: !!c.promoted,
      promoted_from: c.promoted_from || null,
    };
  });
}
