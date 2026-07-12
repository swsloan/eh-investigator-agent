import { execFile as execFileCallback } from 'node:child_process';
import { ClaudeSession } from './session.js';
import { createModelCatalog, REASONING_LEVELS } from './models.js';
import { runOneShot } from './oneshot.js';

const PROBE_TIMEOUT_MS = 15_000;

function firstLine(text = '') {
  return String(text).trim().split('\n').find(Boolean) || '';
}

async function detect(execFile = execFileCallback) {
  return new Promise((resolve) => {
    execFile('claude', ['--version'], { timeout: PROBE_TIMEOUT_MS, maxBuffer: 64 * 1024 }, (err, stdout = '', stderr = '') => {
      if (err) {
        resolve({
          ok: false,
          message: err.code === 'ENOENT'
            ? 'Claude Code was not found on PATH. Install it and run `claude` once to sign in.'
            : `Claude Code version check failed: ${(stderr || err.message || '').trim().split('\n').slice(-2).join(' ')}`,
        });
        return;
      }
      const version = firstLine(stdout);
      resolve({ ok: true, version, message: `Claude Code is installed${version ? ` (${version})` : ''}.` });
    });
  });
}

async function preflightChecks({ execFile = execFileCallback } = {}) {
  const probe = await detect(execFile);
  return [{
    id: 'claude',
    label: 'Claude Code',
    ok: probe.ok,
    optional: false,
    message: probe.message,
  }];
}

export const claudeBackend = {
  id: 'claude',
  label: 'Claude Code',
  defaultModelLabel: 'Claude default',
  defaultModelMeta: 'Configured in Claude Code',
  defaultLightModel: 'haiku', // cheap alias for title generation
  reasoningLevels: REASONING_LEVELS,
  Session: ClaudeSession,
  createModelCatalog,
  runOneShot,
  detect,
  preflightChecks,
  recoverSessionState: null, // Claude Code owns its own history; nothing to backfill
};
