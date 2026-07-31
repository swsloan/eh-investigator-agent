// Non-root agent worker for the Claude backend (#97).
//
// The control plane (root) spawns THIS entry as a child process lowered to the
// dedicated worker UID (see lib/worker-user.js). It hosts the Claude Agent SDK's
// `query()` so the `claude` CLI — and every Bash command the agent runs — inherits
// the non-root UID, which is what actually closes the /proc/1/environ and
// secrets.json vectors. The parent bridges this process's stdout back into the
// existing ClaudeSession event translation, so nothing about the UI stream changes.
//
// Protocol (newline-delimited JSON over stdio):
//   parent → stdin:  first line = init  { prompt, options, sessionId, taint }
//                    later lines = control { "type": "abort" }
//   stdout → parent: one line per SDK message (JSON.stringify(msg)); on failure a
//                    single { "__workerError": "<message>" } line, then exit 1.
//
// Non-serializable query options (abortController, the stderr forwarder, and the
// EH_EXMCP_TAINT PostToolUse hook) cannot cross the process boundary, so they are
// reconstructed HERE from the serializable init payload plus this process's env.

import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk';
import { taintToolResponse } from '../../telemetry-taint.js';

function writeLine(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

// Rebuild the injection-boundary PostToolUse hook (normally in session.js,
// gated by EH_EXMCP_TAINT) inside the worker, where the SDK runs.
function taintHooks(logPrefix) {
  return {
    PostToolUse: [{
      hooks: [async (input) => {
        try {
          const t = taintToolResponse(input?.tool_name, input?.tool_response);
          if (!t) return {};
          if (t.flags.length) {
            process.stderr.write(`[taint:${logPrefix}] ${input.tool_name} injection-suspected: ${t.flags.join(',')}\n`);
          }
          return { hookSpecificOutput: { hookEventName: 'PostToolUse', updatedToolOutput: t.text } };
        } catch (err) {
          process.stderr.write(`[taint] hook error: ${err.message}\n`);
          return {};
        }
      }],
    }],
  };
}

async function main() {
  const abortController = new AbortController();
  let query = null;
  let started = false;
  let aborted = false;

  const startQuery = ({ prompt, options = {}, sessionId = '', taint = false }) => {
    const logPrefix = String(sessionId || '').slice(0, 8) || 'worker';
    const fullOptions = {
      ...options,
      // The worker inherits the scrubbed session env as its own process env; the
      // SDK passes it to the `claude` CLI it spawns.
      env: process.env,
      abortController,
      stderr: (data) => { const s = String(data || ''); if (s) process.stderr.write(s); },
      ...(taint ? { hooks: taintHooks(logPrefix) } : {}),
    };
    query = sdkQuery({ prompt, options: fullOptions });
  };

  const handleControl = (msg) => {
    if (msg && msg.type === 'abort') {
      aborted = true;
      Promise.resolve(query?.interrupt?.()).catch(() => abortController.abort());
    }
  };

  // Line-framed stdin: the first complete line is the init envelope (which starts
  // the query); every later line is a control message.
  let buf = '';
  const onData = (chunk) => {
    buf += chunk.toString();
    let nl;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (!line.trim()) continue;
      let parsed;
      try { parsed = JSON.parse(line); } catch { continue; }
      if (!started) {
        started = true;
        try {
          startQuery(parsed);
          pump();
        } catch (err) {
          writeLine({ __workerError: err?.message || 'failed to start the agent query' });
          process.exitCode = 1;
          process.stdin.removeListener('data', onData);
        }
      } else {
        handleControl(parsed);
      }
    }
  };

  async function pump() {
    try {
      for await (const msg of query) writeLine(msg);
    } catch (err) {
      if (!aborted && !abortController.signal.aborted) {
        writeLine({ __workerError: err?.message || 'unknown error' });
        process.exitCode = 1;
      }
    } finally {
      process.stdin.removeListener('data', onData);
      // Let stdout flush, then stop reading stdin so the process can exit.
      process.stdin.pause();
    }
  }

  process.stdin.setEncoding('utf8');
  process.stdin.on('data', onData);
  process.stdin.on('end', () => { if (!started) process.exitCode = 0; });
}

main().catch((err) => {
  writeLine({ __workerError: err?.message || 'worker crashed' });
  process.exitCode = 1;
});
