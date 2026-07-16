import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk';
import { AgentSession, SYSTEM_PROMPT } from '../../agent-session.js';
import { taintToolResponse } from '../../telemetry-taint.js';
import { contextWindowForModel, reasoningOptions } from './models.js';
import { buildScrubbedEnv } from '../../secrets.js';

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
    this.abortController = null;
    this.activeQuery = null;
    this.toolNames = new Map(); // tool_use_id -> tool name for result labeling
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

  buildQueryOptions() {
    const env = buildScrubbedEnv(process.env, this.options.env || {});
    if (this.options.subscriptionAuth) {
      // Use the Claude Code /login (Pro/Max) instead of an API key: Claude Code
      // prefers ANTHROPIC_API_KEY when present, so hide it (and the OAuth env
      // token) to fall back to the stored subscription credentials.
      delete env.ANTHROPIC_API_KEY;
      delete env.ANTHROPIC_AUTH_TOKEN;
    }
    return {
      cwd: this.workspace,
      env,
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      systemPrompt: { type: 'preset', preset: 'claude_code', append: SYSTEM_PROMPT },
      settingSources: ['project'],
      // Phase 3 injection boundary (exmcp path): a PostToolUse hook that wraps
      // attacker-controllable MCP tool output in an <untrusted-telemetry> envelope
      // via the SDK's updatedToolOutput. Verified to fire, but GATED OFF by default
      // (EH_EXMCP_TAINT=1) because in practice the agent does all ExtraHop access
      // through excli-interface (Bash → broker, already enveloped by §B), so exmcp
      // is unused — and the exmcp wrap FORMAT is therefore unverified. Enable +
      // verify the updatedToolOutput MCP contract before relying on it.
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
      includePartialMessages: true,
      abortController: this.abortController,
      stderr: (data) => {
        const line = String(data || '').trim();
        if (line) console.error(`[claude:${this.id.slice(0, 8)}]`, this.redact(line));
      },
      ...(this.options.model ? { model: this.options.model } : {}),
      ...reasoningOptions(this.options.thinking),
      ...(this.options.mcpServers && Object.keys(this.options.mcpServers).length
        ? { mcpServers: this.options.mcpServers }
        : {}),
      ...(this.claudeSessionId ? { resume: this.claudeSessionId } : {}),
    };
  }

  handleStreamEvent(msg) {
    if (msg.parent_tool_use_id) return; // subagent traffic; UI shows tool cards only
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

  handleAssistantMessage(msg) {
    if (msg.parent_tool_use_id) return;
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
    if (msg.parent_tool_use_id) return;
    for (const block of msg.message?.content || []) {
      if (block?.type !== 'tool_result') continue;
      this.pushEvent({
        type: 'tool_execution_end',
        toolCallId: block.tool_use_id,
        toolName: this.toolNames.get(block.tool_use_id) || 'tool',
        isError: !!block.is_error,
        result: { content: normalizeToolResultContent(block.content) },
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
      const q = this.queryFn({ prompt: text, options: this.buildQueryOptions() });
      this.activeQuery = q;
      for await (const msg of q) this.handleSdkMessage(msg);
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

  finishTurn() {
    this.clearAbortKillTimer();
    this.activeQuery = null;
    this.abortController = null;
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
    if (this.running) this.abortController?.abort();
  }

  dispose() {
    super.dispose();
    this.abortController?.abort();
    this.activeQuery = null;
  }
}
