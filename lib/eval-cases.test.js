// Run: node --test lib/eval-cases.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadMergedCases } from './eval-cases.js';

/** A throwaway cases dir + data dir, torn down by the caller. */
function fixture({ baked = [], promoted = [], overrides = {} }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evalcases-'));
  const casesDir = path.join(dir, 'cases');
  fs.mkdirSync(casesDir);
  for (const c of baked) fs.writeFileSync(path.join(casesDir, `${c.id}.json`), JSON.stringify(c));
  const overridesPath = path.join(dir, 'label-overrides.json');
  fs.writeFileSync(path.join(dir, 'promoted-cases.json'), JSON.stringify(promoted));
  fs.writeFileSync(overridesPath, JSON.stringify(overrides));
  return { dir, casesDir, overridesPath };
}

test('an override can take a case out of a measure without an image rebuild', () => {
  // A promoted case lives in the writable volume and has no baked file, so an
  // override is the ONLY way to reach it. Before `scoring` was merged here,
  // excluding one from a measure needed a rebuild while retitling it did not.
  const f = fixture({
    baked: [{ id: 'baked', prompt: 'p', expected: { disposition: 'malicious', attack: ['T1'], min_rung: 'records' } }],
    promoted: [{ id: 'promoted', prompt: 'p', expected: { disposition: 'malicious', attack: ['T1', 'T2'], min_rung: 'packets' } }],
    overrides: { promoted: { scoring: { attack: false }, notes: 'labels are the agent’s own output' } },
  });
  const merged = loadMergedCases(f.casesDir, f.overridesPath);
  const promoted = merged.find((c) => c.id === 'promoted');
  assert.deepEqual(promoted.scoring, { attack: false });
  assert.equal(promoted.edited, true, 'a scoring-only override still counts as edited');
  assert.equal(merged.find((c) => c.id === 'baked').scoring, undefined, 'untouched cases keep theirs');
  fs.rmSync(f.dir, { recursive: true, force: true });
});

test('a baked scoring rule survives when no override touches it', () => {
  // plaintext-http-creds carries scoring.disposition=false in its baked file
  // (#128). Merging must not drop it just because the case has other overrides.
  const f = fixture({
    baked: [{
      id: 'fixture', prompt: 'p', scoring: { disposition: false },
      expected: { disposition: 'benign', attack: [], min_rung: 'records' },
    }],
    overrides: { fixture: { notes: 'retitled only' } },
  });
  const merged = loadMergedCases(f.casesDir, f.overridesPath);
  assert.deepEqual(merged[0].scoring, { disposition: false });
  assert.equal(merged[0].notes, 'retitled only');
  fs.rmSync(f.dir, { recursive: true, force: true });
});
