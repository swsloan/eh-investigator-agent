import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

export const DEFAULT_BROKER_MAX_REQUEST_BYTES = 64 * 1024;
export const DEFAULT_BROKER_REQUEST_TIMEOUT_MS = 35_000;

function isInsidePath(parent, child) {
  const rel = path.relative(parent, child);
  return rel === '' || (!!rel && !rel.startsWith('..') && !path.isAbsolute(rel));
}

function realDirectory(value, missingMessage) {
  try {
    const real = fs.realpathSync.native(value);
    if (!fs.statSync(real).isDirectory()) throw new Error('not a directory');
    return real;
  } catch {
    throw new Error(missingMessage);
  }
}

/** Resolve a request cwd to a currently registered workspace without materializing lazy sessions. */
export function resolveBrokerWorkspace(sessions, cwd, {
  brokerName,
} = {}) {
  const name = brokerName || 'Broker';
  if (!cwd) throw new Error(`${name} request did not include a working directory.`);
  const realCwd = realDirectory(cwd, `${name} working directory does not exist.`);

  // SessionRegistry keeps every workspace directly below one trusted root and
  // exposes peek() so authorization does not materialize a dormant session or
  // scan and realpath every investigation on each broker request.
  if (sessions?.workspacesRoot && typeof sessions.peek === 'function') {
    let rootReal;
    try { rootReal = fs.realpathSync.native(sessions.workspacesRoot); } catch { rootReal = null; }
    if (rootReal) {
      if (!isInsidePath(rootReal, realCwd)) {
        throw new Error(`${name} rejected a request outside a known session workspace.`);
      }
      const rel = path.relative(rootReal, realCwd);
      const id = rel && !path.isAbsolute(rel) ? rel.split(path.sep)[0] : '';
      const session = id ? sessions.peek(id) : null;
      if (session?.workspace) {
        try {
          const workspaceReal = fs.realpathSync.native(session.workspace);
          if (isInsidePath(workspaceReal, realCwd)) {
            return { cwd: realCwd, workspace: workspaceReal };
          }
        } catch { /* missing workspaces are not authorized */ }
      }
      throw new Error(`${name} rejected a request outside a known session workspace.`);
    }
  }

  for (const session of sessions?.values?.() || []) {
    try {
      const workspaceReal = fs.realpathSync.native(session.workspace);
      if (isInsidePath(workspaceReal, realCwd)) {
        return { cwd: realCwd, workspace: workspaceReal };
      }
    } catch { /* missing workspaces are not authorized */ }
  }
  throw new Error(`${name} rejected a request outside a known session workspace.`);
}

/**
 * Lifecycle and framing for one-line, one-request Unix-socket brokers.
 * Request handlers receive a per-connection AbortSignal that fires on client
 * disconnect, deadline, oversized input, or broker shutdown.
 */
export class SingleRequestBrokerLifecycle {
  constructor({
    brokerName,
    logger = console,
    maxRequestBytes = DEFAULT_BROKER_MAX_REQUEST_BYTES,
    requestTimeoutMs = DEFAULT_BROKER_REQUEST_TIMEOUT_MS,
    closeGraceMs = 250,
    onRequest,
  } = {}) {
    this.brokerName = brokerName || 'Broker';
    this.logger = logger;
    this.maxRequestBytes = Math.max(1, Number(maxRequestBytes) || DEFAULT_BROKER_MAX_REQUEST_BYTES);
    this.requestTimeoutMs = Math.max(1, Number(requestTimeoutMs) || DEFAULT_BROKER_REQUEST_TIMEOUT_MS);
    this.closeGraceMs = Math.max(1, Number(closeGraceMs) || 250);
    this.onRequest = onRequest;
    this.server = null;
    this.connections = new Map();
  }

  listen(socketPath) {
    if (this.server) return;
    const server = net.createServer((socket) => this.#handleConnection(socket));
    this.server = server;
    server.on('error', (err) => {
      this.logger?.error?.(`[${this.brokerName.toLowerCase().replaceAll(' ', '-')}] ${err?.code || 'socket error'}`);
    });
    server.listen(socketPath);
  }

  send(socket, message) {
    if (!socket || socket.destroyed || socket.writableEnded) {
      return { written: false, backpressured: false };
    }
    try {
      const flushed = socket.write(`${JSON.stringify(message)}\n`);
      return { written: true, backpressured: !flushed };
    } catch {
      return { written: false, backpressured: false };
    }
  }

  finish(socket, message) {
    if (message !== undefined) this.send(socket, message);
    if (socket && !socket.destroyed && !socket.writableEnded) socket.end();
  }

  stop() {
    for (const context of this.connections.values()) {
      context.controller.abort();
      context.socket.destroy();
    }
    this.connections.clear();
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }

  #fail(context, message) {
    if (context.closed) return;
    context.controller.abort();
    this.finish(context.socket, { error: message });
    const destroyTimer = setTimeout(() => context.socket.destroy(), this.closeGraceMs);
    destroyTimer.unref?.();
  }

  #handleConnection(socket) {
    const controller = new AbortController();
    const context = {
      socket,
      controller,
      signal: controller.signal,
      closed: false,
    };
    this.connections.set(socket, context);
    socket.setEncoding('utf8');
    socket.setNoDelay(true);

    const deadline = setTimeout(() => {
      this.#fail(context, `${this.brokerName} request timed out.`);
    }, this.requestTimeoutMs);
    deadline.unref?.();

    socket.once('close', () => {
      context.closed = true;
      clearTimeout(deadline);
      controller.abort();
      this.connections.delete(socket);
    });
    socket.on('error', () => {
      // Agent harnesses can disappear when a turn is aborted. Request data and
      // credential-adjacent transport errors must not be logged here.
    });

    let buffer = '';
    const onData = (chunk) => {
      buffer += chunk;
      if (Buffer.byteLength(buffer) > this.maxRequestBytes) {
        socket.removeListener('data', onData);
        this.#fail(context, `${this.brokerName} request is too large.`);
        return;
      }
      const newline = buffer.indexOf('\n');
      if (newline === -1) return;
      socket.removeListener('data', onData);
      socket.pause();
      Promise.resolve()
        .then(() => this.onRequest?.(socket, buffer.slice(0, newline), context))
        .catch(() => {
          this.#fail(context, `${this.brokerName} request failed.`);
        });
    };
    socket.on('data', onData);
  }
}
