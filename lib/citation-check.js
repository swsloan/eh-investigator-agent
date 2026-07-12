// Deterministic citation check for Warrant Phase 2. Given an investigation
// workspace, reads evidence/verdict.json and verifies that every claim in
// `evidence_chain` cites a `source` file that actually exists under the
// workspace. No model, no dependencies — the "citations enforceable" half of
// Phase 2 as a checkable fact. Unit-tested in citation-check.test.js.
import fs from 'node:fs';
import path from 'node:path';

/**
 * @returns {{ has_verdict:boolean, total:number, present:number, coverage:number,
 *             missing:string[], uncited:string[] }}
 *   coverage = present / total (claims whose cited source file exists), 0 when
 *   there are no claims (a verdict with no evidence chain is ungrounded).
 */
export function checkCitations(workspace) {
  let verdict;
  try {
    verdict = JSON.parse(fs.readFileSync(path.join(workspace, 'evidence', 'verdict.json'), 'utf8'));
  } catch {
    return { has_verdict: false, total: 0, present: 0, coverage: 0, missing: [], uncited: [] };
  }
  const chain = Array.isArray(verdict.evidence_chain) ? verdict.evidence_chain : [];
  const root = path.resolve(workspace);
  const missing = [];
  const uncited = [];
  let present = 0;
  for (const entry of chain) {
    const claim = (entry && typeof entry.claim === 'string') ? entry.claim : '(claim)';
    const src = (entry && typeof entry.source === 'string') ? entry.source.trim() : '';
    if (!src) { uncited.push(claim); continue; }
    const abs = path.resolve(workspace, src);
    // Guard against path traversal, then require the file to exist.
    if ((abs === root || abs.startsWith(root + path.sep)) && fs.existsSync(abs)) present++;
    else missing.push(src);
  }
  const total = chain.length;
  return {
    has_verdict: true,
    total,
    present,
    coverage: total ? Number((present / total).toFixed(4)) : 0,
    missing,
    uncited,
  };
}
