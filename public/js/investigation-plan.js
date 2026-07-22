export const INVESTIGATION_PLAN_FILENAME = 'investigation-plan.md';

export function isInvestigationPlanFile(file) {
  return file?.kind === 'plan'
    || String(file?.path || '').toLowerCase() === INVESTIGATION_PLAN_FILENAME;
}
