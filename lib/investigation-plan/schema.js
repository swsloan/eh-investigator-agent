import crypto from 'node:crypto';
import {
  ALL_TASK_STATUSES,
  INVESTIGATION_PLAN_SCHEMA_VERSION,
  MUTABLE_TASK_STATUSES,
  PLAN_LIMITS,
  PLAN_TYPE_LABELS,
  PLAN_TYPES,
  TASK_ID_RE,
} from './constants.js';

const PLAN_TYPE_SET = new Set(PLAN_TYPES);
const ALL_STATUS_SET = new Set(ALL_TASK_STATUSES);
const MUTABLE_STATUS_SET = new Set(MUTABLE_TASK_STATUSES);
const TERMINAL_STATUSES = new Set(['completed', 'skipped', 'superseded']);

export class InvestigationPlanError extends Error {
  constructor(message, { code = 'INVALID_INVESTIGATION_PLAN', statusCode = 400 } = {}) {
    super(message);
    this.name = 'InvestigationPlanError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function fail(message, options) {
  throw new InvestigationPlanError(message, options);
}

export function assertPlainObject(value, label = 'Value') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${label} must be a JSON object.`);
  }
  return value;
}

export function assertKnownKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(`${label} contains unsupported field "${key}".`);
  }
}

export function boundedString(value, label, max, { required = true } = {}) {
  if (value === undefined || value === null) {
    if (!required) return '';
    fail(`${label} is required.`);
  }
  if (typeof value !== 'string') fail(`${label} must be a string.`);
  const normalized = value.replace(/\r\n?/g, '\n').trim();
  if (required && !normalized) fail(`${label} is required.`);
  if (normalized.length > max) fail(`${label} must be ${max} characters or fewer.`);
  return normalized;
}

export function optionalRevision(value) {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || value < 0) {
    fail('expected_revision must be a non-negative integer.');
  }
  return value;
}

export function normalizePlanType(value, label = 'plan_type') {
  if (typeof value !== 'string' || !PLAN_TYPE_SET.has(value)) {
    fail(`${label} must be one of: ${PLAN_TYPES.join(', ')}.`);
  }
  return value;
}

export function normalizeTaskStatus(value) {
  if (typeof value !== 'string' || !MUTABLE_STATUS_SET.has(value)) {
    fail(`status must be one of: ${MUTABLE_TASK_STATUSES.join(', ')}.`);
  }
  return value;
}

function normalizeEvidence(value, label) {
  if (value === undefined || value === null || value === '') return [];
  const items = typeof value === 'string' ? [value] : value;
  if (!Array.isArray(items)) fail(`${label} must be a string or an array of strings.`);
  if (items.length > PLAN_LIMITS.taskEvidenceItems) {
    fail(`${label} can contain at most ${PLAN_LIMITS.taskEvidenceItems} items.`);
  }
  const normalized = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = boundedString(
      items[index],
      `${label}[${index}]`,
      PLAN_LIMITS.taskEvidenceItem,
    );
    if (!normalized.includes(item)) normalized.push(item);
  }
  return normalized;
}

export function normalizeTaskInput(value, label = 'task') {
  assertPlainObject(value, label);
  assertKnownKeys(value, new Set(['id', 'title', 'why', 'evidence']), label);
  const id = boundedString(value.id, `${label}.id`, PLAN_LIMITS.taskId);
  if (!TASK_ID_RE.test(id)) {
    fail(`${label}.id must be a lowercase slug using letters, numbers, and single hyphens.`);
  }
  return {
    id,
    title: boundedString(value.title, `${label}.title`, PLAN_LIMITS.taskTitle),
    why: boundedString(value.why, `${label}.why`, PLAN_LIMITS.taskWhy, { required: false }),
    evidence: normalizeEvidence(value.evidence, `${label}.evidence`),
  };
}

export function normalizeTaskInputs(value, label = 'tasks', {
  minimum = 1,
  maximum = PLAN_LIMITS.tasksPerMutation,
} = {}) {
  if (!Array.isArray(value)) fail(`${label} must be an array.`);
  if (value.length < minimum) fail(`${label} must contain at least ${minimum} task${minimum === 1 ? '' : 's'}.`);
  if (value.length > maximum) fail(`${label} can contain at most ${maximum} tasks.`);
  const tasks = value.map((task, index) => normalizeTaskInput(task, `${label}[${index}]`));
  const ids = new Set();
  for (const task of tasks) {
    if (ids.has(task.id)) fail(`${label} contains duplicate task id "${task.id}".`);
    ids.add(task.id);
  }
  return tasks;
}

export function normalizeEvidenceRefInput(value, label = 'evidence_refs') {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) fail(`${label} must be an array of workspace-relative file paths.`);
  if (value.length > PLAN_LIMITS.evidenceRefs) {
    fail(`${label} can contain at most ${PLAN_LIMITS.evidenceRefs} paths.`);
  }
  const result = [];
  for (let index = 0; index < value.length; index += 1) {
    const item = boundedString(value[index], `${label}[${index}]`, PLAN_LIMITS.evidenceRef);
    if (!result.includes(item)) result.push(item);
  }
  return result;
}

export function normalizeInitPayload(payload) {
  assertPlainObject(payload, 'init payload');
  assertKnownKeys(payload, new Set([
    'plan_type',
    'title',
    'objective',
    'scope',
    'hypothesis',
    'strategy',
    'completion_criteria',
    'tasks',
    'expected_revision',
  ]), 'init payload');
  return {
    plan_type: normalizePlanType(payload.plan_type),
    title: boundedString(payload.title, 'title', PLAN_LIMITS.title),
    objective: boundedString(payload.objective, 'objective', PLAN_LIMITS.objective),
    scope: boundedString(payload.scope, 'scope', PLAN_LIMITS.scope),
    hypothesis: boundedString(payload.hypothesis, 'hypothesis', PLAN_LIMITS.hypothesis),
    strategy: boundedString(payload.strategy, 'strategy', PLAN_LIMITS.strategy),
    completion_criteria: boundedString(
      payload.completion_criteria,
      'completion_criteria',
      PLAN_LIMITS.completionCriteria,
    ),
    tasks: normalizeTaskInputs(payload.tasks, 'tasks', { maximum: PLAN_LIMITS.tasks }),
    expected_revision: optionalRevision(payload.expected_revision),
  };
}

export function normalizeAddPayload(payload) {
  assertPlainObject(payload, 'add payload');
  assertKnownKeys(payload, new Set(['reason', 'tasks', 'expected_revision']), 'add payload');
  return {
    reason: boundedString(payload.reason, 'reason', PLAN_LIMITS.reason),
    tasks: normalizeTaskInputs(payload.tasks),
    expected_revision: optionalRevision(payload.expected_revision),
  };
}

export function normalizeUpdatePayload(payload) {
  assertPlainObject(payload, 'update payload');
  assertKnownKeys(payload, new Set([
    'id',
    'status',
    'outcome',
    'evidence_refs',
    'expected_revision',
  ]), 'update payload');
  const status = normalizeTaskStatus(payload.status);
  const outcomeRequired = ['completed', 'blocked', 'skipped'].includes(status);
  const outcomeProvided = Object.hasOwn(payload, 'outcome');
  const evidenceRefsProvided = Object.hasOwn(payload, 'evidence_refs');
  return {
    id: boundedString(payload.id, 'id', PLAN_LIMITS.taskId),
    status,
    outcome: boundedString(payload.outcome, 'outcome', PLAN_LIMITS.outcome, {
      required: outcomeRequired,
    }),
    outcome_provided: outcomeProvided,
    evidence_refs: evidenceRefsProvided ? normalizeEvidenceRefInput(payload.evidence_refs) : undefined,
    evidence_refs_provided: evidenceRefsProvided,
    expected_revision: optionalRevision(payload.expected_revision),
  };
}

function normalizeIdList(value, label) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) fail(`${label} must be an array of task ids.`);
  if (value.length > PLAN_LIMITS.tasksPerMutation) {
    fail(`${label} can contain at most ${PLAN_LIMITS.tasksPerMutation} task ids.`);
  }
  const result = [];
  for (let index = 0; index < value.length; index += 1) {
    const id = boundedString(value[index], `${label}[${index}]`, PLAN_LIMITS.taskId);
    if (!TASK_ID_RE.test(id)) fail(`${label}[${index}] is not a valid task id.`);
    if (result.includes(id)) fail(`${label} contains duplicate task id "${id}".`);
    result.push(id);
  }
  return result;
}

export function normalizePivotPayload(payload) {
  assertPlainObject(payload, 'pivot payload');
  assertKnownKeys(payload, new Set([
    'trigger',
    'decision',
    'revised_objective',
    'revised_hypothesis',
    'revised_strategy',
    'revised_scope',
    'revised_completion_criteria',
    'plan_type',
    'supersede',
    'add',
    'evidence_refs',
    'expected_revision',
  ]), 'pivot payload');
  return {
    trigger: boundedString(payload.trigger, 'trigger', PLAN_LIMITS.trigger),
    decision: boundedString(payload.decision, 'decision', PLAN_LIMITS.decision),
    revised_objective: payload.revised_objective === undefined
      ? undefined
      : boundedString(payload.revised_objective, 'revised_objective', PLAN_LIMITS.objective),
    revised_hypothesis: payload.revised_hypothesis === undefined
      ? undefined
      : boundedString(payload.revised_hypothesis, 'revised_hypothesis', PLAN_LIMITS.hypothesis),
    revised_strategy: payload.revised_strategy === undefined
      ? undefined
      : boundedString(payload.revised_strategy, 'revised_strategy', PLAN_LIMITS.strategy),
    revised_scope: payload.revised_scope === undefined
      ? undefined
      : boundedString(payload.revised_scope, 'revised_scope', PLAN_LIMITS.scope),
    revised_completion_criteria: payload.revised_completion_criteria === undefined
      ? undefined
      : boundedString(
        payload.revised_completion_criteria,
        'revised_completion_criteria',
        PLAN_LIMITS.completionCriteria,
      ),
    plan_type: payload.plan_type === undefined ? undefined : normalizePlanType(payload.plan_type),
    supersede: normalizeIdList(payload.supersede, 'supersede'),
    add: payload.add === undefined
      ? []
      : normalizeTaskInputs(payload.add, 'add', { minimum: 0 }),
    evidence_refs: normalizeEvidenceRefInput(payload.evidence_refs),
    expected_revision: optionalRevision(payload.expected_revision),
  };
}

export function initFingerprint(normalized) {
  const value = {
    plan_type: normalized.plan_type,
    title: normalized.title,
    objective: normalized.objective,
    scope: normalized.scope,
    hypothesis: normalized.hypothesis,
    strategy: normalized.strategy,
    completion_criteria: normalized.completion_criteria,
    tasks: normalized.tasks,
  };
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function assertRevision(actual, expected) {
  if (expected === undefined) return;
  if (actual !== expected) {
    fail(`Plan revision conflict: expected ${expected}, current revision is ${actual}.`, {
      code: 'PLAN_REVISION_CONFLICT',
      statusCode: 409,
    });
  }
}

function validateStoredTask(task, index) {
  validateStoredObject(task, `Stored task ${index + 1}`, new Set([
    'id',
    'title',
    'why',
    'evidence',
    'status',
    'outcome',
    'evidence_refs',
    'created_at',
    'updated_at',
  ]));
  if (typeof task.id !== 'string' || !TASK_ID_RE.test(task.id) || task.id.length > PLAN_LIMITS.taskId) {
    fail(`Stored task ${index + 1} has an invalid id.`, { code: 'INVALID_PLAN_STATE' });
  }
  validateStoredString(task.title, `Stored task ${task.id} title`, PLAN_LIMITS.taskTitle);
  validateStoredString(task.why, `Stored task ${task.id} why`, PLAN_LIMITS.taskWhy, { required: false });
  if (!Array.isArray(task.evidence) || task.evidence.length > PLAN_LIMITS.taskEvidenceItems) {
    fail(`Stored task ${task.id} has invalid evidence guidance.`, { code: 'INVALID_PLAN_STATE' });
  }
  validateStoredStringArray(
    task.evidence,
    `Stored task ${task.id} evidence`,
    PLAN_LIMITS.taskEvidenceItem,
  );
  if (!ALL_STATUS_SET.has(task.status)) {
    fail(`Stored task ${task.id} has invalid status "${task.status}".`, { code: 'INVALID_PLAN_STATE' });
  }
  validateStoredString(task.outcome, `Stored task ${task.id} outcome`, PLAN_LIMITS.outcome, { required: false });
  if (['completed', 'blocked', 'skipped', 'superseded'].includes(task.status) && !task.outcome.trim()) {
    fail(`Stored task ${task.id} requires an outcome for status ${task.status}.`, { code: 'INVALID_PLAN_STATE' });
  }
  if (['pending', 'in_progress'].includes(task.status) && task.outcome) {
    fail(`Stored task ${task.id} cannot retain an outcome while ${task.status}.`, { code: 'INVALID_PLAN_STATE' });
  }
  if (!Array.isArray(task.evidence_refs) || task.evidence_refs.length > PLAN_LIMITS.evidenceRefs) {
    fail(`Stored task ${task.id} has invalid evidence references.`, { code: 'INVALID_PLAN_STATE' });
  }
  validateStoredStringArray(
    task.evidence_refs,
    `Stored task ${task.id} evidence_refs`,
    PLAN_LIMITS.evidenceRef,
  );
  validateStoredTimestamp(task.created_at, `Stored task ${task.id} created_at`);
  validateStoredTimestamp(task.updated_at, `Stored task ${task.id} updated_at`);
}

function invalidStoredState(message) {
  fail(message, { code: 'INVALID_PLAN_STATE' });
}

function validateStoredObject(value, label, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalidStoredState(`${label} must be a JSON object.`);
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) invalidStoredState(`${label} contains unsupported field "${key}".`);
  }
}

function validateStoredString(value, label, max, { required = true } = {}) {
  if (typeof value !== 'string') invalidStoredState(`${label} must be a string.`);
  if (required && !value.trim()) invalidStoredState(`${label} is required.`);
  if (value.length > max) invalidStoredState(`${label} exceeds its ${max}-character limit.`);
  return value;
}

function validateStoredStringArray(items, label, max, { maximum = items?.length } = {}) {
  if (!Array.isArray(items) || items.length > maximum) {
    invalidStoredState(`${label} is not a valid bounded string array.`);
  }
  const seen = new Set();
  items.forEach((item, index) => {
    validateStoredString(item, `${label}[${index}]`, max);
    if (seen.has(item)) invalidStoredState(`${label} contains duplicate value "${item}".`);
    seen.add(item);
  });
}

function validateStoredTimestamp(value, label) {
  validateStoredString(value, label, 40);
  let canonical = '';
  try { canonical = new Date(value).toISOString(); } catch { /* handled below */ }
  if (canonical !== value) invalidStoredState(`${label} must be a canonical ISO-8601 UTC timestamp.`);
}

function validateStoredRevision(value, label, stateRevision, { minimum = 1 } = {}) {
  if (!Number.isSafeInteger(value) || value < minimum || value > stateRevision) {
    invalidStoredState(`${label} must be an integer from ${minimum} through ${stateRevision}.`);
  }
}

function validateStoredTaskIds(value, label, taskIds, {
  minimum = 0,
  // Per-mutation lists (added, superseded, tasks_added) are capped at
  // tasksPerMutation. Initialization is not a mutation: it may name up to a
  // full plan's worth of tasks, so its caller raises this bound.
  maximum = PLAN_LIMITS.tasksPerMutation,
} = {}) {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    invalidStoredState(`${label} has an invalid task-id list.`);
  }
  const seen = new Set();
  value.forEach((id, index) => {
    if (typeof id !== 'string' || id.length > PLAN_LIMITS.taskId || !TASK_ID_RE.test(id)) {
      invalidStoredState(`${label}[${index}] is not a valid task id.`);
    }
    if (!taskIds.has(id)) invalidStoredState(`${label}[${index}] references unknown task "${id}".`);
    if (seen.has(id)) invalidStoredState(`${label} repeats task id "${id}".`);
    seen.add(id);
  });
}

function validateStoredPivot(pivot, index, stateRevision, taskIds) {
  const label = `Stored pivot ${index + 1}`;
  validateStoredObject(pivot, label, new Set([
    'id',
    'revision',
    'at',
    'trigger',
    'decision',
    'revised_objective',
    'revised_hypothesis',
    'revised_strategy',
    'revised_scope',
    'revised_completion_criteria',
    'from_plan_type',
    'to_plan_type',
    'superseded',
    'added',
    'evidence_refs',
  ]));
  if (pivot.id !== `pivot-${index + 1}`) invalidStoredState(`${label} has an invalid id.`);
  validateStoredRevision(pivot.revision, `${label} revision`, stateRevision, { minimum: 2 });
  validateStoredTimestamp(pivot.at, `${label} at`);
  validateStoredString(pivot.trigger, `${label} trigger`, PLAN_LIMITS.trigger);
  validateStoredString(pivot.decision, `${label} decision`, PLAN_LIMITS.decision);
  // Every revised_* field is persisted as a string (empty when unrevised), so
  // all of them are validated the same way. Upstream guarded this one field on
  // presence, which let a tampered pivot drop it without detection.
  validateStoredString(
    pivot.revised_objective,
    `${label} revised_objective`,
    PLAN_LIMITS.objective,
    { required: false },
  );
  validateStoredString(
    pivot.revised_hypothesis,
    `${label} revised_hypothesis`,
    PLAN_LIMITS.hypothesis,
    { required: false },
  );
  validateStoredString(
    pivot.revised_strategy,
    `${label} revised_strategy`,
    PLAN_LIMITS.strategy,
    { required: false },
  );
  validateStoredString(
    pivot.revised_scope,
    `${label} revised_scope`,
    PLAN_LIMITS.scope,
    { required: false },
  );
  validateStoredString(
    pivot.revised_completion_criteria,
    `${label} revised_completion_criteria`,
    PLAN_LIMITS.completionCriteria,
    { required: false },
  );
  if (!PLAN_TYPE_SET.has(pivot.from_plan_type) || !PLAN_TYPE_SET.has(pivot.to_plan_type)) {
    invalidStoredState(`${label} has an invalid plan type transition.`);
  }
  validateStoredTaskIds(pivot.superseded, `${label} superseded`, taskIds);
  validateStoredTaskIds(pivot.added, `${label} added`, taskIds);
  if (!Array.isArray(pivot.evidence_refs) || pivot.evidence_refs.length > PLAN_LIMITS.evidenceRefs) {
    invalidStoredState(`${label} has invalid evidence references.`);
  }
  validateStoredStringArray(pivot.evidence_refs, `${label} evidence_refs`, PLAN_LIMITS.evidenceRef);
}

function validateStoredChange(change, index, stateRevision, taskIds, pivotsById, seenPivotChanges) {
  const label = `Stored plan change ${index + 1}`;
  const baseKeys = ['revision', 'at', 'kind'];
  const keysByKind = {
    initialized: [...baseKeys, 'task_ids'],
    tasks_added: [...baseKeys, 'reason', 'task_ids'],
    task_updated: [...baseKeys, 'task_id', 'from_status', 'to_status'],
    pivot: [...baseKeys, 'pivot_id'],
  };
  if (!change || typeof change !== 'object' || Array.isArray(change)) {
    invalidStoredState(`${label} must be a JSON object.`);
  }
  const allowed = keysByKind[change.kind];
  if (!allowed) invalidStoredState(`${label} has invalid kind "${change.kind}".`);
  validateStoredObject(change, label, new Set(allowed));
  validateStoredRevision(change.revision, `${label} revision`, stateRevision);
  validateStoredTimestamp(change.at, `${label} at`);
  if (change.kind === 'initialized') {
    if (change.revision !== 1) invalidStoredState('The initialized change must have revision 1.');
    validateStoredTaskIds(change.task_ids, `${label} task_ids`, taskIds, {
      minimum: 1,
      maximum: PLAN_LIMITS.tasks,
    });
  } else if (change.kind === 'tasks_added') {
    validateStoredString(change.reason, `${label} reason`, PLAN_LIMITS.reason);
    validateStoredTaskIds(change.task_ids, `${label} task_ids`, taskIds, { minimum: 1 });
  } else if (change.kind === 'task_updated') {
    if (typeof change.task_id !== 'string' || !taskIds.has(change.task_id)) {
      invalidStoredState(`${label} references an unknown task.`);
    }
    if (!ALL_STATUS_SET.has(change.from_status) || !MUTABLE_STATUS_SET.has(change.to_status)) {
      invalidStoredState(`${label} has an invalid status transition.`);
    }
  } else {
    const pivot = typeof change.pivot_id === 'string' ? pivotsById.get(change.pivot_id) : null;
    if (!pivot) invalidStoredState(`${label} references an unknown pivot.`);
    if (seenPivotChanges.has(change.pivot_id)) {
      invalidStoredState(`${label} repeats pivot change "${change.pivot_id}".`);
    }
    if (change.revision !== pivot.revision || change.at !== pivot.at) {
      invalidStoredState(`${label} does not match the pivot revision and timestamp.`);
    }
    seenPivotChanges.add(change.pivot_id);
  }
}

export function validateStoredState(state) {
  validateStoredObject(state, 'Stored investigation plan', new Set([
    'schema_version',
    'revision',
    'initial_fingerprint',
    'plan_type',
    'title',
    'objective',
    'scope',
    'hypothesis',
    'strategy',
    'completion_criteria',
    'tasks',
    'pivots',
    'changes',
    'created_at',
    'updated_at',
  ]));
  if (state.schema_version !== INVESTIGATION_PLAN_SCHEMA_VERSION) {
    fail(`Unsupported investigation plan schema version "${state.schema_version}".`, {
      code: 'UNSUPPORTED_PLAN_SCHEMA',
    });
  }
  if (!Number.isSafeInteger(state.revision) || state.revision < 1) {
    fail('Stored investigation plan has an invalid revision.', { code: 'INVALID_PLAN_STATE' });
  }
  if (!PLAN_TYPE_SET.has(state.plan_type)) invalidStoredState('Stored plan_type is invalid.');
  validateStoredString(state.title, 'Stored title', PLAN_LIMITS.title);
  validateStoredString(state.objective, 'Stored objective', PLAN_LIMITS.objective);
  validateStoredString(state.scope, 'Stored scope', PLAN_LIMITS.scope);
  validateStoredString(state.hypothesis, 'Stored hypothesis', PLAN_LIMITS.hypothesis);
  validateStoredString(state.strategy, 'Stored strategy', PLAN_LIMITS.strategy);
  validateStoredString(state.completion_criteria, 'Stored completion_criteria', PLAN_LIMITS.completionCriteria);
  validateStoredTimestamp(state.created_at, 'Stored created_at');
  validateStoredTimestamp(state.updated_at, 'Stored updated_at');
  if (!Array.isArray(state.tasks) || !state.tasks.length || state.tasks.length > PLAN_LIMITS.tasks) {
    fail('Stored investigation plan has an invalid task list.', { code: 'INVALID_PLAN_STATE' });
  }
  const ids = new Set();
  let inProgress = 0;
  state.tasks.forEach((task, index) => {
    validateStoredTask(task, index);
    if (ids.has(task.id)) fail(`Stored investigation plan repeats task id "${task.id}".`, { code: 'INVALID_PLAN_STATE' });
    ids.add(task.id);
    if (task.status === 'in_progress') inProgress += 1;
  });
  if (inProgress > 1) {
    fail('Stored investigation plan has more than one in-progress task.', { code: 'INVALID_PLAN_STATE' });
  }
  if (!Array.isArray(state.pivots) || state.pivots.length > PLAN_LIMITS.pivots) {
    fail('Stored investigation plan has an invalid pivot history.', { code: 'INVALID_PLAN_STATE' });
  }
  let previousPivotRevision = 1;
  const supersededByPivot = new Set();
  const addedByPivot = new Set();
  state.pivots.forEach((pivot, index) => {
    validateStoredPivot(pivot, index, state.revision, ids);
    if (pivot.revision <= previousPivotRevision) invalidStoredState('Stored pivot revisions must increase.');
    if (index > 0 && state.pivots[index - 1].to_plan_type !== pivot.from_plan_type) {
      invalidStoredState('Stored pivot plan type transitions must form a continuous history.');
    }
    for (const id of pivot.superseded) {
      if (supersededByPivot.has(id)) invalidStoredState(`Task "${id}" is superseded by more than one pivot.`);
      if (state.tasks.find((task) => task.id === id)?.status !== 'superseded') {
        invalidStoredState(`Pivot ${pivot.id} names task "${id}" as superseded but its status disagrees.`);
      }
      supersededByPivot.add(id);
    }
    for (const id of pivot.added) {
      if (addedByPivot.has(id)) invalidStoredState(`Task "${id}" is added by more than one pivot.`);
      addedByPivot.add(id);
    }
    previousPivotRevision = pivot.revision;
  });
  if (state.pivots.length && state.pivots.at(-1).to_plan_type !== state.plan_type) {
    invalidStoredState('Stored plan_type does not match the latest pivot.');
  }
  for (const task of state.tasks) {
    if (task.status === 'superseded' && !supersededByPivot.has(task.id)) {
      invalidStoredState(`Superseded task "${task.id}" is not associated with a pivot.`);
    }
  }
  if (!Array.isArray(state.changes) || !state.changes.length || state.changes.length > PLAN_LIMITS.changes) {
    fail('Stored investigation plan has an invalid change history.', { code: 'INVALID_PLAN_STATE' });
  }
  const pivotsById = new Map(state.pivots.map((pivot) => [pivot.id, pivot]));
  const seenPivotChanges = new Set();
  let previousChangeRevision = 0;
  state.changes.forEach((change, index) => {
    validateStoredChange(change, index, state.revision, ids, pivotsById, seenPivotChanges);
    if (change.revision <= previousChangeRevision) invalidStoredState('Stored plan change revisions must increase.');
    previousChangeRevision = change.revision;
  });
  if (state.changes[0].kind !== 'initialized' || state.changes.at(-1).revision !== state.revision) {
    invalidStoredState('Stored plan change history does not match the plan revision.');
  }
  const retainedChangeRevisions = new Set(state.changes.map((change) => change.revision));
  for (const pivot of state.pivots) {
    if (retainedChangeRevisions.has(pivot.revision) && !seenPivotChanges.has(pivot.id)) {
      invalidStoredState(`Retained change history is missing ${pivot.id}.`);
    }
  }
  if (typeof state.initial_fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(state.initial_fingerprint)) {
    fail('Stored investigation plan has an invalid initialization fingerprint.', { code: 'INVALID_PLAN_STATE' });
  }
  return state;
}

export function planProgress(tasks = [], { structured = true } = {}) {
  const counts = Object.fromEntries(ALL_TASK_STATUSES.map((status) => [status, 0]));
  for (const task of tasks) {
    if (Object.hasOwn(counts, task.status)) counts[task.status] += 1;
  }
  const total = tasks.length;
  const resolved = counts.completed + counts.skipped + counts.superseded;
  const open = counts.pending + counts.in_progress + counts.blocked;
  let state = 'awaiting';
  if (structured && total) {
    if (resolved === total) state = 'complete';
    else if (counts.blocked > 0 && counts.pending === 0 && counts.in_progress === 0) state = 'blocked';
    else state = 'active';
  } else if (total) {
    state = resolved === total ? 'complete' : 'active';
  }
  return {
    state,
    total,
    resolved,
    open,
    percent: total ? Math.round((resolved / total) * 100) : 0,
    ...counts,
  };
}

export function publicPlanView(state) {
  validateStoredState(state);
  const tasks = state.tasks.map((task) => ({
    id: task.id,
    title: task.title,
    why: task.why || '',
    evidence: [...task.evidence],
    status: task.status,
    outcome: task.outcome || '',
    evidence_refs: [...task.evidence_refs],
    created_at: task.created_at,
    updated_at: task.updated_at,
  }));
  const progress = planProgress(tasks);
  return {
    structured: true,
    legacy: false,
    mode: 'structured',
    schema_version: state.schema_version,
    revision: state.revision,
    plan_type: state.plan_type,
    plan_type_label: PLAN_TYPE_LABELS[state.plan_type],
    title: state.title,
    objective: state.objective,
    scope: state.scope,
    hypothesis: state.hypothesis,
    strategy: state.strategy,
    completion_criteria: state.completion_criteria,
    tasks,
    pivots: state.pivots.map((pivot) => ({
      ...pivot,
      superseded: [...pivot.superseded],
      added: [...pivot.added],
      evidence_refs: [...pivot.evidence_refs],
    })),
    changes: state.changes.map((change) => ({ ...change })),
    created_at: state.created_at,
    updated_at: state.updated_at,
    state: progress.state,
    progress,
    current_task: tasks.find((task) => task.status === 'in_progress')
      || tasks.find((task) => task.status === 'pending')
      || tasks.find((task) => task.status === 'blocked')
      || null,
  };
}

export function isTerminalStatus(status) {
  return TERMINAL_STATUSES.has(status);
}
