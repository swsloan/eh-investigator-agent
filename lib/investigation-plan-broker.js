import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  resolveBrokerWorkspace,
  SingleRequestBrokerLifecycle,
} from './single-request-broker.js';
import { executeInvestigationPlanOperation } from './investigation-plan.js';

const DEFAULT_PLAN_BROKER_TIMEOUT_MS = 10_000;
const PLAN_CAPABILITY_BYTES = 32;
// The plan payload itself is capped at 64 KiB. Leave bounded headroom for the
// operation/cwd envelope and JSON escaping at the local socket boundary.
const DEFAULT_PLAN_BROKER_MAX_REQUEST_BYTES = 96 * 1024;

function createSocketPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eh-investigation-plan-'));
  fs.chmodSync(dir, 0o700);
  return { dir, socketPath: path.join(dir, 'broker.sock') };
}

function executable(file, fsModule) {
  try {
    const stat = fsModule.statSync(file);
    if (!stat.isFile()) return false;
    fsModule.accessSync(file, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function eventView(result) {
  const { operation: _operation, changed: _changed, idempotent: _idempotent, ...view } = result;
  return view;
}

function compactResult(result) {
  if (result.operation === 'status') return result;
  return {
    ok: true,
    operation: result.operation,
    changed: result.changed,
    ...(result.idempotent ? { idempotent: true } : {}),
    initialized: result.initialized,
    structured: result.structured,
    revision: result.revision,
    progress: result.progress,
    ...(result.warnings ? { warnings: result.warnings } : {}),
  };
}

function capabilityError() {
  return Object.assign(
    new Error('Investigation plan capability is invalid or expired.'),
    { code: 'INVESTIGATION_PLAN_CAPABILITY_INVALID', statusCode: 403 },
  );
}

function sameWorkspace(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string' || !left || !right) return false;
  try {
    return fs.realpathSync.native(left) === fs.realpathSync.native(right);
  } catch {
    return path.resolve(left) === path.resolve(right);
  }
}

export class InvestigationPlanBroker {
  constructor({
    root = path.resolve(import.meta.dirname, '..'),
    sessions,
    logger = console,
    maxRequestBytes = DEFAULT_PLAN_BROKER_MAX_REQUEST_BYTES,
    requestTimeoutMs = DEFAULT_PLAN_BROKER_TIMEOUT_MS,
    executeOperation = executeInvestigationPlanOperation,
    randomBytes = crypto.randomBytes,
  } = {}) {
    this.root = root;
    this.sessions = sessions;
    this.logger = logger;
    this.executeOperation = executeOperation;
    this.randomBytes = randomBytes;
    this.socketDir = null;
    this.socketPath = null;
    this.capabilities = new Map(); // capability -> { sessionId, workspace }
    this.sessionCapabilities = new Map(); // sessionId -> capability
    this.lifecycle = new SingleRequestBrokerLifecycle({
      brokerName: 'Investigation plan broker',
      logger,
      maxRequestBytes,
      requestTimeoutMs,
      onRequest: (socket, line) => this.handleRequest(socket, line),
    });
  }

  get server() { return this.lifecycle.server; }

  get connections() { return this.lifecycle.connections; }

  start() {
    if (this.server) return this.socketPath;
    const { dir, socketPath } = createSocketPath();
    this.socketDir = dir;
    this.socketPath = socketPath;
    this.lifecycle.listen(socketPath);
    return socketPath;
  }

  stop() {
    this.lifecycle.stop();
    this.capabilities.clear();
    this.sessionCapabilities.clear();
    try { if (this.socketPath) fs.rmSync(this.socketPath, { force: true }); } catch { /* best effort */ }
    try { if (this.socketDir) fs.rmSync(this.socketDir, { recursive: true, force: true }); } catch { /* best effort */ }
    this.socketPath = null;
    this.socketDir = null;
  }

  status(fsModule = fs) {
    const interfacePath = path.join(this.root, 'investigation-plan');
    const interfaceOk = executable(interfacePath, fsModule);
    const brokerOk = Boolean(this.server && this.socketPath && fsModule.existsSync(this.socketPath));
    return [
      {
        id: 'investigation_plan_interface',
        label: 'Investigation plan interface',
        ok: interfaceOk,
        optional: false,
        message: interfaceOk ? './investigation-plan is executable.' : './investigation-plan is missing or not executable.',
      },
      {
        id: 'investigation_plan_broker',
        label: 'Investigation plan broker',
        ok: brokerOk,
        optional: false,
        message: brokerOk
          ? 'The local investigation plan broker is listening.'
          : 'The local investigation plan broker is not listening.',
      },
    ];
  }

  issueSessionCapability(sessionOrId, workspacePath) {
    const sessionId = typeof sessionOrId === 'string' ? sessionOrId : sessionOrId?.id;
    const workspace = workspacePath || (typeof sessionOrId === 'object' ? sessionOrId?.workspace : '');
    if (typeof sessionId !== 'string' || !sessionId || typeof workspace !== 'string' || !workspace) {
      throw new TypeError('A session id and workspace are required to issue a plan capability.');
    }
    this.revokeSessionCapability(sessionId);
    let capability;
    do {
      capability = this.randomBytes(PLAN_CAPABILITY_BYTES).toString('base64url');
    } while (this.capabilities.has(capability));
    this.capabilities.set(capability, {
      sessionId,
      workspace: path.resolve(workspace),
    });
    this.sessionCapabilities.set(sessionId, capability);
    return capability;
  }

  capabilityForSession(sessionOrId) {
    const sessionId = typeof sessionOrId === 'string' ? sessionOrId : sessionOrId?.id;
    const capability = typeof sessionId === 'string'
      ? this.sessionCapabilities.get(sessionId)
      : null;
    const record = capability ? this.capabilities.get(capability) : null;
    if (!record || record.sessionId !== sessionId) return '';
    if (typeof sessionOrId === 'object' && sessionOrId?.workspace
      && !sameWorkspace(record.workspace, sessionOrId.workspace)) {
      return '';
    }
    return capability;
  }

  revokeCapability(capability) {
    const record = typeof capability === 'string' ? this.capabilities.get(capability) : null;
    if (!record) return false;
    this.capabilities.delete(capability);
    if (this.sessionCapabilities.get(record.sessionId) === capability) {
      this.sessionCapabilities.delete(record.sessionId);
    }
    return true;
  }

  revokeSessionCapability(sessionOrId) {
    const sessionId = typeof sessionOrId === 'string' ? sessionOrId : sessionOrId?.id;
    const capability = typeof sessionId === 'string'
      ? this.sessionCapabilities.get(sessionId)
      : null;
    return capability ? this.revokeCapability(capability) : false;
  }

  sessionById(sessionId) {
    if (typeof this.sessions?.peek === 'function') return this.sessions.peek(sessionId);
    if (typeof this.sessions?.get === 'function') return this.sessions.get(sessionId);
    for (const session of this.sessions?.values?.() || []) {
      if (session?.id === sessionId) return session;
    }
    return null;
  }

  authorizeCapability(capability, cwd) {
    const record = typeof capability === 'string' ? this.capabilities.get(capability) : null;
    if (!record || this.sessionCapabilities.get(record.sessionId) !== capability) {
      throw capabilityError();
    }
    const session = this.sessionById(record.sessionId);
    if (!session || session.__lazySession || session.disposed || session.lifecycle?.closing) {
      throw capabilityError();
    }
    const resolved = resolveBrokerWorkspace(this.sessions, cwd, {
      brokerName: 'Investigation plan broker',
    });
    if (!sameWorkspace(record.workspace, resolved.workspace)
      || !sameWorkspace(session.workspace, resolved.workspace)) {
      throw capabilityError();
    }
    return { ...resolved, session };
  }

  handleRequest(socket, line) {
    try {
      const request = JSON.parse(line);
      if (!request || typeof request !== 'object' || Array.isArray(request)) {
        throw new Error('Invalid investigation plan broker request.');
      }
      const operation = typeof request.operation === 'string' ? request.operation : '';
      const payload = request.payload === undefined ? {} : request.payload;
      const cwd = typeof request.cwd === 'string' ? request.cwd : '';
      const capability = typeof request.capability === 'string' ? request.capability : '';
      const resolved = this.authorizeCapability(capability, cwd);
      const result = this.executeOperation(resolved.workspace, operation, payload);
      if (result.changed) {
        // The state mutation is already committed. UI invalidation and SSE are
        // best-effort notifications and cannot turn success into an ambiguous
        // broker error; reconnect/status reads recover from authoritative state.
        try {
          const { session } = resolved;
          if (session && !session.__lazySession) {
            // Upstream also invalidates a cached workspace inventory here. This
            // fork has none — AgentSession.listFiles() walks the workspace on
            // every call — so the cache arrives with the deferred P3c backend
            // slice, and this is the seam to restore it at.
            const event = { type: 'investigation_plan_updated', view: eventView(result) };
            // emit() reaches SSE subscribers without appending to the persisted
            // transcript: the transient delivery upstream asks for, and it keeps
            // plan churn out of the transcript P3b just bounded.
            session.emit?.('event', event);
          }
        } catch { /* committed state remains the source of truth */ }
      }
      this.lifecycle.finish(socket, { result: compactResult(result) });
    } catch (err) {
      this.lifecycle.finish(socket, {
        error: err?.message || 'Investigation plan request failed.',
        code: err?.code || 'INVESTIGATION_PLAN_ERROR',
        statusCode: Number(err?.statusCode) || 400,
      });
    }
  }

  resolveAllowedCwd(cwd, capability) {
    return this.authorizeCapability(capability, cwd);
  }
}
