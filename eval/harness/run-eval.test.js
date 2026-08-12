// Result assembly for the eval harness. Run: node --test eval/harness/run-eval.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseFalseAlarmTarget, readResult } from './run-eval.js';

function caseDir(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eh-readresult-'));
  fs.mkdirSync(path.join(dir, 'c1'), { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, 'c1', name), JSON.stringify(body));
  }
  return dir;
}

const VERDICT = { disposition: 'malicious', confidence: 'high', highest_rung_used: 'records' };
const META = { cost_usd: 7.25, tokens: 1400, cache_read: 1280, delegated_tokens: 400, delegations: 1 };

test('meta.json is merged onto the verdict, so a live case carries its cost', () => {
  const dir = caseDir({ 'verdict.json': VERDICT, 'meta.json': META });
  const r = readResult(dir, 'c1');
  assert.equal(r.disposition, 'malicious');
  assert.equal(r.cost_usd, 7.25);
  assert.equal(r.delegated_tokens, 400);
  assert.equal(r.delegations, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a verdict without meta still scores — cost simply unknown', () => {
  const dir = caseDir({ 'verdict.json': VERDICT });
  const r = readResult(dir, 'c1');
  assert.equal(r.disposition, 'malicious');
  assert.equal(r.cost_usd, undefined);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a case that spent but concluded nothing keeps its cost', () => {
  // Scoring this as $0 would make the most wasteful outcome — an expensive
  // investigation that produced no verdict — the cheapest line in the report.
  const dir = caseDir({ 'meta.json': META });
  const r = readResult(dir, 'c1');
  assert.equal(r.disposition, 'inconclusive', 'a missing verdict IS inconclusive');
  assert.equal(r.cost_usd, 7.25, 'and it still cost what it cost');
  // The scorer indexes on these, so they must be present rather than undefined.
  assert.equal(r.highest_rung_used, 'metrics');
  assert.equal(r.detection_source, 'unknown');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a case with neither file is absent, not a zero-cost result', () => {
  const dir = caseDir({});
  assert.equal(readResult(dir, 'c1'), null);
  assert.equal(readResult(dir, 'never-ran'), null);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---- --false-alarm parsing (#144) ----

test('an absent flag keeps the scorer default, not a value', () => {
  // The trap: parsing the missing arg with Number() yields NaN, and NaN as a
  // target makes every comparison false — the gate would be silently off on
  // every ordinary run, which is worse than the bug it replaced.
  assert.equal(parseFalseAlarmTarget([]), undefined);
  assert.equal(parseFalseAlarmTarget(['--results', 'x', '--check']), undefined);
});

test('a valid rate or "off" is accepted', () => {
  assert.equal(parseFalseAlarmTarget(['--false-alarm', '0.25']), 0.25);
  assert.equal(parseFalseAlarmTarget(['--false-alarm', '0']), 0);
  assert.equal(parseFalseAlarmTarget(['--false-alarm', '1']), 1);
  assert.equal(parseFalseAlarmTarget(['--false-alarm', 'off']), null, 'off = measure, never gate');
  assert.equal(parseFalseAlarmTarget(['--false-alarm', ' 0.4 ']), 0.4, 'tolerates padding');
});

test('a malformed value fails the command instead of quietly retuning the gate', () => {
  // Each of these previously produced a working command with a different gate
  // than the operator asked for.
  for (const argv of [
    ['--false-alarm'],                 // bare: parsed as 0, the strictest gate
    ['--false-alarm', '--check'],      // swallows the next flag
    ['--false-alarm', 'abc'],          // NaN: gate silently off
    ['--false-alarm', '5'],            // unreachable rate: gate silently off
    ['--false-alarm', '-1'],           // every run fails
    ['--false-alarm', 'Infinity'],
    ['--false-alarm', ''],
  ]) {
    assert.throws(() => parseFalseAlarmTarget(argv), /between 0 and 1|off/, argv.join(' '));
  }
});
