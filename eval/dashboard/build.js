#!/usr/bin/env node
// Eval dashboard generator (M1 + the M2 trend). Reads the data contract
// (history.jsonl + <run_id>.json) and writes self-contained static HTML:
//   <out>/index.html        aggregate: north-star strip + progress-over-runs chart
//   <out>/<run_id>.html     per-run scorecard
// No dependencies, no server, inline CSS + inline SVG (viewable offline / in CI).
//
// Usage:
//   node eval/dashboard/build.js [--data <dir>] [--out <dir>]
// Defaults: --data eval/dashboard/fixtures  --out eval/dashboard/out
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const argVal = (flag, def) => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
// fileURLToPath decodes %20 etc. — plain URL().pathname breaks on paths with spaces.
const HERE = path.dirname(fileURLToPath(import.meta.url));
let DATA_DIR = path.resolve(argVal('--data', path.join(HERE, 'fixtures')));
let OUT_DIR = path.resolve(argVal('--out', path.join(HERE, 'out')));

const DISPOSITIONS = ['malicious', 'benign', 'false-positive', 'benign-authorized'];
const DISPO_SHORT = { malicious: 'mal', benign: 'ben', 'false-positive': 'FP', 'benign-authorized': 'b-auth' };
const RUNGS = ['metrics', 'records', 'packets'];

// ---------- helpers ----------
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pct = (x, d = 0) => `${(x * 100).toFixed(d)}%`;
const usd = (x) => `$${Number(x).toFixed(2)}`;
const round = (x, d = 2) => Number(x).toFixed(d);

function loadRuns() {
  const hf = path.join(DATA_DIR, 'history.jsonl');
  if (!fs.existsSync(hf)) return [];
  const lines = fs.readFileSync(hf, 'utf8').split('\n');
  const runs = [];
  for (const line of lines) {
    const t = line.trim();
    if (t) runs.push(JSON.parse(t));
  }
  runs.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return runs;
}
function loadDetail(runId) {
  const p = path.join(DATA_DIR, `${runId}.json`);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
}

// ---------- shared CSS (brand tokens, light + dark) ----------
function css() {
  return `
:root{--sapphire:#261F63;--plum:#7F2854;--accent:#00AAEF;--gradient:linear-gradient(135deg,#261F63,#7F2854);
--ink:#1A1A22;--ink-soft:#54555F;--ink-faint:#85868F;--rule:#D9D8E0;--rule-soft:#ECEBF1;--paper:#FFF;--panel:#FAFAFC;--card:#FFF;--canvas:#E9E9EE;
--ok:#3F7A4F;--ok-bg:#ECF5EE;--bad:#9E1B1B;--bad-bg:#FBEDED;--warn:#A36F0B;--warn-bg:#FBF4E2;--sapphire-chip:#ECEBF6;
--mono:"JetBrains Mono",ui-monospace,Menlo,Consolas,monospace;--maxw:8in;}
@media(prefers-color-scheme:dark){:root:not([data-report-theme="light"]){
--sapphire:#B3A8F2;--plum:#D171A0;--accent:#37C0F5;--ink:#ECECF2;--ink-soft:#C4C3CF;--ink-faint:#9B9BA6;
--rule:#3A3947;--rule-soft:#2E2D3A;--paper:#15141C;--panel:#1F1E28;--card:#232230;--canvas:#0F0E14;
--ok:#67D391;--ok-bg:#183427;--bad:#FF8585;--bad-bg:#3A1D22;--warn:#F2C356;--warn-bg:#342B16;--sapphire-chip:#2A2740;}}
*{box-sizing:border-box}
body{font-family:"Source Sans 3",Arial,Helvetica,sans-serif;color:var(--ink);background:var(--canvas);margin:0;font-size:11pt;line-height:1.5}
.sheet{background:var(--paper);max-width:var(--maxw);margin:24px auto;padding:0 0 .4in;box-shadow:0 2px 30px rgba(20,18,40,.14)}
a{color:var(--accent);text-decoration:none}
.masthead{background:var(--gradient);color:#fff;padding:.34in .55in .4in}
.doc-kind{font-size:8.5pt;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:rgba(255,255,255,.66);margin-bottom:6px}
h1{font-size:20pt;font-weight:900;margin:0 0 .12em;letter-spacing:-.01em}
.meta{font-size:8.7pt;color:rgba(255,255,255,.66);margin-top:12px;display:flex;flex-wrap:wrap;gap:4px 22px}
.meta b{color:#fff;font-weight:600}
.gate{display:inline-flex;align-items:center;gap:8px;font-size:11pt;font-weight:800;padding:5px 15px;border-radius:99px;margin:.28in .55in 0}
.gate.pass{color:var(--ok);background:var(--ok-bg)}
.gate.fail{color:var(--bad);background:var(--bad-bg)}
section{padding:.14in .55in 0}
.h2{font-size:12pt;font-weight:800;color:var(--sapphire);margin:.5em 0 .5em}
.tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
.tile{background:var(--panel);border-radius:8px;padding:11px 13px;border:1px solid var(--rule)}
.tile.hero{border-left:3px solid var(--sapphire)}
.tile .lbl{font-size:8.6pt;color:var(--ink-faint);text-transform:uppercase;letter-spacing:.08em;font-weight:800}
.tile .val{font-size:22pt;font-weight:900;color:var(--sapphire);line-height:1.05;margin-top:2px}
.tile .sub{font-size:8.6pt;margin-top:3px;color:var(--ink-soft)}
.up{color:var(--ok)} .down{color:var(--ok)} .bad{color:var(--bad)}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.panel{background:var(--card);border:1px solid var(--rule);border-radius:10px;padding:12px 14px}
.panel .pt{font-size:10.5pt;font-weight:700;margin-bottom:8px}
table{width:100%;border-collapse:collapse;font-size:9pt}
th{text-align:left;color:var(--ink-faint);font-weight:700;padding:5px 6px;border-bottom:1px solid var(--rule)}
td{padding:6px 6px;border-bottom:1px solid var(--rule-soft);vertical-align:top}
.mono{font-family:var(--mono);font-size:8.4pt}
.pill{display:inline-block;font-size:8pt;font-weight:700;padding:1px 8px;border-radius:99px}
.pill.ok{color:var(--ok);background:var(--ok-bg)} .pill.bad{color:var(--bad);background:var(--bad-bg)}
.cm{font-size:9.5pt;table-layout:fixed}
.cm td,.cm th{text-align:center;padding:5px}
.cm .diag{background:var(--ok);color:#fff;border-radius:4px}
.cm .fc{background:var(--bad);color:#fff;border-radius:4px}
.rowlink td{border-bottom:1px solid var(--rule-soft)}
.note{font-size:8.6pt;color:var(--ink-faint);margin-top:7px}
.footer{margin:.3in .55in 0;padding-top:12px;border-top:1px solid var(--rule);font-size:8.5pt;color:var(--ink-faint);display:flex;justify-content:space-between}
`.trim();
}

function page(title, bodyHtml) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title><style>${css()}</style></head><body><div class="sheet">${bodyHtml}
<div class="footer"><span>ExtraHop Investigation Agent — eval dashboard</span><span>generated from ${esc(path.basename(DATA_DIR))}</span></div>
</div></body></html>`;
}

// ---------- charts (build-time inline SVG) ----------
function lineChart(runs) {
  const W = 660, H = 220, L = 46, R = 150, T = 16, B = 34;
  const x = (i) => L + (runs.length === 1 ? (W - L - R) / 2 : i * (W - L - R) / (runs.length - 1));
  const y = (v) => T + (1 - v) * (H - T - B);
  const target = runs[runs.length - 1]?.gate?.false_close_target ?? 0.05;
  const series = [
    { key: 'false_close_rate', color: '#E24B4A', label: 'false-close' },
    { key: 'verdict_accuracy', color: '#378ADD', label: 'accuracy' },
    { key: 'ladder_adherence', color: '#7F77DD', label: 'adherence' },
  ];
  const poly = (key) => runs.map((r, i) => `${round(x(i), 1)},${round(y(r.aggregates[key]), 1)}`).join(' ');
  const dots = (key, color) => runs.map((r, i) =>
    `<circle cx="${round(x(i), 1)}" cy="${round(y(r.aggregates[key]), 1)}" r="3" fill="${color}"/>`).join('');
  const xlabels = runs.map((r, i) => {
    const v = (r.skill_version || '').split(' ')[0];
    return `<text x="${round(x(i), 1)}" y="${H - 18}" text-anchor="middle" font-size="9.5" fill="var(--ink-soft)">${esc(v || 'run')}</text>` +
      `<text x="${round(x(i), 1)}" y="${H - 7}" text-anchor="middle" font-size="8" fill="var(--ink-faint)">${esc(r.label || '')}</text>`;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto" role="img" aria-label="Progress over runs: false-close rate, verdict accuracy, and ladder adherence across runs, with the autonomy-gate threshold">
<line x1="${L}" y1="${y(0)}" x2="${W - R + 6}" y2="${y(0)}" stroke="var(--rule)"/>
<line x1="${L}" y1="${T}" x2="${L}" y2="${y(0)}" stroke="var(--rule)"/>
<text x="${L - 6}" y="${y(1) + 3}" text-anchor="end" font-size="9" fill="var(--ink-faint)">100%</text>
<text x="${L - 6}" y="${y(0.5) + 3}" text-anchor="end" font-size="9" fill="var(--ink-faint)">50%</text>
<text x="${L - 6}" y="${y(0) + 3}" text-anchor="end" font-size="9" fill="var(--ink-faint)">0%</text>
<line x1="${L}" y1="${round(y(target), 1)}" x2="${W - R + 6}" y2="${round(y(target), 1)}" stroke="#E24B4A" stroke-dasharray="5 4" opacity="0.7"/>
<text x="${W - R + 8}" y="${round(y(target), 1) - 3}" font-size="9" fill="#A32D2D">gate · false-close &lt; ${pct(target)}</text>
${series.map((s) => `<polyline fill="none" stroke="${s.color}" stroke-width="2.5" points="${poly(s.key)}"/>${dots(s.key, s.color)}`).join('')}
${series.map((s, i) => `<rect x="${W - R + 8}" y="${T + 6 + i * 16}" width="10" height="10" rx="2" fill="${s.color}"/><text x="${W - R + 22}" y="${T + 15 + i * 16}" font-size="9.5" fill="var(--ink-soft)">${s.label}</text>`).join('')}
${xlabels}
</svg>`;
}

function calibrationChart(cal) {
  if (!cal || !cal.length) return '<div class="note">No calibration data.</div>';
  const W = 250, H = 150, L = 30, T = 10, B = 30;
  const order = { low: 0, medium: 1, high: 2 };
  const x = (b) => L + (order[b] / 2) * (W - L - 10);
  const y = (v) => T + (1 - v) * (H - T - B);
  const pts = cal.slice().sort((a, b) => order[a.bucket] - order[b.bucket]);
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto" role="img" aria-label="Confidence calibration: accuracy within each stated-confidence bucket versus the ideal diagonal">
<line x1="${L}" y1="${y(0)}" x2="${W - 10}" y2="${y(0)}" stroke="var(--rule)"/>
<line x1="${L}" y1="${T}" x2="${L}" y2="${y(0)}" stroke="var(--rule)"/>
<line x1="${L}" y1="${y(0)}" x2="${W - 10}" y2="${T}" stroke="var(--ink-faint)" stroke-dasharray="4 4" opacity="0.5"/>
<polyline fill="none" stroke="#378ADD" stroke-width="2.5" points="${pts.map((p) => `${round(x(p.bucket), 1)},${round(y(p.accuracy), 1)}`).join(' ')}"/>
${pts.map((p) => `<circle cx="${round(x(p.bucket), 1)}" cy="${round(y(p.accuracy), 1)}" r="3.5" fill="#378ADD"/><text x="${round(x(p.bucket), 1)}" y="${H - 14}" text-anchor="middle" font-size="9" fill="var(--ink-soft)">${p.bucket}</text>`).join('')}
<text x="${L - 4}" y="${y(1) + 3}" text-anchor="end" font-size="8.5" fill="var(--ink-faint)">100%</text>
<text x="${L - 4}" y="${y(0) + 3}" text-anchor="end" font-size="8.5" fill="var(--ink-faint)">0%</text>
</svg><div class="note">Dashed = perfect calibration.</div>`;
}

function confusionMatrix(conf) {
  if (!conf) return '<div class="note">No confusion data.</div>';
  const head = `<tr><th></th>${DISPOSITIONS.map((d) => `<th>${DISPO_SHORT[d]}</th>`).join('')}</tr>`;
  const rows = DISPOSITIONS.map((e) => {
    const cells = DISPOSITIONS.map((p) => {
      const v = conf[e]?.[p] ?? 0;
      let cls = '';
      if (e === p && v > 0) cls = 'diag';
      else if (e === 'malicious' && p !== 'malicious' && v > 0) cls = 'fc';
      return `<td class="${cls}">${v}</td>`;
    }).join('');
    return `<tr><td style="color:var(--ink-faint);text-align:right">${DISPO_SHORT[e]}</td>${cells}</tr>`;
  }).join('');
  return `<table class="cm">${head}${rows}</table>
<div class="note">Rows = expected, cols = predicted. <span style="color:var(--bad)">Red</span> = malicious closed as non-malicious (false-close).</div>`;
}

function adherenceBars(a) {
  if (!a) return '<div class="note">No adherence data.</div>';
  const items = [
    ['entered_right_rung', 'Entered right rung', 'var(--ok)'],
    ['false_climb', 'False climb', 'var(--warn)'],
    ['under_investigated', 'Under-investigated', 'var(--warn)'],
    ['under_corroborated', 'Under-corroborated', 'var(--bad)'],
  ];
  return items.map(([k, label, color]) => {
    const v = a[k] ?? 0;
    return `<div style="margin:5px 0"><div style="display:flex;justify-content:space-between;font-size:9pt"><span>${label}</span><span>${pct(v)}</span></div>
<div style="height:7px;background:var(--rule-soft);border-radius:99px;overflow:hidden"><div style="height:100%;width:${round(v * 100, 1)}%;background:${color}"></div></div></div>`;
  }).join('');
}

// ---------- north-star tiles ----------
function delta(cur, prev, key, opts = {}) {
  if (!prev) return '';
  const d = cur.aggregates[key] - prev.aggregates[key];
  if (Math.abs(d) < 1e-9) return `<span style="color:var(--ink-faint)">no change vs prev</span>`;
  const goodDown = opts.goodDown;
  const good = goodDown ? d < 0 : d > 0;
  const arrow = d < 0 ? '&#8600;' : '&#8599;';
  const mag = opts.money ? usd(Math.abs(d)) : `${(Math.abs(d) * 100).toFixed(1)} pts`;
  return `<span class="${good ? 'up' : 'bad'}">${arrow} ${mag} vs prev</span>`;
}

function tiles(run, prev) {
  const a = run.aggregates;
  const gate = run.gate;
  const fcClass = gate.pass ? 'up' : 'bad';
  return `<div class="tiles">
<div class="tile hero" style="border-left-color:${gate.pass ? 'var(--ok)' : 'var(--bad)'}">
  <div class="lbl">False-close rate</div><div class="val" style="color:${gate.pass ? 'var(--ok)' : 'var(--bad)'}">${pct(a.false_close_rate, 1)}</div>
  <div class="sub"><span class="${fcClass}">target &lt; ${pct(gate.false_close_target)}</span> · ${delta(run, prev, 'false_close_rate', { goodDown: true })}</div></div>
<div class="tile"><div class="lbl">Verdict accuracy</div><div class="val">${pct(a.verdict_accuracy)}</div><div class="sub">${delta(run, prev, 'verdict_accuracy')}</div></div>
<div class="tile"><div class="lbl">Ladder adherence</div><div class="val">${pct(a.ladder_adherence)}</div><div class="sub">${delta(run, prev, 'ladder_adherence')}</div></div>
<div class="tile"><div class="lbl">Cost / case</div><div class="val">${usd(a.cost_per_case_usd)}</div><div class="sub">${delta(run, prev, 'cost_per_case_usd', { goodDown: true, money: true })}</div></div>
</div>`;
}

// ---------- per-case table ----------
function caseTable(detail) {
  const rows = detail.cases.map((c) => {
    const regressed = !!c.regressed_from;
    const under = RUNGS.indexOf(c.predicted.highest_rung_used) < RUNGS.indexOf(c.expected.min_rung);
    const flags = [];
    if (c.scores.false_climb) flags.push('<span class="pill" style="color:var(--warn);background:var(--warn-bg)">over-climb</span>');
    if (under) flags.push('<span class="pill" style="color:var(--warn);background:var(--warn-bg)">under-dug</span>');
    const status = c.status === 'pass'
      ? '<span class="pill ok">pass</span>'
      : `<span class="pill bad">${regressed ? 'regression' : 'fail'}</span>`;
    const predWrong = !c.scores.verdict_correct ? ` style="color:var(--bad)"` : '';
    return `<tr class="rowlink"><td class="mono">${esc(c.id)}</td><td>${esc(c.detection_source)}</td>
<td>${esc(c.expected.disposition)}</td><td${predWrong}>${esc(c.predicted.disposition)}</td>
<td>${esc(c.predicted.highest_rung_used)}</td><td>${usd(c.scores.cost_usd)}</td>
<td style="text-align:right">${flags.join(' ')} ${status}</td></tr>`;
  }).join('');
  const passed = detail.cases.filter((c) => c.status === 'pass').length;
  const regr = detail.cases.filter((c) => c.regressed_from).length;
  return `<div class="note">${passed}/${detail.cases.length} pass${regr ? ` · ${regr} regression` : ''}</div>
<table><tr><th>case</th><th>source</th><th>expected</th><th>predicted</th><th>rung</th><th>cost</th><th style="text-align:right">status</th></tr>${rows}</table>`;
}

// ---------- run-vs-run diff ----------
function computeDiff(prevDetail, curDetail) {
  const prevMap = new Map(prevDetail.cases.map((c) => [c.id, c]));
  const curMap = new Map(curDetail.cases.map((c) => [c.id, c]));
  const regressions = [], fixes = [], changed = [], unchanged = [], added = [], removed = [];
  for (const [id, cur] of curMap) {
    const prev = prevMap.get(id);
    if (!prev) { added.push({ cur }); continue; }
    if (prev.status === 'pass' && cur.status === 'fail') regressions.push({ prev, cur });
    else if (prev.status === 'fail' && cur.status === 'pass') fixes.push({ prev, cur });
    else if (prev.predicted.disposition !== cur.predicted.disposition) changed.push({ prev, cur });
    else unchanged.push({ prev, cur });
  }
  for (const [id, prev] of prevMap) if (!curMap.has(id)) removed.push({ prev });
  return { regressions, fixes, changed, unchanged, added, removed };
}

function diffFileName(prevRun, curRun) {
  return `diff-${prevRun.run_id}__${curRun.run_id}.html`;
}

function diffStrip(prevRun, curRun) {
  const items = [
    ['false_close_rate', 'False-close', true, false],
    ['verdict_accuracy', 'Accuracy', false, false],
    ['ladder_adherence', 'Adherence', false, false],
    ['cost_per_case_usd', 'Cost / case', true, true],
  ];
  return `<div class="tiles">${items.map(([k, label, goodDown, money]) => {
    const a = prevRun.aggregates[k], b = curRun.aggregates[k];
    const d = b - a;
    const good = goodDown ? d <= 0 : d >= 0;
    const fmt = money ? usd : (x) => pct(x, k === 'false_close_rate' ? 1 : 0);
    const arrow = d < 0 ? '&#8600;' : (d > 0 ? '&#8599;' : '');
    const mag = money ? usd(Math.abs(d)) : `${(Math.abs(d) * 100).toFixed(1)} pts`;
    const cls = Math.abs(d) < 1e-9 ? '' : (good ? 'up' : 'bad');
    return `<div class="tile"><div class="lbl">${label}</div><div class="val" style="font-size:15pt">${fmt(a)} &rarr; ${fmt(b)}</div><div class="sub ${cls}">${arrow} ${Math.abs(d) < 1e-9 ? 'no change' : mag}</div></div>`;
  }).join('')}</div>`;
}

function transitionTable(rows) {
  const cell = (c, key) => c ? esc(c.predicted.disposition) : '&mdash;';
  return `<table><tr><th>case</th><th>source</th><th>expected</th><th>before</th><th>after</th></tr>${rows.map(({ prev, cur }) => {
    const ref = cur || prev;
    return `<tr><td class="mono">${esc(ref.id)}</td><td>${esc(ref.detection_source)}</td><td>${esc(ref.expected.disposition)}</td><td>${cell(prev)}</td><td>${cell(cur)}</td></tr>`;
  }).join('')}</table>`;
}

function diffSection(title, rows, tone, emptyMsg) {
  const border = tone === 'bad' ? 'var(--bad)' : tone === 'ok' ? 'var(--ok)' : 'var(--rule)';
  const inner = rows.length ? transitionTable(rows) : `<div class="note">${emptyMsg}</div>`;
  return `<section><div class="panel" style="border-left:4px solid ${border}"><div class="pt">${title} <span class="note">(${rows.length})</span></div>${inner}</div></section>`;
}

function diffPage(prevRun, curRun, prevDetail, curDetail) {
  const d = computeDiff(prevDetail, curDetail);
  const summary = `${d.regressions.length} regression(s) &middot; ${d.fixes.length} fix(es) &middot; ${d.changed.length} other change(s) &middot; ${d.unchanged.length} unchanged`
    + (d.added.length ? ` &middot; ${d.added.length} new` : '') + (d.removed.length ? ` &middot; ${d.removed.length} removed` : '');
  const body = `
<header class="masthead"><div class="doc-kind">Run diff</div>
<h1>${esc(prevRun.skill_version || prevRun.run_id)} &rarr; ${esc(curRun.skill_version || curRun.run_id)}</h1>
<div class="meta"><span><b>From:</b> ${esc(prevRun.run_id)}</span><span><b>To:</b> ${esc(curRun.run_id)}</span><span><b>Backend:</b> ${esc(curRun.backend)}</span></div></header>
<section><div class="note">${summary}</div>${diffStrip(prevRun, curRun)}</section>
${diffSection('Regressions (newly failing)', d.regressions, 'bad', 'No regressions &#10003;')}
${diffSection('Fixes (newly passing)', d.fixes, 'ok', 'No new fixes.')}
${d.changed.length ? diffSection('Other prediction changes', d.changed, 'neutral', '') : ''}
${d.added.length ? diffSection('New cases', d.added, 'neutral', '') : ''}
${d.removed.length ? diffSection('Removed cases', d.removed, 'neutral', '') : ''}
<section><div class="note"><a href="index.html">&#8592; trend</a> &middot; <a href="${esc(curRun.run_id)}.html">${esc(curRun.skill_version || curRun.run_id)} scorecard</a></div></section>`;
  return page(`Diff — ${prevRun.run_id} to ${curRun.run_id}`, body);
}

// ---------- pages ----------
function scorecard(run, prev, detail, diffFile) {
  const a = run.aggregates;
  const gate = `<div class="gate ${run.gate.pass ? 'pass' : 'fail'}">${run.gate.pass ? '&#10003; Autonomy gate: PASS' : '&#10007; Autonomy gate: FAIL'}${run.gate.reasons?.length ? ` — ${esc(run.gate.reasons.join('; '))}` : ''}</div>`;
  const body = `
<header class="masthead"><div class="doc-kind">Eval scorecard</div>
<h1>${esc(run.skill_version || run.run_id)}</h1>
<div class="meta"><span><b>Run:</b> ${esc(run.run_id)}</span><span><b>When:</b> ${esc(run.timestamp)}</span><span><b>Backend:</b> ${esc(run.backend)}/${esc(run.model || '')}</span><span><b>Commit:</b> ${esc(run.git_sha || '—')}</span><span><b>Cases:</b> ${run.case_count}</span></div></header>
${gate}
<section>${tiles(run, prev)}</section>
<section><div class="grid2">
<div class="panel"><div class="pt">Disposition confusion</div>${confusionMatrix(a.confusion)}</div>
<div class="panel"><div class="pt">Confidence calibration</div>${calibrationChart(a.calibration)}</div>
</div></section>
<section><div class="panel"><div class="pt">Ladder adherence</div>${adherenceBars(a.adherence)}</div></section>
<section><div class="h2">Cases</div>${detail ? caseTable(detail) : '<div class="note">No per-case detail file for this run (history-only).</div>'}</section>
<section><div class="note"><a href="index.html">&#8592; back to trend</a>${diffFile ? ` &middot; <a href="${esc(diffFile)}">compare to previous run &rarr;</a>` : ''}</div></section>`;
  return page(`Eval — ${run.run_id}`, body);
}

function emptyIndex() {
  const body = `
<header class="masthead"><div class="doc-kind">Investigation eval · trend</div><h1>Eval dashboard</h1></header>
<section><div class="panel"><div class="pt">No eval runs yet</div>
<div class="note">Run the eval harness to produce <code>history.jsonl</code> and per-run detail; results will appear here.</div></div></section>`;
  return page('Eval dashboard', body);
}

function indexPage(runs, byBackend, prevByRun, diffByCur) {
  const latest = runs[runs.length - 1];
  const prev = prevByRun[latest.run_id];
  const backends = [...byBackend.keys()].sort();

  // One trend chart per backend (small multiples) so Pi and Claude don't blur together.
  const charts = backends.map((b) => {
    const list = byBackend.get(b);
    const single = list.length < 2
      ? '<div class="note">Single run — the trend line fills in from the next run.</div>' : '';
    return `<div class="panel" style="margin-bottom:12px"><div class="pt">Progress over runs — ${esc(b)}</div>${lineChart(list)}${single}</div>`;
  }).join('');

  const rows = runs.slice().reverse().map((r) => {
    const has = fs.existsSync(path.join(DATA_DIR, `${r.run_id}.json`));
    const name = esc(r.skill_version || r.run_id);
    const link = has ? `<a href="${esc(r.run_id)}.html">${name}</a>` : `${name} <span class="note">(history-only)</span>`;
    const g = r.gate.pass ? '<span class="pill ok">PASS</span>' : '<span class="pill bad">FAIL</span>';
    const diff = diffByCur[r.run_id] ? `<a href="${esc(diffByCur[r.run_id])}">vs prev</a>` : '<span class="note">&mdash;</span>';
    return `<tr><td>${link}</td><td>${esc(r.backend)}</td><td class="mono">${esc(r.timestamp.slice(0, 10))}</td><td>${pct(r.aggregates.false_close_rate, 1)}</td><td>${pct(r.aggregates.verdict_accuracy)}</td><td>${pct(r.aggregates.ladder_adherence)}</td><td>${diff}</td><td style="text-align:right">${g}</td></tr>`;
  }).join('');

  const body = `
<header class="masthead"><div class="doc-kind">Investigation eval · trend</div>
<h1>Eval dashboard</h1>
<div class="meta"><span><b>Runs:</b> ${runs.length}</span><span><b>Backends:</b> ${esc(backends.join(', '))}</span><span><b>Latest:</b> ${esc(latest.run_id)}</span></div></header>
<div class="gate ${latest.gate.pass ? 'pass' : 'fail'}">${latest.gate.pass ? '&#10003;' : '&#10007;'} Latest gate (${esc(latest.backend)}): ${latest.gate.pass ? 'PASS' : 'FAIL'}</div>
<section><div class="h2">Latest run <span class="note">(${esc(latest.backend)} &middot; ${esc(latest.run_id)})</span></div>${tiles(latest, prev)}</section>
<section>${charts}</section>
<section><div class="h2">All runs</div><table><tr><th>run</th><th>backend</th><th>date</th><th>false-close</th><th>accuracy</th><th>adherence</th><th>diff</th><th style="text-align:right">gate</th></tr>${rows}</table></section>`;
  return page('Eval dashboard', body);
}

// ---------- build ----------
function main() {
  const runs = loadRuns(); // sorted by timestamp ascending
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // Empty-state: still emit a valid dashboard, don't crash.
  if (runs.length === 0) {
    const idx = path.join(OUT_DIR, 'index.html');
    fs.writeFileSync(idx, emptyIndex());
    console.log('No runs in history.jsonl — wrote empty dashboard:', path.relative(process.cwd(), idx));
    if (args.includes('--check')) console.log('gate check: no runs (nothing to gate)');
    return;
  }

  const detailByRun = {};
  for (const r of runs) detailByRun[r.run_id] = loadDetail(r.run_id);

  // Group by backend so Pi and Claude are tracked as independent series.
  const byBackend = new Map();
  for (const r of runs) {
    if (!byBackend.has(r.backend)) byBackend.set(r.backend, []);
    byBackend.get(r.backend).push(r);
  }
  // "Previous run" and diffs are per-backend: a Claude run compares to the prior
  // Claude run, not to whatever ran most recently overall.
  const prevByRun = {};
  const diffByCur = {};
  const diffPairs = [];
  for (const list of byBackend.values()) {
    for (let i = 0; i < list.length; i++) {
      prevByRun[list[i].run_id] = i > 0 ? list[i - 1] : null;
      if (i > 0 && detailByRun[list[i].run_id] && detailByRun[list[i - 1].run_id]) {
        diffByCur[list[i].run_id] = diffFileName(list[i - 1], list[i]);
        diffPairs.push({ prev: list[i - 1], cur: list[i] });
      }
    }
  }

  const written = [];
  for (const r of runs) {
    const out = path.join(OUT_DIR, `${r.run_id}.html`);
    fs.writeFileSync(out, scorecard(r, prevByRun[r.run_id], detailByRun[r.run_id], diffByCur[r.run_id]));
    written.push(out);
  }
  for (const { prev, cur } of diffPairs) {
    const out = path.join(OUT_DIR, diffByCur[cur.run_id]);
    fs.writeFileSync(out, diffPage(prev, cur, detailByRun[prev.run_id], detailByRun[cur.run_id]));
    written.push(out);
  }
  const idx = path.join(OUT_DIR, 'index.html');
  fs.writeFileSync(idx, indexPage(runs, byBackend, prevByRun, diffByCur));
  written.push(idx);

  console.log(`Built ${written.length} file(s) from ${runs.length} run(s):`);
  for (const w of written) console.log('  ' + path.relative(process.cwd(), w));

  // M4: CI gate. --check exits non-zero if the latest run fails its gate;
  // --fail-on-regression also fails when the latest run regressed a case.
  const latest = runs[runs.length - 1];
  console.log(`Gate (latest ${latest.run_id}, ${latest.backend}): ${latest.gate.pass ? 'PASS' : 'FAIL'}`);
  if (args.includes('--check')) {
    let fail = !latest.gate.pass;
    if (!fail) console.log('CI gate check: PASS');
    else console.error(`CI gate check: FAIL — ${(latest.gate.reasons || []).join('; ') || 'gate not met'}`);
    if (args.includes('--fail-on-regression') && diffByCur[latest.run_id]) {
      const prev = prevByRun[latest.run_id];
      const d = computeDiff(detailByRun[prev.run_id], detailByRun[latest.run_id]);
      if (d.regressions.length) {
        console.error(`CI regression check: FAIL — ${d.regressions.length} regressed case(s): ${d.regressions.map((r) => r.cur.id).join(', ')}`);
        fail = true;
      } else {
        console.log('CI regression check: PASS');
      }
    }
    if (fail) process.exit(1);
  }
}

/** In-process entry (used by the app to build the dashboard on demand). */
export function buildDashboard({ dataDir, outDir } = {}) {
  if (dataDir) DATA_DIR = path.resolve(dataDir);
  if (outDir) OUT_DIR = path.resolve(outDir);
  main();
  return { outDir: OUT_DIR };
}

// Run as a CLI only when invoked directly (not when imported by the server).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
