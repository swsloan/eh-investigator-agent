import assert from 'node:assert/strict';
import { test } from 'node:test';
import { INVESTIGATION_PLAN_FILENAME, isInvestigationPlanFile } from './investigation-plan.js';

test('the plan is recognized by server-assigned kind or by canonical name', () => {
  // The server marks it with kind:'plan'; the filename check is the fallback for
  // entries that predate the kind (restored session state, partial responses).
  assert.equal(isInvestigationPlanFile({ kind: 'plan', path: 'anything.md' }), true);
  assert.equal(isInvestigationPlanFile({ path: INVESTIGATION_PLAN_FILENAME }), true);
  assert.equal(isInvestigationPlanFile({ path: 'Investigation-Plan.MD' }), true, 'case-insensitive');
});

test('ordinary workspace files are not mistaken for the plan', () => {
  for (const file of [
    { path: 'notes.md' },
    { path: 'evidence/records/smb.json' },
    { path: 'scratch/investigation-plan-notes.md' },
    { path: 'plans/investigation-plan.md' }, // nested copy is a user file, not the generated root projection
    {},
    null,
  ]) {
    assert.equal(isInvestigationPlanFile(file), false, JSON.stringify(file));
  }
});
