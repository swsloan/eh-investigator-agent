import { getInvestigationPlan, getRenderedInvestigationPlan } from './api.js';
import { dom } from './dom.js';
import { state } from './state.js';

const PLAN_TYPES = {
  'threat-hunt': { token: 'threat-hunt', label: 'Threat hunt' },
  threat_hunt: { token: 'threat-hunt', label: 'Threat hunt' },
  'security-investigation': { token: 'security-investigation', label: 'Security investigation' },
  security_investigation: { token: 'security-investigation', label: 'Security investigation' },
  'performance-investigation': { token: 'performance-investigation', label: 'Performance investigation' },
  performance_investigation: { token: 'performance-investigation', label: 'Performance investigation' },
};
const COMPLETE_STATUSES = new Set(['complete', 'completed', 'done', 'resolved', 'skipped', 'superseded']);
const ACTIVE_STATUSES = new Set(['active', 'current', 'in-progress', 'in_progress', 'working']);
const BLOCKED_STATUSES = new Set(['blocked', 'paused']);

let openGeneratedHtmlViewer = () => {};
let planRequest = null;
let planRequestGeneration = 0;
let renderRequest = null;
let updateFlashTimer = null;

function captureSessionScope() {
  if (!state.session) return null;
  return {
    sessionId: state.session.id,
    sessionGeneration: state.sessionGeneration,
  };
}

function isCurrentSessionScope(scope) {
  return Boolean(scope)
    && state.session?.id === scope.sessionId
    && state.sessionGeneration === scope.sessionGeneration;
}

function isAbortError(err) {
  return err?.name === 'AbortError';
}

function revisionNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const revision = Number(value);
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : null;
}

function planTypeInfo(plan = {}) {
  const raw = String(plan.planType || plan.plan_type || '').trim().toLowerCase();
  if (PLAN_TYPES[raw]) return PLAN_TYPES[raw];
  const suppliedLabel = String(plan.planTypeLabel || plan.plan_type_label || '').trim();
  return {
    token: '',
    label: suppliedLabel || (raw ? raw.replaceAll(/[-_]/g, ' ') : 'Investigation'),
  };
}

function renderedPlanMetadata(html, fallbackPlan = {}) {
  try {
    const documentSnapshot = new DOMParser().parseFromString(String(html || ''), 'text/html');
    const root = documentSnapshot.documentElement;
    const planType = root?.dataset?.planType || root?.dataset?.planTemplate || '';
    const title = documentSnapshot.querySelector('h1')?.textContent?.trim()
      || documentSnapshot.title?.trim()
      || String(fallbackPlan.title || 'Investigation plan');
    return { title, type: planTypeInfo({ planType }) };
  } catch {
    return {
      title: String(fallbackPlan.title || 'Investigation plan'),
      type: planTypeInfo(fallbackPlan),
    };
  }
}

function taskStatus(task, currentTaskId) {
  const raw = String(task?.status || '').trim().toLowerCase();
  if (COMPLETE_STATUSES.has(raw)) return 'complete';
  if (BLOCKED_STATUSES.has(raw)) return 'blocked';
  if (String(task?.id || '') === currentTaskId || ACTIVE_STATUSES.has(raw)) return 'active';
  return 'pending';
}

function currentTaskId(progress = {}) {
  const current = progress.currentTask;
  if (current && typeof current === 'object') return String(current.id || '');
  return typeof current === 'string' ? current : '';
}

function currentTaskTitle(plan = {}, progress = {}) {
  const tasks = Array.isArray(plan.tasks) ? plan.tasks : [];
  const current = progress.currentTask;
  if (current && typeof current === 'object' && current.title) return String(current.title);
  if (typeof current === 'string') {
    const task = tasks.find((candidate) => String(candidate?.id || '') === current);
    return String(task?.title || current);
  }
  const active = tasks.find((task) => ACTIVE_STATUSES.has(String(task?.status || '').toLowerCase()));
  if (active?.title) return String(active.title);
  const pending = tasks.find((task) => !COMPLETE_STATUSES.has(String(task?.status || '').toLowerCase()));
  return String(pending?.title || 'Checklist complete');
}

function normalizedProgress(view = {}) {
  const plan = view.plan || {};
  const tasks = Array.isArray(plan.tasks) ? plan.tasks : [];
  const source = view.progress || {};
  const resolvedValue = Number(source.resolved);
  const totalValue = Number(source.total);
  const resolved = Number.isFinite(resolvedValue)
    ? Math.max(0, resolvedValue)
    : tasks.filter((task) => COMPLETE_STATUSES.has(String(task?.status || '').toLowerCase())).length;
  const total = Number.isFinite(totalValue) ? Math.max(0, totalValue) : tasks.length;
  const percentValue = Number(source.percent);
  const percent = Number.isFinite(percentValue)
    ? Math.max(0, Math.min(100, percentValue))
    : total ? Math.round((resolved / total) * 100) : 0;
  const planState = String(source.state || (total && resolved >= total ? 'complete' : total ? 'active' : 'awaiting'));
  return { ...source, resolved, total, percent, state: planState };
}

function updatePlanToggleLabel() {
  const action = state.investigationPlanExpanded ? 'Collapse' : 'Expand';
  const view = state.investigationPlan;
  if (!view?.initialized || !view.plan) {
    dom.investigationPlanToggle.setAttribute(
      'aria-label',
      `${action} investigation plan checklist. Awaiting plan initialization.`,
    );
    return;
  }
  const progress = normalizedProgress(view);
  const type = planTypeInfo(view.plan);
  const current = currentTaskTitle(view.plan, progress);
  const focus = progress.state === 'blocked' ? `Blocked: ${current}.` : `Current focus: ${current}.`;
  dom.investigationPlanToggle.setAttribute(
    'aria-label',
    `${action} investigation plan checklist. ${type.label}. ${progress.resolved} of ${progress.total} tasks resolved. ${focus}`,
  );
}

function announcePlan(message) {
  dom.investigationPlanLive.textContent = '';
  requestAnimationFrame(() => { dom.investigationPlanLive.textContent = message; });
}

function flashPlanRibbon() {
  if (updateFlashTimer !== null) clearTimeout(updateFlashTimer);
  dom.investigationPlanRibbon.classList.remove('updated');
  requestAnimationFrame(() => dom.investigationPlanRibbon.classList.add('updated'));
  updateFlashTimer = setTimeout(() => {
    updateFlashTimer = null;
    dom.investigationPlanRibbon.classList.remove('updated');
  }, 700);
}

function setProgressSemantics(progress, initialized) {
  const meter = dom.investigationPlanProgress;
  if (!initialized || progress.total === 0) {
    meter.setAttribute('role', 'status');
    meter.setAttribute('aria-label', initialized ? 'Investigation checklist has no tasks' : 'Investigation plan is awaiting initialization');
    meter.removeAttribute('aria-valuemin');
    meter.removeAttribute('aria-valuemax');
    meter.removeAttribute('aria-valuenow');
    meter.removeAttribute('aria-valuetext');
  } else {
    meter.setAttribute('role', 'progressbar');
    meter.setAttribute('aria-label', 'Investigation checklist progress');
    meter.setAttribute('aria-valuemin', '0');
    meter.setAttribute('aria-valuemax', String(progress.total));
    meter.setAttribute('aria-valuenow', String(progress.resolved));
    meter.setAttribute('aria-valuetext', `${progress.resolved} of ${progress.total} tasks resolved`);
  }
  meter.querySelector('span').style.width = `${progress.percent}%`;
}

function renderTasks(plan, progress) {
  const tasks = Array.isArray(plan.tasks) ? plan.tasks : [];
  const activeId = currentTaskId(progress);
  dom.investigationPlanTasks.replaceChildren();
  for (const task of tasks) {
    const status = taskStatus(task, activeId);
    const item = document.createElement('li');
    item.className = `plan-ribbon-task ${status}`;
    item.dataset.planTaskId = String(task?.id || '');
    const title = String(task?.title || 'Untitled investigation step');
    const rawStatus = String(task?.status || '').trim().toLowerCase();
    const statusLabel = rawStatus === 'skipped'
      ? 'Skipped'
      : rawStatus === 'superseded'
        ? 'Superseded'
        : status === 'complete'
          ? 'Complete'
          : status === 'active'
            ? 'Current'
            : status === 'blocked'
              ? 'Blocked'
              : 'Pending';
    item.setAttribute('aria-label', `${statusLabel}: ${title}`);

    const mark = document.createElement('span');
    mark.className = 'plan-ribbon-task-mark';
    mark.setAttribute('aria-hidden', 'true');
    mark.textContent = status === 'complete' ? '✓' : status === 'active' ? '•' : status === 'blocked' ? '!' : '';

    const copy = document.createElement('span');
    copy.className = 'plan-ribbon-task-copy';
    const taskTitle = document.createElement('span');
    taskTitle.textContent = title;
    copy.appendChild(taskTitle);
    if (status !== 'pending') {
      const label = document.createElement('small');
      label.textContent = statusLabel;
      copy.appendChild(label);
    }
    if (status === 'blocked' && task?.outcome) {
      const outcome = document.createElement('span');
      outcome.className = 'plan-ribbon-task-outcome';
      outcome.textContent = String(task.outcome);
      copy.appendChild(outcome);
    }
    item.append(mark, copy);
    dom.investigationPlanTasks.appendChild(item);
  }
}

function renderPivot(plan) {
  const pivots = Array.isArray(plan.pivots) ? plan.pivots : [];
  const pivot = pivots.at(-1);
  dom.investigationPlanPivot.classList.toggle('hidden', !pivot);
  if (!pivot) return;
  const decision = String(pivot.decision || pivot.trigger || 'The investigation changed direction.');
  const detail = String(pivot.reason || (pivot.decision ? pivot.trigger : '') || '');
  dom.investigationPlanPivot.querySelector('strong').textContent = decision;
  dom.investigationPlanPivot.querySelector('p').textContent = detail;
}

function renderPlanView(view) {
  const initialized = Boolean(view?.initialized && view?.plan);
  const plan = initialized ? view.plan : {};
  const progress = normalizedProgress(initialized ? view : {});
  const type = planTypeInfo(plan);
  const focusTitle = initialized ? currentTaskTitle(plan, progress) : '';
  const currentTitle = progress.state === 'blocked'
    ? `Blocked · ${focusTitle}`
    : initialized
      ? focusTitle
      : 'The agent has not initialized a plan yet.';

  dom.investigationPlanRibbon.classList.toggle('awaiting', !initialized);
  dom.investigationPlanRibbon.classList.toggle('blocked', initialized && progress.state === 'blocked');
  dom.investigationPlanRibbon.dataset.planType = initialized ? type.token : '';
  dom.investigationPlanType.textContent = initialized ? type.label : 'Awaiting plan';
  dom.investigationPlanCurrent.textContent = currentTitle;
  dom.investigationPlanCount.textContent = initialized && progress.total ? `${progress.resolved}/${progress.total}` : '—';
  dom.investigationPlanCount.setAttribute(
    'aria-label',
    initialized && progress.total ? `${progress.resolved} of ${progress.total} tasks resolved` : 'No checklist items',
  );
  dom.investigationPlanProgressStatus.textContent = initialized
    ? progress.state === 'complete'
      ? `Plan complete · ${progress.resolved} of ${progress.total}`
      : progress.state === 'blocked'
        ? `Plan blocked · ${progress.resolved} of ${progress.total} resolved`
        : `${progress.resolved} of ${progress.total} resolved`
    : 'Awaiting plan';
  dom.investigationPlanObjective.textContent = initialized
    ? String(plan.objective || plan.hypothesis || 'The investigator is working from the checklist below.')
    : 'The checklist will appear after the investigator initializes its plan.';
  setProgressSemantics(progress, initialized);
  renderTasks(plan, progress);
  renderPivot(plan);
  dom.investigationPlanView.classList.toggle('hidden', !initialized);
  const opening = Boolean(renderRequest);
  dom.investigationPlanView.disabled = opening;
  dom.investigationPlanView.textContent = opening ? 'Opening plan…' : 'View investigation plan';
  if (!opening) dom.investigationPlanView.removeAttribute('title');
  updatePlanToggleLabel();
}

function setExpanded(expanded) {
  state.investigationPlanExpanded = Boolean(expanded);
  dom.investigationPlanRibbon.classList.toggle('expanded', state.investigationPlanExpanded);
  dom.investigationPlanToggle.setAttribute('aria-expanded', String(state.investigationPlanExpanded));
  dom.investigationPlanDetails.hidden = !state.investigationPlanExpanded;
  updatePlanToggleLabel();
}

function applyInvestigationPlanView(view, { announce = false, sessionId = '' } = {}) {
  if (sessionId && state.session?.id !== sessionId) return false;
  const incomingRevision = revisionNumber(view?.revision);
  const currentRevision = revisionNumber(state.investigationPlanRevision);
  if (currentRevision !== null && (incomingRevision === null || incomingRevision < currentRevision)) return false;

  state.investigationPlan = view || null;
  state.investigationPlanRevision = incomingRevision;
  renderPlanView(state.investigationPlan);
  if (announce && view?.initialized && view?.plan) {
    const progress = normalizedProgress(view);
    const current = currentTaskTitle(view.plan, progress);
    announcePlan(`Investigation plan updated. ${progress.resolved} of ${progress.total} tasks resolved. Current focus: ${current}`);
    flashPlanRibbon();
  }
  return true;
}

async function openRenderedPlan() {
  const scope = captureSessionScope();
  if (!scope || !state.investigationPlan?.initialized || !state.investigationPlan.plan) return;

  renderRequest?.controller.abort();
  const request = {
    ...scope,
    controller: new AbortController(),
  };
  renderRequest = request;
  dom.investigationPlanView.disabled = true;
  dom.investigationPlanView.textContent = 'Opening plan…';
  dom.investigationPlanView.removeAttribute('title');
  let failed = false;
  try {
    let rendered = null;
    let snapshotView = state.investigationPlan;
    let snapshotRevision = revisionNumber(state.investigationPlanRevision);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      snapshotView = state.investigationPlan;
      snapshotRevision = revisionNumber(state.investigationPlanRevision);
      rendered = await getRenderedInvestigationPlan(request.sessionId, {
        signal: request.controller.signal,
      });
      if (
        renderRequest !== request
        || request.controller.signal.aborted
        || !isCurrentSessionScope(request)
      ) return;
      const renderedRevision = revisionNumber(rendered.revision) ?? snapshotRevision;
      let ribbonRevision = revisionNumber(state.investigationPlanRevision);
      if (attempt === 0 && renderedRevision !== ribbonRevision) {
        if (renderedRevision !== null && (ribbonRevision === null || renderedRevision > ribbonRevision)) {
          await refreshInvestigationPlan();
          if (
            renderRequest !== request
            || request.controller.signal.aborted
            || !isCurrentSessionScope(request)
          ) return;
          ribbonRevision = revisionNumber(state.investigationPlanRevision);
          if (renderedRevision === ribbonRevision) {
            snapshotView = state.investigationPlan;
            snapshotRevision = renderedRevision;
            break;
          }
        }
        continue;
      }
      snapshotRevision = renderedRevision;
      break;
    }
    if (!rendered) return;
    const ribbonRevision = revisionNumber(state.investigationPlanRevision);
    const ribbonAhead = snapshotRevision !== null
      && ribbonRevision !== null
      && ribbonRevision > snapshotRevision;
    const renderAhead = snapshotRevision !== null
      && ribbonRevision !== null
      && snapshotRevision > ribbonRevision;
    const displayView = ribbonAhead || renderAhead ? snapshotView : state.investigationPlan;
    const metadata = renderedPlanMetadata(rendered.html, displayView?.plan || {});
    const revisionLabel = snapshotRevision === null ? '' : ` · Revision ${snapshotRevision}`;
    const syncLabel = ribbonAhead
      ? ` · Checklist is now revision ${ribbonRevision}`
      : renderAhead
        ? ' · Checklist sync pending'
        : '';
    openGeneratedHtmlViewer({
      title: metadata.title,
      subtitle: `${metadata.type.label}${revisionLabel}${syncLabel}`,
      html: rendered.html,
      kind: 'investigation-plan',
      returnFocus: dom.investigationPlanView,
    });
  } catch (err) {
    if (!isAbortError(err) && isCurrentSessionScope(request)) {
      failed = true;
      dom.investigationPlanView.title = err.message;
      announcePlan(`Could not open the investigation plan: ${err.message}`);
    }
  } finally {
    if (renderRequest === request) {
      renderRequest = null;
      dom.investigationPlanView.disabled = false;
      dom.investigationPlanView.textContent = failed
        ? 'Could not open — try again'
        : 'View investigation plan';
    }
  }
}

export function initInvestigationPlan({ openGeneratedHtml } = {}) {
  if (typeof openGeneratedHtml === 'function') openGeneratedHtmlViewer = openGeneratedHtml;
  dom.investigationPlanToggle.addEventListener('click', () => {
    setExpanded(!state.investigationPlanExpanded);
  });
  dom.investigationPlanView.addEventListener('click', openRenderedPlan);
  setExpanded(state.investigationPlanExpanded);
  renderPlanView(state.investigationPlan);
}

export function resetInvestigationPlan() {
  planRequest?.controller.abort();
  renderRequest?.controller.abort();
  planRequest = null;
  renderRequest = null;
  planRequestGeneration += 1;
  state.investigationPlan = null;
  state.investigationPlanRevision = null;
  renderPlanView(null);
}

export async function refreshInvestigationPlan() {
  const scope = captureSessionScope();
  if (!scope) return;
  planRequest?.controller.abort();
  const request = {
    ...scope,
    requestGeneration: ++planRequestGeneration,
    controller: new AbortController(),
  };
  planRequest = request;
  try {
    const view = await getInvestigationPlan(request.sessionId, { signal: request.controller.signal });
    if (
      planRequest !== request
      || request.requestGeneration !== planRequestGeneration
      || request.controller.signal.aborted
      || !isCurrentSessionScope(request)
    ) return;
    applyInvestigationPlanView(view, { sessionId: request.sessionId });
  } catch (err) {
    if (!isAbortError(err) && isCurrentSessionScope(request) && !state.investigationPlan) {
      dom.investigationPlanCurrent.textContent = 'Plan status is temporarily unavailable.';
      dom.investigationPlanObjective.textContent = 'Refresh the session or wait for the next plan update.';
      announcePlan(`Investigation plan unavailable: ${err.message}`);
    }
  } finally {
    if (planRequest === request) planRequest = null;
  }
}

export function applyInvestigationPlanEvent(event, options = {}) {
  const view = event?.view || event?.planView || event;
  return applyInvestigationPlanView(view, {
    announce: options.announce ?? !state.replaying,
    sessionId: options.sessionId || '',
  });
}
