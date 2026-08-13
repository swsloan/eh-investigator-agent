// Load + lightly validate labeled eval cases from a directory of JSON files.
import fs from 'node:fs';
import path from 'node:path';
import { DISPOSITIONS, RUNGS } from './score.js';

// Keys allowed inside a case's `scoring` block, mirroring the strict
// `additionalProperties: false` contract in cases.schema.json. Kept here as
// well because the loader, not the schema, is what actually runs.
const SCORING_KEYS = ['disposition'];

export function loadCases(dir) {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json') && !f.includes('schema'));
  const cases = [];
  for (const f of files) {
    const c = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    const where = path.join(dir, f);
    if (!c.id) throw new Error(`${where}: missing id`);
    if (!c.expected || !DISPOSITIONS.includes(c.expected.disposition)) {
      throw new Error(`${where}: expected.disposition must be one of ${DISPOSITIONS.join('|')}`);
    }
    if (!RUNGS.includes(c.expected.min_rung)) {
      throw new Error(`${where}: expected.min_rung must be one of ${RUNGS.join('|')}`);
    }
    // A case still needs a labelled disposition even when it is not scored on
    // one (#128): the label documents the right answer, and scoring can be
    // switched back on without re-deriving it.
    if (c.scoring !== undefined && (typeof c.scoring !== 'object' || c.scoring === null || Array.isArray(c.scoring))) {
      throw new Error(`${where}: "scoring" must be an object`);
    }
    // Reject unknown keys rather than ignoring them. `{ "dispositon": false }`
    // would otherwise load cleanly and leave verdict scoring ON — a typo that
    // silently changes what the suite measures is the worst kind, because the
    // run still succeeds and reports numbers nobody asked for.
    for (const key of Object.keys(c.scoring || {})) {
      if (!SCORING_KEYS.includes(key)) {
        throw new Error(`${where}: unknown scoring key "${key}" (expected one of ${SCORING_KEYS.join('|')})`);
      }
    }
    if (c.scoring?.disposition !== undefined && typeof c.scoring.disposition !== 'boolean') {
      throw new Error(`${where}: scoring.disposition must be a boolean`);
    }
    cases.push(c);
  }
  cases.sort((a, b) => a.id.localeCompare(b.id));
  return cases;
}
