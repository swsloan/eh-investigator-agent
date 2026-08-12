#!/usr/bin/env node
// Eval harness CLI: turn labeled cases + agent results into the dashboard data
// contract (history.jsonl + <run_id>.json).
//
// Two modes:
//   Offline (default, fully reproducible): read per-case verdicts already on disk
//     node eval/harness/run-eval.js --results <dir> --run-id <id> --skill-version <v>
//   Live: drive a running app instance to produce those verdicts first (see runner.js)
//     node eval/harness/run-eval.js --live --url http://127.0.0.1:3100 --run-id <id>
//
// <results-dir>/<caseId>/verdict.json   the agent's evidence/verdict.json
// <results-dir>/<caseId>/meta.json      optional { cost_usd, tokens, grounded }
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCases } from './cases.js';
import { scoreRun } from './score.js';
import { loadPrevDetails } from './history.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f, d) => { const i = args.indexOf(f); return i >= 0 && args[i + 1] ? args[i + 1] : d; };

const CASES_DIR = path.resolve(val('--cases', path.join(ROOT, 'eval/cases')));
const REPORTS_DIR = path.resolve(val('--reports', path.join(ROOT, 'eval/reports')));
const GATE = Number(val('--gate', '0.05'));
/**
 * `--false-alarm <rate 0..1>` | `--false-alarm off` | absent (#144).
 *
 * Returns `undefined` to keep the scorer's default, `null` to measure without
 * gating, or the rate. Throws on anything else, because every malformed value
 * silently changes the gate rather than failing: a bare `--false-alarm` parses
 * as `0` (the strictest possible gate), and `abc` or `5` parse to values the
 * rate can never exceed (the gate quietly does nothing). A CI gate that turned
 * itself off because of a typo is the failure mode worth refusing outright.
 */
export function parseFalseAlarmTarget(argv) {
  const i = argv.indexOf('--false-alarm');
  if (i < 0) return undefined;
  const raw = String(argv[i + 1] ?? '').trim();
  if (raw === 'off') return null;
  const n = Number(raw);
  if (!raw || raw.startsWith('--') || !Number.isFinite(n) || n < 0 || n > 1) {
    throw new Error('--false-alarm takes a rate between 0 and 1, or "off".');
  }
  return n;
}
const meta = {
  run_id: val('--run-id', `run-${(process.env.EVAL_STAMP || 'unstamped')}`),
  timestamp: process.env.EVAL_STAMP || 'unstamped',
  git_sha: val('--git-sha', ''),
  skill_version: val('--skill-version', 'evidence-ladder'),
  label: val('--label', ''),
  backend: val('--backend', 'claude'),
  model: val('--model', ''),
};

export function readResult(resultsDir, id) {
  const vf = path.join(resultsDir, id, 'verdict.json');
  const mf = path.join(resultsDir, id, 'meta.json');
  const meta = fs.existsSync(mf) ? JSON.parse(fs.readFileSync(mf, 'utf8')) : null;
  if (!fs.existsSync(vf)) {
    // No verdict, but the case still ran and still spent. Scoring it as $0
    // would make the most wasteful outcome — an expensive investigation that
    // concluded nothing — the cheapest line in the report. Score it
    // inconclusive (which is what a missing verdict means) with its real cost.
    return meta ? { disposition: 'inconclusive', highest_rung_used: 'metrics', detection_source: 'unknown', ...meta } : null;
  }
  const v = JSON.parse(fs.readFileSync(vf, 'utf8'));
  if (meta) Object.assign(v, meta);
  return v;
}

async function main() {
  // Parsed here rather than at module scope so an invalid value fails the
  // command through main()'s handler instead of exiting on import.
  const falseAlarmTarget = parseFalseAlarmTarget(args);
  const cases = loadCases(CASES_DIR);
  let resultsDir = val('--results', '');

  if (has('--live')) {
    const { runCases } = await import('./runner.js');
    resultsDir = path.join(REPORTS_DIR, `${meta.run_id}-results`);
    await runCases({
      appUrl: val('--url', 'http://127.0.0.1:3100'),
      cases,
      backend: meta.backend,
      outDir: resultsDir,
      timeoutMs: Number(process.env.EVAL_CASE_TIMEOUT_MS || 600_000),
    });
  }
  if (!resultsDir) {
    console.error('Provide --results <dir> (offline) or --live --url <app> (drive the app).');
    process.exit(2);
  }

  const results = {};
  const missing = [];
  for (const c of cases) {
    const r = readResult(resultsDir, c.id);
    if (r) results[c.id] = r;
    // Keyed off the verdict file, not off `r`: a case can now yield a result
    // (its cost) while still having produced no verdict, and that is exactly
    // the case the warning exists to name.
    if (!fs.existsSync(path.join(resultsDir, c.id, 'verdict.json'))) missing.push(c.id);
  }
  if (missing.length) console.warn(`WARN: no verdict for ${missing.length} case(s): ${missing.join(', ')} (scored inconclusive)`);

  const { record, detail } = scoreRun({
    cases, results, meta, gateTarget: GATE,
    // #127: a window of prior runs, so one sample cannot assert a regression.
    prevDetails: loadPrevDetails(REPORTS_DIR, meta.backend),
    // undefined = keep the scorer's default; null = measure but never gate.
    ...(falseAlarmTarget === undefined ? {} : { falseAlarmTarget }),
  });

  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  fs.writeFileSync(path.join(REPORTS_DIR, `${meta.run_id}.json`), JSON.stringify(detail, null, 2));
  fs.appendFileSync(path.join(REPORTS_DIR, 'history.jsonl'), JSON.stringify(record) + '\n');

  const a = record.aggregates;
  console.log(`Run ${meta.run_id} (${meta.backend}): ${cases.length} cases`);
  console.log(`  accuracy=${a.verdict_accuracy}  false_close=${a.false_close_rate}  false_alarm=${a.false_alarm_rate}  adherence=${a.ladder_adherence}  cost/case=$${a.cost_per_case_usd}`);
  console.log(`  gate: ${record.gate.pass ? 'PASS' : 'FAIL'}${record.gate.reasons.length ? ' — ' + record.gate.reasons.join('; ') : ''}`);
  console.log(`  wrote ${path.relative(process.cwd(), path.join(REPORTS_DIR, meta.run_id + '.json'))} and appended history.jsonl`);

  if (has('--check') && !record.gate.pass) process.exit(1);
}
// Run only when invoked as the CLI, so the module's helpers can be unit-tested
// without the import itself scoring a run and calling process.exit.
const invokedDirectly = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) main().catch((e) => { console.error(e.message || e); process.exit(2); });
