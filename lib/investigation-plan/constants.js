import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');

export const INVESTIGATION_PLAN_FILENAME = 'investigation-plan.md';
export const INVESTIGATION_PLAN_STATE_FILENAME = '.investigation-plan.json';
export const INVESTIGATION_PLAN_SCHEMA_VERSION = 1;
export const INVESTIGATION_PLAN_TEMPLATE = path.join(
  ROOT,
  'skills',
  'investigation-planning',
  'assets',
  INVESTIGATION_PLAN_FILENAME,
);

export const PLAN_TYPES = Object.freeze([
  'threat_hunt',
  'security_investigation',
  'performance_investigation',
]);

export const PLAN_TYPE_LABELS = Object.freeze({
  threat_hunt: 'Threat hunt',
  security_investigation: 'Security investigation',
  performance_investigation: 'Performance investigation',
});

export const MUTABLE_TASK_STATUSES = Object.freeze([
  'pending',
  'in_progress',
  'completed',
  'blocked',
  'skipped',
]);

export const ALL_TASK_STATUSES = Object.freeze([
  ...MUTABLE_TASK_STATUSES,
  'superseded',
]);

export const PLAN_LIMITS = Object.freeze({
  requestBytes: 64 * 1024,
  stateBytes: 512 * 1024,
  legacyMarkdownBytes: 512 * 1024,
  tasks: 64,
  tasksPerMutation: 24,
  pivots: 64,
  changes: 256,
  title: 180,
  objective: 4_000,
  scope: 4_000,
  hypothesis: 4_000,
  strategy: 6_000,
  completionCriteria: 4_000,
  taskId: 64,
  taskTitle: 500,
  taskWhy: 2_000,
  taskEvidenceItems: 12,
  taskEvidenceItem: 160,
  reason: 2_000,
  outcome: 4_000,
  trigger: 4_000,
  decision: 4_000,
  evidenceRefs: 24,
  evidenceRef: 500,
});

export const TASK_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

