import fs from 'node:fs';
import path from 'node:path';
import {
  INVESTIGATION_PLAN_FILENAME,
  INVESTIGATION_PLAN_SCHEMA_VERSION,
  INVESTIGATION_PLAN_STATE_FILENAME,
  INVESTIGATION_PLAN_TEMPLATE,
  PLAN_LIMITS,
  PLAN_TYPE_LABELS,
} from './constants.js';
import {
  InvestigationPlanError,
  assertKnownKeys,
  assertPlainObject,
  assertRevision,
  initFingerprint,
  isTerminalStatus,
  normalizeAddPayload,
  normalizeInitPayload,
  normalizePivotPayload,
  normalizeUpdatePayload,
  planProgress,
  publicPlanView,
  validateStoredState,
} from './schema.js';
import { renderInvestigationPlanMarkdown } from './render.js';
import { withInvestigationPlanLock } from './lock.js';

const OLD_PLACEHOLDER = `<!-- artifact-kind: investigation-plan -->
# Investigation plan

_The investigator will replace this placeholder with the scope, working hypothesis, evidence strategy, and definition of done before collecting evidence._

## Checklist

<!-- Add a concise, ordered Markdown task list here using - [ ] and - [x]. -->

## Plan updates

<!-- Record material pivots here before pursuing them. Preserve earlier entries. -->
`;

function error(message, code = 'INVALID_INVESTIGATION_PLAN', statusCode = 400) {
  return new InvestigationPlanError(message, { code, statusCode });
}

function pathsFor(workspace) {
  return {
    markdown: path.join(workspace, INVESTIGATION_PLAN_FILENAME),
    state: path.join(workspace, INVESTIGATION_PLAN_STATE_FILENAME),
  };
}

function isInsidePath(parent, child) {
  const rel = path.relative(parent, child);
  return rel === '' || (!!rel && !rel.startsWith('..') && !path.isAbsolute(rel));
}

function readBoundedRegularFile(file, maxBytes, label) {
  let stat;
  try {
    stat = fs.lstatSync(file);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw error(`${label} must be a regular file.`, 'INVALID_PLAN_FILE');
  }
  if (stat.size > maxBytes) {
    throw error(`${label} exceeds the ${maxBytes}-byte limit.`, 'PLAN_FILE_TOO_LARGE', 413);
  }
  return fs.readFileSync(file, 'utf8');
}

function placeholderMarkdown() {
  try {
    return fs.readFileSync(INVESTIGATION_PLAN_TEMPLATE, 'utf8');
  } catch {
    return OLD_PLACEHOLDER;
  }
}

function isUntouchedPlaceholder(content) {
  return content === placeholderMarkdown() || content === OLD_PLACEHOLDER;
}

function atomicWrite(file, content, mode = 0o600) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
  try {
    fs.writeFileSync(temporary, content, { mode });
    fs.chmodSync(temporary, mode);
    fs.renameSync(temporary, file);
  } catch (err) {
    try { fs.rmSync(temporary, { force: true }); } catch { /* best effort */ }
    throw err;
  }
}

function clockTimestamp(options = {}) {
  const supplied = typeof options.clock === 'function' ? options.clock() : options.now;
  const value = supplied === undefined ? Date.now() : supplied;
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw error('The injected plan clock returned an invalid time.');
  return date.toISOString();
}

function readState(workspace) {
  const file = pathsFor(workspace).state;
  const raw = readBoundedRegularFile(file, PLAN_LIMITS.stateBytes, 'Structured investigation plan state');
  if (raw === null) return null;
  let state;
  try {
    state = JSON.parse(raw);
  } catch {
    throw error('Structured investigation plan state is not valid JSON.', 'INVALID_PLAN_STATE');
  }
  return validateStoredState(state);
}

function projectionWarning() {
  return {
    code: 'PLAN_PROJECTION_DEFERRED',
    message: 'Structured plan state was committed, but investigation-plan.md could not be updated. The app will retry the projection on a later read.',
  };
}

function warningExtra(warning) {
  return warning ? { warnings: [warning] } : {};
}

function projectionEntryIsInvalid(file) {
  try {
    const stat = fs.lstatSync(file);
    return stat.isSymbolicLink() || !stat.isFile();
  } catch (err) {
    if (err.code === 'ENOENT') return false;
    throw err;
  }
}

function preservedProjectionConflictPath(file) {
  for (let suffix = 1; ; suffix += 1) {
    const candidate = suffix === 1 ? `${file}.user` : `${file}.user-${suffix}`;
    try {
      fs.lstatSync(candidate);
    } catch (err) {
      if (err.code === 'ENOENT') return candidate;
      throw err;
    }
  }
}

function writeProjectionAfterCommit(file, markdown) {
  try {
    // Do not replace an unrelated directory, special file, or symlink after
    // the state commit. A later locked read preserves that entry first.
    if (projectionEntryIsInvalid(file)) return projectionWarning();
    atomicWrite(file, markdown);
    return null;
  } catch {
    return projectionWarning();
  }
}

function writeStateAndProjection(workspace, state, expectedBaseRevision) {
  validateStoredState(state);
  const serialized = `${JSON.stringify(state, null, 2)}\n`;
  if (Buffer.byteLength(serialized) > PLAN_LIMITS.stateBytes) {
    throw error('Structured investigation plan exceeds its state-size limit.', 'PLAN_STATE_TOO_LARGE', 413);
  }
  const markdown = renderInvestigationPlanMarkdown(state);
  const files = pathsFor(workspace);
  // Revalidate the revision immediately before the commit point. The
  // workspace lock serializes supported app processes; this CAS also catches
  // an out-of-band state replacement that happened during preparation.
  const current = readState(workspace);
  assertRevision(current?.revision || 0, expectedBaseRevision);

  // This rename is the commit point. Everything that can fail beforehand
  // reports a failed mutation. Projection failures after it are warnings, not
  // ambiguous operation failures, because state is authoritative.
  atomicWrite(files.state, serialized);
  return writeProjectionAfterCommit(files.markdown, markdown);
}

function repairProjection(workspace, state) {
  const expected = renderInvestigationPlanMarkdown(state);
  const file = pathsFor(workspace).markdown;
  let current = null;
  try {
    if (projectionEntryIsInvalid(file)) {
      // Rename the directory entry itself. This preserves directories and
      // symlinks without traversing or modifying their targets.
      fs.renameSync(file, preservedProjectionConflictPath(file));
    } else {
      const stat = fs.lstatSync(file);
      if (stat.size <= PLAN_LIMITS.legacyMarkdownBytes) {
        current = fs.readFileSync(file, 'utf8');
      }
    }
  } catch (err) {
    if (err.code !== 'ENOENT') return projectionWarning();
  }
  if (current === expected) return null;
  try {
    atomicWrite(file, expected);
    return null;
  } catch {
    return projectionWarning();
  }
}

function currentTaskFor(tasks, progress) {
  return tasks.find((task) => task.status === 'in_progress')
    || tasks.find((task) => task.status === 'pending')
    || tasks.find((task) => task.status === 'blocked')
    || null;
}

function toCamelTask(task) {
  return {
    id: task.id,
    title: task.title,
    why: task.why,
    evidence: [...task.evidence],
    status: task.status,
    outcome: task.outcome,
    evidenceRefs: [...task.evidence_refs],
    createdAt: task.created_at,
    updatedAt: task.updated_at,
  };
}

function wrapStructuredState(state) {
  const inner = publicPlanView(state);
  const tasks = inner.tasks.map(toCamelTask);
  const progress = {
    ...inner.progress,
    currentTask: currentTaskFor(tasks, inner.progress),
  };
  return {
    ok: true,
    initialized: true,
    structured: true,
    legacy: false,
    revision: inner.revision,
    plan: {
      planType: inner.plan_type,
      planTypeLabel: inner.plan_type_label,
      title: inner.title,
      objective: inner.objective,
      scope: inner.scope,
      hypothesis: inner.hypothesis,
      evidenceStrategy: inner.strategy,
      completionCriteria: inner.completion_criteria,
      tasks,
      pivots: inner.pivots.map((pivot) => ({
        id: pivot.id,
        revision: pivot.revision,
        at: pivot.at,
        trigger: pivot.trigger,
        decision: pivot.decision,
        revisedObjective: pivot.revised_objective || '',
        revisedHypothesis: pivot.revised_hypothesis || '',
        revisedStrategy: pivot.revised_strategy || '',
        revisedScope: pivot.revised_scope || '',
        revisedCompletionCriteria: pivot.revised_completion_criteria || '',
        fromPlanType: pivot.from_plan_type,
        toPlanType: pivot.to_plan_type,
        superseded: [...pivot.superseded],
        added: [...pivot.added],
        evidenceRefs: [...pivot.evidence_refs],
      })),
      changes: inner.changes.map((change) => ({
        revision: change.revision,
        at: change.at,
        kind: change.kind,
        reason: change.reason || '',
        taskIds: [...(change.task_ids || [])],
        taskId: change.task_id || '',
        fromStatus: change.from_status || '',
        toStatus: change.to_status || '',
        pivotId: change.pivot_id || '',
      })),
      createdAt: inner.created_at,
      updatedAt: inner.updated_at,
    },
    progress,
  };
}

function awaitingView({ missing = false } = {}) {
  return {
    ok: true,
    initialized: false,
    structured: !missing,
    legacy: false,
    revision: 0,
    plan: null,
    progress: { ...planProgress([], { structured: false }), currentTask: null },
  };
}

function legacyView(markdown) {
  const heading = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() || 'Legacy investigation plan';
  const tasks = [];
  for (const match of markdown.matchAll(/^[ \t]*[-*+]\s+\[([ xX])\]\s+(.+)$/gm)) {
    tasks.push({
      id: `legacy-${tasks.length + 1}`,
      title: match[2].replace(/~~/g, '').trim(),
      why: '',
      evidence: [],
      status: match[1].toLowerCase() === 'x' ? 'completed' : 'pending',
      outcome: '',
      evidenceRefs: [],
      createdAt: null,
      updatedAt: null,
    });
  }
  const progress = planProgress(tasks, { structured: false });
  return {
    ok: true,
    initialized: true,
    structured: false,
    legacy: true,
    revision: 0,
    plan: {
      planType: null,
      planTypeLabel: 'Legacy plan',
      title: heading,
      objective: 'This historical Markdown plan is preserved without structured conversion.',
      scope: '',
      hypothesis: '',
      evidenceStrategy: '',
      completionCriteria: '',
      tasks,
      pivots: [],
      markdown,
      createdAt: null,
      updatedAt: null,
    },
    progress: { ...progress, currentTask: currentTaskFor(tasks, progress) },
  };
}

function readPlanViewUnlocked(workspace) {
  const state = readState(workspace);
  if (state) {
    const warning = repairProjection(workspace, state);
    return { ...wrapStructuredState(state), ...warningExtra(warning) };
  }
  const markdown = readBoundedRegularFile(
    pathsFor(workspace).markdown,
    PLAN_LIMITS.legacyMarkdownBytes,
    'Investigation plan Markdown',
  );
  if (markdown === null) return awaitingView({ missing: true });
  if (isUntouchedPlaceholder(markdown)) return awaitingView();
  return legacyView(markdown);
}

export function readPlanView(workspace, options = {}) {
  return withInvestigationPlanLock(workspace, () => readPlanViewUnlocked(workspace), options);
}

function resolveEvidenceRefs(workspace, refs = []) {
  if (!refs.length) return [];
  const workspaceReal = fs.realpathSync.native(workspace);
  const output = [];
  for (const raw of refs) {
    if (raw.includes('\\') || path.isAbsolute(raw) || raw.split('/').some((part) => !part || part === '.' || part === '..' || part.startsWith('.'))) {
      throw error(`Evidence reference "${raw}" must be a visible workspace-relative file path.`, 'INVALID_EVIDENCE_REFERENCE');
    }
    const rel = path.posix.normalize(raw);
    if (rel === INVESTIGATION_PLAN_FILENAME || rel === INVESTIGATION_PLAN_STATE_FILENAME) {
      throw error('The investigation plan cannot cite itself as evidence.', 'INVALID_EVIDENCE_REFERENCE');
    }
    const absolute = path.resolve(workspace, ...rel.split('/'));
    if (!isInsidePath(workspace, absolute)) {
      throw error(`Evidence reference "${raw}" escapes the workspace.`, 'INVALID_EVIDENCE_REFERENCE');
    }
    let current = workspace;
    for (const part of rel.split('/')) {
      current = path.join(current, part);
      let stat;
      try { stat = fs.lstatSync(current); } catch {
        throw error(`Evidence reference "${raw}" does not exist.`, 'INVALID_EVIDENCE_REFERENCE');
      }
      if (stat.isSymbolicLink()) {
        throw error(`Evidence reference "${raw}" cannot use a symbolic link.`, 'INVALID_EVIDENCE_REFERENCE');
      }
    }
    const stat = fs.lstatSync(absolute);
    const real = fs.realpathSync.native(absolute);
    if (!stat.isFile() || !isInsidePath(workspaceReal, real)) {
      throw error(`Evidence reference "${raw}" must name a regular workspace file.`, 'INVALID_EVIDENCE_REFERENCE');
    }
    for (const reserved of Object.values(pathsFor(workspace))) {
      try {
        const reservedStat = fs.lstatSync(reserved);
        const reservedReal = fs.realpathSync.native(reserved);
        if (real === reservedReal || (stat.dev === reservedStat.dev && stat.ino === reservedStat.ino)) {
          throw error('The investigation plan cannot cite itself as evidence.', 'INVALID_EVIDENCE_REFERENCE');
        }
      } catch (err) {
        if (err instanceof InvestigationPlanError) throw err;
        if (err.code !== 'ENOENT') throw err;
      }
    }
    if (!output.includes(rel)) output.push(rel);
  }
  return output;
}

function newTask(input, at) {
  return {
    id: input.id,
    title: input.title,
    why: input.why,
    evidence: [...input.evidence],
    status: 'pending',
    outcome: '',
    evidence_refs: [],
    created_at: at,
    updated_at: at,
  };
}

function appendChange(state, change) {
  const next = [...state.changes, change];
  if (next.length <= PLAN_LIMITS.changes) return next;
  return [next[0], ...next.slice(-(PLAN_LIMITS.changes - 1))];
}

function requireStructuredState(workspace) {
  const state = readState(workspace);
  if (state) return state;
  const markdown = readBoundedRegularFile(
    pathsFor(workspace).markdown,
    PLAN_LIMITS.legacyMarkdownBytes,
    'Investigation plan Markdown',
  );
  if (markdown !== null && !isUntouchedPlaceholder(markdown)) {
    throw error(
      'Existing investigation-plan.md contains a legacy or manually edited plan. Structured mutation was refused so it is not overwritten.',
      'LEGACY_PLAN_CONFLICT',
      409,
    );
  }
  throw error('Initialize the structured investigation plan before modifying it.', 'PLAN_NOT_INITIALIZED', 409);
}

function mutationResult(view, operation, changed, extra = {}) {
  return { ...view, operation, changed, ...extra };
}

function initPlan(workspace, payload, options) {
  const normalized = normalizeInitPayload(payload);
  const fingerprint = initFingerprint(normalized);
  const existing = readState(workspace);
  if (existing) {
    if (existing.initial_fingerprint === fingerprint) {
      // A caller may safely retry the original expected_revision: 0 request
      // after losing the first response. Current-revision retries are also
      // accepted; unrelated revision values still signal a stale caller.
      if (normalized.expected_revision !== undefined
        && normalized.expected_revision !== 0
        && normalized.expected_revision !== existing.revision) {
        assertRevision(existing.revision, normalized.expected_revision);
      }
      const warning = repairProjection(workspace, existing);
      return mutationResult(wrapStructuredState(existing), 'init', false, {
        idempotent: true,
        ...warningExtra(warning),
      });
    }
    assertRevision(existing.revision, normalized.expected_revision);
    throw error('The structured investigation plan is already initialized with different input.', 'PLAN_ALREADY_INITIALIZED', 409);
  }
  assertRevision(0, normalized.expected_revision);
  const currentMarkdown = readBoundedRegularFile(
    pathsFor(workspace).markdown,
    PLAN_LIMITS.legacyMarkdownBytes,
    'Investigation plan Markdown',
  );
  if (currentMarkdown !== null && !isUntouchedPlaceholder(currentMarkdown)) {
    throw error(
      'Existing investigation-plan.md contains a legacy or manually edited plan. Initialization was refused so it is not overwritten.',
      'LEGACY_PLAN_CONFLICT',
      409,
    );
  }
  const at = clockTimestamp(options);
  const state = {
    schema_version: INVESTIGATION_PLAN_SCHEMA_VERSION,
    revision: 1,
    initial_fingerprint: fingerprint,
    plan_type: normalized.plan_type,
    title: normalized.title,
    objective: normalized.objective,
    scope: normalized.scope,
    hypothesis: normalized.hypothesis,
    strategy: normalized.strategy,
    completion_criteria: normalized.completion_criteria,
    tasks: normalized.tasks.map((task) => newTask(task, at)),
    pivots: [],
    changes: [{ revision: 1, at, kind: 'initialized', task_ids: normalized.tasks.map((task) => task.id) }],
    created_at: at,
    updated_at: at,
  };
  const view = wrapStructuredState(state);
  const warning = writeStateAndProjection(workspace, state, 0);
  return mutationResult(view, 'init', true, warningExtra(warning));
}

function addTasks(workspace, payload, options) {
  const normalized = normalizeAddPayload(payload);
  const state = requireStructuredState(workspace);
  const baseRevision = state.revision;
  assertRevision(state.revision, normalized.expected_revision);
  if (state.tasks.length + normalized.tasks.length > PLAN_LIMITS.tasks) {
    throw error(`A plan can contain at most ${PLAN_LIMITS.tasks} tasks.`, 'PLAN_TASK_LIMIT', 413);
  }
  const existing = new Set(state.tasks.map((task) => task.id));
  for (const task of normalized.tasks) {
    if (existing.has(task.id)) throw error(`Task id "${task.id}" already exists.`, 'DUPLICATE_TASK_ID', 409);
  }
  const at = clockTimestamp(options);
  const revision = state.revision + 1;
  state.tasks.push(...normalized.tasks.map((task) => newTask(task, at)));
  state.revision = revision;
  state.updated_at = at;
  state.changes = appendChange(state, {
    revision,
    at,
    kind: 'tasks_added',
    reason: normalized.reason,
    task_ids: normalized.tasks.map((task) => task.id),
  });
  const view = wrapStructuredState(state);
  const warning = writeStateAndProjection(workspace, state, baseRevision);
  return mutationResult(view, 'add', true, warningExtra(warning));
}

function updateTask(workspace, payload, options) {
  const normalized = normalizeUpdatePayload(payload);
  const state = requireStructuredState(workspace);
  const baseRevision = state.revision;
  assertRevision(state.revision, normalized.expected_revision);
  const task = state.tasks.find((candidate) => candidate.id === normalized.id);
  if (!task) throw error(`Task "${normalized.id}" was not found.`, 'PLAN_TASK_NOT_FOUND', 404);
  if (isTerminalStatus(task.status) && task.status !== normalized.status) {
    throw error(`Task "${task.id}" is ${task.status} and cannot transition to ${normalized.status}.`, 'INVALID_TASK_TRANSITION', 409);
  }
  if (normalized.status === 'in_progress') {
    const active = state.tasks.find((candidate) => candidate.status === 'in_progress' && candidate.id !== task.id);
    if (active) throw error(`Task "${active.id}" is already in progress.`, 'PLAN_TASK_ALREADY_IN_PROGRESS', 409);
  }
  const refs = normalized.evidence_refs_provided
    ? resolveEvidenceRefs(workspace, normalized.evidence_refs)
    : task.evidence_refs;
  const outcome = ['pending', 'in_progress'].includes(normalized.status)
    ? ''
    : (normalized.outcome_provided ? normalized.outcome : task.outcome);
  if (['completed', 'blocked', 'skipped'].includes(normalized.status) && !outcome) {
    throw error(`An outcome is required when task status is ${normalized.status}.`);
  }
  if (task.status === normalized.status && task.outcome === outcome
    && JSON.stringify(task.evidence_refs) === JSON.stringify(refs)) {
    const warning = repairProjection(workspace, state);
    return mutationResult(wrapStructuredState(state), 'update', false, {
      idempotent: true,
      ...warningExtra(warning),
    });
  }
  const at = clockTimestamp(options);
  const previousStatus = task.status;
  task.status = normalized.status;
  task.outcome = outcome;
  task.evidence_refs = [...refs];
  task.updated_at = at;
  state.revision += 1;
  state.updated_at = at;
  state.changes = appendChange(state, {
    revision: state.revision,
    at,
    kind: 'task_updated',
    task_id: task.id,
    from_status: previousStatus,
    to_status: task.status,
  });
  const view = wrapStructuredState(state);
  const warning = writeStateAndProjection(workspace, state, baseRevision);
  return mutationResult(view, 'update', true, warningExtra(warning));
}

function pivotPlan(workspace, payload, options) {
  const normalized = normalizePivotPayload(payload);
  const state = requireStructuredState(workspace);
  const baseRevision = state.revision;
  assertRevision(state.revision, normalized.expected_revision);
  if (state.pivots.length >= PLAN_LIMITS.pivots) {
    throw error(`A plan can contain at most ${PLAN_LIMITS.pivots} pivots.`, 'PLAN_PIVOT_LIMIT', 413);
  }
  if (state.tasks.length + normalized.add.length > PLAN_LIMITS.tasks) {
    throw error(`A plan can contain at most ${PLAN_LIMITS.tasks} tasks.`, 'PLAN_TASK_LIMIT', 413);
  }
  const byId = new Map(state.tasks.map((task) => [task.id, task]));
  for (const id of normalized.supersede) {
    const task = byId.get(id);
    if (!task) throw error(`Task "${id}" was not found.`, 'PLAN_TASK_NOT_FOUND', 404);
    if (isTerminalStatus(task.status)) {
      throw error(`Task "${id}" is already ${task.status} and cannot be superseded.`, 'INVALID_TASK_TRANSITION', 409);
    }
  }
  for (const task of normalized.add) {
    if (byId.has(task.id)) throw error(`Task id "${task.id}" already exists.`, 'DUPLICATE_TASK_ID', 409);
    byId.set(task.id, task);
  }
  const refs = resolveEvidenceRefs(workspace, normalized.evidence_refs);
  const at = clockTimestamp(options);
  const revision = state.revision + 1;
  const pivotId = `pivot-${state.pivots.length + 1}`;
  const fromPlanType = state.plan_type;
  for (const id of normalized.supersede) {
    const task = state.tasks.find((candidate) => candidate.id === id);
    task.status = 'superseded';
    task.outcome = `Superseded by ${pivotId}: ${normalized.decision}`;
    task.updated_at = at;
  }
  state.tasks.push(...normalized.add.map((task) => newTask(task, at)));
  if (normalized.revised_objective !== undefined) state.objective = normalized.revised_objective;
  if (normalized.revised_hypothesis !== undefined) state.hypothesis = normalized.revised_hypothesis;
  if (normalized.revised_strategy !== undefined) state.strategy = normalized.revised_strategy;
  if (normalized.revised_scope !== undefined) state.scope = normalized.revised_scope;
  if (normalized.revised_completion_criteria !== undefined) {
    state.completion_criteria = normalized.revised_completion_criteria;
  }
  if (normalized.plan_type !== undefined) state.plan_type = normalized.plan_type;
  const pivot = {
    id: pivotId,
    revision,
    at,
    trigger: normalized.trigger,
    decision: normalized.decision,
    revised_objective: normalized.revised_objective || '',
    revised_hypothesis: normalized.revised_hypothesis || '',
    revised_strategy: normalized.revised_strategy || '',
    revised_scope: normalized.revised_scope || '',
    revised_completion_criteria: normalized.revised_completion_criteria || '',
    from_plan_type: fromPlanType,
    to_plan_type: state.plan_type,
    superseded: [...normalized.supersede],
    added: normalized.add.map((task) => task.id),
    evidence_refs: refs,
  };
  state.pivots.push(pivot);
  state.revision = revision;
  state.updated_at = at;
  state.changes = appendChange(state, {
    revision,
    at,
    kind: 'pivot',
    pivot_id: pivotId,
  });
  const view = wrapStructuredState(state);
  const warning = writeStateAndProjection(workspace, state, baseRevision);
  return mutationResult(view, 'pivot', true, warningExtra(warning));
}

export function executePlanOperation(workspace, operation, payload = {}, options = {}) {
  if (typeof workspace !== 'string' || !workspace) throw error('A workspace path is required.');
  if (typeof operation !== 'string') throw error('A plan operation is required.');
  let requestBytes = 0;
  try { requestBytes = Buffer.byteLength(JSON.stringify(payload)); } catch { throw error('Plan payload must be JSON-serializable.'); }
  if (requestBytes > PLAN_LIMITS.requestBytes) throw error('Plan payload is too large.', 'PLAN_REQUEST_TOO_LARGE', 413);
  if (operation === 'status') {
    assertPlainObject(payload, 'status payload');
    assertKnownKeys(payload, new Set(), 'status payload');
    return mutationResult(readPlanView(workspace, options), 'status', false);
  }
  if (['init', 'add', 'update', 'pivot'].includes(operation)) {
    return withInvestigationPlanLock(workspace, () => {
      if (operation === 'init') return initPlan(workspace, payload, options);
      if (operation === 'add') return addTasks(workspace, payload, options);
      if (operation === 'update') return updateTask(workspace, payload, options);
      return pivotPlan(workspace, payload, options);
    }, options);
  }
  throw error('Unknown investigation plan operation. Use init, add, update, pivot, or status.', 'UNKNOWN_PLAN_OPERATION');
}

export const __test = {
  isUntouchedPlaceholder,
  placeholderMarkdown,
  readState,
  wrapStructuredState,
};
