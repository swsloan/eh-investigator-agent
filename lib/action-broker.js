// Agent-facing broker for proposing write actions (Phase 1: governed write path).
//
// The agent connects over a per-run unix socket (via ./propose-action) to RECORD
// a write it wants a human to approve. This broker never executes anything — it
// validates the proposal against the live capability catalog and persists it.
// Execution is a separate, in-process, human-gated path (ExcliBroker.executeApproved
// invoked by the /api/actions decide route). Mirrors the excli / reversinglabs
// broker structure: same socket lifecycle and workspace-scoped cwd resolution.

import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createAction, validateProposalPayload } from './action-store.js';

const MAX_BROKER_REQUEST_BYTES = 64 * 1024;
const BROKER_SOCKET_TIMEOUT_MS = 15_000;

function sendMessage(socket, message) {
  if (!socket.destroyed) socket.write(`${JSON.stringify(message)}\n`);
}

export function createActionSocketPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eh-action-broker-'));
  fs.chmodSync(dir, 0o700);
  return { dir, socketPath: path.join(dir, 'broker.sock') };
}

export class ActionBroker {
  constructor({
    root = path.resolve(import.meta.dirname, '..'),
    excli,               // ExcliBroker: source of truth for capability catalog + cwd resolution
    broadcast = () => {}, // (sessionId, event) => void  — SSE fan-out
    logger = console,
  } = {}) {
    this.root = root;
    this.excli = excli;
    this.broadcast = broadcast;
    this.logger = logger;
    this.server = null;
    this.socketDir = null;
    this.socketPath = null;
    this.connections = new Set();
  }

  start() {
    if (this.server) return this.socketPath;
    const { dir, socketPath } = createActionSocketPath();
    this.socketDir = dir;
    this.socketPath = socketPath;
    this.server = net.createServer((socket) => this.handleConnection(socket));
    this.server.on('error', (err) => {
      this.logger?.error?.(`[action-broker] ${err?.code || 'socket error'}`);
    });
    this.server.listen(socketPath);
    return socketPath;
  }

  stop() {
    for (const socket of this.connections) socket.destroy();
    this.connections.clear();
    if (this.server) {
      this.server.close();
      this.server = null;
    }
    if (this.socketPath) {
      try { fs.rmSync(this.socketPath, { force: true }); } catch { /* best effort */ }
    }
    if (this.socketDir) {
      try { fs.rmSync(this.socketDir, { recursive: true, force: true }); } catch { /* best effort */ }
    }
    this.socketPath = null;
    this.socketDir = null;
  }

  handleConnection(socket) {
    this.connections.add(socket);
    socket.setEncoding('utf8');
    socket.setTimeout(BROKER_SOCKET_TIMEOUT_MS);
    let buffer = '';
    socket.on('timeout', () => socket.destroy());
    socket.on('close', () => this.connections.delete(socket));
    socket.on('error', () => { /* interface may exit early; no secret-bearing logs */ });
    socket.on('data', (chunk) => {
      buffer += chunk;
      if (Buffer.byteLength(buffer) > MAX_BROKER_REQUEST_BYTES) {
        sendMessage(socket, { error: 'Proposal request too large.' });
        socket.end();
        return;
      }
      const nl = buffer.indexOf('\n');
      if (nl === -1) return;
      socket.removeAllListeners('data');
      this.handleRequest(socket, buffer.slice(0, nl));
    });
  }

  handleRequest(socket, line) {
    let request;
    try {
      request = JSON.parse(line);
    } catch {
      sendMessage(socket, { error: 'Invalid proposal request.' });
      socket.end();
      return;
    }
    const cwd = typeof request.cwd === 'string' ? request.cwd : '';

    // The proposing call must originate inside a known session workspace. Reuse
    // the excli broker's resolver so "valid workspace" has a single definition.
    let session;
    let workspace;
    try {
      ({ session, workspace } = this.excli.resolveAllowedCwd(cwd));
    } catch (err) {
      sendMessage(socket, { error: err.message });
      socket.end();
      return;
    }

    let proposal;
    try {
      proposal = validateProposalPayload(request.payload);
    } catch (err) {
      sendMessage(socket, { error: err.message });
      socket.end();
      return;
    }

    // Validate against the live catalog: unknown tools are rejected, and
    // read-only tools are refused (the agent should just call those directly).
    const info = this.excli.describeCapability(proposal.capabilityId);
    if (info.catalogLoaded && !info.known) {
      sendMessage(socket, { error: `Unknown capability "${proposal.capabilityId}". Run ./excli-interface -listtools to see valid tools.` });
      socket.end();
      return;
    }
    if (info.accessType !== 'write') {
      sendMessage(socket, { error: `"${proposal.capabilityId}" is a read-only capability — call it directly via ./excli-interface; no approval is needed.` });
      socket.end();
      return;
    }

    let record;
    try {
      record = createAction(workspace, {
        sessionId: session.id,
        capabilityId: proposal.capabilityId,
        params: proposal.params,
        label: proposal.label,
        accessType: 'write',
        destructive: info.destructive,
      });
    } catch (err) {
      sendMessage(socket, { error: err.message || 'Could not record the proposal.' });
      socket.end();
      return;
    }

    this.broadcast(session.id, { type: 'action_proposed', action: record });
    this.logger?.info?.(`[action-broker] proposed ${record.capabilityId} (${record.id}) in session ${session.id.slice(0, 8)}`);
    sendMessage(socket, {
      result: {
        id: record.id,
        status: record.status,
        capabilityId: record.capabilityId,
        message: 'Proposal recorded and awaiting human approval. It has NOT executed. Do not claim the change happened until it shows "executed" in the pending-actions context.',
      },
    });
    socket.end();
  }
}
