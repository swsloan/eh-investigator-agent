// In-app eval runner: run the labeled cases through the app's own session
// machinery (in-process — no HTTP, no external script), capturing cost/tokens
// natively from the session transcript, and score with the shared scorer.
//
// Eval sessions run READ-ONLY (per-session broker guard) with memory disabled,
// so they are safe to run inside the normal app alongside real investigations.
import fs from 'node:fs';
import path from 'node:path';
import { scoreRun } from '../eval/harness/score.js';
import { loadMergedCases } from './eval-cases.js';
import { checkCitations } from './citation-check.js';

/** Sum cost + tokens from a session transcript (message_end usage). Cost is
 *  authoritative (only the result event carries total_cost_usd); tokens is
 *  approximate — it sums per-message totals (incl. cache-read tokens) so it
 *  over-counts. Use cost, not tokens, for gating/comparison. */
export function sumUsage(transcript = []) {
  let cost = 0, tokens = 0;
  for (const e of transcript) {
    const u = e?.message?.usage;
    if (e?.type === 'message_end' && u) {
      cost += Number(u.cost?.total || 0);
      tokens += Number(u.totalTokens || 0);
    }
  }
  return { cost: Number(cost.toFixed(4)), tokens };
}

function readVerdict(workspace) {
  try {
    return JSON.parse(fs.readFileSync(path.join(workspace, 'evidence', 'verdict.json'), 'utf8'));
  } catch {
    return null;
  }
}

function loadPrevDetail(reportsDir, backend) {
  const hf = path.join(reportsDir, 'history.jsonl');
  if (!fs.existsSync(hf)) return null;
  const recs = fs.readFileSync(hf, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
    .filter((r) => r.backend === backend)
    .sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
  for (let i = recs.length - 1; i >= 0; i--) {
    const df = path.join(reportsDir, `${recs[i].run_id}.json`);
    if (fs.existsSync(df)) return JSON.parse(fs.readFileSync(df, 'utf8'));
  }
  return null;
}

/**
 * @param {object} deps
 * @param {Function} deps.createSession  (id, {backend}) => session   (server's)
 * @param {Function} deps.disposeSession (session) => void            (remove + rm workspace)
 * @param {string}   deps.casesDir
 * @param {string}   deps.reportsDir
 * @param {string}   deps.backendId
 * @param {string}   deps.runId
 * @param {string}   deps.timestamp     ISO string (caller stamps it)
 * @param {number}  [deps.gateTarget=0.05]
 * @param {Function}[deps.onProgress]   ({phase,id,index,total}) => void
 * @param {object}  [deps.meta]         extra history fields (git_sha, skill_version, model, label)
 */
/** Run `worker` over `items` with at most `limit` in flight at once. */
export async function mapPool(items, limit, worker) {
  let next = 0;
  const n = Math.max(1, Math.min(Number(limit) || 1, items.length || 1));
  const runners = Array.from({ length: n }, async () => {
    while (next < items.length) {
      const i = next++;
      await worker(items[i], i);
    }
  });
  await Promise.all(runners);
}

export async function runEvalInApp({
  createSession, disposeSession, casesDir, reportsDir, overridesPath, backendId = 'claude',
  runId, timestamp, gateTarget = 0.05, costCeiling = null, accuracyFloor = 0.8, caseIds = null, maxParallel = 3,
  mode = 'live', onProgress = () => {}, meta = {},
}) {
  let cases = loadMergedCases(casesDir, overridesPath || path.join(reportsDir, 'label-overrides.json'));
  if (Array.isArray(caseIds) && caseIds.length) {
    const want = new Set(caseIds);
    cases = cases.filter((c) => want.has(c.id));
  }
  const cassetteDir = path.join(reportsDir, 'cassettes');
  const results = {};
  let completed = 0;
  const total = cases.length;

  // Cases are independent read-only investigations, so run several concurrently.
  // Cost is unchanged (same total work); wall-clock drops ~maxParallel×. Bounded
  // to avoid overloading the appliance / hitting model rate limits.
  await mapPool(cases, Math.min(maxParallel, 8), async (c) => {
    const session = createSession(undefined, { backend: backendId });
    try {
      session.options.readOnly = true;               // per-session broker guard
      if (session.options.env) delete session.options.env.EH_MEMORY_MCP_URL; // no memory writes
      session.options.mcpServers = {};               // (Claude) drop the memory MCP server
      if (mode === 'record' || mode === 'replay') {  // excli record/replay cassette
        session.options.excli = { mode, file: path.join(cassetteDir, `${c.id}.jsonl`), onMiss: 'error' };
      }
      await session.prompt(c.prompt, { source: 'user' });
      const verdict = readVerdict(session.workspace);
      const usage = sumUsage(session.transcript);
      if (verdict) {
        // Phase 2: hypothesis-first (did the agent write the framing artifact
        // before concluding?) + citation coverage (do verdict claims cite real
        // evidence files?). Grounded is now derived from citation coverage.
        const cite = checkCitations(session.workspace);
        const framingPresent = fs.existsSync(path.join(session.workspace, 'evidence', 'hypothesis.json'));
        results[c.id] = {
          disposition: verdict.disposition,
          confidence: verdict.confidence,
          highest_rung_used: verdict.highest_rung_used,
          detection_source: verdict.detection_source,
          attack: verdict.attack_techniques || verdict.attack || [],
          cost_usd: usage.cost,
          tokens: usage.tokens,
          grounded: cite.coverage >= 0.8,
          citation_coverage: cite.coverage,
          framing_present: framingPresent,
          injection_detected: verdict.injection_detected === true, // Phase 3: agent flagged an injected instruction
        };
      }
    } catch (err) {
      onProgress({ phase: 'error', id: c.id, error: err?.message || String(err) });
    } finally {
      try { disposeSession(session); } catch { /* best effort */ }
      completed++;
      onProgress({ phase: 'done', id: c.id, completed, total });
    }
  });

  const { record, detail } = scoreRun({
    cases, results, gateTarget, costCeiling, accuracyFloor,
    meta: { run_id: runId, timestamp, backend: backendId, ...meta },
    prevDetail: loadPrevDetail(reportsDir, backendId),
  });
  fs.mkdirSync(reportsDir, { recursive: true });
  fs.writeFileSync(path.join(reportsDir, `${runId}.json`), JSON.stringify(detail, null, 2));
  fs.appendFileSync(path.join(reportsDir, 'history.jsonl'), JSON.stringify(record) + '\n');
  return { record, detail };
}
