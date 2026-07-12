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

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f, d) => { const i = args.indexOf(f); return i >= 0 && args[i + 1] ? args[i + 1] : d; };

const CASES_DIR = path.resolve(val('--cases', path.join(ROOT, 'eval/cases')));
const REPORTS_DIR = path.resolve(val('--reports', path.join(ROOT, 'eval/reports')));
const GATE = Number(val('--gate', '0.05'));
const meta = {
  run_id: val('--run-id', `run-${(process.env.EVAL_STAMP || 'unstamped')}`),
  timestamp: process.env.EVAL_STAMP || 'unstamped',
  git_sha: val('--git-sha', ''),
  skill_version: val('--skill-version', 'evidence-ladder'),
  label: val('--label', ''),
  backend: val('--backend', 'claude'),
  model: val('--model', ''),
};

function readResult(resultsDir, id) {
  const vf = path.join(resultsDir, id, 'verdict.json');
  if (!fs.existsSync(vf)) return null;
  const v = JSON.parse(fs.readFileSync(vf, 'utf8'));
  const mf = path.join(resultsDir, id, 'meta.json');
  if (fs.existsSync(mf)) Object.assign(v, JSON.parse(fs.readFileSync(mf, 'utf8')));
  return v;
}

// Previous same-backend run detail, for regression flags.
function loadPrevDetail(backend) {
  const hf = path.join(REPORTS_DIR, 'history.jsonl');
  if (!fs.existsSync(hf)) return null;
  const recs = fs.readFileSync(hf, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
    .filter((r) => r.backend === backend)
    .sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
  for (let i = recs.length - 1; i >= 0; i--) {
    const df = path.join(REPORTS_DIR, `${recs[i].run_id}.json`);
    if (fs.existsSync(df)) return JSON.parse(fs.readFileSync(df, 'utf8'));
  }
  return null;
}

async function main() {
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
    if (r) results[c.id] = r; else missing.push(c.id);
  }
  if (missing.length) console.warn(`WARN: no verdict for ${missing.length} case(s): ${missing.join(', ')} (scored inconclusive)`);

  const { record, detail } = scoreRun({ cases, results, meta, prevDetail: loadPrevDetail(meta.backend), gateTarget: GATE });

  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  fs.writeFileSync(path.join(REPORTS_DIR, `${meta.run_id}.json`), JSON.stringify(detail, null, 2));
  fs.appendFileSync(path.join(REPORTS_DIR, 'history.jsonl'), JSON.stringify(record) + '\n');

  const a = record.aggregates;
  console.log(`Run ${meta.run_id} (${meta.backend}): ${cases.length} cases`);
  console.log(`  accuracy=${a.verdict_accuracy}  false_close=${a.false_close_rate}  adherence=${a.ladder_adherence}  cost/case=$${a.cost_per_case_usd}`);
  console.log(`  gate: ${record.gate.pass ? 'PASS' : 'FAIL'}${record.gate.reasons.length ? ' — ' + record.gate.reasons.join('; ') : ''}`);
  console.log(`  wrote ${path.relative(process.cwd(), path.join(REPORTS_DIR, meta.run_id + '.json'))} and appended history.jsonl`);

  if (has('--check') && !record.gate.pass) process.exit(1);
}
main().catch((e) => { console.error(e.message || e); process.exit(2); });
