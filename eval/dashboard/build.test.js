// Dashboard rendering of a metric that older runs never recorded (#144).
// Run: node --test eval/dashboard/build.test.js
//
// The trap this guards: `false_alarm_rate ?? 0` renders "0.0%" for a run that
// never measured it, which reads as "this run had no false alarms" — a clean
// bill of health the data does not support. Absent and zero are different
// claims and the dashboard has to keep them apart.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildDashboard } from './build.js';

const GATE = { pass: true, false_close_target: 0.05, false_alarm_target: 0.25, reasons: [] };

// The gate is cloned, not shared: a test that strips a field to simulate a
// legacy record must not strip it from every later test's fixture too.
function run(id, aggregates, gate = GATE) {
  return {
    run_id: id,
    timestamp: `2026-08-${id.slice(-2)}T00:00:00Z`,
    backend: 'claude',
    skill_version: 'test',
    case_count: 2,
    aggregates: {
      false_close_rate: 0, verdict_accuracy: 1, ladder_adherence: 1, attack_accuracy: 1,
      groundedness: 1, framing_present: 1, citation_coverage: 1,
      cost_per_case_usd: 1, tokens_per_case: 100,
      confusion: {}, calibration: [], adherence: {},
      ...aggregates,
    },
    gate: { ...gate },
  };
}

/** Write a data dir the builder can read: history.jsonl + per-run detail. */
function dataDir(runs) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eh-dash-'));
  fs.writeFileSync(path.join(dir, 'history.jsonl'), runs.map((r) => JSON.stringify(r)).join('\n') + '\n');
  for (const r of runs) {
    fs.writeFileSync(path.join(dir, `${r.run_id}.json`), JSON.stringify({
      run_id: r.run_id,
      cases: [{
        id: 'c1', detection_source: 'behavioral',
        expected: { disposition: 'benign', attack: [], min_rung: 'metrics' },
        predicted: { disposition: 'benign', confidence: 'high', highest_rung_used: 'metrics', attack: [] },
        scores: { verdict_correct: true, cost_usd: 1, false_climb: false, false_alarm: false },
        status: 'pass',
      }],
    }));
  }
  return dir;
}

function build(runs) {
  const dir = dataDir(runs);
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'eh-dash-out-'));
  buildDashboard({ dataDir: dir, outDir: out });
  const html = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(out, { recursive: true, force: true });
  return html;
}

test('a run that never measured false alarms says so, rather than claiming zero', () => {
  const legacy = run('eval-01', {});
  delete legacy.aggregates.false_alarm_rate;
  delete legacy.gate.false_alarm_target;
  const html = build([legacy]);
  assert.match(html, /False-alarm rate/);
  assert.match(html, /not measured on this run/);
  assert.ok(!/False-alarm rate<\/div>\s*<div class="val">0\.0%/.test(html), 'never renders an unmeasured run as 0.0%');
});

test('a run that measured zero false alarms reports zero', () => {
  const html = build([run('eval-02', { false_alarm_rate: 0 })]);
  assert.match(html, /False-alarm rate/);
  assert.ok(!/not measured/.test(html), 'a real zero is a result, not a gap');
  assert.match(html, /target &lt; 25%/, 'and shows the target it was judged against');
});

test('a measured false-alarm rate is shown to one decimal', () => {
  const html = build([run('eval-03', { false_alarm_rate: 0.25 })]);
  assert.match(html, /25\.0%/);
});

test('no NaN reaches the page when a metric appears mid-history', () => {
  // The realistic shape: older runs without the field, newer ones with it, so
  // every prev/cur comparison spans the boundary.
  const legacy = run('eval-04', {});
  delete legacy.aggregates.false_alarm_rate;
  const html = build([legacy, run('eval-05', { false_alarm_rate: 0.2 })]);
  assert.ok(!/NaN/.test(html), 'a missing comparand renders nothing, not NaN');
  assert.ok(!/undefined/.test(html));
});

// ---- Regressed vs unstable (#127) ----

/** A detail whose single case carries the scorer's stability verdict. */
function detailWith(runId, status, extra = {}) {
  return {
    run_id: runId,
    cases: [{
      id: 'flaky', detection_source: 'behavioral',
      expected: { disposition: 'benign', attack: [], min_rung: 'metrics' },
      predicted: { disposition: status === 'pass' ? 'benign' : 'malicious', confidence: 'high', highest_rung_used: 'metrics', attack: [] },
      scores: { verdict_correct: status === 'pass', cost_usd: 1, false_climb: false, false_alarm: status !== 'pass' },
      status,
      ...extra,
    }],
  };
}

function buildWith(runs, details) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eh-dash-'));
  fs.writeFileSync(path.join(dir, 'history.jsonl'), runs.map((r) => JSON.stringify(r)).join('\n') + '\n');
  for (const d of details) fs.writeFileSync(path.join(dir, `${d.run_id}.json`), JSON.stringify(d));
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'eh-dash-out-'));
  buildDashboard({ dataDir: dir, outDir: out });
  const files = Object.fromEntries(fs.readdirSync(out).map((f) => [f, fs.readFileSync(path.join(out, f), 'utf8')]));
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(out, { recursive: true, force: true });
  return files;
}

test('an unstable case is labelled unstable, not called a regression', () => {
  const runs = [run('eval-10', {}), run('eval-11', { verdict_accuracy: 0 })];
  const files = buildWith(runs, [
    detailWith('eval-10', 'pass'),
    detailWith('eval-11', 'fail', { unstable: true, prior_statuses: ['pass', 'fail'] }),
  ]);
  const page = files['eval-11.html'];
  assert.match(page, /unstable/, 'the row says the case flips');
  assert.ok(!/>regression</.test(page), 'and never calls this a regression');
  const diff = Object.entries(files).find(([f]) => f.startsWith('diff-'))?.[1] || '';
  assert.match(diff, /0 regression\(s\)/, 'the diff does not count it either');
  assert.match(diff, /1 unstable flip\(s\)/, 'but does report it was set aside');
});

test('a confirmed regression is still called one', () => {
  const runs = [run('eval-12', {}), run('eval-13', { verdict_accuracy: 0 })];
  const files = buildWith(runs, [
    detailWith('eval-12', 'pass'),
    detailWith('eval-13', 'fail', { regressed_from: 'eval-12', prior_statuses: ['pass', 'pass'] }),
  ]);
  assert.match(files['eval-13.html'], />regression</, 'a real change keeps the strong signal');
  const diff = Object.entries(files).find(([f]) => f.startsWith('diff-'))?.[1] || '';
  assert.match(diff, /1 regression\(s\)/);
});

test('a PASS that skipped the relative accuracy check says so', () => {
  // Silence would imply the run survived a check it never faced.
  const skipped = run('eval-20', {}, { ...GATE, accuracy_drop_limit: 0.15, accuracy_vs_prev: { not_checked: 'no previous run' } });
  const html = buildWith([skipped], [detailWith('eval-20', 'pass')])['eval-20.html'];
  assert.match(html, /vs-prev check skipped: no previous run/);
});

test('a run that survived the relative check does not carry the caveat', () => {
  const checked = run('eval-21', {}, { ...GATE, accuracy_drop_limit: 0.15, accuracy_vs_prev: { drop: 0, prev: 1, cur: 1, comparable: 6, regressed: 0 } });
  const html = buildWith([checked], [detailWith('eval-21', 'pass')])['eval-21.html'];
  assert.ok(!/check skipped/.test(html));
});

test('an unscored prediction is not painted as an error', () => {
  // The pill says "verdict not scored"; colouring the prediction red beside it
  // asserts a mistake nobody claimed. `!undefined` made that the default.
  const r = run('eval-30', {});
  const d = detailWith('eval-30', 'unscored');
  d.cases[0].scores = { cost_usd: 1, false_climb: true, disposition_scored: false };
  const html = buildWith([r], [d])['eval-30.html'];
  assert.match(html, /verdict not scored/);
  assert.ok(!/<td style="color:var\(--bad\)">/.test(html), 'the prediction cell is not styled as wrong');
});
