import { sessionEventsUrl } from './api.js';
import { applyInvestigationPlanEvent, refreshInvestigationPlan } from './plan-ribbon.js';
import {
  addSysNote,
  addToolCard,
  addUserMessage,
  agentErrorText,
  discardEmptyReasoningBlock,
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

// Incremented per EventSource we open, so a stream that has been superseded can
// be told apart from the live one even within the same session.
let streamGeneration = 0;

/** True only for the stream that is still the active one for the shown session. */
function isActiveStream(scope) {
  return !scope || (
    scope.connectionGeneration === streamGeneration
    && state.eventSource === scope.source
    && state.session?.id === scope.sessionId
    && state.sessionGeneration === scope.sessionGeneration
  );
}

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
        // A reasoning block that ended with only whitespace never becomes visible;
        // drop its placeholder rather than leaving an empty disclosure behind.
        if (kind === 'thinking' && !/\S/.test(block.raw || '')) {
          discardEmptyReasoningBlock(block);
          block.dirty = false;
        } else {
          block.dirty = true;
          queueRender();
        }
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

    case 'investigation_plan_updated':
      applyInvestigationPlanEvent(ev, { sessionId: state.session?.id || '' });
      break;

    case 'session_error':
      addSysNote(ev.error);
      setRunning(false);
      break;

    // Emitted when a restored transcript had older events pruned, so the gap in
    // the replayed conversation is explained rather than silently missing.
    case 'history_notice':
      addSysNote(ev.message || 'Older chat details were pruned.');
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
  const source = new EventSource(sessionEventsUrl(sessionId));
  // Identity for this connection. A superseded stream (session switched, or a
  // newer connect() replaced it) fails the check and its late events are dropped
  // instead of being applied to whatever session is now on screen.
  const scope = {
    source,
    sessionId,
    sessionGeneration: state.sessionGeneration,
    connectionGeneration: ++streamGeneration,
  };
  state.eventSource = source;
  source.onopen = () => {
    if (!isActiveStream(scope)) return;
    applyIdleStatus();
    // Reconcile the authoritative plan on every connect and reconnect: a
    // mutation that lands while SSE is down would otherwise leave the ribbon
    // stale until the next one.
    refreshInvestigationPlan();
  };
  source.onmessage = (event) => {
    if (!isActiveStream(scope)) return;
    handleEvent(JSON.parse(event.data));
  };
  source.onerror = () => {
    if (!isActiveStream(scope)) return;
    setStatus('error', 'Reconnecting...', 'Trying to reconnect to the session event stream.');
  };
}
