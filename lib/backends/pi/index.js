import { execFile as execFileCallback } from 'node:child_process';
import { PiSession } from './session.js';
import { createModelCatalog, REASONING_LEVELS } from './models.js';
import { runOneShot } from './oneshot.js';
import { recoverPiSessionState } from './recovery.js';

const PROBE_TIMEOUT_MS = 15_000;

function plural(n, one, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

function firstLine(text = '') {
  return String(text).trim().split('\n').find(Boolean) || '';
}

async function detect(execFile = execFileCallback) {
  return new Promise((resolve) => {
    execFile('pi', ['--version'], { timeout: PROBE_TIMEOUT_MS, maxBuffer: 64 * 1024 }, (err, stdout = '') => {
      if (err) {
        resolve({
          ok: false,
          message: err.code === 'ENOENT'
            ? 'Pi CLI was not found on PATH.'
            : `Pi version check failed: ${(err.message || '').trim()}`,
        });
        return;
      }
      const version = firstLine(stdout);
      resolve({ ok: true, version, message: `Pi is installed${version ? ` (${version})` : ''}.` });
    });
  });
}

function modelErrorMessage(err) {
  const detail = (err.stderr || err.message || '').trim().split('\n').slice(-3).join(' ');
  if (err.code === 'ENOENT') return 'Pi CLI was not found on PATH.';
  if (/timed out/i.test(err.message || '')) return 'Pi model listing timed out.';
  return `Could not load Pi models${detail ? `: ${detail}` : '.'}`;
}

async function preflightChecks({ modelCatalog } = {}) {
  try {
    const models = await modelCatalog.list();
    return [
      { id: 'pi', label: 'Pi CLI', ok: true, optional: false, message: 'Pi CLI is available.' },
      {
        id: 'pi_models',
        label: 'Pi models',
        ok: models.length > 0,
        optional: false,
        message: models.length
          ? `${plural(models.length, 'Pi model')} available.`
          : 'Pi returned no models. Complete Pi provider setup.',
      },
    ];
  } catch (err) {
    const piMissing = err.code === 'ENOENT';
    return [
      {
        id: 'pi',
        label: 'Pi CLI',
        ok: !piMissing,
        optional: false,
        message: piMissing ? 'Pi CLI was not found on PATH.' : 'Pi CLI is available, but model listing failed.',
      },
      { id: 'pi_models', label: 'Pi models', ok: false, optional: false, message: modelErrorMessage(err) },
    ];
  }
}

export const piBackend = {
  id: 'pi',
  label: 'Pi',
  defaultModelLabel: 'Pi default',
  defaultModelMeta: 'Configured in Pi',
  defaultLightModel: '', // fall through to the main model for title generation
  reasoningLevels: REASONING_LEVELS,
  Session: PiSession,
  createModelCatalog,
  runOneShot,
  detect,
  preflightChecks,
  update: {
    mode: 'managed',
    displayCommand: 'pi update --self',
    checkUrl: 'https://pi.dev/api/latest-version',
    readLatestVersion: (body) => body?.ok && typeof body.version === 'string' ? body.version : '',
    executable: 'pi',
    args: ['update', '--self', '--no-approve'],
    timeoutMs: 10 * 60_000,
  },
  recoverSessionState: recoverPiSessionState,
};
