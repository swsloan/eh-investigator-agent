// Prior eval runs, for judging whether a case actually changed (#127).
//
// One definition, two callers: the in-app runner and the CLI harness both need
// the previous runs for the same backend, and both had their own byte-identical
// copy of the loader. The copies did the same thing then; they would not have
// stayed that way now that the window matters.
//
// Why a window rather than the single previous run: a regression flag is a
// strong claim, and comparing one sample against one sample cannot support it
// when a case is bimodal. Judging "did this change" needs enough prior samples
// to know whether the case holds still at all.

import fs from 'node:fs';
import path from 'node:path';

// How many prior runs to scan. Deliberately larger than the number of samples
// actually used per case: runs are not uniform — a burst of single-case runs
// while debugging one case (exactly what produced this issue's evidence) would
// otherwise push every other case out of the window and blind the suite to real
// regressions. Scanning wide and sampling per case keeps that from happening.
// Costs a few small file reads, not an eval run.
export const DEFAULT_HISTORY_WINDOW = 10;

/**
 * The last `limit` run details for `backend`, newest first. Runs whose detail
 * file is missing are skipped rather than treated as absent history, so a
 * pruned report cannot silently shorten the window into a single sample.
 */
export function loadPrevDetails(reportsDir, backend, limit = DEFAULT_HISTORY_WINDOW) {
  const hf = path.join(reportsDir, 'history.jsonl');
  if (!fs.existsSync(hf)) return [];
  let recs;
  try {
    recs = fs.readFileSync(hf, 'utf8').split('\n').filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter((r) => r && r.backend === backend)
      .sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
  } catch {
    return [];
  }
  const out = [];
  for (let i = recs.length - 1; i >= 0 && out.length < limit; i--) {
    const df = path.join(reportsDir, `${recs[i].run_id}.json`);
    if (!fs.existsSync(df)) continue;
    try { out.push(JSON.parse(fs.readFileSync(df, 'utf8'))); } catch { /* unreadable — skip */ }
  }
  return out;
}

/** The most recent prior detail, or null. Kept for callers that only need one. */
export function loadPrevDetail(reportsDir, backend) {
  return loadPrevDetails(reportsDir, backend, 1)[0] || null;
}
