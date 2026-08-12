// Live runner (SCAFFOLD): drive a running app instance over the labeled cases
// and capture each investigation's evidence/verdict.json.
//
// IMPORTANT — this is not the tool-less one-shot path. An investigation needs
// excli tools, skills, and multiple turns, so runOneShot() (used for titles and
// challenger reviews) CANNOT be reused here. The runner instead exercises the
// full session machinery through the app's HTTP API:
//     POST /api/sessions                     -> { id }
//     POST /api/sessions/:id/message         -> starts the turn
//     GET  /api/sessions/:id/events (SSE)    -> wait for agent_end
//     GET  /api/sessions/:id/files/evidence/verdict.json  (files route) -> the verdict
//     GET  /api/sessions/:id/usage           -> cost/tokens for the case (meta.json)
//
// PREREQUISITES for running this against a real appliance (tracked in
// DESIGN-eval-harness.md). All three are satisfied by the eval compose profile,
// which is what scripts/run-eval-live.sh brings up:
//   1. Read-only mode at the excli broker — start the app with
//      EH_BROKER_READONLY=1 and the broker rejects update_detection and other
//      write-class tools (see lib/excli-readonly.js).
//   2. A dedicated group_id (e.g. "evallab") per case so memory writes are sandboxed.
//   3. A lab RevealX or the excli record/replay shim for reproducibility.
//
// Still unexercised in CI (it needs a live appliance), so the offline
// `--results` path in run-eval.js remains the reproducible one.
import fs from 'node:fs';
import path from 'node:path';
import { usageAsCaseMeta } from '../../lib/session-usage.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runOne(appUrl, c, backend, outDir, timeoutMs, pollMs) {
  // 1. create a session
  const create = await fetch(`${appUrl}/api/sessions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  if (!create.ok) throw new Error(`create session failed: ${create.status}`);
  const { id } = await create.json();

  // 2. start the investigation turn
  const msg = await fetch(`${appUrl}/api/sessions/${id}/message`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: c.prompt }),
  });
  if (!msg.ok) throw new Error(`message failed: ${msg.status}`);

  // 3. poll session summary until it stops running (simpler than parsing SSE)
  const deadline = Date.now() + timeoutMs;
  let running = true;
  while (running && Date.now() < deadline) {
    await sleep(pollMs);
    const s = await fetch(`${appUrl}/api/sessions`);
    const list = s.ok ? await s.json() : [];
    const me = list.find((x) => x.id === id);
    running = me ? me.running : false;
  }
  if (running) throw new Error(`case ${c.id}: timed out after ${Math.round(timeoutMs / 1000)}s`);

  const caseDir = path.join(outDir, c.id);
  fs.mkdirSync(caseDir, { recursive: true });

  // 4. fetch the verdict the agent wrote (via the files route)
  const vf = await fetch(`${appUrl}/api/sessions/${id}/files/evidence/verdict.json`);
  if (vf.ok) {
    fs.writeFileSync(path.join(caseDir, 'verdict.json'), await vf.text());
  } else {
    // agent produced no verdict — leave it absent; the scorer marks it inconclusive.
    console.warn(`case ${c.id}: no evidence/verdict.json (${vf.status})`);
  }

  // 5. capture what the case actually spent. Without this every live run scored
  // cost=0 — a cost comparison that silently reported "free" — so the only
  // trustworthy figures came from the in-app runner. The server computes it from
  // the transcript with the same sumUsage the in-app path uses; we only write it
  // out under the keys run-eval.js merges from meta.json.
  //
  // Ordering is safe: the turn's final usage (and the whole-turn cost) is pushed
  // before the session stops reporting `running`, which is what step 3 waits on.
  const uf = await fetch(`${appUrl}/api/sessions/${id}/usage`);
  if (uf.ok) {
    const u = await uf.json();
    fs.writeFileSync(path.join(caseDir, 'meta.json'), `${JSON.stringify(usageAsCaseMeta(u), null, 2)}\n`);
    if (!u.cost) {
      // Real and worth saying out loud rather than scoring as $0: a session with
      // no cost recorded is usually a turn that never ran, not a free one.
      console.warn(`case ${c.id}: usage reported no cost — check the turn actually ran`);
    }
  } else {
    console.warn(`case ${c.id}: could not read usage (${uf.status}) — this case will score as cost 0`);
  }
  return id;
}

// How often to ask whether the turn has finished. A real investigation runs for
// minutes, so 3s is cheap; tests inject a small value rather than sleeping
// through the default.
export async function runCases({ appUrl, cases, backend = 'claude', outDir, timeoutMs = 600_000, pollMs = 3000 }) {
  fs.mkdirSync(outDir, { recursive: true });
  for (const c of cases) {
    console.log(`[runner] ${c.id} …`);
    try { await runOne(appUrl, c, backend, outDir, timeoutMs, pollMs); }
    catch (e) { console.error(`[runner] ${c.id} failed: ${e.message}`); }
  }
  return outDir;
}
