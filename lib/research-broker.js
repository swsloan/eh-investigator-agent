import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ResearchService } from './research/service.js';
import {
  DEFAULT_BROKER_MAX_REQUEST_BYTES,
  DEFAULT_BROKER_REQUEST_TIMEOUT_MS,
  resolveBrokerWorkspace,
  SingleRequestBrokerLifecycle,
} from './single-request-broker.js';

export function createResearchSocketPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eh-research-broker-'));
  fs.chmodSync(dir, 0o700);
  return { dir, socketPath: path.join(dir, 'broker.sock') };
}

export class ResearchBroker {
  constructor({
    root = path.resolve(import.meta.dirname, '..'),
    sessions,
    getConfig,
    secretStore,
    service = null,
    logger = console,
    maxRequestBytes = DEFAULT_BROKER_MAX_REQUEST_BYTES,
    requestTimeoutMs = DEFAULT_BROKER_REQUEST_TIMEOUT_MS,
  } = {}) {
    this.root = root;
    this.sessions = sessions;
    this.getConfig = getConfig;
    this.secretStore = secretStore;
    this.service = service || new ResearchService({ getConfig, secretStore });
    this.logger = logger;
    this.socketDir = null;
    this.socketPath = null;
    this.lifecycle = new SingleRequestBrokerLifecycle({
      brokerName: 'Research broker',
      logger,
      maxRequestBytes,
      requestTimeoutMs,
      onRequest: (socket, line, context) => this.handleRequest(socket, line, context),
    });
  }

  get server() { return this.lifecycle.server; }

  get connections() { return this.lifecycle.connections; }

  start() {
    if (this.server) return this.socketPath;
    const { dir, socketPath } = createResearchSocketPath();
    this.socketDir = dir;
    this.socketPath = socketPath;
    this.lifecycle.listen(socketPath);
    return socketPath;
  }

  stop() {
    this.lifecycle.stop();
    try { if (this.socketPath) fs.rmSync(this.socketPath, { force: true }); } catch { /* best effort */ }
    try { if (this.socketDir) fs.rmSync(this.socketDir, { recursive: true, force: true }); } catch { /* best effort */ }
    this.socketPath = null;
    this.socketDir = null;
  }

  status(fsModule = fs) {
    const interfacePath = path.join(this.root, 'research-interface');
    let interfaceOk = false;
    try {
      interfaceOk = fsModule.statSync(interfacePath).isFile();
      fsModule.accessSync(interfacePath, fs.constants.X_OK);
    } catch { interfaceOk = false; }
    const listening = Boolean(this.server && this.socketPath && fsModule.existsSync(this.socketPath));
    const provider = this.service.status();
    return [
      {
        id: 'research_interface', label: 'Research interface', ok: interfaceOk, optional: false,
        message: interfaceOk ? './research-interface is executable.' : './research-interface is missing or not executable.',
      },
      {
        id: 'research_broker', label: 'Research broker', ok: listening, optional: false,
        message: listening ? 'The local research broker is listening.' : 'The local research broker is not listening.',
      },
      {
        id: 'research_provider', label: 'Web research provider', ok: provider.ok, optional: provider.effectiveProvider !== 'brave',
        message: provider.message,
      },
    ];
  }

  async handleRequest(socket, line, context) {
    try {
      const request = JSON.parse(line);
      if (!request || typeof request !== 'object' || Array.isArray(request)) {
        throw new Error('Invalid Research broker request.');
      }
      this.resolveAllowedCwd(typeof request.cwd === 'string' ? request.cwd : '');
      const operation = typeof request.operation === 'string' ? request.operation : '';
      const payload = request.payload && typeof request.payload === 'object' ? request.payload : {};
      const result = await this.service.execute(operation, payload, { signal: context.signal });
      this.lifecycle.finish(socket, { result });
    } catch (err) {
      this.lifecycle.finish(socket, { error: err.message || 'Research broker request failed.' });
    }
  }

  resolveAllowedCwd(cwd) {
    return resolveBrokerWorkspace(this.sessions, cwd, { brokerName: 'Research broker' }).cwd;
  }
}
