// Record/replay store for excli calls ("cassettes"). Lets an eval run capture
// every excli request+response and replay them later without a live appliance —
// so eval runs can execute offline and against a frozen environment (a score
// change then reflects the agent/skill, not drifting telemetry).
//
// Note: replay stubs the excli/appliance calls only. The model still runs and
// reasons on every run, so replay is offline + deterministic-telemetry, not free.
// Also: downloaded PCAP *files* are not reproduced on replay (only the tool's
// JSON response is), so packet-tier workflows are best recorded, not replayed.
import fs from 'node:fs';
import path from 'node:path';

/** Stable key for a call. argv holds the tool + JSON body + flags (no secrets —
 *  credentials are injected as env into the child, never into argv). */
export function cassetteKey(argv = []) {
  return JSON.stringify(argv);
}

/** Load a cassette (.jsonl) into a key -> entry map. Missing file -> empty. */
export function loadCassette(file) {
  const map = new Map();
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return map; }
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try { const e = JSON.parse(t); map.set(e.key, e); } catch { /* skip bad line */ }
  }
  return map;
}

/** Append one recorded call. entry: { key, argv, stdout, stderr, exitCode } with
 *  stdout/stderr base64-encoded (matching the broker's wire encoding). */
export function appendCassette(file, entry) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(entry)}\n`);
}
