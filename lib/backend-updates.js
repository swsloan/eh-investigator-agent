import { execFile as execFileCallback } from 'node:child_process';
import os from 'node:os';

const DEFAULT_CACHE_TTL_MS = 12 * 60 * 60_000;
const DEFAULT_CHECK_TIMEOUT_MS = 10_000;

export function normalizeVersion(value) {
  const match = String(value || '').match(/(?:^|\s|v)(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/);
  return match?.[1] || '';
}

export function compareVersions(left, right) {
  const parse = (value) => {
    const [core, prerelease = ''] = normalizeVersion(value).split('-', 2);
    return { numbers: core.split('.').map(Number), prerelease };
  };
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < 3; index++) {
    if ((a.numbers[index] || 0) !== (b.numbers[index] || 0)) {
      return (a.numbers[index] || 0) > (b.numbers[index] || 0) ? 1 : -1;
    }
  }
  if (a.prerelease === b.prerelease) return 0;
  if (!a.prerelease) return 1;
  if (!b.prerelease) return -1;
  return a.prerelease.localeCompare(b.prerelease, undefined, { numeric: true });
}

function runExecFile(execFile, command, args, options) {
  return new Promise((resolve, reject) => {
    execFile(command, args, options, (err, stdout = '', stderr = '') => {
      if (err) {
        err.stdout = stdout;
        err.stderr = stderr;
        reject(err);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function fetchJson(fetchFn, url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    const response = await fetchFn(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json', 'User-Agent': 'eh-investigator-agent/update-check' },
    });
    if (!response.ok) throw new Error(`Update service returned HTTP ${response.status}.`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function loadedSessions(sessions) {
  if (typeof sessions?.loadedValues === 'function') return sessions.loadedValues();
  return [...(sessions?.values?.() || [])].filter((session) => !session?.__lazySession);
}

export class BackendUpdateManager {
  constructor({
    getActiveBackend,
    sessions,
    getModelCatalog,
    detectBackends,
    isBackendBusy = () => false,
    fetchFn = globalThis.fetch,
    execFile = execFileCallback,
    cacheTtlMs = DEFAULT_CACHE_TTL_MS,
    checkTimeoutMs = DEFAULT_CHECK_TIMEOUT_MS,
    now = Date.now,
    cwd = os.tmpdir(),
  } = {}) {
    this.getActiveBackend = getActiveBackend;
    this.sessions = sessions;
    this.getModelCatalog = getModelCatalog;
    this.detectBackends = detectBackends;
    this.isBackendBusy = isBackendBusy;
    this.fetchFn = fetchFn;
    this.execFile = execFile;
    this.cacheTtlMs = cacheTtlMs;
    this.checkTimeoutMs = checkTimeoutMs;
    this.now = now;
    this.cwd = cwd;
    // The installed harness can change independently of this server (for
    // example, an operator can run `pi update` in another terminal). Keep only
    // the provider response cached; probe the local executable on every check.
    this.latestCache = new Map();
    this.lastStatus = new Map();
    this.updatingBackendId = '';
  }

  isUpdating(backendId = '') {
    return Boolean(this.updatingBackendId && (!backendId || this.updatingBackendId === backendId));
  }

  unavailable(backend, message) {
    return {
      backend: { id: backend.id, label: backend.label },
      status: 'unavailable',
      updateAvailable: false,
      managed: backend.update?.mode === 'managed',
      command: backend.update?.displayCommand || '',
      note: backend.update?.note || '',
      installedVersion: '',
      latestVersion: '',
      checkedAt: this.now(),
      message,
    };
  }

  async latestVersion(backend, { force = false } = {}) {
    const cached = this.latestCache.get(backend.id);
    if (!force && cached && cached.expiresAt > this.now()) {
      if (cached.error) throw new Error(cached.error);
      return cached.version;
    }

    try {
      const body = await fetchJson(this.fetchFn, backend.update.checkUrl, this.checkTimeoutMs);
      const version = normalizeVersion(backend.update.readLatestVersion(body));
      if (!version) throw new Error('Could not determine the latest version.');
      this.latestCache.set(backend.id, {
        version,
        expiresAt: this.now() + this.cacheTtlMs,
      });
      return version;
    } catch (err) {
      const message = err.message || 'unknown error';
      // Briefly cache provider failures while still re-probing the installed
      // executable on every request.
      this.latestCache.set(backend.id, {
        error: message,
        expiresAt: this.now() + Math.min(this.cacheTtlMs, 5 * 60_000),
      });
      throw err;
    }
  }

  async checkActive({ force = false, internal = false } = {}) {
    const backend = this.getActiveBackend();
    const policy = backend?.update;
    if (!backend || !policy) return this.unavailable(backend || { id: '', label: 'Backend' }, 'Update checks are not supported.');
    if (!internal && this.updatingBackendId === backend.id) {
      return {
        ...(this.lastStatus.get(backend.id) || this.unavailable(backend, 'Update in progress.')),
        status: 'updating',
        message: `Updating ${backend.label}…`,
      };
    }

    try {
      const [probe, latestVersion] = await Promise.all([
        backend.detect(this.execFile),
        this.latestVersion(backend, { force }),
      ]);
      if (!probe.ok) throw new Error(probe.message || `${backend.label} is not available.`);
      const installedVersion = normalizeVersion(probe.version);
      if (!installedVersion || !latestVersion) throw new Error('Could not determine installed and latest versions.');
      const updateAvailable = compareVersions(latestVersion, installedVersion) > 0;
      const value = {
        backend: { id: backend.id, label: backend.label },
        status: updateAvailable ? 'available' : 'current',
        updateAvailable,
        managed: policy.mode === 'managed',
        command: policy.displayCommand || '',
        note: policy.note || '',
        installedVersion,
        latestVersion,
        checkedAt: this.now(),
        message: updateAvailable
          ? `${backend.label} ${latestVersion} is available; ${installedVersion} is installed.`
          : `${backend.label} ${installedVersion} is up to date.`,
      };
      this.lastStatus.set(backend.id, value);
      return value;
    } catch (err) {
      const value = this.unavailable(backend, `Could not check for ${backend.label} updates: ${err.message || 'unknown error'}`);
      this.lastStatus.set(backend.id, value);
      return value;
    }
  }

  async updateActive() {
    const backend = this.getActiveBackend();
    const policy = backend?.update;
    if (!backend || policy?.mode !== 'managed') {
      const err = new Error(`${backend?.label || 'This backend'} must be updated manually.`);
      err.statusCode = 400;
      throw err;
    }
    if (this.updatingBackendId) {
      const err = new Error('A backend update is already in progress.');
      err.statusCode = 409;
      throw err;
    }

    const initialSessions = loadedSessions(this.sessions).filter((session) => session.backend === backend.id);
    if (initialSessions.some((session) => session.running) || this.isBackendBusy(backend.id)) {
      const err = new Error(`Wait for active ${backend.label} investigations to finish before updating.`);
      err.statusCode = 409;
      throw err;
    }

    const available = await this.checkActive();
    if (!available.updateAvailable) return available;

    this.updatingBackendId = backend.id;
    this.lastStatus.set(backend.id, {
      ...available,
      status: 'updating',
      message: `Updating ${backend.label}…`,
    });
    try {
      const relevantSessions = loadedSessions(this.sessions).filter((session) => session.backend === backend.id);
      if (relevantSessions.some((session) => session.running) || this.isBackendBusy(backend.id)) {
        const err = new Error(`A ${backend.label} operation became active; update cancelled.`);
        err.statusCode = 409;
        throw err;
      }
      for (const session of relevantSessions) {
        if (typeof session.prepareForHarnessUpdate === 'function') {
          const ready = await session.prepareForHarnessUpdate();
          if (!ready) {
            const err = new Error(`A ${backend.label} session became active; update cancelled.`);
            err.statusCode = 409;
            throw err;
          }
        }
      }

      await runExecFile(this.execFile, policy.executable, policy.args || [], {
        cwd: this.cwd,
        timeout: policy.timeoutMs || 10 * 60_000,
        maxBuffer: 1024 * 1024,
        env: process.env,
      });
      this.getModelCatalog?.(backend.id)?.clearCache?.();
      await this.detectBackends?.({ force: true });
      this.latestCache.delete(backend.id);
      const checked = await this.checkActive({ force: true, internal: true });
      const value = {
        ...checked,
        status: 'updated',
        updateAvailable: false,
        message: `${backend.label} was updated to ${checked.installedVersion || available.latestVersion}. It will reconnect on the next turn.`,
      };
      this.lastStatus.set(backend.id, value);
      return value;
    } catch (err) {
      const detail = String(err.stderr || err.message || '').trim().split('\n').slice(-3).join(' ');
      const value = {
        ...available,
        status: 'failed',
        message: `${backend.label} update failed${detail ? `: ${detail}` : '.'}`,
      };
      this.lastStatus.set(backend.id, value);
      err.publicState = value;
      if (!err.statusCode) err.statusCode = 502;
      throw err;
    } finally {
      this.updatingBackendId = '';
    }
  }
}
