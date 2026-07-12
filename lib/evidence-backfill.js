import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ENTITY_ARRAY_KEYS = ['devices', 'entities', 'items', 'results', 'data'];
const ENTITY_OBJECT_KEYS = ['device', 'entity', 'result'];
const DEVICE_LOOKUP_TIMEOUT_MS = 12_000;
const inflightDeviceLookups = new Set();

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function collectEntities(value, out = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectEntities(item, out);
    return out;
  }
  if (!isPlainObject(value)) return out;

  if (value.id !== undefined && value.id !== null && value.id !== '') out.push(value);
  for (const key of ENTITY_ARRAY_KEYS) {
    if (Array.isArray(value[key])) collectEntities(value[key], out);
  }
  for (const key of ENTITY_OBJECT_KEYS) {
    if (isPlainObject(value[key])) collectEntities(value[key], out);
  }
  return out;
}

function safeDeviceId(id) {
  const value = String(id ?? '').trim();
  return /^\d{1,20}$/.test(value) ? value : '';
}

function deviceFilename(id) {
  return `device-${id}.json`;
}

function parseEntityFile(session, relPath) {
  try {
    const abs = session.resolveFile(relPath);
    if (!fs.existsSync(abs) || !fs.lstatSync(abs).isFile()) return [];
    return collectEntities(JSON.parse(fs.readFileSync(abs, 'utf8')));
  } catch {
    return [];
  }
}

function atomicWriteJson(file, value) {
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
    fs.renameSync(tmp, file);
    fs.chmodSync(file, 0o600);
  } catch (err) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      // Best effort cleanup.
    }
    throw err;
  }
}

export function createEvidenceSummaryContext(session) {
  const entityById = new Map();
  for (const file of session.listFiles()) {
    if (!/^evidence\/entities\/[^/]+\.json$/i.test(file.path)) continue;
    for (const entity of parseEntityFile(session, file.path)) {
      if (entity.id !== undefined && entity.id !== null && entity.id !== '') {
        entityById.set(String(entity.id), entity);
      }
    }
  }
  return {
    entityById,
    pendingDeviceIds: new Set(),
  };
}

export function defaultDeviceLookup(session, id, { timeoutMs = DEVICE_LOOKUP_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, ...(session.options?.env || {}) };
    const numericId = Number(id);
    const requestId = Number.isSafeInteger(numericId) ? numericId : id;
    const child = spawn('./excli-interface', ['get_device', '-json', JSON.stringify({ id: requestId })], {
      cwd: session.workspace,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('Device lookup timed out.'));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(stderr.trim() || `Device lookup exited with status ${code}.`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(new Error('Device lookup did not return JSON.'));
      }
    });
  });
}

export function startDeviceEntityBackfills(session, ids, {
  lookupDevice = defaultDeviceLookup,
  logger = console,
} = {}) {
  const started = [];
  for (const rawId of ids || []) {
    const id = safeDeviceId(rawId);
    if (!id) continue;
    const key = `${session.id}:device:${id}`;
    if (inflightDeviceLookups.has(key)) continue;
    inflightDeviceLookups.add(key);
    started.push(id);
    Promise.resolve()
      .then(() => lookupDevice(session, id))
      .then((device) => {
        const entitiesDir = path.join(session.workspace, 'evidence', 'entities');
        fs.mkdirSync(entitiesDir, { recursive: true });
        atomicWriteJson(path.join(entitiesDir, deviceFilename(id)), device);
      })
      .catch((err) => {
        logger?.warn?.(`[evidence-backfill:${session.id.slice(0, 8)}] device ${id}: ${err.message}`);
      })
      .finally(() => {
        inflightDeviceLookups.delete(key);
      });
  }
  return started;
}
