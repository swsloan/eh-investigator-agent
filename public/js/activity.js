// What the agent is doing, while it does it.
//
// During a five-minute turn the transcript shows a stack of grey cards and then, at
// the end, a conclusion. This is the other reading of the same events: what has been
// run (left), where the agent is in its plan and what it currently believes
// (centre), and what it has produced so far (right).
//
// It renders from the tool store, the plan state and the workspace file list — the
// same data the transcript uses. No new events, no new backend state.

import { $ } from './dom.js';
import { state } from './state.js';
import { allCalls, callDuration, subscribeCalls } from './tool-store.js';

let active = false;      // is the activity view the visible surface?
let manual = false;      // did the user choose it, rather than a turn starting?
let elapsedTimer = null;
let turnStartedAt = 0;

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** `4s` / `1m 12s` — short enough to sit in a card header. */
export function fmtElapsed(ms) {
  const total = Math.max(0, Math.round(Number(ms) || 0) / 1000);
  if (total < 60) return `${total.toFixed(total < 10 ? 1 : 0)}s`;
  const m = Math.floor(total / 60);
  return `${m}m ${String(Math.floor(total % 60)).padStart(2, '0')}s`;
}

export function isActivityOpen() { return active; }

/**
 * Show or hide the live view.
 *
 * Both surfaces stay mounted and swap by class: the transcript keeps its scroll
 * position and its streaming DOM, so returning to it mid-turn does not restart
 * anything. The files panel collapses because the artifacts rail supersedes it —
 * the same mechanism the docked memory panel already uses.
 */
export function setActivityOpen(open, { byUser = false } = {}) {
  if (open === active) return;
  active = open;
  manual = open ? byUser : false;
  $('activity')?.classList.toggle('hidden', !open);
  $('chat-scroll')?.classList.toggle('hidden', open);
  document.body.classList.toggle('activity-on', open);
  if (open) { renderAll(); startElapsed(); } else stopElapsed();
}

function startElapsed() {
  stopElapsed();
  if (!turnStartedAt) turnStartedAt = Date.now();
  elapsedTimer = setInterval(renderStatus, 1000);
  renderStatus();
}

function stopElapsed() {
  if (elapsedTimer) clearInterval(elapsedTimer);
  elapsedTimer = null;
}

/**
 * A turn started or ended.
 *
 * The live view opens itself when work starts, because that is the moment it is
 * worth looking at, and closes when the work ends — unless the user asked for it, in
 * which case it is theirs to close.
 */
export function onRunningChanged(running) {
  if (running) {
    turnStartedAt = Date.now();
    setActivityOpen(true);
  } else {
    turnStartedAt = 0;
    if (!manual) setActivityOpen(false);
    else { stopElapsed(); renderAll(); }
  }
}

function renderStatus() {
  const dot = $('activity-dot');
  const label = $('activity-state');
  if (!label) return;
  const running = state.running;
  dot?.classList.toggle('running', running);
  const elapsed = running && turnStartedAt ? ` · ${fmtElapsed(Date.now() - turnStartedAt)} elapsed` : '';
  label.textContent = running ? `Investigating${elapsed}` : 'Idle';

  const context = $('activity-context');
  const title = state.session?.title || '';
  if (context) {
    context.textContent = title;
    context.classList.toggle('hidden', !title);
  }
}

/** The agent's current occupation, taken from whatever is actually running. */
function renderDoing() {
  const el = $('activity-doing');
  if (!el) return;
  const running = allCalls().filter((c) => c.status === 'running');
  const latest = running[running.length - 1];
  if (latest) el.textContent = latest.phrase || latest.name || 'Working…';
  else if (state.running) el.textContent = 'Thinking…';
  else el.textContent = allCalls().length ? 'Turn complete.' : 'Waiting for a question.';
}

/** The plan, mirrored from the ribbon's own state — one source, two renderings. */
function renderPlan() {
  const card = $('activity-plan');
  if (!card) return;
  const view = state.investigationPlan;
  const progress = view?.progress;
  const tasks = Array.isArray(view?.plan?.tasks) ? view.plan.tasks : [];
  if (!view?.initialized || !tasks.length) { card.classList.add('hidden'); return; }
  card.classList.remove('hidden');

  const total = Number(progress?.total) || tasks.length;
  const resolved = Number(progress?.resolved) || 0;
  const percent = Number.isFinite(Number(progress?.percent))
    ? Math.max(0, Math.min(100, Number(progress.percent)))
    : (total ? (resolved / total) * 100 : 0);
  $('activity-plan-count').textContent = `${resolved}/${total}`;
  $('activity-plan-fill').style.width = `${percent.toFixed(0)}%`;

  const currentId = progress?.currentTask?.id;
  $('activity-plan-tasks').innerHTML = tasks.map((task) => {
    const done = ['completed', 'skipped', 'superseded'].includes(task.status);
    const current = task.id === currentId || task.status === 'in_progress';
    const cls = done ? 'done' : (current ? 'current' : 'pending');
    const mark = done ? '✓' : '';
    return `<li class="${cls}"><span class="activity-task-mark">${mark}</span>${esc(task.title || '')}</li>`;
  }).join('');
}

/**
 * The most recent FINDING the agent stated.
 *
 * Populated by chat.js as findings are parsed out of the stream, so the card and the
 * chips in the transcript can never disagree about what was said.
 */
export function setCurrentFinding(finding) {
  const card = $('activity-finding');
  const text = $('activity-finding-text');
  if (!card || !text) return;
  if (!finding) { card.classList.add('hidden'); return; }
  card.classList.remove('hidden');
  card.dataset.leaning = finding.leaning || '';
  text.textContent = finding.text;
}

export function renderAll() {
  if (!active) return;
  renderStatus();
  renderDoing();
  renderPlan();
  renderToolStream();
  renderArtifacts();
}

// Filled in by phase 6.3; declared here so renderAll has one shape from the start.
let renderToolStream = () => {};
let renderArtifacts = () => {};

/** Let the stream and artifact renderers register themselves. */
export function registerActivityRenderers({ tools, artifacts }) {
  if (tools) renderToolStream = tools;
  if (artifacts) renderArtifacts = artifacts;
}

export function initActivity() {
  if (!$('activity')) return;
  $('activity-transcript')?.addEventListener('click', () => setActivityOpen(false, { byUser: true }));
  // Re-render on every store change; cheap, and the alternative is a diff nobody
  // needs for a list this size.
  subscribeCalls(() => { if (active) { renderDoing(); renderToolStream(); } });
}

export { callDuration };
