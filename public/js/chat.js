import { postChallenge } from './api.js';
import { dom, $ } from './dom.js';
import { renderMarkdown } from './markdown.js';
import { modelLabel } from './model-utils.js';
import {
  integrationBySource,
  integrationForResearchResult,
  integrationForToolCall,
  integrationSourceForToolCall,
} from './integration-badges.js';
import { onRunningChanged, setCurrentFinding } from './activity.js';
import { rerenderActionsTray } from './actions.js';
import { refreshActionPrompt } from './action-prompt.js';
import { flushQueuedMessage } from './composer.js';
import { newUsage, state } from './state.js';
import { replaceFindingPlaceholders, splitFindings } from './findings.js';
import { phraseFor, reasonFor, resultSummary, toolLabel } from './tool-phrases.js';
import { endCall, resetCalls, startCall, updateCall } from './tool-store.js';
import { fmtBytes, fmtTime, fmtTokens } from './utils.js';
import { applyIdleStatus, setStatus } from './status.js';

function nearBottom() {
  return dom.chatScroll.scrollHeight - dom.chatScroll.scrollTop - dom.chatScroll.clientHeight < 120;
}

export function autoscroll(force = false) {
  if (state.replaying) return;
  if (force || nearBottom()) dom.chatScroll.scrollTop = dom.chatScroll.scrollHeight;
}

export function setRunning(isRunning) {
  const was = state.running;
  state.running = isRunning;
  onRunningChanged(isRunning);
  // A message typed during the turn goes out at the boundary, not into a 409.
  if (was && !isRunning) flushQueuedMessage();
  // #137: decide buttons are gated while the turn runs — re-render the tray and
  // any open approval prompt the moment the running state flips.
  if (was !== isRunning) {
    rerenderActionsTray();
    refreshActionPrompt();
  }
  updatePlanStrip();
  updateSessionModelButton();
  dom.sendBtn.classList.toggle('hidden', isRunning);
  dom.stopBtn.classList.toggle('hidden', !isRunning);
  if (isRunning) setStatus('working', 'Investigating...', 'The investigation agent is working.');
  else applyIdleStatus();
}

function sessionModelDisplay() {
  if (state.agentModel?.id) {
    return state.agentModel.provider ? `${state.agentModel.provider}/${state.agentModel.id}` : state.agentModel.id;
  }
  if (state.sessionRequestedModel) return modelLabel(state.sessionRequestedModel, state.sessionRequestedModel);
  return state.backend?.defaultModelLabel || 'Default';
}

export function updateSessionModelButton() {
  const label = $('session-model-label');
  if (!label) return;
  label.textContent = sessionModelDisplay();
  const logo = $('session-backend-logo');
  const backendId = state.session?.backend || state.backend?.id;
  const logoPath = {
    pi: '/assets/harnesses/pi.svg',
    claude: '/assets/harnesses/claude-code.svg',
  }[backendId];
  if (logo) {
    logo.src = logoPath || '';
    logo.classList.toggle('hidden', !logoPath);
  }
  $('session-model-btn').disabled = !state.session || state.running;
}

export function updateUsage() {
  updateSessionModelButton();
  const hasTokens = state.usage.input + state.usage.output + state.usage.cacheRead + state.usage.cacheWrite > 0;
  if (!state.agentModel && !hasTokens) { dom.usageReadout.innerHTML = ''; return; }

  const ctxWindow = state.agentModel?.contextWindow || 0;
  const ctxPct = ctxWindow > 0 ? (state.usage.contextTokens / ctxWindow) * 100 : null;
  let ctxClass = '';
  if (ctxPct !== null && ctxPct > 90) ctxClass = 'crit';
  else if (ctxPct !== null && ctxPct > 70) ctxClass = 'warn';

  dom.usageReadout.innerHTML = `
    <div class="usage-grid">
      <span class="u-label">Input</span><span class="u-val" data-k="input"></span>
      <span class="u-label">Output</span><span class="u-val" data-k="output"></span>
      <span class="u-label">Cache read</span><span class="u-val" data-k="cache"></span>
      <span class="u-label">Cache write</span><span class="u-val" data-k="cache-write"></span>
      <span class="u-label">Cost</span><span class="u-val" data-k="cost"></span>
    </div>
    <div class="usage-context ${ctxClass}">
      <div class="ctx-bar"><div class="ctx-fill"></div></div>
      <span class="ctx-text"></span>
    </div>`;
  dom.usageReadout.querySelector('[data-k="input"]').textContent = fmtTokens(state.usage.input);
  dom.usageReadout.querySelector('[data-k="output"]').textContent = fmtTokens(state.usage.output);
  dom.usageReadout.querySelector('[data-k="cache"]').textContent = fmtTokens(state.usage.cacheRead);
  dom.usageReadout.querySelector('[data-k="cache-write"]').textContent = fmtTokens(state.usage.cacheWrite);
  dom.usageReadout.querySelector('[data-k="cost"]').textContent =
    state.usage.cost >= 0.01 ? `$${state.usage.cost.toFixed(2)}` : `$${state.usage.cost.toFixed(4)}`;
  dom.usageReadout.querySelector('.ctx-fill').style.width =
    ctxPct === null ? '0%' : `${Math.min(100, ctxPct).toFixed(1)}%`;
  dom.usageReadout.querySelector('.ctx-text').textContent = ctxPct === null
    ? `${fmtTokens(state.usage.contextTokens)} ctx`
    : `${ctxPct.toFixed(1)}% of ${fmtTokens(ctxWindow)}`;
}

export function hideEmptyState() {
  if (dom.emptyState) dom.emptyState.classList.add('hidden');
}

export function setHasMessages(val) {
  state.hasMessages = val;
  $('new-session-btn').disabled = !val;
}

export function addUserMessage(text, attachments, options = {}) {
  hideEmptyState();
  setHasMessages(true);
  const wrap = document.createElement('div');
  wrap.className = `msg msg-user${options.source === 'challenger' ? ' msg-user-challenger' : ''}`;
  if (options.source === 'challenger') {
    const source = document.createElement('div');
    source.className = 'msg-source';
    source.textContent = 'Challenger Agent';
    wrap.appendChild(source);
  }
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = text;
  wrap.appendChild(bubble);
  if (attachments?.length) {
    const list = document.createElement('div');
    list.className = 'msg-attachments';
    for (const attachment of attachments) {
      const chip = document.createElement('span');
      chip.className = 'file-chip';
      chip.innerHTML = `<span class="name"></span><span class="size"></span>`;
      chip.querySelector('.name').textContent = attachment.name;
      chip.querySelector('.size').textContent = fmtBytes(attachment.size);
      list.appendChild(chip);
    }
    wrap.appendChild(list);
  }
  dom.chatEl.appendChild(wrap);
  autoscroll(true);
}

function challengerCard(challengeId) {
  const key = challengeId || 'latest';
  let card = state.challengerCards.get(key);
  if (card) return card;
  hideEmptyState();
  setHasMessages(true);
  const wrap = document.createElement('div');
  wrap.className = 'msg challenger-msg';
  wrap.innerHTML = `
    <div class="challenger-card">
      <div class="challenger-head">
        <span class="challenger-dot"></span>
        <span class="challenger-title">Challenger Agent</span>
        <span class="challenger-state"></span>
      </div>
      <div class="challenger-body"></div>
      <div class="challenger-actions"></div>
    </div>`;
  dom.chatEl.appendChild(wrap);
  card = wrap.querySelector('.challenger-card');
  state.challengerCards.set(key, card);
  autoscroll();
  return card;
}

function statusLabel(status) {
  return {
    ready: 'Ready',
    reviewing: 'Reviewing',
    satisfied: 'Accepted',
    challenged: 'Challenge raised',
    queued: 'Waiting',
    delivered: 'Sent',
    skipped: 'Skipped',
    error: 'Error',
  }[status] || 'Updated';
}

function statusBody(ev) {
  const bodyByStatus = {
    ready: 'Investigator findings are ready for challenger review.',
    reviewing: 'Challenger Agent is reviewing the findings.',
    satisfied: 'Challenger Agent accepted the findings.',
    challenged: 'Counter-prompt prepared for the investigator.',
    queued: 'Counter-prompt will be sent after the current investigator turn finishes.',
    delivered: 'Counter-prompt sent to the investigator.',
    skipped: 'Challenger Agent could not find workspace evidence to review.',
    error: 'Challenger Agent review failed.',
  };
  if (ev.status === 'challenged' || ev.status === 'queued' || ev.status === 'delivered') {
    return bodyByStatus[ev.status];
  }
  return ev.message || bodyByStatus[ev.status] || 'Challenger Agent status changed.';
}

export function renderChallengerStatus(ev) {
  const card = challengerCard(ev.challengeId);
  card.className = `challenger-card ${ev.status || ''}`.trim();
  card.querySelector('.challenger-state').textContent = statusLabel(ev.status);
  card.querySelector('.challenger-body').textContent = statusBody(ev);
  const actions = card.querySelector('.challenger-actions');
  actions.innerHTML = '';

  if (ev.status === 'ready') {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn-secondary slim';
    button.innerHTML = `
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7 4v5c0 4-3 7-7 9-4-2-7-5-7-9V7l7-4z"/><path d="M9 12h6"/><path d="M12 9v6"/></svg>
      <span>Challenge these findings</span>`;
    button.addEventListener('click', async () => {
      if (!state.session) return;
      button.disabled = true;
      button.querySelector('span').textContent = 'Starting...';
      const response = await postChallenge(state.session.id, { challengeId: ev.challengeId });
      if (!response.ok) {
        card.classList.add('error');
        card.querySelector('.challenger-state').textContent = 'Error';
        card.querySelector('.challenger-body').textContent = response.data.error || 'Could not start challenger review.';
        button.remove();
      }
    });
    actions.appendChild(button);
  }
  autoscroll();
}

export function startAgentMessage() {
  hideEmptyState();
  const wrap = document.createElement('div');
  wrap.className = 'msg msg-agent';
  wrap.innerHTML = `
    <div class="agent-head"><div class="agent-dot"></div>Investigation Agent</div>
    <div class="plan-strip hidden">
      <span class="plan-strip-task"></span>
      <span class="plan-strip-meter"><span></span></span>
      <span class="plan-strip-count"></span>
    </div>
    <div class="agent-body"></div>`;
  dom.chatEl.appendChild(wrap);
  state.currentAgentMsg = wrap.querySelector('.agent-body');
  state.blocks = new Map();
  updatePlanStrip();
  autoscroll();
}

/**
 * The plan's current task, on the turn that is working on it.
 *
 * The ribbon remains the full plan; this is the one line worth reading while text
 * is streaming, and the review's point that the most narrative-rich element of the
 * app was also its least legible. Shown only during a running turn — afterwards the
 * message is history and the ribbon is the live view again.
 */
export function updatePlanStrip() {
  const strip = state.currentAgentMsg?.parentElement?.querySelector('.plan-strip');
  if (!strip) return;
  const view = state.investigationPlan;
  const progress = view?.progress;
  const title = progress?.currentTask?.title || '';
  if (!state.running || !view?.initialized || !title) { strip.classList.add('hidden'); return; }

  const total = Number(progress.total) || 0;
  const resolved = Number(progress.resolved) || 0;
  const percent = Number.isFinite(Number(progress.percent))
    ? Math.max(0, Math.min(100, Number(progress.percent)))
    : (total ? (resolved / total) * 100 : 0);
  strip.querySelector('.plan-strip-task').textContent = title;
  strip.querySelector('.plan-strip-count').textContent = total ? `${resolved}/${total}` : '';
  strip.querySelector('.plan-strip-meter > span').style.width = `${percent.toFixed(0)}%`;
  strip.classList.remove('hidden');
}

function agentBody() {
  if (!state.currentAgentMsg) startAgentMessage();
  return state.currentAgentMsg;
}

export function ensureBlock(index, kind) {
  let block = state.blocks.get(index);
  if (block && block.kind === kind) return block;
  if (kind === 'text') {
    const el = document.createElement('div');
    el.className = 'md';
    agentBody().appendChild(el);
    block = { el, raw: '', kind };
  } else {
    const det = document.createElement('details');
    det.className = 'thinking';
    det.innerHTML = `<summary>Reasoning</summary><div class="thinking-body md"></div>`;
    // Hold the block off-DOM behind a marker until it proves it has non-whitespace
    // content. Some backends emit whitespace-only reasoning, which would otherwise
    // render as an empty "Reasoning" disclosure.
    const marker = document.createComment('reasoning-block');
    agentBody().appendChild(marker);
    block = { el: det.querySelector('.thinking-body'), container: det, marker, raw: '', kind };
  }
  state.blocks.set(index, block);
  return block;
}

function revealReasoningBlock(block) {
  if (block.kind !== 'thinking' || block.container.isConnected) return;
  if (block.marker?.isConnected) block.marker.replaceWith(block.container);
}

/** Drop a reasoning block that finished with nothing but whitespace. */
export function discardEmptyReasoningBlock(block) {
  if (block.kind !== 'thinking') return;
  block.container?.remove();
  block.marker?.remove();
}

/**
 * Markdown, with the agent's FINDING lines lifted out into chips. Two steps rather
 * than one so a finding keeps its place in the narrative while none of the model's
 * text is ever concatenated into an HTML string.
 */
function renderAgentMarkdown(el, raw) {
  const { text, findings } = splitFindings(raw);
  renderMarkdown(el, text);
  replaceFindingPlaceholders(el, findings);
  // The live view's current-finding card reads the same parse, so the chip in the
  // transcript and the card beside the orb can never say different things.
  if (findings.length) setCurrentFinding(findings[findings.length - 1]);
}

export function queueRender() {
  if (state.renderQueued) return;
  state.renderQueued = true;
  requestAnimationFrame(() => {
    state.renderQueued = false;
    for (const block of state.blocks.values()) {
      if (block.dirty) {
        renderAgentMarkdown(block.el, block.raw);
        // Only surface a reasoning block once it actually has visible content.
        if (/\S/.test(block.raw || '')) revealReasoningBlock(block);
        block.dirty = false;
      }
    }
    autoscroll();
  });
}

export function addSysNote(text) {
  hideEmptyState();
  const el = document.createElement('div');
  el.className = 'msg sys-note';
  el.textContent = text;
  dom.chatEl.appendChild(el);
  autoscroll();
}

export function isAssistantErrorMessage(msg) {
  return msg?.role === 'assistant' && (msg.stopReason === 'error' || msg.errorMessage);
}

function parseJsonMaybe(text) {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (!trimmed || !/^[{[]/.test(trimmed)) return null;
  try { return JSON.parse(trimmed); } catch { return null; }
}

export function agentErrorText(raw) {
  let value = raw || 'The agent stopped because the model/provider returned an error.';
  let code = null;
  let status = null;

  for (let i = 0; i < 4; i++) {
    const parsed = typeof value === 'string' ? parseJsonMaybe(value) : value;
    if (!parsed || typeof parsed !== 'object') break;

    const err = parsed.error && typeof parsed.error === 'object' ? parsed.error : parsed;
    code ||= err.code || parsed.code || null;
    status ||= err.status || parsed.status || null;
    const next = err.message || parsed.message || err.errorMessage || parsed.errorMessage;
    if (!next || next === value) break;
    value = next;
  }

  const body = String(value).replace(/\s+/g, ' ').trim();
  const prefix = code || status ? `Agent error${code ? ` ${code}` : ''}${status ? ` ${status}` : ''}: ` : 'Agent error: ';
  return `${prefix}${body}`.slice(0, 1200);
}

/** The literal arguments, for when no honest phrase can be derived from them. */
function rawSummary(name, args) {
  if (!args) return '';
  if (name === 'bash') return args.command || '';
  if (name === 'read' || name === 'write' || name === 'edit') return args.path || args.file_path || '';
  return JSON.stringify(args).slice(0, 160);
}

export function addToolCard(ev) {
  const card = document.createElement('div');
  card.className = 'tool-card';
  card.innerHTML = `
    <div class="tool-head">
      <span class="tool-status"></span>
      <span class="tool-name"></span>
      <span class="tool-summary"></span>
      <svg class="tool-chevron" viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 3l5 5-5 5"/></svg>
    </div>
    <div class="tool-progress hidden"></div>
    <div class="tool-result hidden"></div>
    <div class="tool-detail">
      <div class="label">Input</div><pre class="tool-args"></pre>
      <div class="label out-label hidden">Output</div><pre class="tool-out hidden"></pre>
    </div>`;
  // "ExtraHop · search_records", not "Bash": the shell is the transport, not the act.
  const nameLabel = toolLabel(ev.toolName, ev.args);
  card.querySelector('.tool-name').textContent = nameLabel.action
    ? `${nameLabel.source} · ${nameLabel.action}`
    : nameLabel.source;
  // The store is the record of what ran; the card is one rendering of it.
  const phrase = phraseFor(ev.toolName, ev.args);
  startCall(ev, {
    phrase,
    label: toolLabel(ev.toolName, ev.args),
    reason: reasonFor(ev.toolName, ev.args),
    integrationSource: integrationSourceForToolCall(ev),
  });
  // A derived phrase is prose and a raw command is a literal, so the typography
  // switches with it rather than setting every summary in monospace.
  const summary = card.querySelector('.tool-summary');
  summary.textContent = phrase || rawSummary(ev.toolName, ev.args);
  summary.classList.toggle('phrase', Boolean(phrase));
  card.querySelector('.tool-args').textContent = JSON.stringify(ev.args, null, 2);
  const integrationSource = integrationSourceForToolCall(ev);
  if (integrationSource) card.dataset.integrationSource = integrationSource;
  setIntegrationBadge(card, integrationForToolCall(ev));
  card.querySelector('.tool-head').addEventListener('click', () => card.classList.toggle('open'));
  agentBody().appendChild(card);
  state.toolCards.set(ev.toolCallId, card);
  autoscroll();
}

function setIntegrationBadge(card, integration) {
  const existing = card.querySelector('.tool-integration');
  if (!integration) {
    existing?.remove();
    return;
  }
  const badge = existing || document.createElement('span');
  badge.className = 'tool-integration';
  badge.title = `${integration.label} integration`;
  badge.setAttribute('aria-label', `${integration.label} integration`);
  if (integration.logo) {
    badge.innerHTML = '<img alt=""><span></span>';
    badge.querySelector('img').src = integration.logo;
  } else {
    badge.innerHTML = `
      <svg class="tool-integration-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
        <circle cx="12" cy="12" r="9"></circle>
        <path d="M3 12h18M12 3c2.4 2.6 3.7 5.6 3.7 9s-1.3 6.4-3.7 9c-2.4-2.6-3.7-5.6-3.7-9s1.3-6.4 3.7-9z"></path>
      </svg>
      <span></span>`;
  }
  badge.querySelector('span').textContent = integration.label;
  if (!existing) card.querySelector('.tool-name').before(badge);
}

export function finishToolCard(ev) {
  const card = state.toolCards.get(ev.toolCallId);
  if (!card) return;
  if (card.dataset.integrationSource === 'research') {
    setIntegrationBadge(card, integrationForResearchResult(ev, state.webResearchProvider));
  }
  card.classList.add(ev.isError ? 'error' : 'done');
  const text = (ev.result?.content || [])
    .filter((content) => content.type === 'text')
    .map((content) => content.text)
    .join('\n')
    .trim();
  if (text) {
    const out = card.querySelector('.tool-out');
    out.textContent = text.length > 4000 ? text.slice(0, 4000) + '\n… (truncated)' : text;
    out.classList.remove('hidden');
    card.querySelector('.out-label').classList.remove('hidden');
  }
  // What it found, in the stream itself. Built from text nodes rather than markup:
  // this is tool output, so nothing here should ever be parsed as HTML.
  const summary = resultSummary({ output: text, isError: ev.isError });
  endCall(ev, { output: text, summary });
  const line = card.querySelector('.tool-result');
  if (summary && line) {
    line.replaceChildren(...summary.map((seg) => {
      const node = document.createElement(seg.strong ? 'strong' : 'span');
      node.textContent = seg.text;
      return node;
    }));
    line.classList.remove('hidden');
  }
  autoscroll();
}

/**
 * Progress on a call that is still running.
 *
 * `tool_execution_update` has been on the wire since the Pi backend landed and has
 * never had a client handler, so a five-minute query looked identical to a hung one.
 */
export function updateToolCard(ev) {
  const record = updateCall(ev);
  if (!record) return;
  const card = state.toolCards.get(ev.toolCallId);
  const line = card?.querySelector('.tool-progress');
  if (!card || !line) return;
  line.textContent = record.progress;
  line.classList.toggle('hidden', !record.progress);
}

export function resetStreamRendering() {
  resetCalls();
  state.currentAgentMsg = null;
  state.pendingReplayAssistantBoundary = false;
  state.blocks = new Map();
  state.toolCards = new Map();
  state.challengerCards = new Map();
  state.renderQueued = false;
}

/** Replace browser-only conversation state before applying an authoritative snapshot. */
export function resetConversationReplay() {
  dom.chatEl.querySelectorAll('.msg').forEach((el) => el.remove());
  dom.emptyState.classList.remove('hidden');
  resetStreamRendering();
  state.usage = newUsage();
  setHasMessages(false);
}

export { renderMarkdown };
