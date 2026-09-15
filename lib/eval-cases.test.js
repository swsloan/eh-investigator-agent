// Run: node --test lib/eval-cases.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { firstUserPrompt, loadMergedCases } from './eval-cases.js';

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

test('the reproduction prompt comes from the session, not its title (#162)', () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'promptrec-'));
  // The real shape that broke: a 60-char model-written title that drops the
  // subnet and the date, beside the actual prompt that carries both.
  fs.writeFileSync(path.join(ws, '.session.json'), JSON.stringify({
    title: 'Investigate suspicious OT network activity on the water trea',
    transcript: [
      { type: 'message_end', message: { role: 'user', content: 'Investigate suspicious OT network activity on the water treatment network (10.42.x.x) during the afternoon of Aug 27th.' } },
      { type: 'message_end', message: { role: 'assistant', content: 'Starting.' } },
    ],
  }));
  const got = firstUserPrompt(ws);
  assert.match(got, /10\.42\.x\.x/, 'keeps the target subnet');
  assert.match(got, /Aug 27th/, 'keeps the date — without it the case investigates "now"');
  assert.doesNotMatch(got, /water trea$/, 'not the truncated title');
  fs.rmSync(ws, { recursive: true, force: true });
});

test('an unrecoverable prompt returns empty rather than something that looks filled in', () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'promptrec-none-'));
  assert.equal(firstUserPrompt(ws), '', 'no state file');
  fs.writeFileSync(path.join(ws, '.session.json'), 'not json');
  assert.equal(firstUserPrompt(ws), '', 'unreadable state');
  fs.writeFileSync(path.join(ws, '.session.json'), JSON.stringify({
    transcript: [{ type: 'message_end', message: { role: 'assistant', content: 'no user turn' } }],
  }));
  assert.equal(firstUserPrompt(ws), '', 'no user turn');
  // Content-block form, as the Claude backend records it.
  fs.writeFileSync(path.join(ws, '.session.json'), JSON.stringify({
    transcript: [{ message: { role: 'user', content: [{ type: 'text', text: 'blocks form' }] } }],
  }));
  assert.equal(firstUserPrompt(ws), 'blocks form');
  fs.rmSync(ws, { recursive: true, force: true });
});

test('a promoted case keeps its agent-sourced ATT&CK out of scoring until sign-off (#163)', () => {
  const f = fixture({
    promoted: [{
      id: 'promoted-ot', prompt: 'p', expected_source: 'agent', scoring: { attack: false },
      expected: { disposition: 'malicious', attack: ['T1', 'T2'], min_rung: 'records' },
    }],
  });
  let c = loadMergedCases(f.casesDir, f.overridesPath).find((x) => x.id === 'promoted-ot');
  assert.deepEqual(c.scoring, { attack: false }, 'unadjudicated: out of the ATT&CK aggregate');
  assert.equal(c.expected_source, 'agent');

  // Sign-off is the adjudication and lifts it — the analyst never sees the flag.
  fs.writeFileSync(f.overridesPath, JSON.stringify({
    'promoted-ot': { signed_off: true, scoring: {}, expected_source: 'analyst' },
  }));
  c = loadMergedCases(f.casesDir, f.overridesPath).find((x) => x.id === 'promoted-ot');
  assert.deepEqual(c.scoring, {}, 'adjudicated: scores like any other case');
  assert.equal(c.expected_source, 'analyst');
  assert.equal(c.signed_off, true);
  fs.rmSync(f.dir, { recursive: true, force: true });
});
