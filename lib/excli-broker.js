import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { buildExcliEnv } from './settings.js';
import { HELP_ARGS, normalizeArg, isMutatingTool, parseCapabilityCatalog } from './excli-readonly.js';
import { cassetteKey, loadCassette, appendCassette } from './excli-cassette.js';
import { wrapUntrusted } from './telemetry-taint.js';

export { isMutatingTool };

const CATALOG_LOAD_TIMEOUT_MS = 10_000;
const CATALOG_MAX_BUFFER = 8 * 1024 * 1024;
const EXECUTE_TIMEOUT_MS = 30_000;

const PCAP_DOWNLOAD_TOOL = 'download_pcap';

function isInsidePath(parent, child) {
  const rel = path.relative(parent, child);
  return rel === '' || (!!rel && !rel.startsWith('..') && !path.isAbsolute(rel));
}

export function needsPcapDownloadDirectory(argv = []) {
  if (normalizeArg(argv[0]) !== PCAP_DOWNLOAD_TOOL) return false;
  return !argv.slice(1).some((arg) => HELP_ARGS.has(normalizeArg(arg)));
}

function sendMessage(socket, message) {
  socket.write(`${JSON.stringify(message)}\n`);
}

function socketErrorMessage(err) {
  if (err?.code === 'ENOENT') return 'The ExtraHop CLI broker is not running.';
  if (err?.code === 'EACCES') return 'The ExtraHop CLI broker socket is not accessible.';
  return err?.message || 'The ExtraHop CLI broker request failed.';
}

export function createBrokerSocketPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eh-excli-broker-'));
  fs.chmodSync(dir, 0o700);
  return {
    dir,
    socketPath: path.join(dir, 'broker.sock'),
  };
}

export class ExcliBroker {
  constructor({
    root = path.resolve(import.meta.dirname, '..'),
    sessions,
    getConfig,
    secretStore,
    excliBinaryPath = path.join(root, 'bin', 'excli'),
    logger = console,
    readOnly = process.env.EH_BROKER_READONLY === '1',
  } = {}) {
    this.root = root;
    this.sessions = sessions;
    this.getConfig = getConfig;
    this.secretStore = secretStore;
    this.excliBinaryPath = excliBinaryPath;
    this.logger = logger;
    // Reject write-class tools (used by eval runs). Off by default.
    this.readOnly = readOnly;
    this.server = null;
    this.socketDir = null;
    this.socketPath = null;
    // Lazily-loaded annotation catalog (tool name -> {accessType, destructive}).
    // Null until the first successful `-jsonschema` load; guards fall back to the
    // heuristic while null, so classification is always safe.
    this.catalog = null;
  }

  start() {
    if (this.server) return this.socketPath;
    const { dir, socketPath } = createBrokerSocketPath();
    this.socketDir = dir;
    this.socketPath = socketPath;
    this.server = net.createServer((socket) => this.handleConnection(socket));
    this.server.on('error', (err) => {
      this.logger?.error?.(`[excli-broker] ${socketErrorMessage(err)}`);
    });
    this.server.listen(socketPath);
    // Warm the capability catalog in the background. Best-effort: on failure the
    // guards keep using the denylist heuristic (which agrees with the annotations).
    this.refreshCapabilityCatalog().catch(() => {});
    return socketPath;
  }

  /**
   * Load and cache tool annotations from `excli -jsonschema`. Best-effort and
   * non-fatal: returns null (and leaves the prior catalog in place) on any error.
   * `-jsonschema` is a static schema dump that needs no live appliance connection.
   */
  refreshCapabilityCatalog() {
    return new Promise((resolve) => {
      if (!this.checkExecutable(this.excliBinaryPath)) {
        resolve(null);
        return;
      }
      let env;
      try {
        env = buildExcliEnv(this.getConfig?.() || {}, this.secretStore, process.env);
      } catch {
        env = process.env;
      }
      execFile(
        this.excliBinaryPath,
        ['-jsonschema'],
        { env, timeout: CATALOG_LOAD_TIMEOUT_MS, maxBuffer: CATALOG_MAX_BUFFER },
        (err, stdout) => {
          if (err) {
            this.logger?.warn?.(`[excli-broker] capability catalog load failed: ${err.message}`);
            resolve(null);
            return;
          }
          const catalog = parseCapabilityCatalog(stdout);
          if (catalog) {
            this.catalog = catalog;
            this.logger?.info?.(`[excli-broker] loaded ${catalog.size} capability annotations`);
          } else {
            this.logger?.warn?.('[excli-broker] capability catalog was empty or unparseable; using heuristic');
          }
          resolve(catalog);
        },
      );
    });
  }

  /**
   * Classify a tool as 'read' or 'write' using the live catalog, falling back to
   * the heuristic. Shared by the read-only guard, Phase 1 propose-time validation,
   * and the audit read/write badge so enforcement and labeling never diverge.
   */
  accessTypeForTool(toolName) {
    return isMutatingTool([toolName], this.catalog) ? 'write' : 'read';
  }

  /**
   * Describe a capability for the propose-time validator: whether the live
   * catalog is loaded, whether the tool is known to it, its access type, and
   * whether it is destructive. During catalog warm-up (`catalogLoaded === false`)
   * the caller should skip the unknown-tool check and rely on the heuristic
   * access type; executeApproved re-validates against the catalog at run time.
   */
  describeCapability(toolName) {
    const key = normalizeArg(toolName);
    const entry = this.catalog ? this.catalog.get(key) : null;
    return {
      catalogLoaded: Boolean(this.catalog),
      known: Boolean(entry),
      accessType: entry ? entry.accessType : (isMutatingTool([key], null) ? 'write' : 'read'),
      destructive: entry ? entry.destructive : false,
    };
  }

  /**
   * Privileged, in-process execution of a human-approved write action. This is
   * the ONLY path that bypasses the read-only guard, and it is never reachable
   * over the agent's socket — only the /api/actions decide route calls it. Every
   * safety property is re-checked here (defense in depth):
   *   - the action must be in the 'approved' state;
   *   - the capability must still classify as write against the live catalog;
   *   - process-wide and per-session read-only (eval) modes refuse execution
   *     even after approval, so evals never mutate;
   *   - the workspace must resolve to a known session workspace.
   * Returns {ok, exitCode, stdout, stderr, error}; excli errors are reported in
   * the result, while guard violations reject the promise (uniform error channel
   * so the caller's single try/await/catch handles every failure).
   */
  async executeApproved(action, { workspace } = {}) {
    if (!action || action.status !== 'approved') {
      throw new Error('Only an approved action can be executed.');
    }
    if (this.readOnly) {
      throw new Error('Read-only mode is enabled: approved actions cannot be executed.');
    }
    const capabilityId = normalizeArg(action.capabilityId);
    if (this.accessTypeForTool(capabilityId) !== 'write') {
      throw new Error(`Refusing to execute "${action.capabilityId}": it is not a write capability.`);
    }
    // Confirm the workspace is a real session workspace, and honor per-session
    // read-only (eval) sessions.
    const { cwd, session } = this.resolveAllowedCwd(workspace);
    if (session?.options?.readOnly) {
      throw new Error('This session is read-only: approved actions cannot be executed.');
    }

    const params = action.params && typeof action.params === 'object' && !Array.isArray(action.params)
      ? action.params
      : {};
    const argv = [capabilityId, '-json', JSON.stringify(params)];
    const env = buildExcliEnv(this.getConfig(), this.secretStore, process.env);

    return new Promise((resolve) => {
      execFile(
        this.excliBinaryPath,
        argv,
        { cwd, env, timeout: EXECUTE_TIMEOUT_MS, maxBuffer: CATALOG_MAX_BUFFER },
        (err, stdout, stderr) => {
          const out = String(stdout || '');
          const errText = String(stderr || '');
          if (err && err.killed) {
            resolve({ ok: false, exitCode: null, stdout: out, stderr: errText, error: 'Execution timed out.' });
            return;
          }
          const exitCode = err ? (typeof err.code === 'number' ? err.code : 1) : 0;
          resolve({
            ok: exitCode === 0,
            exitCode,
            stdout: out,
            stderr: errText,
            error: exitCode === 0 ? null : (errText.trim() || `excli exited with code ${exitCode}.`),
          });
        },
      );
    });
  }

  stop() {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
    if (this.socketPath) {
      try {
        fs.rmSync(this.socketPath, { force: true });
      } catch { /* best effort */ }
    }
    if (this.socketDir) {
      try {
        fs.rmSync(this.socketDir, { recursive: true, force: true });
      } catch { /* best effort */ }
    }
    this.socketPath = null;
    this.socketDir = null;
  }

  status(fsModule = fs) {
    const checks = [];
    const interfacePath = path.join(this.root, 'excli-interface');
    const interfaceOk = this.checkExecutable(interfacePath, fsModule);
    const binaryOk = this.checkExecutable(this.excliBinaryPath, fsModule);
    checks.push({
      id: 'excli_interface',
      label: 'ExtraHop CLI interface',
      ok: interfaceOk,
      optional: false,
      message: interfaceOk
        ? './excli-interface is executable.'
        : './excli-interface is missing or not executable.',
    });
    checks.push({
      id: 'excli_broker',
      label: 'ExtraHop CLI broker',
      ok: Boolean(this.server && this.socketPath && fsModule.existsSync(this.socketPath)),
      optional: false,
      message: this.server && this.socketPath && fsModule.existsSync(this.socketPath)
        ? 'The local excli broker is listening.'
        : 'The local excli broker is not listening.',
    });
    checks.push({
      id: 'excli_binary',
      label: 'ExtraHop CLI binary',
      ok: binaryOk,
      optional: false,
      message: binaryOk
        ? 'bin/excli is executable.'
        : 'bin/excli is missing or not executable. Run ./start.sh to install the bundled binary for this platform.',
    });
    return checks;
  }

  checkExecutable(file, fsModule = fs) {
    try {
      const stat = fsModule.statSync(file);
      if (!stat.isFile()) return false;
      fsModule.accessSync(file, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }

  handleConnection(socket) {
    socket.setEncoding('utf8');
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk;
      const nl = buffer.indexOf('\n');
      if (nl === -1) return;
      const line = buffer.slice(0, nl);
      socket.removeAllListeners('data');
      this.handleRequest(socket, line);
    });
    socket.on('error', () => {
      // The interface may exit early if the caller aborts. No secret-bearing logs.
    });
  }

  handleRequest(socket, line) {
    let request;
    try {
      request = JSON.parse(line);
    } catch {
      sendMessage(socket, { error: 'Invalid excli broker request.' });
      socket.end();
      return;
    }
    const argv = Array.isArray(request.argv) ? request.argv : [];
    const cwd = typeof request.cwd === 'string' ? request.cwd : '';
    if (!argv.every((arg) => typeof arg === 'string')) {
      sendMessage(socket, { error: 'Invalid excli argument list.' });
      socket.end();
      return;
    }
    if (this.readOnly && isMutatingTool(argv, this.catalog)) {
      this.logger?.warn?.(`[excli-broker] read-only mode: rejected write-class tool "${argv[0]}"`);
      sendMessage(socket, { error: `Read-only mode is enabled: "${argv[0]}" is a write action and is disabled for this run. Investigate and report; do not modify the environment.` });
      socket.end();
      return;
    }
    let safeCwd;
    let workspace;
    let session;
    try {
      ({ cwd: safeCwd, workspace, session } = this.resolveAllowedCwd(cwd));
    } catch (err) {
      sendMessage(socket, { error: err.message });
      socket.end();
      return;
    }
    // Per-session read-only (eval sessions) in addition to the process-wide flag.
    if (session?.options?.readOnly && isMutatingTool(argv, this.catalog)) {
      this.logger?.warn?.(`[excli-broker] read-only session: rejected write-class tool "${argv[0]}"`);
      sendMessage(socket, { error: `Read-only mode is enabled: "${argv[0]}" is a write action and is disabled for this run. Investigate and report; do not modify the environment.` });
      socket.end();
      return;
    }
    // Record/replay (eval sessions). Replay serves recorded excli responses so
    // the run is offline against a frozen environment; record captures them.
    const cass = session?.options?.excli;
    if (cass?.mode === 'replay') {
      const hit = this.replayLookup(cass.file, argv);
      if (hit) {
        if (hit.stdout) { // envelope replayed stdout too, so injection cassettes exercise the boundary
          const raw = Buffer.from(hit.stdout, 'base64').toString('utf8');
          const { text } = wrapUntrusted(raw, `excli ${argv[0] || ''}`.trim());
          sendMessage(socket, { stream: 'stdout', data: Buffer.from(text, 'utf8').toString('base64') });
        }
        if (hit.stderr) sendMessage(socket, { stream: 'stderr', data: hit.stderr });
        sendMessage(socket, { exitCode: hit.exitCode ?? 0, signal: null });
        socket.end();
        return;
      }
      if (cass.onMiss !== 'live') {
        sendMessage(socket, { stream: 'stderr', data: Buffer.from(`excli replay: no recording for "${argv[0]}"\n`).toString('base64') });
        sendMessage(socket, { exitCode: 1, signal: null });
        socket.end();
        return;
      }
      // onMiss === 'live': fall through to a real (un-recorded) call.
    }

    const env = buildExcliEnv(this.getConfig(), this.secretStore, process.env);
    if (needsPcapDownloadDirectory(argv)) {
      const pcapDownloadDir = path.join(workspace, 'evidence', 'packets');
      fs.mkdirSync(pcapDownloadDir, { recursive: true });
      env.EXTRAHOP_PCAP_DOWNLOAD_DIRECTORY = pcapDownloadDir;
    }

    const child = spawn(this.excliBinaryPath, argv, {
      cwd: safeCwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // Buffer stdout so it can be returned as ONE untrusted-telemetry block
    // (Phase 3 injection boundary). excli results are bounded tool outputs, so
    // buffering (vs streaming) is fine and the model gets an atomic result. The
    // record cassette still captures the raw bytes (clean).
    const out = [];
    const rec = cass?.mode === 'record' ? { out: [], err: [] } : null;
    child.stdout.on('data', (chunk) => {
      out.push(chunk);
      if (rec) rec.out.push(chunk);
    });
    child.stderr.on('data', (chunk) => {
      if (rec) rec.err.push(chunk);
      sendMessage(socket, { stream: 'stderr', data: chunk.toString('base64') });
    });
    child.on('error', (err) => {
      sendMessage(socket, { error: socketErrorMessage(err) });
      socket.end();
    });
    child.on('exit', (code, signal) => {
      if (rec) {
        try {
          appendCassette(cass.file, {
            key: cassetteKey(argv),
            argv,
            stdout: Buffer.concat(rec.out).toString('base64'),
            stderr: Buffer.concat(rec.err).toString('base64'),
            exitCode: code ?? 1,
          });
        } catch (e) { this.logger?.warn?.(`[excli-broker] cassette write failed: ${e.message}`); }
      }
      // Envelope the full stdout as untrusted wire content before it reaches the agent.
      const { text } = wrapUntrusted(Buffer.concat(out).toString('utf8'), `excli ${argv[0] || ''}`.trim());
      sendMessage(socket, { stream: 'stdout', data: Buffer.from(text, 'utf8').toString('base64') });
      sendMessage(socket, { exitCode: code ?? 1, signal: signal || null });
      socket.end();
    });
  }

  /** Cached cassette lookup for replay. */
  replayLookup(file, argv) {
    if (!this._replayCache) this._replayCache = new Map();
    let map = this._replayCache.get(file);
    if (!map) { map = loadCassette(file); this._replayCache.set(file, map); }
    return map.get(cassetteKey(argv));
  }

  resolveAllowedCwd(cwd) {
    if (!cwd) throw new Error('excli broker request did not include a working directory.');
    let realCwd;
    try {
      realCwd = fs.realpathSync.native(cwd);
    } catch {
      throw new Error('excli broker working directory does not exist.');
    }
    for (const session of this.sessions?.values?.() || []) {
      let workspaceReal;
      try {
        workspaceReal = fs.realpathSync.native(session.workspace);
      } catch {
        continue;
      }
      if (isInsidePath(workspaceReal, realCwd)) return { cwd: realCwd, workspace: workspaceReal, session };
    }
    throw new Error('excli broker rejected a request outside a known session workspace.');
  }
}
