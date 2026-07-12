import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { loadMergedCases, promoteCase, writeOverride } from '../lib/eval-cases.js';

const DISPOSITIONS = ['malicious', 'benign', 'false-positive', 'benign-authorized', 'inconclusive'];
const RUNGS = ['metrics', 'records', 'packets'];

/**
 * In-app eval API. Runs the labeled cases through the app's own session
 * machinery (read-only, memory off) and scores them; edits/signs-off labels;
 * builds + serves the full dashboard.
 *
 *   POST /api/eval/run       { backend?, gateTarget?, costCeiling?, caseIds? }
 *   GET  /api/eval/status
 *   GET  /api/eval/runs
 *   GET  /api/eval/cases                       -> merged cases (label + sign-off)
 *   PUT  /api/eval/cases/:id  { expected?, notes?, signed_off? }
 *   GET  /api/eval/dashboard                   -> build + redirect to the HTML
 */
export function evalRouter({ startEval, reportsDir, casesDir, overridesPath, buildDashboard, getSession, redact = (v) => v }) {
  const router = express.Router();
  const state = {
    status: 'idle', runId: null, index: 0, total: 0, currentCase: null,
    startedAt: null, finishedAt: null, gate: null, aggregates: null, error: null,
  };

  router.post('/run', (req, res) => {
    if (state.status === 'running') {
      return res.status(409).json({ error: 'An eval run is already in progress.' });
    }
    const b = req.body || {};
    const backendId = typeof b.backend === 'string' ? b.backend : 'claude';
    const gateTarget = Number.isFinite(b.gateTarget) ? b.gateTarget : undefined;
    const costCeiling = Number.isFinite(b.costCeiling) && b.costCeiling > 0 ? b.costCeiling : null;
    const accuracyFloor = Number.isFinite(b.accuracyFloor) && b.accuracyFloor >= 0 && b.accuracyFloor <= 1 ? b.accuracyFloor : undefined;
    const caseIds = Array.isArray(b.caseIds) && b.caseIds.length ? b.caseIds.map(String) : null;
    const maxParallel = Number.isFinite(b.maxParallel) && b.maxParallel > 0 ? Math.min(Math.floor(b.maxParallel), 8) : 3;
    const mode = ['live', 'record', 'replay'].includes(b.mode) ? b.mode : 'live';
    const runId = `eval-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    Object.assign(state, {
      status: 'running', runId, index: 0, total: caseIds?.length || 0, currentCase: null, maxParallel, mode,
      startedAt: new Date().toISOString(), finishedAt: null, gate: null, aggregates: null, error: null,
    });
    res.json({ ok: true, runId });

    startEval({
      runId, backendId, gateTarget, costCeiling, accuracyFloor, caseIds, maxParallel, mode, timestamp: new Date().toISOString(),
      onProgress: (p) => {
        if (typeof p.completed === 'number') state.index = p.completed; // completed count
        if (typeof p.total === 'number') state.total = p.total;
        if (p.id) state.currentCase = p.id;
      },
    })
      .then(({ record }) => Object.assign(state, {
        status: 'done', finishedAt: new Date().toISOString(), gate: record.gate, aggregates: record.aggregates,
      }))
      .catch((err) => Object.assign(state, {
        status: 'error', finishedAt: new Date().toISOString(), error: redact(err?.message || String(err)),
      }));
  });

  router.get('/status', (req, res) => res.json(state));

  router.get('/runs', (req, res) => {
    const hf = path.join(reportsDir, 'history.jsonl');
    if (!fs.existsSync(hf)) return res.json([]);
    res.json(fs.readFileSync(hf, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)));
  });

  router.get('/cases', (req, res) => {
    try { res.json(loadMergedCases(casesDir, overridesPath)); }
    catch (err) { res.status(500).json({ error: redact(err.message) }); }
  });

  const slugify = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);

  // Suggest a case definition from a finished investigation's verdict.json so the
  // promote dialog opens pre-filled (the analyst edits + confirms).
  router.get('/cases/prefill/:sessionId', (req, res) => {
    const session = getSession?.(req.params.sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found.' });
    let verdict = null;
    try { verdict = JSON.parse(fs.readFileSync(path.join(session.workspace, 'evidence', 'verdict.json'), 'utf8')); }
    catch { /* no verdict yet — fields default blank/malicious */ }
    const title = session.title || 'investigation';
    res.json({
      id: slugify(title) || `case-${String(req.params.sessionId).slice(0, 8)}`,
      prompt: `Investigate: ${title}.`,
      group_id: 'evallab',
      notes: (verdict && typeof verdict.summary === 'string') ? verdict.summary : '',
      expected: {
        disposition: DISPOSITIONS.includes(verdict?.disposition) ? verdict.disposition : 'malicious',
        min_rung: RUNGS.includes(verdict?.highest_rung_used) ? verdict.highest_rung_used : 'records',
        attack: Array.isArray(verdict?.attack_techniques) ? verdict.attack_techniques.map(String) : [],
      },
      has_verdict: !!verdict,
    });
  });

  // Persist a promoted case (writable data volume — no image rebuild). It then
  // shows up in the case list + the runner, as a seed unless signed off here.
  router.post('/cases/promote', (req, res) => {
    const b = req.body || {};
    const id = slugify(b.id);
    if (!id) return res.status(400).json({ error: 'A valid case id is required.' });
    if (typeof b.prompt !== 'string' || !b.prompt.trim()) return res.status(400).json({ error: 'A prompt (that reproduces the investigation) is required.' });
    const exp = b.expected || {};
    if (!DISPOSITIONS.includes(exp.disposition)) return res.status(400).json({ error: 'Invalid disposition.' });
    if (!RUNGS.includes(exp.min_rung)) return res.status(400).json({ error: 'Invalid min_rung.' });
    if (loadMergedCases(casesDir, overridesPath).some((c) => c.id === id)) {
      return res.status(409).json({ error: `A case with id "${id}" already exists — choose a different id.` });
    }
    promoteCase(overridesPath, {
      id,
      prompt: b.prompt.trim(),
      group_id: (typeof b.group_id === 'string' && b.group_id) ? b.group_id : 'evallab',
      notes: typeof b.notes === 'string' ? b.notes : '',
      expected: { disposition: exp.disposition, min_rung: exp.min_rung, attack: Array.isArray(exp.attack) ? exp.attack.map(String) : [] },
      promoted_from: typeof b.sessionId === 'string' ? b.sessionId : null,
      promoted_at: new Date().toISOString(),
    });
    if (b.signed_off === true) writeOverride(overridesPath, id, { signed_off: true });
    const merged = loadMergedCases(casesDir, overridesPath).find((c) => c.id === id);
    res.json({ ok: true, case: merged });
  });

  router.put('/cases/:id', (req, res) => {
    const all = loadMergedCases(casesDir, overridesPath);
    const current = all.find((c) => c.id === req.params.id);
    if (!current) return res.status(404).json({ error: 'Unknown case.' });
    const b = req.body || {};
    const patch = {};
    if (b.expected && typeof b.expected === 'object') {
      const e = {};
      if (b.expected.disposition) {
        if (!DISPOSITIONS.includes(b.expected.disposition)) return res.status(400).json({ error: 'Invalid disposition.' });
        e.disposition = b.expected.disposition;
      }
      if (b.expected.min_rung) {
        if (!RUNGS.includes(b.expected.min_rung)) return res.status(400).json({ error: 'Invalid min_rung.' });
        e.min_rung = b.expected.min_rung;
      }
      if (Array.isArray(b.expected.attack)) e.attack = b.expected.attack.map(String);
      patch.expected = e;
    }
    if (typeof b.notes === 'string') patch.notes = b.notes;
    if (typeof b.signed_off === 'boolean') patch.signed_off = b.signed_off;
    if (!Object.keys(patch).length) return res.status(400).json({ error: 'Nothing to update.' });
    writeOverride(overridesPath, req.params.id, patch);
    const merged = loadMergedCases(casesDir, overridesPath).find((c) => c.id === req.params.id);
    res.json({ ok: true, case: merged });
  });

  router.get('/dashboard', (req, res) => {
    try {
      buildDashboard();
      res.redirect('/eval-dashboard/index.html');
    } catch (err) {
      res.status(500).json({ error: redact(err?.message || 'Could not build the dashboard.') });
    }
  });

  return router;
}
