// Load + lightly validate labeled eval cases from a directory of JSON files.
import fs from 'node:fs';
import path from 'node:path';
import { DISPOSITIONS, RUNGS } from './score.js';

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
    cases.push(c);
  }
  cases.sort((a, b) => a.id.localeCompare(b.id));
  return cases;
}
