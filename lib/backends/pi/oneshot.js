import { execFile as nodeExecFile } from 'node:child_process';
import { buildScrubbedEnv } from '../../secrets.js';

const DEFAULT_ONESHOT_TIMEOUT_MS = 240_000;

/**
 * Run a single tool-less, non-persisted Pi turn and return its stdout text.
 * Used for session-title generation and challenger reviews.
 */
export function runOneShot({
  prompt,
  model = '',
  reasoning = 'off',
  cwd,
  env = process.env,
  timeoutMs = DEFAULT_ONESHOT_TIMEOUT_MS,
  execFileFn = nodeExecFile,
} = {}) {
  const args = [
    '-p', '--no-session', '--no-tools', '--no-extensions',
    '--no-skills', '--no-context-files',
  ];
  if (reasoning) args.push('--thinking', reasoning);
  if (model) args.push('--model', model);
  args.push(prompt);

  return new Promise((resolve, reject) => {
    const child = execFileFn('pi', args, {
      cwd,
      env: buildScrubbedEnv(env),
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024,
    }, (err, stdout, stderr) => {
      if (err) {
        const detail = err.killed
          ? `Pi one-shot call timed out after ${Math.round(timeoutMs / 1000)}s`
          : (stderr || err.message || '').trim();
        reject(Object.assign(
          new Error(detail || `Pi process exited with code ${err.code ?? 'unknown'}.`),
          { code: err.code },
        ));
        return;
      }
      resolve(stdout);
    });
    child?.stdin?.end?.(); // pi -p blocks waiting for stdin EOF on a non-TTY pipe
  });
}
