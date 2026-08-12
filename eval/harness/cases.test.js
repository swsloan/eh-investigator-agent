// Case loading and validation. Run: node --test eval/harness/cases.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadCases } from './cases.js';

const VALID = {
  id: 'c1',
  prompt: 'investigate something',
  expected: { disposition: 'benign', attack: [], min_rung: 'records' },
};

/** Write one case file to a temp dir and load it. */
function loadOne(patch) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eh-cases-'));
  fs.writeFileSync(path.join(dir, 'c1.json'), JSON.stringify({ ...VALID, ...patch }));
  try { return loadCases(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('a plain case loads', () => {
  const [c] = loadOne({});
  assert.equal(c.id, 'c1');
  assert.equal(c.scoring, undefined, 'scoring is optional; absent means everything is scored');
});

test('a ladder fixture loads with disposition scoring off', () => {
  const [c] = loadOne({ scoring: { disposition: false } });
  assert.equal(c.scoring.disposition, false);
  assert.equal(c.expected.disposition, 'benign', 'the label is kept as documentation');
});

test('a typo in a scoring key is rejected, not ignored', () => {
  // The failure this prevents: `dispositon` loads cleanly, verdict scoring stays
  // ON, and the run reports numbers the author thought they had turned off. A
  // silent change of what the suite measures is worse than a broken run.
  assert.throws(() => loadOne({ scoring: { dispositon: false } }), /unknown scoring key "dispositon"/);
  assert.throws(() => loadOne({ scoring: { disposition: false, ladder: false } }), /unknown scoring key "ladder"/);
});

test('a non-boolean or non-object scoring block is rejected', () => {
  assert.throws(() => loadOne({ scoring: { disposition: 'false' } }), /must be a boolean/);
  assert.throws(() => loadOne({ scoring: [] }), /must be an object/);
  assert.throws(() => loadOne({ scoring: null }), /must be an object/);
});

test('the existing required-field validation still holds', () => {
  assert.throws(() => loadOne({ id: undefined }), /missing id/);
  assert.throws(() => loadOne({ expected: { disposition: 'nope', min_rung: 'records' } }), /expected.disposition/);
  assert.throws(() => loadOne({ expected: { disposition: 'benign', min_rung: 'atoms' } }), /expected.min_rung/);
});

test('the shipped case files all load', () => {
  const cases = loadCases(path.resolve(import.meta.dirname, '../cases'));
  assert.ok(cases.length >= 5, `loaded ${cases.length}`);
  const fixture = cases.find((c) => c.id === 'plaintext-http-creds');
  assert.equal(fixture.scoring.disposition, false, 'the #128 fixture is configured as one');
});
