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

/** Called by files.js after every workspace refresh. */
export function onFilesChanged() {
  if (active) renderArtifacts();
}

export function renderAll() {
  if (!active) return;
  renderStatus();
  renderDoing();
  renderPlan();
  renderToolStream();
  renderArtifacts();
}

// How many finished calls stay expanded before the rest fold away. The newest work
// is the work being watched; older calls are context, not content.
const VISIBLE_CALLS = 6;

/** Segments from tool-phrases, as text nodes — tool output is never markup. */
function summaryNode(summary) {
  const wrap = document.createElement('div');
  wrap.className = 'act-call-result';
  for (const seg of summary) {
    const node = document.createElement(seg.strong ? 'strong' : 'span');
    node.textContent = seg.text;
    wrap.appendChild(node);
  }
  return wrap;
}

function callCard(record, { faded = false } = {}) {
  const card = document.createElement('div');
  card.className = `act-call ${record.status}${faded ? ' faded' : ''}`;

  const head = document.createElement('div');
  head.className = 'act-call-head';
  const dot = document.createElement('span');
  dot.className = 'act-call-dot';
  const name = document.createElement('strong');
  name.className = 'act-call-name';
  name.textContent = record.name || 'tool';
  const timing = document.createElement('span');
  timing.className = 'act-call-timing';
  const ms = callDuration(record);
  timing.textContent = record.status === 'running'
    ? `running · ${fmtElapsed(Date.now() - record.startedAt)}`
    : fmtElapsed(ms);
  head.append(dot, name, timing);
  card.appendChild(head);

  if (record.phrase) {
    const phrase = document.createElement('div');
    phrase.className = 'act-call-phrase';
    phrase.textContent = record.phrase;
    card.appendChild(phrase);
  }
  if (record.status === 'running' && record.progress) {
    const progress = document.createElement('div');
    progress.className = 'act-call-progress';
    progress.textContent = record.progress;
    card.appendChild(progress);
  }
  if (record.summary?.length) card.appendChild(summaryNode(record.summary));
  return card;
}

/**
 * The tool stream, newest first.
 *
 * Reversed relative to the transcript on purpose: the transcript is a record you
 * read forwards, this is a monitor where the interesting line is the last one.
 */
function renderToolStream() {
  const host = $('activity-tools');
  const head = $('activity-tools-head');
  if (!host) return;
  const calls = allCalls();
  if (head) {
    head.textContent = calls.length
      ? `Tool activity · ${calls.length} call${calls.length === 1 ? '' : 's'}`
      : 'Tool activity';
  }
  if (!calls.length) {
    host.innerHTML = '<div class="act-empty">Nothing has run yet this turn.</div>';
    return;
  }
  const newestFirst = [...calls].reverse();
  const shown = newestFirst.slice(0, VISIBLE_CALLS);
  const hidden = newestFirst.length - shown.length;

  const frag = document.createDocumentFragment();
  shown.forEach((record, i) => frag.appendChild(callCard(record, { faded: i >= 3 && record.status !== 'running' })));
  if (hidden > 0) {
    const more = document.createElement('div');
    more.className = 'act-more';
    more.textContent = `${hidden} earlier call${hidden === 1 ? '' : 's'}`;
    frag.appendChild(more);
  }
  host.replaceChildren(frag);
}

/**
 * Artifacts, and the one being written right now.
 *
 * A file the agent is mid-write has no entry in the workspace listing yet — the list
 * is polled when a tool call ends. So a running write/edit is read as a drafting
 * card, which is what makes the rail show work in progress rather than only its
 * results.
 */
function draftingPaths() {
  const paths = new Set();
  for (const record of allCalls()) {
    if (record.status !== 'running') continue;
    const name = String(record.name || '').toLowerCase();
    if (name !== 'write' && name !== 'edit') continue;
    const path = record.args?.path || record.args?.file_path;
    if (path) paths.add(String(path).split('/').filter(Boolean).join('/'));
  }
  return paths;
}

function artifactCard({ name, tag, drafting = false, meta = '' }) {
  const card = document.createElement('div');
  card.className = `act-artifact${drafting ? ' drafting' : ''}`;
  const head = document.createElement('div');
  head.className = 'act-artifact-head';
  if (drafting) {
    const dot = document.createElement('span');
    dot.className = 'act-artifact-dot';
    head.appendChild(dot);
  }
  const title = document.createElement('strong');
  title.className = 'act-artifact-name';
  title.textContent = name;
  const kind = document.createElement('span');
  kind.className = 'act-artifact-tag';
  kind.textContent = drafting ? 'Drafting' : (tag || '');
  head.append(title, kind);
  card.appendChild(head);
  if (meta) {
    const sub = document.createElement('div');
    sub.className = 'act-artifact-meta';
    sub.textContent = meta;
    card.appendChild(sub);
  }
  return card;
}

function renderArtifacts() {
  const host = $('activity-artifacts');
  const head = $('activity-artifacts-head');
  if (!host) return;
  const files = [...state.workspaceFiles.values()].filter((f) => f.reveal);
  const drafting = draftingPaths();
  // A file being written that is not yet in the listing still deserves a card.
  const unlisted = [...drafting].filter((p) => !state.workspaceFiles.has(p));

  if (head) {
    const total = files.length + unlisted.length;
    head.textContent = total ? `Artifacts · ${total}` : 'Artifacts';
  }
  if (!files.length && !unlisted.length) {
    host.innerHTML = '<div class="act-empty">Evidence and reports appear here as they are written.</div>';
    return;
  }

  const frag = document.createDocumentFragment();
  const short = (p) => String(p).split('/').pop();
  for (const path of unlisted) frag.appendChild(artifactCard({ name: short(path), drafting: true }));
  for (const file of files) {
    frag.appendChild(artifactCard({
      name: short(file.path),
      tag: file.tag || '',
      drafting: drafting.has(file.path),
      meta: file.path.includes('/') ? file.path.replace(/\/[^/]+$/, '') : '',
    }));
  }
  host.replaceChildren(frag);
}

export function initActivity() {
  if (!$('activity')) return;
  $('activity-transcript')?.addEventListener('click', () => setActivityOpen(false, { byUser: true }));
  // Re-render on every store change; cheap, and the alternative is a diff nobody
  // needs for a list this size.
  subscribeCalls(() => { if (active) { renderDoing(); renderToolStream(); } });
}

export { callDuration };
