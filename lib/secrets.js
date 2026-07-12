import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const EXTRA_HOP_SECRET_FIELDS = ['apiKey', 'clientId', 'clientSecret'];
// All secrets held by the store. The Anthropic key powers the Claude backend
// and memory extraction; it is kept out of EXTRA_HOP_SECRET_FIELDS so ExtraHop
// -specific logic (excli env, credentialsConfigured) is unaffected.
export const SECRET_FIELDS = [...EXTRA_HOP_SECRET_FIELDS, 'anthropicApiKey', 'claudeOauthToken'];
export const EXTRA_HOP_SECRET_ENV_KEYS = [
  'EXTRAHOP_API_KEY',
  'EXTRAHOP_CLIENT_ID',
  'EXTRAHOP_CLIENT_SECRET',
];
export const EXTRA_HOP_ENV_KEYS = [
  'EXTRAHOP_HOST',
  'EXTRAHOP_FAMILY',
  'EXTRAHOP_INSECURE',
  ...EXTRA_HOP_SECRET_ENV_KEYS,
];

const DEFAULT_SERVICE = 'ExtraHop Investigation Agent';
const DEFAULT_ACCOUNT = os.userInfo().username || 'local-user';

function pickSecrets(values = {}) {
  const out = {};
  for (const key of SECRET_FIELDS) {
    if (typeof values[key] === 'string' && values[key]) out[key] = values[key];
  }
  return out;
}

function parseStoredSecrets(raw) {
  if (!raw) return {};
  try {
    return pickSecrets(JSON.parse(raw));
  } catch {
    return {};
  }
}

function serializeSecrets(secrets) {
  return JSON.stringify(pickSecrets(secrets));
}

function commandExists(command, execFile = execFileSync) {
  try {
    execFile('command', ['-v', command], { stdio: 'ignore', timeout: 2_000 });
    return true;
  } catch {
    try {
      execFile('which', [command], { stdio: 'ignore', timeout: 2_000 });
      return true;
    } catch {
      return false;
    }
  }
}

class MemorySecretBackend {
  constructor(initial = {}) {
    this.id = 'memory';
    this.label = 'memory';
    this.secrets = pickSecrets(initial);
  }

  read() {
    return { ...this.secrets };
  }

  write(secrets) {
    this.secrets = pickSecrets(secrets);
  }

  clear() {
    this.secrets = {};
  }
}

/**
 * Plaintext file backend (0600), for headless/container installs with no OS
 * keyring. Same at-rest posture as a .env file; use only where that is
 * acceptable. Selected when EH_SECRETS_PATH is set (or EH_AGENT_SECRET_STORE=file).
 */
class FileSecretBackend {
  constructor({ file } = {}) {
    this.id = 'file';
    this.label = `file (${file})`;
    this.file = file;
  }

  read() {
    try {
      return parseStoredSecrets(fs.readFileSync(this.file, 'utf8'));
    } catch {
      return {};
    }
  }

  write(secrets) {
    const clean = pickSecrets(secrets);
    if (!Object.keys(clean).length) {
      this.clear();
      return;
    }
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, serializeSecrets(clean), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
    fs.chmodSync(this.file, 0o600);
  }

  clear() {
    try { fs.rmSync(this.file, { force: true }); } catch { /* best effort */ }
  }
}

class MacKeychainBackend {
  constructor({
    service = DEFAULT_SERVICE,
    account = DEFAULT_ACCOUNT,
    execFile = execFileSync,
  } = {}) {
    this.id = 'keychain';
    this.label = 'macOS Keychain';
    this.service = service;
    this.account = account;
    this.execFile = execFile;
  }

  read() {
    try {
      const raw = this.execFile('security', [
        'find-generic-password',
        '-a', this.account,
        '-s', this.service,
        '-w',
      ], { encoding: 'utf8', timeout: 5_000 });
      return parseStoredSecrets(raw.trim());
    } catch {
      return {};
    }
  }

  write(secrets) {
    const clean = pickSecrets(secrets);
    if (!Object.keys(clean).length) {
      this.clear();
      return;
    }
    this.execFile('security', [
      'add-generic-password',
      '-U',
      '-a', this.account,
      '-s', this.service,
      '-w', serializeSecrets(clean),
    ], { stdio: 'ignore', timeout: 5_000 });
  }

  clear() {
    try {
      this.execFile('security', [
        'delete-generic-password',
        '-a', this.account,
        '-s', this.service,
      ], { stdio: 'ignore', timeout: 5_000 });
    } catch {
      // Missing keychain items are fine.
    }
  }
}

class SecretServiceBackend {
  constructor({
    service = DEFAULT_SERVICE,
    account = DEFAULT_ACCOUNT,
    execFile = execFileSync,
  } = {}) {
    this.id = 'secret-service';
    this.label = 'Secret Service';
    this.service = service;
    this.account = account;
    this.execFile = execFile;
    this.attrs = ['service', this.service, 'account', this.account];
  }

  read() {
    try {
      const raw = this.execFile('secret-tool', ['lookup', ...this.attrs], {
        encoding: 'utf8',
        timeout: 5_000,
      });
      return parseStoredSecrets(raw.trim());
    } catch {
      return {};
    }
  }

  write(secrets) {
    const clean = pickSecrets(secrets);
    if (!Object.keys(clean).length) {
      this.clear();
      return;
    }
    this.execFile('secret-tool', [
      'store',
      '--label', this.service,
      ...this.attrs,
    ], {
      input: serializeSecrets(clean),
      stdio: ['pipe', 'ignore', 'ignore'],
      timeout: 5_000,
    });
  }

  clear() {
    try {
      this.execFile('secret-tool', ['clear', ...this.attrs], {
        stdio: 'ignore',
        timeout: 5_000,
      });
    } catch {
      // Missing Secret Service items are fine.
    }
  }
}

function defaultPersistentBackend({
  platform = process.platform,
  env = process.env,
  execFile = execFileSync,
} = {}) {
  const requested = (env.EH_AGENT_SECRET_STORE || '').toLowerCase();
  if (requested === 'memory' || requested === 'none') return null;
  // Plaintext file backend for headless/container installs (persists secrets
  // across restarts where no OS keyring exists). Explicit path wins over the
  // OS keyrings so a container reliably uses the mounted volume.
  if (requested === 'file' || env.EH_SECRETS_PATH) {
    return new FileSecretBackend({
      file: env.EH_SECRETS_PATH || path.join(os.homedir(), '.eh-investigator', 'secrets.json'),
    });
  }
  if ((requested === 'keychain' || (!requested && platform === 'darwin')) && commandExists('security', execFile)) {
    return new MacKeychainBackend({ execFile });
  }
  if ((requested === 'secret-service' || (!requested && platform === 'linux')) && commandExists('secret-tool', execFile)) {
    return new SecretServiceBackend({ execFile });
  }
  return null;
}

export class SecretStore {
  constructor({ backend = null, logger = console } = {}) {
    this.backend = backend;
    this.logger = logger;
    this.memory = new MemorySecretBackend();
    this.secrets = {};
    this.source = 'memory';
    if (backend) {
      try {
        this.secrets = pickSecrets(backend.read());
        this.source = Object.keys(this.secrets).length ? backend.id : 'memory';
      } catch (err) {
        this.warn(`Could not read ${backend.label || backend.id} secrets; using memory-only storage.`, err);
      }
    }
  }

  warn(message, err) {
    if (!this.logger?.warn) return;
    const detail = err?.message ? ` ${err.message}` : '';
    this.logger.warn(`${message}${detail}`);
  }

  get() {
    return { ...this.secrets };
  }

  values() {
    return Object.values(this.secrets).filter((value) => typeof value === 'string' && value);
  }

  hasAny() {
    return this.values().length > 0;
  }

  replace(nextSecrets, { persist = true, source = 'settings' } = {}) {
    this.secrets = pickSecrets(nextSecrets);
    return this.persistIfRequested(persist, source);
  }

  update(patch, options = {}) {
    const next = { ...this.secrets };
    for (const key of SECRET_FIELDS) {
      if (!Object.prototype.hasOwnProperty.call(patch, key)) continue;
      const value = patch[key];
      if (typeof value === 'string' && value) next[key] = value;
      else delete next[key];
    }
    return this.replace(next, options);
  }

  persistIfRequested(persist, source) {
    if (!persist) {
      this.memory.write(this.secrets);
      this.source = source || 'memory';
      return { persisted: false, source: this.source };
    }
    if (!this.backend) {
      this.memory.write(this.secrets);
      this.source = 'memory';
      return { persisted: false, source: this.source };
    }
    try {
      this.backend.write(this.secrets);
      this.source = Object.keys(this.secrets).length ? this.backend.id : 'memory';
      return { persisted: true, source: this.source };
    } catch (err) {
      this.memory.write(this.secrets);
      this.source = 'memory';
      this.warn(`Could not save ExtraHop secrets to ${this.backend.label || this.backend.id}; keeping them in memory only.`, err);
      return { persisted: false, source: this.source };
    }
  }
}

export function createSecretStore(options = {}) {
  const backend = Object.prototype.hasOwnProperty.call(options, 'backend')
    ? options.backend
    : defaultPersistentBackend(options);
  return new SecretStore({ backend, logger: options.logger });
}

export function scrubExtraHopEnv(env = process.env) {
  for (const key of Object.keys(env)) {
    if (key.startsWith('EXTRAHOP_')) delete env[key];
  }
}

export function stripExtraHopSecretsFromEnv(env = {}) {
  const clean = { ...env };
  for (const key of EXTRA_HOP_SECRET_ENV_KEYS) delete clean[key];
  return clean;
}

/** Environment for agent backends: inherited env + additions, ExtraHop secrets scrubbed. */
export function buildScrubbedEnv(baseEnv = process.env, additions = {}) {
  const env = { ...baseEnv, ...additions };
  scrubExtraHopEnv(env);
  return env;
}
