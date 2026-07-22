import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { InvestigationPlanError } from './schema.js';

export const INVESTIGATION_PLAN_LOCK_FILENAME = '.investigation-plan.lock';
const LOCK_OWNER_FILENAME = 'owner.json';
const DEFAULT_LOCK_TIMEOUT_MS = 200;
const DEFAULT_LOCK_STALE_MS = 30_000;
const DEFAULT_LOCK_POLL_MS = 10;
const MAX_LOCK_METADATA_BYTES = 4 * 1024;
const SLEEP_ARRAY = new Int32Array(new SharedArrayBuffer(4));

function lockError(message, code, statusCode) {
  return new InvestigationPlanError(message, { code, statusCode });
}

function boundedNumber(value, fallback, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.floor(number)));
}

function settings(options = {}) {
  const lock = options.lock && typeof options.lock === 'object' ? options.lock : options;
  return {
    timeoutMs: boundedNumber(lock.timeoutMs, DEFAULT_LOCK_TIMEOUT_MS, 0, 5_000),
    staleMs: boundedNumber(lock.staleMs, DEFAULT_LOCK_STALE_MS, 100, 10 * 60_000),
    pollMs: boundedNumber(lock.pollMs, DEFAULT_LOCK_POLL_MS, 1, 1_000),
    now: typeof lock.now === 'function' ? lock.now : Date.now,
    hostname: typeof lock.hostname === 'string' && lock.hostname ? lock.hostname : os.hostname(),
  };
}

function nowMs(config) {
  const value = Number(config.now());
  return Number.isFinite(value) ? value : Date.now();
}

function sleep(milliseconds) {
  if (milliseconds > 0) Atomics.wait(SLEEP_ARRAY, 0, 0, milliseconds);
}

export function investigationPlanLockPath(workspace) {
  return path.join(workspace, INVESTIGATION_PLAN_LOCK_FILENAME);
}

function ownerPath(lockPath) {
  return path.join(lockPath, LOCK_OWNER_FILENAME);
}

function readOwner(lockPath) {
  const file = ownerPath(lockPath);
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_LOCK_METADATA_BYTES) return null;
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    if (typeof parsed.token !== 'string' || !parsed.token || parsed.token.length > 100) return null;
    if (!Number.isSafeInteger(parsed.pid) || parsed.pid <= 0) return null;
    if (typeof parsed.hostname !== 'string' || !parsed.hostname || parsed.hostname.length > 255) return null;
    if (!Number.isFinite(Number(parsed.createdAt))) return null;
    return parsed;
  } catch {
    return null;
  }
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    if (err?.code === 'ESRCH') return false;
    // EPERM means the process exists but cannot be signalled. Unknown
    // platform errors fail closed so an active lock is never stolen.
    return true;
  }
}

function lockSnapshot(lockPath, config) {
  let stat;
  try {
    stat = fs.lstatSync(lockPath);
  } catch (err) {
    if (err.code === 'ENOENT') return { exists: false };
    throw err;
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw lockError(
      `${INVESTIGATION_PLAN_LOCK_FILENAME} conflicts with the investigation plan lock directory.`,
      'PLAN_LOCK_CONFLICT',
      409,
    );
  }
  const owner = readOwner(lockPath);
  const ageMs = Math.max(0, nowMs(config) - stat.mtimeMs);
  const ownerIsDead = owner
    && owner.hostname === config.hostname
    && !processIsAlive(owner.pid);
  // A syntactically valid same-host owner whose PID is alive remains busy,
  // even when old. This fails closed for PID reuse instead of risking theft;
  // callers receive bounded PLAN_BUSY and can inspect/remove a confirmed
  // orphan explicitly.
  const stale = Boolean(ownerIsDead)
    || (!owner && ageMs >= config.staleMs)
    || (owner && owner.hostname !== config.hostname && ageMs >= config.staleMs);
  return { exists: true, owner, stale, stat };
}

function acquireReaper(lockPath, config) {
  const reaperPath = `${lockPath}.reap`;
  try {
    fs.mkdirSync(reaperPath, { mode: 0o700 });
    return reaperPath;
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
  }
  // A crashed stale-lock reaper must not permanently prevent recovery. A
  // reaper normally exists for only a few synchronous filesystem calls.
  try {
    const stat = fs.lstatSync(reaperPath);
    if (stat.isDirectory() && !stat.isSymbolicLink()
      && nowMs(config) - stat.mtimeMs >= config.staleMs) {
      fs.rmSync(reaperPath, { recursive: true, force: true });
      fs.mkdirSync(reaperPath, { mode: 0o700 });
      return reaperPath;
    }
  } catch { /* another process may already have recovered it */ }
  return null;
}

function reclaimStaleLock(lockPath, config) {
  const reaperPath = acquireReaper(lockPath, config);
  if (!reaperPath) return false;
  try {
    const snapshot = lockSnapshot(lockPath, config);
    if (!snapshot.exists || !snapshot.stale) return false;
    const quarantine = `${lockPath}.stale-${process.pid}-${crypto.randomUUID()}`;
    try {
      fs.renameSync(lockPath, quarantine);
    } catch (err) {
      if (err.code === 'ENOENT') return false;
      throw err;
    }
    try { fs.rmSync(quarantine, { recursive: true, force: true }); } catch { /* ignored debris is non-blocking */ }
    return true;
  } finally {
    try { fs.rmSync(reaperPath, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}

function releaseLock(lockPath, token) {
  const owner = readOwner(lockPath);
  if (!owner || owner.token !== token || owner.pid !== process.pid) return;
  try { fs.rmSync(lockPath, { recursive: true, force: true }); } catch { /* stale recovery handles leftovers */ }
}

export function withInvestigationPlanLock(workspace, callback, options = {}) {
  const config = settings(options);
  fs.mkdirSync(workspace, { recursive: true });
  const lockPath = investigationPlanLockPath(workspace);
  const startedAt = nowMs(config);
  const token = crypto.randomUUID();

  while (true) {
    try {
      fs.mkdirSync(lockPath, { mode: 0o700 });
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      const snapshot = lockSnapshot(lockPath, config);
      if (!snapshot.exists || (snapshot.stale && reclaimStaleLock(lockPath, config))) continue;
      const elapsed = nowMs(config) - startedAt;
      if (elapsed >= config.timeoutMs) {
        throw lockError(
          'The investigation plan is busy in another app process. Retry the operation.',
          'PLAN_BUSY',
          409,
        );
      }
      sleep(Math.min(config.pollMs, Math.max(1, config.timeoutMs - elapsed)));
      continue;
    }

    try {
      fs.writeFileSync(ownerPath(lockPath), `${JSON.stringify({
        version: 1,
        token,
        pid: process.pid,
        hostname: config.hostname,
        createdAt: nowMs(config),
      })}\n`, { flag: 'wx', mode: 0o600 });
    } catch (err) {
      try { fs.rmSync(lockPath, { recursive: true, force: true }); } catch { /* best effort */ }
      throw err;
    }
    try {
      return callback();
    } finally {
      releaseLock(lockPath, token);
    }
  }
}
