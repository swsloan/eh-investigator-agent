// Broker for READ-ONLY detection tuning-rule access (suppression visibility).
//
// Mirrors the excli/research brokers: the agent runs a thin socket client
// (./tuning-interface) with no credentials in its environment, and this process
// makes the authenticated REST call. Credentials never cross into the workspace.
//
// Read-only by construction: it dispatches through executeTuningOperation, whose
// whole surface is GET requests. There is no create/update/delete path here, so
// enabling suppression *visibility* cannot become suppression *authorship* —
// writing a tuning rule belongs to the governed propose/approve path.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  DEFAULT_BROKER_MAX_REQUEST_BYTES,
  DEFAULT_BROKER_REQUEST_TIMEOUT_MS,
  resolveBrokerWorkspace,
  SingleRequestBrokerLifecycle,
} from './single-request-broker.js';
import { executeTuningOperation, TUNING_OPERATIONS } from './tuning-rules.js';
import { wrapUntrusted } from './telemetry-taint.js';
import { secureBrokerForWorker } from './worker-user.js';

export function createTuningSocketPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eh-tuning-broker-'));
  fs.chmodSync(dir, 0o700);
  return { dir, socketPath: path.join(dir, 'broker.sock') };
}

export class TuningBroker {
  constructor({
    root = path.resolve(import.meta.dirname, '..'),
    sessions,
    getConfig,
    secretStore,
    logger = console,
    maxRequestBytes = DEFAULT_BROKER_MAX_REQUEST_BYTES,
    requestTimeoutMs = DEFAULT_BROKER_REQUEST_TIMEOUT_MS,
    execute = executeTuningOperation,
  } = {}) {
    this.root = root;
    this.sessions = sessions;
    this.getConfig = getConfig;
    this.secretStore = secretStore;
    this.logger = logger;
    this.execute = execute;
    this.socketDir = null;
    this.socketPath = null;
    this.lifecycle = new SingleRequestBrokerLifecycle({
      brokerName: 'Tuning broker',
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
    const { dir, socketPath } = createTuningSocketPath();
    this.socketDir = dir;
    this.socketPath = socketPath;
    this.lifecycle.listen(socketPath);
    secureBrokerForWorker({ server: this.lifecycle.server, dir, socketPath });
    return socketPath;
  }

  stop() {
    this.lifecycle.stop();
    try { if (this.socketPath) fs.rmSync(this.socketPath, { force: true }); } catch { /* best effort */ }
    try { if (this.socketDir) fs.rmSync(this.socketDir, { recursive: true, force: true }); } catch { /* best effort */ }
    this.socketPath = null;
    this.socketDir = null;
  }

  async handleRequest(socket, line, context) {
    try {
      const request = JSON.parse(line);
      if (!request || typeof request !== 'object' || Array.isArray(request)) {
        throw new Error('Invalid Tuning broker request.');
      }
      // Same workspace check as the other brokers: the caller must be inside a
      // live session's workspace.
      resolveBrokerWorkspace(this.sessions, typeof request.cwd === 'string' ? request.cwd : '', { brokerName: 'Tuning broker' });
      const operation = typeof request.operation === 'string' ? request.operation : '';
      if (!TUNING_OPERATIONS.includes(operation)) {
        throw new Error(`Unknown tuning operation "${operation}". Supported: ${TUNING_OPERATIONS.join(', ')}.`);
      }
      const payload = request.payload && typeof request.payload === 'object' ? request.payload : {};
      const result = await this.execute(operation, payload, {
        cfg: this.getConfig?.() || {},
        secretStore: this.secretStore,
        signal: context?.signal || null,
      });

      // Rule descriptions and match criteria are written by operators and often
      // quote wire-derived values (hostnames, user agents, URIs), so this is
      // untrusted data like any other telemetry. `status` is our own answer about
      // local configuration, so it is not enveloped.
      if (operation === 'status') {
        this.lifecycle.finish(socket, { result });
        return;
      }
      const { text } = wrapUntrusted(JSON.stringify(result, null, 2), `tuning ${operation}`);
      this.lifecycle.finish(socket, { result: { enveloped: text } });
    } catch (err) {
      this.lifecycle.finish(socket, { error: err.message || 'Tuning broker request failed.' });
    }
  }

  status(fsModule = fs) {
    const interfacePath = path.join(this.root, 'tuning-interface');
    let interfaceOk = false;
    try {
      interfaceOk = fsModule.statSync(interfacePath).isFile();
      fsModule.accessSync(interfacePath, fs.constants.X_OK);
    } catch { interfaceOk = false; }
    const listening = Boolean(this.server && this.socketPath && fsModule.existsSync(this.socketPath));
    return [
      {
        id: 'tuning_interface', label: 'Tuning interface', ok: interfaceOk, optional: false,
        message: interfaceOk ? './tuning-interface is executable.' : './tuning-interface is missing or not executable.',
      },
      {
        id: 'tuning_broker', label: 'Tuning broker (read-only)', ok: listening, optional: false,
        message: listening ? 'The local tuning broker is listening.' : 'The local tuning broker is not listening.',
      },
    ];
  }
}
