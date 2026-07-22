import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  INVESTIGATION_PLAN_FILENAME,
  INVESTIGATION_PLAN_STATE_FILENAME,
  INVESTIGATION_PLAN_TEMPLATE,
  PLAN_LIMITS,
  executeInvestigationPlanOperation,
  readInvestigationPlanView,
  renderInvestigationPlanHtml,
  renderInvestigationPlanMarkdown,
} from './investigation-plan.js';

// Every operation serializes on a filesystem lock. Tests use a short timeout so
// a genuine deadlock fails fast instead of hanging the suite.
const FAST_LOCK = { lock: { timeoutMs: 50 } };

function workspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'plan-'));
}

function planPaths(dir) {
  return {
    markdown: path.join(dir, INVESTIGATION_PLAN_FILENAME),
    state: path.join(dir, INVESTIGATION_PLAN_STATE_FILENAME),
  };
}

const INIT = {
  plan_type: 'security_investigation',
  title: 'Lateral movement from 10.1.4.22',
  objective: 'Determine whether the SMB activity from 10.1.4.22 is authorized administration.',
  scope: 'The host 10.1.4.22 and the file servers it contacted in the last 24 hours.',
  hypothesis: 'An operator ran a scripted inventory sweep rather than an attacker enumerating shares.',
  strategy: 'Compare peer counts against the 30-day baseline, then read the SMB records for the burst.',
  completion_criteria: 'Every contacted server is attributed to a known change window or escalated.',
  tasks: [
    { id: 'scope-host', title: 'Scope the source host', why: 'Attribution decides everything downstream.', evidence: ['device metrics', 'records: SMB'] },
    { id: 'read-records', title: 'Read the SMB records for the burst', evidence: ['records: SMB'] },
  ],
};

function init(dir, overrides = {}) {
  return executeInvestigationPlanOperation(dir, 'init', { ...INIT, ...overrides }, FAST_LOCK);
}

function run(dir, operation, payload) {
  return executeInvestigationPlanOperation(dir, operation, payload, FAST_LOCK);
}

function readState(dir) {
  return JSON.parse(fs.readFileSync(planPaths(dir).state, 'utf8'));
}

function assertPlanError(fn, { code, statusCode }, message) {
  assert.throws(fn, (err) => {
    assert.equal(err.name, 'InvestigationPlanError', `${message}: wrong error type (${err.message})`);
    assert.equal(err.code, code, `${message}: wrong code (${err.message})`);
    if (statusCode !== undefined) assert.equal(err.statusCode, statusCode, `${message}: wrong status`);
    return true;
  }, message);
}

test('init writes validated state plus a rendered Markdown projection', () => {
  const dir = workspace();
  const result = init(dir);

  assert.equal(result.ok, true);
  assert.equal(result.initialized, true);
  assert.equal(result.structured, true);
  assert.equal(result.changed, true);
  assert.equal(result.revision, 1);
  assert.equal(result.plan.planType, 'security_investigation');
  assert.equal(result.plan.tasks.length, 2);
  assert.equal(result.progress.state, 'active');
  assert.equal(result.progress.currentTask.id, 'scope-host', 'the first pending task is the current one');

  // State is authoritative; the Markdown file is a deterministic projection of it.
  const state = readState(dir);
  assert.equal(state.revision, 1);
  assert.equal(state.changes[0].kind, 'initialized');
  const markdown = fs.readFileSync(planPaths(dir).markdown, 'utf8');
  assert.equal(markdown, renderInvestigationPlanMarkdown(state), 'projection matches the renderer');
  assert.match(markdown, /^<!-- artifact-kind: investigation-plan -->/, 'the artifact-kind marker leads the file');
});

test('state and projection are written 0600 so plans are not world-readable', () => {
  const dir = workspace();
  init(dir);
  for (const file of Object.values(planPaths(dir))) {
    assert.equal(fs.statSync(file).mode & 0o777, 0o600, `${path.basename(file)} is owner-only`);
  }
});

test('re-running the same init is idempotent rather than a conflict', () => {
  const dir = workspace();
  init(dir);
  const again = init(dir);

  assert.equal(again.changed, false);
  assert.equal(again.idempotent, true, 'a lost response can be safely retried');
  assert.equal(again.revision, 1, 'the retry did not bump the revision');
});

test('init with different content is refused once a plan exists', () => {
  const dir = workspace();
  init(dir);
  assertPlanError(
    () => init(dir, { title: 'A different investigation' }),
    { code: 'PLAN_ALREADY_INITIALIZED', statusCode: 409 },
    'a second distinct init',
  );
  assert.equal(readState(dir).title, INIT.title, 'the stored plan was left alone');
});

test('expected_revision mismatches fail as revision conflicts', () => {
  const dir = workspace();
  init(dir);
  assertPlanError(
    () => run(dir, 'add', { reason: 'Follow the new lead.', tasks: [{ id: 'check-dns', title: 'Check DNS' }], expected_revision: 7 }),
    { code: 'PLAN_REVISION_CONFLICT', statusCode: 409 },
    'a stale expected_revision',
  );
  assert.equal(readState(dir).revision, 1, 'the conflicting mutation did not commit');
});

test('mutating before initialization is refused', () => {
  const dir = workspace();
  assertPlanError(
    () => run(dir, 'update', { id: 'scope-host', status: 'in_progress' }),
    { code: 'PLAN_NOT_INITIALIZED', statusCode: 409 },
    'updating an uninitialized plan',
  );
});

test('unknown operations and oversized payloads are rejected before any write', () => {
  const dir = workspace();
  assertPlanError(() => run(dir, 'delete', {}), { code: 'UNKNOWN_PLAN_OPERATION' }, 'an unsupported operation');
  assertPlanError(
    () => run(dir, 'init', { ...INIT, objective: 'x'.repeat(PLAN_LIMITS.requestBytes + 1) }),
    { code: 'PLAN_REQUEST_TOO_LARGE', statusCode: 413 },
    'a payload past the request limit',
  );
  assert.equal(fs.existsSync(planPaths(dir).state), false, 'nothing was written');
});

test('only one task may be in progress at a time', () => {
  const dir = workspace();
  init(dir);
  run(dir, 'update', { id: 'scope-host', status: 'in_progress' });
  assertPlanError(
    () => run(dir, 'update', { id: 'read-records', status: 'in_progress' }),
    { code: 'PLAN_TASK_ALREADY_IN_PROGRESS', statusCode: 409 },
    'a second in-progress task',
  );
});

test('completing a task requires an outcome, and terminal tasks cannot reopen', () => {
  const dir = workspace();
  init(dir);
  assertPlanError(
    () => run(dir, 'update', { id: 'scope-host', status: 'completed' }),
    { code: 'INVALID_INVESTIGATION_PLAN' },
    'completing without an outcome',
  );

  const done = run(dir, 'update', { id: 'scope-host', status: 'completed', outcome: 'Host is a managed jump box in change window CHG-4412.' });
  assert.equal(done.changed, true);
  assert.equal(done.plan.tasks[0].status, 'completed');

  assertPlanError(
    () => run(dir, 'update', { id: 'scope-host', status: 'in_progress' }),
    { code: 'INVALID_TASK_TRANSITION', statusCode: 409 },
    'reopening a completed task',
  );
});

test('a no-op update reports unchanged instead of burning a revision', () => {
  const dir = workspace();
  init(dir);
  run(dir, 'update', { id: 'scope-host', status: 'in_progress' });
  const repeat = run(dir, 'update', { id: 'scope-host', status: 'in_progress' });
  assert.equal(repeat.changed, false);
  assert.equal(repeat.idempotent, true);
  assert.equal(repeat.revision, 2, 'the revision stayed where the first update left it');
});

test('evidence references must be real, visible, workspace-relative files', () => {
  const dir = workspace();
  init(dir);
  fs.mkdirSync(path.join(dir, 'notes'));
  fs.writeFileSync(path.join(dir, 'notes', 'smb-records.csv'), 'ts,client,server\n');
  fs.writeFileSync(path.join(dir, 'secret.txt'), 'outside evidence');
  fs.symlinkSync(path.join(dir, 'secret.txt'), path.join(dir, 'link.txt'));

  const ok = run(dir, 'update', {
    id: 'scope-host',
    status: 'completed',
    outcome: 'Managed jump box.',
    evidence_refs: ['notes/smb-records.csv'],
  });
  assert.deepEqual(ok.plan.tasks[0].evidenceRefs, ['notes/smb-records.csv']);

  for (const [ref, why] of [
    ['../outside.txt', 'a parent-directory escape'],
    ['/etc/passwd', 'an absolute path'],
    ['link.txt', 'a symbolic link'],
    ['notes/missing.csv', 'a nonexistent file'],
    ['notes', 'a directory'],
    [INVESTIGATION_PLAN_FILENAME, 'the plan citing itself'],
    [INVESTIGATION_PLAN_STATE_FILENAME, 'the plan state citing itself'],
  ]) {
    assertPlanError(
      () => run(dir, 'update', { id: 'read-records', status: 'completed', outcome: 'x', evidence_refs: [ref] }),
      { code: 'INVALID_EVIDENCE_REFERENCE' },
      why,
    );
  }
});

test('a pivot supersedes tasks, records the reclassification, and keeps history', () => {
  const dir = workspace();
  init(dir);
  const pivot = run(dir, 'pivot', {
    trigger: 'The SMB burst matched a backup agent upgrade, not enumeration.',
    decision: 'Reframe as a performance investigation of the backup window.',
    plan_type: 'performance_investigation',
    revised_hypothesis: 'The backup agent saturates the file servers during its upgrade window.',
    supersede: ['read-records'],
    add: [{ id: 'measure-backup', title: 'Measure backup-window throughput', evidence: ['device metrics'] }],
  });

  assert.equal(pivot.changed, true);
  assert.equal(pivot.plan.planType, 'performance_investigation');
  assert.equal(pivot.plan.pivots.length, 1);
  assert.equal(pivot.plan.pivots[0].fromPlanType, 'security_investigation');
  assert.deepEqual(pivot.plan.pivots[0].superseded, ['read-records']);

  const superseded = pivot.plan.tasks.find((task) => task.id === 'read-records');
  assert.equal(superseded.status, 'superseded');
  assert.match(superseded.outcome, /Superseded by pivot-1/, 'the outcome names the pivot that retired it');
  assert.ok(pivot.plan.tasks.some((task) => task.id === 'measure-backup'), 'the replacement task landed');

  // The prior direction stays legible in the projection: history is append-only.
  const markdown = fs.readFileSync(planPaths(dir).markdown, 'utf8');
  assert.match(markdown, /Pivot pivot-1/);
  assert.match(markdown, /Reclassified/);
});

test('superseding an already-terminal task is refused', () => {
  const dir = workspace();
  init(dir);
  run(dir, 'update', { id: 'read-records', status: 'skipped', outcome: 'Records were rolled off.' });
  assertPlanError(
    () => run(dir, 'pivot', { trigger: 'New lead.', decision: 'Change course.', supersede: ['read-records'] }),
    { code: 'INVALID_TASK_TRANSITION', statusCode: 409 },
    'superseding a skipped task',
  );
});

test('a plan may initialize with the full documented task limit', () => {
  // Upstream bounded the `initialized` change entry by tasksPerMutation (24)
  // while init itself accepts PLAN_LIMITS.tasks (64), so any plan starting with
  // 25+ tasks failed its own stored-state validation with an opaque
  // INVALID_PLAN_STATE. Ported with that bound raised for initialization only.
  const tasks = Array.from({ length: PLAN_LIMITS.tasks }, (_, i) => ({ id: `task-${i}`, title: `Task ${i}` }));
  const dir = workspace();
  const result = init(dir, { tasks });

  assert.equal(result.changed, true);
  assert.equal(result.plan.tasks.length, PLAN_LIMITS.tasks);
  assert.equal(readInvestigationPlanView(dir).plan.tasks.length, PLAN_LIMITS.tasks, 'the state re-reads and re-validates');

  assertPlanError(
    () => init(workspace(), { tasks: [...tasks, { id: 'task-over', title: 'One too many' }] }),
    { code: 'INVALID_INVESTIGATION_PLAN' },
    'exceeding the task limit is still refused at the payload boundary',
  );

  // Per-mutation lists keep the tighter bound.
  assertPlanError(
    () => run(dir, 'add', {
      reason: 'Too many at once.',
      tasks: Array.from({ length: PLAN_LIMITS.tasksPerMutation + 1 }, (_, i) => ({ id: `extra-${i}`, title: `Extra ${i}` })),
    }),
    { code: 'INVALID_INVESTIGATION_PLAN' },
    'a single add past tasksPerMutation',
  );
});

test('the shipped placeholder is treated as untouched, a real plan is not', () => {
  const template = fs.readFileSync(INVESTIGATION_PLAN_TEMPLATE, 'utf8');
  assert.match(template, /artifact-kind: investigation-plan/, 'the asset this PR ships is the placeholder the store looks for');

  const placeholderDir = workspace();
  fs.writeFileSync(planPaths(placeholderDir).markdown, template);
  const awaiting = readInvestigationPlanView(placeholderDir);
  assert.equal(awaiting.initialized, false, 'an untouched placeholder is not a plan');
  assert.equal(init(placeholderDir).changed, true, 'initialization may overwrite it');

  const legacyDir = workspace();
  fs.writeFileSync(planPaths(legacyDir).markdown, '# Hand-written plan\n\n- [x] Pull the records\n- [ ] Check the baseline\n');
  assertPlanError(() => init(legacyDir), { code: 'LEGACY_PLAN_CONFLICT', statusCode: 409 }, 'init over a hand-written plan');
  assert.match(fs.readFileSync(planPaths(legacyDir).markdown, 'utf8'), /Hand-written plan/, 'the operator file survived');
});

test('a legacy Markdown plan is read without conversion', () => {
  const dir = workspace();
  fs.writeFileSync(planPaths(dir).markdown, '# Manual triage plan\n\n- [x] Pull the records\n- [ ] Check the baseline\n');
  const view = readInvestigationPlanView(dir);

  assert.equal(view.legacy, true);
  assert.equal(view.structured, false);
  assert.equal(view.plan.title, 'Manual triage plan');
  assert.deepEqual(view.plan.tasks.map((task) => task.status), ['completed', 'pending']);
  assert.equal(view.progress.percent, 50);
  assert.equal(fs.existsSync(planPaths(dir).state), false, 'reading a legacy plan writes no state');
});

test('a missing or damaged projection is repaired from state on the next read', () => {
  const dir = workspace();
  init(dir);
  const expected = fs.readFileSync(planPaths(dir).markdown, 'utf8');

  fs.writeFileSync(planPaths(dir).markdown, 'someone pasted notes over the generated file\n');
  readInvestigationPlanView(dir);
  assert.equal(fs.readFileSync(planPaths(dir).markdown, 'utf8'), expected, 'an edited projection is regenerated');

  fs.rmSync(planPaths(dir).markdown);
  readInvestigationPlanView(dir);
  assert.equal(fs.readFileSync(planPaths(dir).markdown, 'utf8'), expected, 'a deleted projection is recreated');
});

test('a directory in the projection path is preserved, not clobbered', () => {
  const dir = workspace();
  init(dir);
  fs.rmSync(planPaths(dir).markdown);
  fs.mkdirSync(planPaths(dir).markdown);
  fs.writeFileSync(path.join(planPaths(dir).markdown, 'keep.txt'), 'user data');

  const view = readInvestigationPlanView(dir);
  assert.equal(view.initialized, true);
  assert.equal(fs.readFileSync(`${planPaths(dir).markdown}.user/keep.txt`, 'utf8'), 'user data', 'the directory was moved aside intact');
  assert.equal(fs.statSync(planPaths(dir).markdown).isFile(), true, 'the projection took its place');
});

test('tampered state is rejected instead of being served', () => {
  const dir = workspace();
  init(dir);
  const state = readState(dir);
  state.tasks[0].status = 'in_progress';
  state.tasks[1].status = 'in_progress';
  fs.writeFileSync(planPaths(dir).state, JSON.stringify(state, null, 2));

  assertPlanError(() => readInvestigationPlanView(dir), { code: 'INVALID_PLAN_STATE' }, 'two in-progress tasks on disk');

  fs.writeFileSync(planPaths(dir).state, '{ not json');
  assertPlanError(() => readInvestigationPlanView(dir), { code: 'INVALID_PLAN_STATE' }, 'unparseable state');
});

test('a live lock holder blocks a mutation with a bounded busy error', () => {
  const dir = workspace();
  init(dir);
  const lockPath = path.join(dir, '.investigation-plan.lock');
  fs.mkdirSync(lockPath);
  // A same-host owner whose PID is alive is never reclaimed — this process is
  // the owner, so the lock is unambiguously held.
  fs.writeFileSync(path.join(lockPath, 'owner.json'), JSON.stringify({
    version: 1,
    token: 'held-by-another-app-process',
    pid: process.pid,
    hostname: os.hostname(),
    createdAt: Date.now(),
  }));

  assertPlanError(
    () => executeInvestigationPlanOperation(dir, 'add', { reason: 'r', tasks: [{ id: 'x', title: 'X' }] }, { lock: { timeoutMs: 0 } }),
    { code: 'PLAN_BUSY', statusCode: 409 },
    'a mutation against a held lock',
  );
  assert.equal(readState(dir).revision, 1, 'the blocked mutation changed nothing');
});

test('an abandoned lock with no owner is reclaimed once it goes stale', () => {
  const dir = workspace();
  init(dir);
  const lockPath = path.join(dir, '.investigation-plan.lock');
  fs.mkdirSync(lockPath);
  const longAgo = new Date(Date.now() - 60 * 60 * 1000);
  fs.utimesSync(lockPath, longAgo, longAgo);

  const result = executeInvestigationPlanOperation(
    dir,
    'add',
    { reason: 'Recovered after a crash.', tasks: [{ id: 'check-baseline', title: 'Check the baseline' }] },
    { lock: { timeoutMs: 200, staleMs: 1_000 } },
  );
  assert.equal(result.changed, true, 'the stale lock did not permanently wedge the plan');
  assert.equal(fs.existsSync(lockPath), false, 'the lock was released afterwards');
});

test('change history stays bounded and keeps the initialized entry', () => {
  const dir = workspace();
  init(dir);
  // Toggle one task well past the retention cap; pending <-> in_progress is the
  // only transition pair that never reaches a terminal status.
  for (let i = 0; i < PLAN_LIMITS.changes + 8; i += 1) {
    run(dir, 'update', { id: 'scope-host', status: i % 2 === 0 ? 'in_progress' : 'pending' });
  }

  const state = readState(dir);
  assert.ok(state.changes.length <= PLAN_LIMITS.changes, `history stayed within the cap (was ${state.changes.length})`);
  assert.equal(state.changes[0].kind, 'initialized', 'the initialization entry is never evicted');
  assert.equal(state.changes.at(-1).revision, state.revision, 'the newest entry matches the plan revision');
  assert.equal(readInvestigationPlanView(dir).ok, true, 'the pruned history still validates');
});

test('a stored pivot must carry every revised_* field', () => {
  // The store always persists these as strings, so an absent one means the file
  // was edited or truncated outside the app. All of them are treated alike.
  // Each field gets a pristine fixture — sharing one would let the first
  // deletion satisfy every later assertion.
  for (const field of ['revised_objective', 'revised_hypothesis', 'revised_strategy']) {
    const dir = workspace();
    init(dir);
    run(dir, 'pivot', { trigger: 'New lead.', decision: 'Change course.', revised_hypothesis: 'A different actor.' });
    const state = readState(dir);
    delete state.pivots[0][field];
    fs.writeFileSync(planPaths(dir).state, JSON.stringify(state, null, 2));
    assertPlanError(() => readInvestigationPlanView(dir), { code: 'INVALID_PLAN_STATE' }, `a pivot missing ${field}`);
  }
});

test('every view the store produces renders HTML without undefined lookups', () => {
  // renderInvestigationPlanHtml trusts the view it is handed. Views from
  // readInvestigationPlanView are safe — structured ones are schema-validated on
  // read, and legacy ones only ever carry pending/completed — but a hand-built
  // view is not. Callers must render what the store returned, never a
  // client-supplied object.
  const dir = workspace();
  init(dir);
  run(dir, 'update', { id: 'scope-host', status: 'blocked', outcome: 'Waiting on the change record.' });
  run(dir, 'pivot', { trigger: 'New lead.', decision: 'Change course.', supersede: ['read-records'] });
  assert.doesNotMatch(renderInvestigationPlanHtml(readInvestigationPlanView(dir)), /undefined/, 'structured view');

  const legacyDir = workspace();
  fs.writeFileSync(planPaths(legacyDir).markdown, '# Manual plan\n\n- [x] Pull the records\n- [ ] Check the baseline\n');
  assert.doesNotMatch(renderInvestigationPlanHtml(readInvestigationPlanView(legacyDir)), /undefined/, 'legacy view');

  const emptyDir = workspace();
  assert.doesNotMatch(renderInvestigationPlanHtml(readInvestigationPlanView(emptyDir)), /undefined/, 'awaiting view');
});

test('the Markdown projection is deterministic for a given revision', () => {
  const dir = workspace();
  init(dir);
  const state = readState(dir);
  assert.equal(renderInvestigationPlanMarkdown(state), renderInvestigationPlanMarkdown(state));
  assert.match(renderInvestigationPlanMarkdown(state), /revision: 1/);
});

test('rendered Markdown neutralizes attacker-controlled plan text', () => {
  const dir = workspace();
  // Plan fields carry wire-derived text. The renderer must not let that text
  // forge structure (headings, checkboxes, HTML) in the generated artifact.
  init(dir, {
    title: '# Injected heading <img src=x onerror=alert(1)>',
    tasks: [{ id: 'evil', title: '- [x] pretend this task is done', why: '</section><script>alert(1)</script>' }],
  });
  const markdown = fs.readFileSync(planPaths(dir).markdown, 'utf8');

  assert.doesNotMatch(markdown, /^# Injected heading/m, 'a hostile title cannot open its own heading');
  assert.doesNotMatch(markdown, /^\s*- \[x\] pretend/m, 'a hostile title cannot forge a checked task');
  assert.doesNotMatch(markdown, /<script>/, 'raw HTML is escaped');
});
