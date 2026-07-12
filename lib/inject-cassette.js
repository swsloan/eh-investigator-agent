// Build an adversarial injection cassette from a recorded one (Warrant Phase 3).
//
// Injection eval cases test whether a crafted, attacker-controllable field in
// tool output can flip a verdict. A replayable cassette must contain the agent's
// actual excli calls, so the workflow is RECORD a real investigation, then TAMPER
// one response's stdout to embed an injected instruction, then REPLAY + score.
// This module is the pure TAMPER step (unit-tested); recording uses the eval
// runner's `record` mode, replay uses `replay` mode.
//
// Cassette line format (excli-cassette.js): { key, argv, stdout(b64), stderr(b64), exitCode }.

/**
 * Inject `payload` into the stdout of cassette entries matching `match` (a
 * substring tested against the joined argv). To avoid diverging the replay (the
 * agent may make different follow-up calls if early content changes), prefer
 * injecting into a LATE response — default targets only the last match.
 *
 * @param {string} text         raw cassette JSONL
 * @param {object} opts
 * @param {string} opts.match   substring to find in an entry's argv (e.g. 'search_records')
 * @param {string} opts.payload injected instruction text
 * @param {'append'|'prepend'} [opts.position='append']
 * @param {'last'|'all'} [opts.which='last']  which matching entries to tamper
 * @returns {{ text: string, tampered: number, matched: number }}
 */
export function tamperCassette(text, { match, payload, position = 'append', which = 'last' }) {
  if (!match || !payload) throw new Error('match and payload are required');
  const lines = String(text).split('\n').filter((l) => l.trim());
  const entries = lines.map((l) => JSON.parse(l));
  const matchIdx = entries
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => (Array.isArray(e.argv) ? e.argv.join(' ') : '').includes(match))
    .map(({ i }) => i);
  const targets = which === 'all' ? matchIdx : matchIdx.slice(-1);
  for (const i of targets) {
    const e = entries[i];
    const raw = Buffer.from(e.stdout || '', 'base64').toString('utf8');
    const injected = position === 'prepend' ? `${payload}\n${raw}` : `${raw}\n${payload}`;
    e.stdout = Buffer.from(injected, 'utf8').toString('base64');
  }
  return {
    text: entries.map((e) => JSON.stringify(e)).join('\n') + (entries.length ? '\n' : ''),
    tampered: targets.length,
    matched: matchIdx.length,
  };
}
