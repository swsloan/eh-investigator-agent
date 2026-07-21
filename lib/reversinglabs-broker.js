import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { redactValue } from './redaction.js';
import { ReversingLabsError } from './reversinglabs/client.js';
import { ReversingLabsService } from './reversinglabs/service.js';
import { resolveBrokerWorkspace } from './single-request-broker.js';

const MAX_BROKER_REQUEST_BYTES = 64 * 1024;
const BROKER_SOCKET_TIMEOUT_MS = 35_000;

function sendMessage(socket, message) {
  if (!socket.destroyed) socket.write(`${JSON.stringify(message)}\n`);
}

function safeErrorMessage(err) {
  if (err instanceof ReversingLabsError) return err.message;
  if (typeof err?.message === 'string' && err.message.startsWith('ReversingLabs broker ')) {
    return err.message;
  }
  return 'ReversingLabs broker request failed.';
}

export function createReversingLabsSocketPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eh-reversinglabs-broker-'));
  fs.chmodSync(dir, 0o700);
  return { dir, socketPath: path.join(dir, 'broker.sock') };
}

export class ReversingLabsBroker {
  constructor({
    root = path.resolve(import.meta.dirname, '..'),
    sessions,
    getConfig = () => ({}),
    secretStore = null,
    service = null,
    logger = console,
  } = {}) {
    this.root = root;
    this.sessions = sessions;
    this.getConfig = getConfig;
    this.secretStore = secretStore;
    this.service = service || new ReversingLabsService({ getConfig, secretStore });
    this.logger = logger;
    this.server = null;
    this.socketDir = null;
    this.socketPath = null;
    this.connections = new Set();
  }

  start() {
    if (this.server) return this.socketPath;
    const { dir, socketPath } = createReversingLabsSocketPath();
    this.socketDir = dir;
    this.socketPath = socketPath;
    this.server = net.createServer((socket) => this.handleConnection(socket));
    this.server.on('error', (err) => {
      this.logger?.error?.(`[reversinglabs-broker] ${err?.code || 'socket error'}`);
    });
    this.server.listen(socketPath);
    return socketPath;
  }

  stop() {
    for (const socket of this.connections) socket.destroy();
    this.connections.clear();
    this.service.abortAll?.();
    if (this.server) {
      this.server.close();
      this.server = null;
    }
    try { if (this.socketPath) fs.rmSync(this.socketPath, { force: true }); } catch { /* best effort */ }
    try { if (this.socketDir) fs.rmSync(this.socketDir, { recursive: true, force: true }); } catch { /* best effort */ }
    this.socketPath = null;
    this.socketDir = null;
  }

  status(fsModule = fs) {
    const integration = this.service.status();
    const interfacePath = path.join(this.root, 'reversinglabs-interface');
    let interfaceOk = false;
    try {
      interfaceOk = fsModule.statSync(interfacePath).isFile();
      fsModule.accessSync(interfacePath, fs.constants.X_OK);
    } catch { interfaceOk = false; }
    const listening = Boolean(this.server && this.socketPath && fsModule.existsSync(this.socketPath));
    const optional = !integration.enabled;
    return [
      {
        id: 'reversinglabs_interface',
        label: 'ReversingLabs interface',
        ok: interfaceOk,
        optional,
        message: interfaceOk
          ? './reversinglabs-interface is executable.'
          : './reversinglabs-interface is missing or not executable.',
      },
      {
        id: 'reversinglabs_broker',
        label: 'ReversingLabs broker',
        ok: listening,
        optional,
        message: listening
          ? 'The local ReversingLabs broker is listening.'
          : 'The local ReversingLabs broker is not listening.',
      },
      {
        id: 'reversinglabs_configuration',
        label: 'ReversingLabs integration',
        ok: !integration.enabled || integration.configured,
        optional,
        message: integration.message,
      },
    ];
  }

  handleConnection(socket) {
    this.connections.add(socket);
    socket.once('close', () => this.connections.delete(socket));
    socket.setEncoding('utf8');
    socket.setTimeout(BROKER_SOCKET_TIMEOUT_MS, () => {
      sendMessage(socket, { error: 'ReversingLabs broker request timed out.' });
      socket.end();
    });
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk;
      if (Buffer.byteLength(buffer) > MAX_BROKER_REQUEST_BYTES) {
        socket.removeAllListeners('data');
        sendMessage(socket, { error: 'ReversingLabs broker request is too large.' });
        socket.end();
        return;
      }
      const newline = buffer.indexOf('\n');
      if (newline === -1) return;
      socket.removeAllListeners('data');
      this.handleRequest(socket, buffer.slice(0, newline));
    });
    socket.on('error', () => {
      // The interface can disappear if an agent turn is aborted. Never log
      // request data or credential-adjacent transport details here.
    });
  }

  async handleRequest(socket, line) {
    try {
      let request;
      try { request = JSON.parse(line); } catch {
        throw new ReversingLabsError('Invalid ReversingLabs broker request.', {
          code: 'RL_BROKER_REQUEST_INVALID',
        });
      }
      if (!request || typeof request !== 'object' || Array.isArray(request)) {
        throw new ReversingLabsError('Invalid ReversingLabs broker request.', {
          code: 'RL_BROKER_REQUEST_INVALID',
        });
      }
      this.resolveAllowedCwd(typeof request.cwd === 'string' ? request.cwd : '');
      const operation = typeof request.operation === 'string' ? request.operation : '';
      const payload = request.payload === undefined ? {} : request.payload;
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new ReversingLabsError('ReversingLabs operation payload must be a JSON object.', {
          code: 'RL_BROKER_REQUEST_INVALID',
        });
      }
      const result = await this.service.execute(operation, payload);
      sendMessage(socket, { result: redactValue(result, this.secretStore) });
    } catch (err) {
      sendMessage(socket, { error: safeErrorMessage(err) });
    } finally {
      socket.end();
    }
  }

  resolveAllowedCwd(cwd) {
    return resolveBrokerWorkspace(this.sessions, cwd, {
      brokerName: 'ReversingLabs broker',
    }).cwd;
  }
}
