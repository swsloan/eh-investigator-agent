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
//
// PREREQUISITES before this is safe to run for real (tracked in DESIGN-eval-harness.md):
//   1. Read-only mode at the excli broker — IMPLEMENTED: start the app with
//      EH_BROKER_READONLY=1 and the broker rejects update_detection and other
//      write-class tools (see lib/excli-readonly.js).
//   2. A dedicated group_id (e.g. "evallab") per case so memory writes are sandboxed.
//   3. A lab RevealX or the excli record/replay shim for reproducibility.
//
// Until (1) lands, prefer the offline `--results` path in run-eval.js against
// recorded verdicts. This function is written to be correct-by-construction but
// is intentionally unexercised in CI.
import fs from 'node:fs';
import path from 'node:path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runOne(appUrl, c, backend, outDir, timeoutMs) {
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
    await sleep(3000);
    const s = await fetch(`${appUrl}/api/sessions`);
    const list = s.ok ? await s.json() : [];
    const me = list.find((x) => x.id === id);
    running = me ? me.running : false;
  }
  if (running) throw new Error(`case ${c.id}: timed out after ${Math.round(timeoutMs / 1000)}s`);

  // TODO(cost): live runs don't yet capture per-case cost/tokens — the runner
  // only fetches verdict.json, so the scorer sees cost=0. Capturing usage needs a
  // session-usage endpoint or transcript parse; until then use offline meta.json.

  // 4. fetch the verdict the agent wrote (via the files route)
  const vf = await fetch(`${appUrl}/api/sessions/${id}/files/evidence/verdict.json`);
  fs.mkdirSync(path.join(outDir, c.id), { recursive: true });
  if (vf.ok) {
    fs.writeFileSync(path.join(outDir, c.id, 'verdict.json'), await vf.text());
  } else {
    // agent produced no verdict — leave it absent; the scorer marks it inconclusive.
    console.warn(`case ${c.id}: no evidence/verdict.json (${vf.status})`);
  }
  return id;
}

export async function runCases({ appUrl, cases, backend = 'claude', outDir, timeoutMs = 600_000 }) {
  fs.mkdirSync(outDir, { recursive: true });
  for (const c of cases) {
    console.log(`[runner] ${c.id} …`);
    try { await runOne(appUrl, c, backend, outDir, timeoutMs); }
    catch (e) { console.error(`[runner] ${c.id} failed: ${e.message}`); }
  }
  return outDir;
}
