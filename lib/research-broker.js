import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { ResearchService } from './research/service.js';

function isInsidePath(parent, child) {
  const rel = path.relative(parent, child);
  return rel === '' || (!!rel && !rel.startsWith('..') && !path.isAbsolute(rel));
}

function sendMessage(socket, message) {
  if (!socket.destroyed) socket.write(`${JSON.stringify(message)}\n`);
}

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
  } = {}) {
    this.root = root;
    this.sessions = sessions;
    this.getConfig = getConfig;
    this.secretStore = secretStore;
    this.service = service || new ResearchService({ getConfig, secretStore });
    this.logger = logger;
    this.server = null;
    this.socketDir = null;
    this.socketPath = null;
  }

  start() {
    if (this.server) return this.socketPath;
    const { dir, socketPath } = createResearchSocketPath();
    this.socketDir = dir;
    this.socketPath = socketPath;
    this.server = net.createServer((socket) => this.handleConnection(socket));
    this.server.on('error', (err) => this.logger?.error?.(`[research-broker] ${err.message}`));
    this.server.listen(socketPath);
    return socketPath;
  }

  stop() {
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

  handleConnection(socket) {
    socket.setEncoding('utf8');
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk;
      if (buffer.length > 64 * 1024) {
        sendMessage(socket, { error: 'Research broker request is too large.' });
        socket.end();
        return;
      }
      const nl = buffer.indexOf('\n');
      if (nl === -1) return;
      socket.removeAllListeners('data');
      this.handleRequest(socket, buffer.slice(0, nl));
    });
    socket.on('error', () => {});
  }

  async handleRequest(socket, line) {
    try {
      const request = JSON.parse(line);
      this.resolveAllowedCwd(typeof request.cwd === 'string' ? request.cwd : '');
      const operation = typeof request.operation === 'string' ? request.operation : '';
      const payload = request.payload && typeof request.payload === 'object' ? request.payload : {};
      const result = await this.service.execute(operation, payload);
      sendMessage(socket, { result });
    } catch (err) {
      sendMessage(socket, { error: err.message || 'Research broker request failed.' });
    } finally {
      socket.end();
    }
  }

  resolveAllowedCwd(cwd) {
    if (!cwd) throw new Error('Research broker request did not include a working directory.');
    let realCwd;
    try { realCwd = fs.realpathSync.native(cwd); } catch { throw new Error('Research broker working directory does not exist.'); }
    for (const session of this.sessions?.values?.() || []) {
      try {
        const workspace = fs.realpathSync.native(session.workspace);
        if (isInsidePath(workspace, realCwd)) return realCwd;
      } catch { /* ignore missing workspaces */ }
    }
    throw new Error('Research broker rejected a request outside a known session workspace.');
  }
}
