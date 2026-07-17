import { sessionEventsUrl } from './api.js';
import {
  addSysNote,
  addToolCard,
  addUserMessage,
  agentErrorText,
  ensureBlock,
  finishToolCard,
  isAssistantErrorMessage,
  queueRender,
  renderMarkdown,
  renderChallengerStatus,
  resetStreamRendering,
  setRunning,
  startAgentMessage,
  updateUsage,
} from './chat.js';
import { dom } from './dom.js';
import { onSessionEvent } from './memory.js';
import { applyActionEvent } from './actions.js';
import { state } from './state.js';
import { applyIdleStatus, setStatus } from './status.js';

const ATTACH_NOTE = /\n\n\[The user shared \d+ file\(s\)[\s\S]*\]$/;
const CHALLENGER_PROMPT_MARKER = /^\[\[EH_CHALLENGER_AGENT\]\]\n?/;

let refreshFilesCallback = () => {};
let loadSessionsCallback = () => {};

export function initSessionStream({ refreshFiles, loadSessions }) {
  refreshFilesCallback = refreshFiles;
  loadSessionsCallback = loadSessions;
}

export function handleEvent(ev) {
  // Feed the memory-graph overlay's investigation view (entities this run
  // touches). Best-effort — never let it break transcript rendering.
  try { onSessionEvent(ev); } catch { /* viz is non-critical */ }
  switch (ev.type) {
    case 'snapshot':
      // A snapshot is a full transcript replay. It arrives on the initial
      // connect (chat already cleared by switchSession) but also on an
      // EventSource auto-reconnect, when the chat is still populated. Clear
      // rendered messages and stream state first so replay is idempotent and
      // never doubles the transcript onto existing content.
      dom.chatEl.querySelectorAll('.msg').forEach((el) => el.remove());
      resetStreamRendering();
      state.replaying = true;
      dom.chatEl.classList.add('replaying');
      if (ev.backend && state.backend && ev.backend !== state.backend.id) {
        addSysNote(`This session was created with the "${ev.backend}" backend. It stays readable, but to continue it switch the backend in Settings.`);
      }
      if (ev.state?.requestedModel !== undefined) state.sessionRequestedModel = ev.state.requestedModel || '';
      if (ev.state?.requestedThinking !== undefined) state.sessionRequestedReasoning = ev.state.requestedThinking || '';
      if (ev.state?.modelPinned !== undefined) state.sessionModelPinned = !!ev.state.modelPinned;
      if (ev.state?.model) state.agentModel = ev.state.model;
      updateUsage();
      for (const event of ev.events) handleEvent(event);
      state.replaying = false;
      dom.chatEl.classList.remove('replaying');
      setRunning(ev.running);
      requestAnimationFrame(() => requestAnimationFrame(() => {
        dom.chatScroll.scrollTop = dom.chatScroll.scrollHeight;
      }));
      break;

    case 'agent_start':
      setRunning(true);
      break;

    case 'agent_end':
      setRunning(false);
      state.currentAgentMsg = null;
      refreshFilesCallback();
      loadSessionsCallback();
      break;

    case 'message_start':
      if (ev.message?.role === 'assistant' && !isAssistantErrorMessage(ev.message)) startAgentMessage();
      break;

    case 'message_update': {
      const ame = ev.assistantMessageEvent;
      if (!ame) break;
      if (ame.type === 'text_delta' || ame.type === 'thinking_delta') {
        const kind = ame.type === 'text_delta' ? 'text' : 'thinking';
        const block = ensureBlock(ame.contentIndex, kind);
        block.raw += ame.delta || '';
        block.dirty = true;
        queueRender();
      } else if (ame.type === 'text_end' || ame.type === 'thinking_end') {
        const kind = ame.type === 'text_end' ? 'text' : 'thinking';
        const block = ensureBlock(ame.contentIndex, kind);
        if (typeof ame.content === 'string') block.raw = ame.content;
        block.dirty = true;
        queueRender();
      }
      break;
    }

    case 'message_end': {
      const msg = ev.message;
      if (!msg) break;
      if (msg.role === 'user') {
        let text = (msg.content || [])
          .filter((content) => content.type === 'text').map((content) => content.text).join('\n');
        const source = CHALLENGER_PROMPT_MARKER.test(text) ? 'challenger' : '';
        text = text.replace(CHALLENGER_PROMPT_MARKER, '');
        const noteMatch = text.match(ATTACH_NOTE);
        const attachments = [];
        if (noteMatch) {
          for (const match of noteMatch[0].matchAll(/- \.\/uploads\/(.+) \((\d+) bytes\)/g)) {
            attachments.push({ name: match[1], size: Number(match[2]) });
          }
        }
        addUserMessage(text.replace(ATTACH_NOTE, ''), attachments, { source });
      } else if (msg.role === 'assistant') {
        if (isAssistantErrorMessage(msg)) {
          addSysNote(agentErrorText(msg.errorMessage));
          setRunning(false);
          refreshFilesCallback();
          loadSessionsCallback();
        }

        // Backends may deliver each content block as its own message_end
        // (content=[block]); contentBase is the block's true index within the
        // assistant message, so finalized text lands on the SAME block the
        // streamed deltas built instead of a duplicate at position 0.
        const base = msg.contentBase || 0;
        let idx = 0;
        for (const content of msg.content || []) {
          if (content.type === 'text') {
            const block = ensureBlock(base + idx, 'text');
            block.raw = content.text;
            renderMarkdown(block.el, block.raw);
          }
          idx++;
        }
        const usage = msg.usage;
        if (usage) {
          state.usage.input += usage.input || 0;
          state.usage.output += usage.output || 0;
          state.usage.cacheRead += usage.cacheRead || 0;
          state.usage.cacheWrite += usage.cacheWrite || 0;
          state.usage.cost += usage.cost?.total || 0;
          const ctx = usage.totalTokens ||
            (usage.input || 0) + (usage.output || 0) + (usage.cacheRead || 0) + (usage.cacheWrite || 0);
          if (ctx > 0) state.usage.contextTokens = ctx;
        }
        updateUsage();
      }
      break;
    }

    case 'tool_execution_start':
      addToolCard(ev);
      break;

    case 'tool_execution_end':
      finishToolCard(ev);
      if (!state.replaying) refreshFilesCallback();
      break;

    case 'session_error':
      addSysNote(ev.error);
      setRunning(false);
      break;

    case 'action_proposed':
    case 'action_decided':
    case 'action_result':
      applyActionEvent(ev); // updates the in-chat tray; the global stream drives the dashboard badge
      break;

    case 'challenger_status':
      renderChallengerStatus(ev);
      break;

    case 'session_state':
      if (ev.requestedModel !== undefined) state.sessionRequestedModel = ev.requestedModel || '';
      if (ev.requestedThinking !== undefined) state.sessionRequestedReasoning = ev.requestedThinking || '';
      if (ev.modelPinned !== undefined) state.sessionModelPinned = !!ev.modelPinned;
      if (ev.model) state.agentModel = ev.model;
      updateUsage();
      break;

    case 'session_meta':
      if (state.session && ev.id === state.session.id) state.session.title = ev.title;
      loadSessionsCallback();
      break;
  }
}

export function connect(sessionId) {
  if (state.eventSource) state.eventSource.close();
  state.eventSource = new EventSource(sessionEventsUrl(sessionId));
  state.eventSource.onopen = () => applyIdleStatus();
  state.eventSource.onmessage = (event) => handleEvent(JSON.parse(event.data));
  state.eventSource.onerror = () => setStatus('error', 'Reconnecting...', 'Trying to reconnect to the session event stream.');
}
