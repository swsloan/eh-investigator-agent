import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { AgentSession, SYSTEM_PROMPT } from '../../agent-session.js';
import { buildScrubbedEnv } from '../../secrets.js';

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const LEGACY_EXCLI_WRAPPER_PATH = path.join(ROOT, 'excli');
const DEFAULT_IDLE_PROCESS_TIMEOUT_MS = Number(process.env.PI_IDLE_PROCESS_TIMEOUT_MS || 5 * 60_000);
const DEFAULT_PROACTIVE_COMPACTION_THRESHOLD_PERCENT = 70;
const DEFAULT_PROACTIVE_COMPACTION_TIMEOUT_MS = Number(process.env.PI_PROACTIVE_COMPACTION_TIMEOUT_MS || 10 * 60_000);
const COMPACTION_SKIP_RE = /^(Nothing to compact|Already compacted|Compaction cancelled)/i;

// Events that carry full message snapshots on every delta; we strip the heavy
// fields before forwarding to browsers and rely on deltas client-side.
function slimEvent(event) {
  if (event.type === 'message_update' && event.assistantMessageEvent?.partial) {
    const { partial, ...rest } = event.assistantMessageEvent;
    return { ...event, assistantMessageEvent: rest };
  }
  if (event.type === 'tool_execution_update') {
    const { partialResult, ...rest } = event;
    return rest;
  }
  if (event.type === 'agent_end') {
    return { type: 'agent_end' };
  }
  return event;
}

function removeLegacyExcliSymlink(workspace) {
  const legacyLink = path.join(workspace, 'excli');
  try {
    const stat = fs.lstatSync(legacyLink);
    if (stat.isSymbolicLink() && fs.readlinkSync(legacyLink) === LEGACY_EXCLI_WRAPPER_PATH) {
      fs.rmSync(legacyLink);
    }
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

function contextUsagePercent(contextUsage) {
  const percent = Number(contextUsage?.percent);
  if (Number.isFinite(percent)) return percent;
  const tokens = Number(contextUsage?.tokens);
  const contextWindow = Number(contextUsage?.contextWindow);
  if (tokens > 0 && contextWindow > 0) return (tokens / contextWindow) * 100;
  return null;
}

function messageUsagePercent(message, contextWindow) {
  const tokens = Number(message?.usage?.totalTokens);
  const window = Number(contextWindow);
  if (tokens > 0 && window > 0) return (tokens / window) * 100;
  return null;
}

function assistantError(message) {
  if (!message || message.role !== 'assistant') return null;
  if (message.stopReason !== 'error' && !message.errorMessage) return null;
  return message.errorMessage || 'Agent turn ended with an error.';
}

/**
 * One chat session backed by a long-lived `pi --mode rpc` process.
 *
 * @param {object} options
 * @param {string} [options.model]    pi --model pattern for this session
 * @param {string} [options.thinking] pi --thinking level for this session
 * @param {object} [options.env]      safe extra env vars, such as the excli broker socket
 * @param {Function} [options.redact] redacts events/errors before persistence or broadcast
 */
export class PiSession extends AgentSession {
  static backend = 'pi';

  constructor(id, workspaceRoot, options = {}) {
    super(id, workspaceRoot, options);
    this.pending = new Map(); // RPC response waiters by command id
    this.proc = null;
    this.processFailureNotified = false;
    this.stdoutBuf = '';
    this.idleProcessTimeoutMs = options.idleProcessTimeoutMs ?? DEFAULT_IDLE_PROCESS_TIMEOUT_MS;
    this.proactiveCompactionThresholdPercent = options.proactiveCompactionThresholdPercent ?? DEFAULT_PROACTIVE_COMPACTION_THRESHOLD_PERCENT;
    this.proactiveCompactionTimeoutMs = options.proactiveCompactionTimeoutMs ?? DEFAULT_PROACTIVE_COMPACTION_TIMEOUT_MS;
    this.idleDisposeTimer = null;
    this.inTurnCompactionAttempted = false;
    this.inTurnCompactionInFlight = false;

    this.restore();
    removeLegacyExcliSymlink(this.workspace);
    this.linkWorkspaceResources('.pi');
  }

  ensureProcess() {
    if (this.proc && this.proc.exitCode === null) return;
    this.clearIdleDisposeTimer();
    this.stdoutBuf = '';
    this.processFailureNotified = false;
    const args = [
      '--mode', 'rpc',
      '--session-id', this.id,
      '--no-context-files',
      '--approve', // trust the project-local skills we symlinked in
      '--append-system-prompt', SYSTEM_PROMPT,
    ];
    if (this.options.model) args.push('--model', this.options.model);
    if (this.options.thinking) args.push('--thinking', this.options.thinking);
    // Load the Graphiti memory extension (registers memory_search/memory_add)
    // when memory is enabled for this session.
    if (this.options.env?.EH_MEMORY_MCP_URL) {
      args.push('-e', path.join(ROOT, 'pi-extensions', 'graphiti-memory.ts'));
    }
    const proc = spawn('pi', args, {
      cwd: this.workspace,
      env: buildScrubbedEnv(process.env, this.options.env || {}),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.proc = proc;

    proc.stdout.on('data', (chunk) => {
      if (this.proc !== proc) return;
      this.stdoutBuf += chunk.toString();
      let nl;
      while ((nl = this.stdoutBuf.indexOf('\n')) !== -1) {
        const line = this.stdoutBuf.slice(0, nl);
        this.stdoutBuf = this.stdoutBuf.slice(nl + 1);
        if (!line.trim()) continue;
        let event;
        try {
          event = JSON.parse(line);
        } catch {
          continue;
        }
        this.handleEvent(event);
      }
    });

    proc.stderr.on('data', (chunk) => {
      if (this.proc !== proc) return;
      console.error(`[pi:${this.id.slice(0, 8)}]`, this.redact(chunk.toString().trim()));
    });

    proc.stdin.on('error', (err) => {
      if (this.proc !== proc) return;
      this.failProcess(`Agent process input failed: ${err.message}`);
    });

    proc.on('error', (err) => {
      if (this.proc !== proc) return;
      const message = err.code === 'ENOENT'
        ? 'Pi CLI was not found on PATH. Install Pi, open a new terminal, and restart the server.'
        : `Agent process failed to start: ${err.message}`;
      this.failProcess(message);
    });

    // Learn which model the session resolved to (and its context window).
    this.writeCommand({ type: 'get_state' });

    proc.on('exit', (code) => {
      if (this.proc !== proc) return;
      this.clearAbortKillTimer();
      this.clearIdleDisposeTimer();
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error(`Agent process exited (code ${code})`));
      }
      this.pending.clear();
      if (this.running) {
        this.running = false;
        this.pushEvent({ type: 'session_error', error: `Agent process exited unexpectedly (code ${code}). Your next message will restart it.` });
      }
      if (this.proc === proc) this.proc = null;
    });
    this.scheduleIdleDisposal();
  }

  failProcess(message) {
    if (this.processFailureNotified) return;
    this.processFailureNotified = true;
    this.clearAbortKillTimer();
    this.clearIdleDisposeTimer();
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(message));
    }
    this.pending.clear();
    this.running = false;
    this.pushEvent({ type: 'session_error', error: message });
    if (this.promptCount > 0) this.persist();
  }

  writeCommand(command) {
    if (!this.proc || this.proc.exitCode !== null) {
      throw new Error('Agent process is not running');
    }
    const line = JSON.stringify(command) + '\n';
    try {
      this.proc.stdin.write(line, (err) => {
        if (err) this.failProcess(`Agent process input failed: ${err.message}`);
      });
    } catch (err) {
      this.failProcess(`Agent process input failed: ${err.message}`);
      throw err;
    }
  }

  handleEvent(event) {
    this.lastActivity = Date.now();
    if (event.type === 'response' && event.id && this.pending.has(event.id)) {
      const pending = this.pending.get(event.id);
      clearTimeout(pending.timer);
      this.pending.delete(event.id);
      if (event.success) pending.resolve(event);
      else pending.reject(new Error(event.error || `${event.command || pending.command} failed`));
    }

    const completedPromptSource = event.type === 'agent_end' ? (this.activePromptSource || 'user') : null;
    const completedTurnError = event.type === 'agent_end' ? this.activeTurnError : null;
    if (event.type === 'agent_start') {
      this.running = true;
      this.activeTurnError = null;
      this.inTurnCompactionAttempted = false;
    }
    if (event.type === 'agent_end' || (event.type === 'response' && event.command === 'abort')) {
      this.running = false;
      this.clearAbortKillTimer();
    }
    if (event.type === 'agent_end') {
      // Re-read state after each run in case the model changed mid-session.
      this.send({ type: 'get_state' });
    }
    if (event.type === 'response' && event.success && event.command === 'set_model') {
      const m = event.data;
      if (m?.provider && m?.id) this.options.model = `${m.provider}/${m.id}`;
      this.send({ type: 'get_state' });
      return; // RPC plumbing; not part of the transcript
    }
    if (event.type === 'response' && event.success && event.command === 'set_thinking_level') {
      this.send({ type: 'get_state' });
      return; // RPC plumbing; not part of the transcript
    }
    if (event.type === 'response' && event.command === 'get_state' && event.success) {
      this.updateAgentState(event.data);
      return; // RPC plumbing; not part of the transcript
    }
    if (event.type === 'response') return; // RPC plumbing; not part of the transcript
    if (event.type === 'message_end' && event.message?.role === 'assistant') {
      const error = assistantError(event.message);
      if (error) this.activeTurnError = { message: this.redact(error) };
      this.maybeCompactDuringTurn(event.message);
    }
    const slim = this.redact(slimEvent(event));
    // Keep only what the UI needs to rebuild history on reconnect.
    if (['message_start', 'message_update', 'message_end',
         'tool_execution_start', 'tool_execution_end',
         'agent_start', 'agent_end', 'session_error'].includes(slim.type)) {
      this.transcript.push(slim);
    }
    this.emit('event', slim);
    if (event.type === 'agent_end') {
      this.persist();
      this.activePromptSource = null;
      this.emit('agent_end', {
        promptSource: completedPromptSource,
        promptCount: this.promptCount,
        hadError: Boolean(completedTurnError),
        errorMessage: completedTurnError?.message || '',
      });
      this.activeTurnError = null;
    }
    this.scheduleIdleDisposal();
  }

  send(command) {
    this.ensureProcess();
    this.writeCommand(command);
  }

  request(command, timeoutMs = 30_000) {
    this.ensureProcess();
    const id = command.id || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    const payload = { ...command, id };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${command.type} timed out`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, command: command.type });
      this.writeCommand(payload);
    });
  }

  updateAgentState(data = {}) {
    const m = data.model;
    this.agentState = {
      model: m ? { id: m.id, provider: m.provider, contextWindow: m.contextWindow || 0 } : null,
      thinkingLevel: data.thinkingLevel || null,
      requestedModel: this.options.model || '',
      requestedThinking: this.options.thinking || '',
      modelPinned: this.modelPinned,
    };
    this.emit('event', { type: 'session_state', ...this.agentState });
  }

  async setSessionModel({ provider, modelId, modelValue, thinking, pinned = true }) {
    if (this.running) throw new Error('Agent is already working — wait or abort before changing models.');
    this.lastActivity = Date.now();
    const previous = {
      model: this.options.model || '',
      thinking: this.options.thinking || '',
      modelPinned: this.modelPinned,
    };
    const processAlive = this.proc && this.proc.exitCode === null;
    this.options.model = modelValue || '';
    this.modelPinned = !!pinned;
    // For a live pi process, blank means "keep current/default"; for an
    // unstarted process, blank clears the spawn-time override.
    if (typeof thinking === 'string' && (thinking || !processAlive)) this.options.thinking = thinking;

    try {
      if (processAlive) {
        if (provider && modelId) await this.request({ type: 'set_model', provider, modelId });
        if (this.options.thinking) await this.request({ type: 'set_thinking_level', level: this.options.thinking });
        await this.request({ type: 'get_state' });
        this.persist();
      } else {
        this.persist();
        this.emit('event', {
          type: 'session_state',
          ...(this.agentState || {}),
          requestedModel: this.options.model || '',
          requestedThinking: this.options.thinking || '',
          modelPinned: this.modelPinned,
        });
      }
    } catch (err) {
      this.options.model = previous.model;
      this.options.thinking = previous.thinking;
      this.modelPinned = previous.modelPinned;
      this.persist();
      throw err;
    }
  }

  async maybeCompactBeforePrompt() {
    if (this.promptCount === 0) return false;
    let stats;
    try {
      stats = await this.request({ type: 'get_session_stats' });
    } catch (err) {
      console.warn(`[session:${this.id.slice(0, 8)}] context usage check failed:`, this.redact(err.message));
      return false;
    }

    const percent = contextUsagePercent(stats?.data?.contextUsage);
    if (percent === null || percent <= this.proactiveCompactionThresholdPercent) return false;

    try {
      await this.request({ type: 'compact' }, this.proactiveCompactionTimeoutMs);
      return true;
    } catch (err) {
      if (!COMPACTION_SKIP_RE.test(err.message || '')) {
        console.warn(`[session:${this.id.slice(0, 8)}] proactive compaction failed:`, this.redact(err.message));
      }
      return false;
    }
  }

  maybeCompactDuringTurn(message) {
    if (!this.running || !message || message.role !== 'assistant') return false;
    if (this.inTurnCompactionAttempted || this.inTurnCompactionInFlight) return false;
    if (!['toolUse', 'length'].includes(message.stopReason)) return false;

    const contextWindow = this.agentState?.model?.contextWindow;
    const percent = messageUsagePercent(message, contextWindow);
    if (percent === null || percent <= this.proactiveCompactionThresholdPercent) return false;

    this.inTurnCompactionAttempted = true;
    this.inTurnCompactionInFlight = true;
    this.request({ type: 'compact' }, this.proactiveCompactionTimeoutMs)
      .catch((err) => {
        if (!COMPACTION_SKIP_RE.test(err.message || '')) {
          console.warn(`[session:${this.id.slice(0, 8)}] in-turn compaction failed:`, this.redact(err.message));
        }
      })
      .finally(() => {
        this.inTurnCompactionInFlight = false;
      });
    return true;
  }

  async startPromptTurn(text, token) {
    await this.maybeCompactBeforePrompt();
    if (token !== this.promptStartToken) {
      this.running = false;
      this.activePromptSource = null;
      this.clearAbortKillTimer();
      return false;
    }

    this.promptCount++;
    if (!this.title) this.title = this.redact(text.slice(0, 60)); // placeholder until summarized
    this.send({ type: 'prompt', message: text });
    this.persist();
    return true;
  }

  handlePromptStartFailure(err, token) {
    if (token !== this.promptStartToken) return;
    this.running = false;
    this.activePromptSource = null;
    this.clearAbortKillTimer();
    this.pushEvent({
      type: 'session_error',
      error: `Agent turn could not start: ${err.message || 'unknown error'}`,
    });
    if (this.promptCount > 0) this.persist();
  }

  prompt(text, { source = 'user' } = {}) {
    this.lastActivity = Date.now();
    const token = ++this.promptStartToken;
    this.running = true;
    this.activePromptSource = source;
    this.activeTurnError = null;
    this.inTurnCompactionAttempted = false;
    return this.startPromptTurn(text, token).catch((err) => {
      this.handlePromptStartFailure(err, token);
      return false;
    });
  }

  abort() {
    this.promptStartToken++;
    if (this.proc && this.proc.exitCode === null) {
      this.send({ type: 'abort' });
      this.scheduleAbortKill();
    }
  }

  clearIdleDisposeTimer() {
    if (!this.idleDisposeTimer) return;
    clearTimeout(this.idleDisposeTimer);
    this.idleDisposeTimer = null;
  }

  scheduleIdleDisposal(delayMs = null) {
    this.clearIdleDisposeTimer();
    if (!this.idleProcessTimeoutMs || this.idleProcessTimeoutMs < 0) return;
    if (!this.proc || this.proc.exitCode !== null) return;
    const idleFor = Date.now() - this.lastActivity;
    const wait = delayMs ?? Math.max(0, this.idleProcessTimeoutMs - idleFor);
    this.idleDisposeTimer = setTimeout(() => this.reapIdleProcess(), wait);
    this.idleDisposeTimer.unref?.();
  }

  reapIdleProcess(now = Date.now()) {
    if (!this.proc || this.proc.exitCode !== null) return false;
    if (this.running || this.pending.size > 0) {
      this.scheduleIdleDisposal(this.idleProcessTimeoutMs);
      return false;
    }
    if (now - this.lastActivity < this.idleProcessTimeoutMs) {
      this.scheduleIdleDisposal();
      return false;
    }
    this.clearIdleDisposeTimer();
    if (this.promptCount > 0) this.persist();
    this.proc.kill();
    this.proc = null;
    this.stdoutBuf = '';
    return true;
  }

  handleAbortTimeout() {
    if (!this.proc || this.proc.exitCode !== null || !this.running) return false;
    this.clearIdleDisposeTimer();
    this.running = false;
    this.pushEvent({
      type: 'session_error',
      error: `Agent did not stop within ${Math.round(this.abortKillTimeoutMs / 1000)}s after abort; the process was killed. Your next message will restart it.`,
    });
    if (this.promptCount > 0) this.persist();
    this.proc.kill();
    this.proc = null;
    this.stdoutBuf = '';
    return true;
  }

  dispose() {
    this.clearIdleDisposeTimer();
    super.dispose();
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Session disposed'));
    }
    this.pending.clear();
    if (this.proc && this.proc.exitCode === null) this.proc.kill();
    this.proc = null;
  }
}
