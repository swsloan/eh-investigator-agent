import {
  INVESTIGATION_PLAN_FILENAME,
  INVESTIGATION_PLAN_SCHEMA_VERSION,
  INVESTIGATION_PLAN_STATE_FILENAME,
  INVESTIGATION_PLAN_TEMPLATE,
  PLAN_LIMITS,
  PLAN_TYPES,
} from './investigation-plan/constants.js';
import { renderInvestigationPlanHtml as renderHtml } from './investigation-plan/render.js';
import {
  executePlanOperation,
  readPlanView,
} from './investigation-plan/store.js';

export {
  INVESTIGATION_PLAN_FILENAME,
  INVESTIGATION_PLAN_SCHEMA_VERSION,
  INVESTIGATION_PLAN_STATE_FILENAME,
  INVESTIGATION_PLAN_TEMPLATE,
  PLAN_LIMITS,
  PLAN_TYPES,
};
export { InvestigationPlanError } from './investigation-plan/schema.js';
export { renderInvestigationPlanMarkdown } from './investigation-plan/render.js';

/** Read a bounded browser-safe plan view, preserving legacy Markdown plans. */
export function readInvestigationPlanView(workspace) {
  return readPlanView(workspace);
}

/** Render a standalone, escaped, type-specific plan document. */
export function renderInvestigationPlanHtml(viewOrState) {
  return renderHtml(viewOrState);
}

/** Apply one validated structured-plan operation and return the updated view. */
export function executeInvestigationPlanOperation(workspace, operation, payload = {}, options = {}) {
  return executePlanOperation(workspace, operation, payload, options);
}
