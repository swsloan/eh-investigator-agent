import { spawn } from 'node:child_process';
import path from 'node:path';
import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk';
import { AgentSession, SYSTEM_PROMPT } from '../../agent-session.js';
import { taintToolResponse } from '../../telemetry-taint.js';
import { contextWindowForModel, reasoningOptions } from './models.js';
import { buildScrubbedEnv } from '../../secrets.js';
import { workerSpawnUser } from '../../worker-user.js';

// The non-root worker entry (#97), spawned when worker isolation is active.
const WORKER_ENTRY = path.join(import.meta.dirname, 'worker-entry.js');

/** Map Anthropic API usage onto the shape the web UI accumulates. */
function mapUsage(usage = {}, costTotal = 0) {
  const input = usage.input_tokens || 0;
  const output = usage.output_tokens || 0;
  const cacheRead = usage.cache_read_input_tokens || 0;
  const cacheWrite = usage.cache_creation_input_tokens || 0;
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    totalTokens: input + output + cacheRead + cacheWrite,
    cost: { total: costTotal },
  };
}

/**
 * Preserve content-block positions so streamed delta indexes line up with the
 * final message content in the UI. Non-text blocks become typed placeholders.
 */
function slimContent(content = []) {
  return content.map((block) => {
    if (block.type === 'text') return { type: 'text', text: block.text || '' };
    if (block.type === 'thinking') return { type: 'thinking' };
    return { type: block.type || 'other' };
  });
}

function normalizeToolResultContent(content) {
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  if (!Array.isArray(content)) return [];
  return content
    .filter((item) => item?.type === 'text' && typeof item.text === 'string')
    .map((item) => ({ type: 'text', text: item.text }));
}

/**
 * One chat session backed by Claude Code via the Claude Agent SDK.
 *
 * Each user turn runs a fresh `query()` that resumes the persisted Claude
 * session ID, so there is no long-lived agent process to babysit: no idle
 * reaping, no RPC plumbing, and context compaction is handled by Claude Code
 * itself. The adapter translates SDK messages into the event vocabulary the
 * web UI already speaks (agent_start/end, message_*, tool_execution_*).
 *
 * @param {object} options
 * @param {string} [options.model]    Claude model alias for this session
 * @param {string} [options.thinking] reasoning level ('', off, low..max)
 * @param {object} [options.env]      safe extra env vars, such as the excli broker socket
 * @param {Function} [options.redact] redacts events/errors before persistence or broadcast
 * @param {Function} [options.queryFn] SDK query() override for tests
 */
export class ClaudeSession extends AgentSession {
  static backend = 'claude';

  constructor(id, workspaceRoot, options = {}) {
    super(id, workspaceRoot, options);
    this.claudeSessionId = null; // Claude Code session ID used for resume
    this.queryFn = options.queryFn || sdkQuery;
    // Resolve the non-root worker identity, or null to run in-process (#97).
    // Overridable for tests; may throw (fail closed) when hardened + misconfigured.
    this.resolveSpawnUser = options.workerSpawnUserFn || workerSpawnUser;
    // Lets tests drive the subprocess bridge without a real child.
    this.spawnWorkerFn = options.spawnWorkerFn || null;
    this.abortController = null;
    this.activeQuery = null;
    this.workerProc = null;
    this.toolNames = new Map(); // tool_use_id -> tool name for result labeling
    // tool_use_id -> the delegating Task call it belongs to, for subagent calls
    // only (#120 slice 0). Lets a tool_result be threaded back to the same
    // parent its start reported, independent of the message it arrives on.
    this.subagentCalls = new Map();
    // Content-block cursor within the current assistant message. The SDK
    // delivers each block as its own `assistant` message (content=[block]), so
    // message_end must report each block's true index to line up with the
    // streamed deltas — otherwise a leading thinking block shifts text and the
    // UI renders it twice.
    this.assistantBlockIndex = 0;

    this.restore();
    this.linkWorkspaceResources('.claude');
  }

  restoreExtras(s) {
    this.claudeSessionId = typeof s.claudeSessionId === 'string' ? s.claudeSessionId : null;
  }

  persistExtras() {
    return { claudeSessionId: this.claudeSessionId };
  }

  updateAgentState(model = null) {
    const known = this.agentState?.model || null;
    this.agentState = {
      model: model
        ? { id: model, provider: 'anthropic', contextWindow: contextWindowForModel(model) }
        : known,
      thinkingLevel: this.options.thinking || null,
      requestedModel: this.options.model || '',
      requestedThinking: this.options.thinking || '',
      modelPinned: this.modelPinned,
    };
    this.emit('event', { type: 'session_state', ...this.agentState });
  }

  /**
   * Change the model/reasoning for future turns. With per-turn queries there
   * is no live process to reconfigure; the next prompt picks these up.
   */
  async setSessionModel({ modelValue, thinking, pinned = true } = {}) {
    if (this.running) throw new Error('Agent is already working — wait or abort before changing models.');
    this.lastActivity = Date.now();
    this.options.model = modelValue || '';
    this.modelPinned = !!pinned;
    if (typeof thinking === 'string') this.options.thinking = thinking;
    this.persist();
    this.updateAgentState(this.agentState?.model?.id || null);
  }

  /**
   * The scrubbed environment the agent CLI runs with. Used both for the in-process
   * query (options.env) and, when worker isolation is active, as the spawned
   * worker's own process env — so the two paths run the agent identically (#97).
   */
  buildChildEnv() {
    const env = buildScrubbedEnv(process.env, this.options.env || {});
    if (this.options.subscriptionAuth) {
      // Use the Claude Code /login (Pro/Max) instead of an API key: Claude Code
      // prefers ANTHROPIC_API_KEY when present, so hide it (and the OAuth env
      // token) to fall back to the stored subscription credentials.
      delete env.ANTHROPIC_API_KEY;
      delete env.ANTHROPIC_AUTH_TOKEN;
    }
    return env;
  }

  /**
   * The JSON-serializable subset of the query options — everything except the
   * environment and the function/instance-valued fields (abortController, the
   * stderr forwarder, the taint hook). This is what crosses the process boundary
   * to the non-root worker, which reconstructs the rest (see worker-entry.js).
   */
  buildSerializableQueryOptions() {
    return {
      cwd: this.workspace,
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      systemPrompt: { type: 'preset', preset: 'claude_code', append: SYSTEM_PROMPT },
      settingSources: ['project'],
      includePartialMessages: true,
      ...(this.options.model ? { model: this.options.model } : {}),
      ...reasoningOptions(this.options.thinking),
      ...(this.options.mcpServers && Object.keys(this.options.mcpServers).length
        ? { mcpServers: this.options.mcpServers }
        : {}),
      ...(this.claudeSessionId ? { resume: this.claudeSessionId } : {}),
    };
  }

  buildQueryOptions() {
    return {
      ...this.buildSerializableQueryOptions(),
      env: this.buildChildEnv(),
      // Phase 3 injection boundary (exmcp path): a PostToolUse hook that wraps
      // attacker-controllable MCP tool output in an <untrusted-telemetry> envelope
      // via the SDK's updatedToolOutput. Verified to fire, but GATED OFF by default
      // (EH_EXMCP_TAINT=1) because in practice the agent does all ExtraHop access
      // through excli-interface (Bash → broker, already enveloped by §B), so exmcp
      // is unused — and the exmcp wrap FORMAT is therefore unverified. Enable +
      // verify the updatedToolOutput MCP contract before relying on it. In the
      // worker-isolation path this hook is rebuilt inside worker-entry.js.
      //
      // NB: context-hygiene truncation was evaluated here and dropped — the SDK
      // already truncates oversized tool output (~2KB head) and persists the full
      // result to a file before PostToolUse runs, so a keyword-preserving hook is
      // inert. See docs/INTEGRATION-PLAN Phase 5.
      ...(process.env.EH_EXMCP_TAINT === '1' ? {
        hooks: {
          PostToolUse: [{
            hooks: [async (input) => {
              try {
                const t = taintToolResponse(input?.tool_name, input?.tool_response);
                if (process.env.EH_TAINT_DEBUG) {
                  console.error(`[taint-dbg:${this.id.slice(0, 8)}] PostToolUse ${input?.tool_name} -> ${t ? `WRAPPED(${t.text.length}b)` : 'passthrough'}`);
                }
                if (!t) return {};
                if (t.flags.length) console.error(`[taint:${this.id.slice(0, 8)}] ${input.tool_name} injection-suspected: ${t.flags.join(',')}`);
                return { hookSpecificOutput: { hookEventName: 'PostToolUse', updatedToolOutput: t.text } };
              } catch (err) {
                console.error('[taint] hook error:', err.message);
                return {};
              }
            }],
          }],
        },
      } : {}),
      abortController: this.abortController,
      stderr: (data) => {
        const line = String(data || '').trim();
        if (line) console.error(`[claude:${this.id.slice(0, 8)}]`, this.redact(line));
      },
    };
  }

  handleStreamEvent(msg) {
    // Subagent PROSE stays out of the lead's transcript (#120 slice 0). Its text
    // and thinking belong to the subagent's own context: interleaved here it
    // would read as the lead saying things it never said, and it would advance
    // the lead's content-block cursor so its real blocks render twice. The
    // subagent's tool ACTIVITY is surfaced instead — see handleSubagentMessage.
    if (msg.parent_tool_use_id) return;
    const event = msg.event || {};
    if (event.type === 'message_start') {
      this.assistantBlockIndex = 0; // new assistant message: reset the block cursor
      this.pushEvent({ type: 'message_start', message: { role: 'assistant' } });
      return;
    }
    if (event.type === 'content_block_delta') {
      const delta = event.delta || {};
      if (delta.type === 'text_delta' || delta.type === 'thinking_delta') {
        this.pushEvent({
          type: 'message_update',
          assistantMessageEvent: {
            type: delta.type,
            contentIndex: event.index || 0,
            delta: delta.type === 'text_delta' ? (delta.text || '') : (delta.thinking || ''),
          },
        });
      }
    }
  }

  /**
   * A subagent's assistant message (Claude Code `Task` delegation).
   *
   * Everything here is threaded to the delegating call by `parent_tool_use_id`,
   * which is the parent Task's `tool_use` id — so the UI can render a delegated
   * unit of work as nested activity instead of one opaque card. Only tool
   * activity and usage cross over; prose does not (see handleStreamEvent), and
   * the lead's `assistantBlockIndex` is deliberately untouched because these
   * blocks are not part of any assistant message the lead produced.
   */
  handleSubagentMessage(msg) {
    const message = msg.message || {};
    const parentToolCallId = msg.parent_tool_use_id;
    const agentModel = typeof message.model === 'string' ? message.model : '';
    for (const block of message.content || []) {
      if (block.type !== 'tool_use') continue;
      this.toolNames.set(block.id, block.name);
      this.subagentCalls.set(block.id, parentToolCallId);
      this.pushEvent({
        type: 'tool_execution_start',
        toolCallId: block.id,
        toolName: block.name,
        args: block.input,
        parentToolCallId,
        ...(agentModel ? { agentModel } : {}),
      });
    }
    // A subagent's tokens are real spend on this turn, and dropping the whole
    // message dropped them too — the usage readout under-reported every
    // delegated run. Cost is NOT included here (it arrives once, whole-turn, on
    // the result message), so this cannot double-count the bill.
    const usage = mapUsage(message.usage);
    if (usage.totalTokens > 0) {
      this.pushEvent({
        type: 'subagent_usage',
        parentToolCallId,
        ...(agentModel ? { agentModel } : {}),
        usage,
      });
    }
  }

  handleAssistantMessage(msg) {
    if (msg.parent_tool_use_id) {
      this.handleSubagentMessage(msg);
      return;
    }
    const message = msg.message || {};
    for (const block of message.content || []) {
      if (block.type !== 'tool_use') continue;
      this.toolNames.set(block.id, block.name);
      this.pushEvent({
        type: 'tool_execution_start',
        toolCallId: block.id,
        toolName: block.name,
        args: block.input,
      });
    }
    const errorMessage = msg.error
      ? `The model/provider returned an error (${msg.error}).`
      : null;
    if (errorMessage) this.activeTurnError = { message: this.redact(errorMessage) };
    const contentBase = this.assistantBlockIndex;
    this.assistantBlockIndex += (message.content || []).length;
    this.pushEvent({
      type: 'message_end',
      message: {
        role: 'assistant',
        contentBase, // true index of this message's first block within the assistant message
        content: slimContent(message.content),
        stopReason: errorMessage ? 'error' : (message.stop_reason || 'stop'),
        ...(errorMessage ? { errorMessage } : {}),
        usage: mapUsage(message.usage),
      },
    });
  }

  handleToolResults(msg) {
    for (const block of msg.message?.content || []) {
      if (block?.type !== 'tool_result') continue;
      // Thread a subagent's result to the same parent its start carried, taken
      // from the recorded call rather than this message — a result can arrive on
      // a message whose own parent id is absent, and the pairing must not depend
      // on that. Absent for the lead's own calls.
      const parentToolCallId = this.subagentCalls.get(block.tool_use_id)
        || msg.parent_tool_use_id
        || null;
      this.pushEvent({
        type: 'tool_execution_end',
        toolCallId: block.tool_use_id,
        toolName: this.toolNames.get(block.tool_use_id) || 'tool',
        isError: !!block.is_error,
        result: { content: normalizeToolResultContent(block.content) },
        ...(parentToolCallId ? { parentToolCallId } : {}),
      });
    }
  }

  handleResult(msg) {
    if (msg.session_id) this.claudeSessionId = msg.session_id;
    if (msg.subtype === 'success' && !msg.is_error) {
      // Cost arrives only on the result; surface it as a usage-only event.
      if (msg.total_cost_usd > 0) {
        this.pushEvent({
          type: 'message_end',
          message: { role: 'assistant', content: [], usage: { cost: { total: msg.total_cost_usd } } },
        });
      }
      return;
    }
    const detail = (msg.errors || []).join('; ') || msg.subtype || 'unknown error';
    const error = `Agent turn failed: ${detail}`;
    this.activeTurnError = { message: this.redact(error) };
    this.pushEvent({ type: 'session_error', error });
  }

  handleSdkMessage(msg) {
    this.lastActivity = Date.now();
    if (msg.isReplay) return;
    switch (msg.type) {
      case 'system':
        if (msg.subtype === 'init') {
          if (msg.session_id) this.claudeSessionId = msg.session_id;
          this.updateAgentState(msg.model || null);
        }
        break;
      case 'stream_event':
        this.handleStreamEvent(msg);
        break;
      case 'assistant':
        this.handleAssistantMessage(msg);
        break;
      case 'user':
        this.handleToolResults(msg);
        break;
      case 'result':
        this.handleResult(msg);
        break;
      default:
        break;
    }
  }

  async runTurn(text) {
    this.abortController = new AbortController();
    this.pushEvent({ type: 'agent_start' });
    this.pushEvent({ type: 'message_end', message: { role: 'user', content: [{ type: 'text', text }] } });
    this.persist();

    try {
      // Worker isolation (#97): when a non-root worker UID is configured and the
      // control plane is root, run the turn in a lowered-privilege child process
      // instead of in-process. resolveSpawnUser may throw (fail closed) when the
      // hardened profile is set but the control plane isn't root.
      const spawnUser = this.resolveSpawnUser();
      if (spawnUser) {
        await this.runTurnInWorker(text, spawnUser);
      } else {
        const q = this.queryFn({ prompt: text, options: this.buildQueryOptions() });
        this.activeQuery = q;
        for await (const msg of q) this.handleSdkMessage(msg);
      }
    } catch (err) {
      if (!this.abortController?.signal?.aborted) {
        const error = `Agent turn failed: ${err.message || 'unknown error'}`;
        this.activeTurnError = { message: this.redact(error) };
        this.pushEvent({ type: 'session_error', error });
      }
    } finally {
      this.finishTurn();
    }
  }

  /**
   * Run one turn in the non-root worker child (#97). Spawns worker-entry.js lowered
   * to the worker UID, streams the init envelope in, and bridges the child's
   * newline-delimited SDK messages back into the same handleSdkMessage translation
   * the in-process path uses — so UI events, resume-id sync, and cost are identical.
   * Resolves when the child exits.
   */
  runTurnInWorker(text, spawnUser) {
    return new Promise((resolve) => {
      const env = { ...this.buildChildEnv(), HOME: spawnUser.home };
      const spawnWorker = this.spawnWorkerFn || spawn;
      let child;
      try {
        child = spawnWorker(process.execPath, [WORKER_ENTRY], {
          cwd: this.workspace,
          env,
          uid: spawnUser.uid,
          gid: spawnUser.gid,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch (err) {
        const error = `Agent turn failed: ${err.message || 'could not start the agent worker'}`;
        this.activeTurnError = { message: this.redact(error) };
        this.pushEvent({ type: 'session_error', error });
        resolve();
        return;
      }

      this.workerProc = child;
      // Expose an interrupt() so the base abort() drives the child (see abort()).
      this.activeQuery = { interrupt: () => this.sendWorkerControl({ type: 'abort' }) };

      let settled = false;
      const done = () => { if (settled) return; settled = true; this.workerProc = null; resolve(); };

      try {
        child.stdin.write(`${JSON.stringify({ prompt: text, options: this.buildSerializableQueryOptions(), sessionId: this.id, taint: process.env.EH_EXMCP_TAINT === '1' })}\n`);
      } catch (err) {
        const error = `Agent turn failed: ${err.message || 'could not send the prompt to the worker'}`;
        this.activeTurnError = { message: this.redact(error) };
        this.pushEvent({ type: 'session_error', error });
      }

      let buf = '';
      child.stdout.on('data', (chunk) => {
        buf += chunk.toString();
        let nl;
        while ((nl = buf.indexOf('\n')) !== -1) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          if (!line.trim()) continue;
          let msg;
          try { msg = JSON.parse(line); } catch { continue; }
          if (msg && msg.__workerError) {
            if (!this.abortController?.signal?.aborted) {
              const error = `Agent turn failed: ${msg.__workerError}`;
              this.activeTurnError = { message: this.redact(error) };
              this.pushEvent({ type: 'session_error', error });
            }
            continue;
          }
          try { this.handleSdkMessage(msg); }
          catch (err) { console.error(`[claude:${this.id.slice(0, 8)}] bridge error:`, this.redact(err.message || String(err))); }
        }
      });

      child.stderr.on('data', (data) => {
        const line = String(data || '').trim();
        if (line) console.error(`[claude:${this.id.slice(0, 8)}]`, this.redact(line));
      });

      child.on('error', (err) => {
        if (!this.abortController?.signal?.aborted) {
          const error = `Agent turn failed: ${err.message || 'the agent worker failed'}`;
          this.activeTurnError = { message: this.redact(error) };
          this.pushEvent({ type: 'session_error', error });
        }
        done();
      });

      child.on('exit', (code, signal) => {
        if (code && code !== 0 && !this.abortController?.signal?.aborted && !this.activeTurnError) {
          const error = `Agent worker exited unexpectedly (code ${code}${signal ? `, ${signal}` : ''}).`;
          this.activeTurnError = { message: this.redact(error) };
          this.pushEvent({ type: 'session_error', error });
        }
        done();
      });
    });
  }

  /** Send a control line to the running worker child (best-effort). */
  sendWorkerControl(msg) {
    const child = this.workerProc;
    if (!child || child.exitCode !== null) return;
    try { child.stdin.write(`${JSON.stringify(msg)}\n`); } catch { /* child gone */ }
  }

  finishTurn() {
    this.clearAbortKillTimer();
    this.activeQuery = null;
    this.abortController = null;
    this.workerProc = null;
    this.toolNames.clear();
    this.running = false;
    const promptSource = this.activePromptSource || 'user';
    const turnError = this.activeTurnError;
    this.activePromptSource = null;
    this.activeTurnError = null;
    this.pushEvent({ type: 'agent_end' });
    this.persist();
    this.emit('agent_end', {
      promptSource,
      promptCount: this.promptCount,
      hadError: Boolean(turnError),
      errorMessage: turnError?.message || '',
    });
  }

  /** Start an agent turn. Resolves when the turn completes. */
  prompt(text, { source = 'user' } = {}) {
    if (this.running) return Promise.resolve(false);
    this.lastActivity = Date.now();
    this.promptStartToken++;
    this.running = true;
    this.activePromptSource = source;
    this.activeTurnError = null;
    this.promptCount++;
    if (!this.title) this.title = this.redact(text.slice(0, 60)); // placeholder until summarized
    return this.runTurn(text).then(() => true);
  }

  abort() {
    this.promptStartToken++;
    const q = this.activeQuery;
    if (!q) return;
    this.scheduleAbortKill();
    Promise.resolve(q.interrupt?.()).catch(() => {
      this.abortController?.abort();
    });
  }

  handleAbortTimeout() {
    if (!this.running) return;
    // A cooperative interrupt didn't stop the turn in time. In the worker path the
    // parent's abortController can't reach the child, so SIGKILL it; otherwise abort
    // the in-process query.
    if (this.workerProc && this.workerProc.exitCode === null) this.workerProc.kill('SIGKILL');
    else this.abortController?.abort();
  }

  dispose() {
    super.dispose();
    if (this.workerProc && this.workerProc.exitCode === null) this.workerProc.kill('SIGKILL');
    this.workerProc = null;
    this.abortController?.abort();
    this.activeQuery = null;
  }
}
