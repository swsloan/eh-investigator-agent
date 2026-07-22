import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { investigationPlansRouter } from './investigation-plans.js';
import { executeInvestigationPlanOperation } from '../lib/investigation-plan.js';
import { withServer } from '../lib/http-test-harness.js';

const SILENT = { warn() {}, error() {} };

function makeSession() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-route-ws-'));
  return { id: 'sess-1', workspace, title: 'T', running: false };
}

function mount(session, overrides = {}) {
  const sessions = new Map([[session.id, session]]);
  return (app) => app.use('/api/sessions', investigationPlansRouter({ sessions, logger: SILENT, ...overrides }));
}

function seedPlan(session) {
  return executeInvestigationPlanOperation(session.workspace, 'init', {
    plan_type: 'security_investigation',
    title: 'Suspicious SMB burst',
    objective: 'Attribute the SMB burst from 10.1.4.22.',
    scope: 'The host and the file servers it contacted.',
    hypothesis: 'A scripted inventory sweep, not enumeration.',
    strategy: 'Compare against baseline, then read the records.',
    completion_criteria: 'Every server attributed or escalated.',
    tasks: [{ id: 'scope-host', title: 'Scope the source host' }],
  }, { lock: { timeoutMs: 50 } });
}

test('GET returns the awaiting view for a workspace with no plan', async () => {
  const session = makeSession();
  await withServer(mount(session), async (base) => {
    const res = await fetch(`${base}/api/sessions/${session.id}/investigation-plan`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store', 'plan state is never cached');
    const body = await res.json();
    assert.equal(body.initialized, false);
    assert.equal(body.plan, null);
  });
});

test('GET returns the structured plan once initialized', async () => {
  const session = makeSession();
  seedPlan(session);
  await withServer(mount(session), async (base) => {
    const body = await (await fetch(`${base}/api/sessions/${session.id}/investigation-plan`)).json();
    assert.equal(body.initialized, true);
    assert.equal(body.revision, 1);
    assert.equal(body.plan.title, 'Suspicious SMB burst');
    assert.equal(body.progress.currentTask.id, 'scope-host');
  });
});

test('the render route serves HTML and stamps the revision', async () => {
  const session = makeSession();
  seedPlan(session);
  await withServer(mount(session), async (base) => {
    const res = await fetch(`${base}/api/sessions/${session.id}/investigation-plan/render`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
    assert.equal(res.headers.get('x-investigation-plan-revision'), '1', 'the client can tell a stale render from a fresh one');
    const html = await res.text();
    assert.match(html, /Suspicious SMB burst/);
    assert.doesNotMatch(html, /undefined/);
  });
});

test('an unknown session is a 404, not a plan error', async () => {
  const session = makeSession();
  await withServer(mount(session), async (base) => {
    assert.equal((await fetch(`${base}/api/sessions/nope/investigation-plan`)).status, 404);
  });
});

test('read routes ask for a short lock wait so a contended read fails fast', async () => {
  // The store is synchronous: a long lock wait would park the event loop for
  // every other request. UI reads take a retryable 409 instead.
  const session = makeSession();
  const waits = [];
  const readPlanView = (workspace, options) => {
    waits.push(options?.lock?.timeoutMs);
    return { ok: true, initialized: false, plan: null, revision: 0, progress: {} };
  };
  await withServer(mount(session, { readPlanView }), async (base) => {
    await fetch(`${base}/api/sessions/${session.id}/investigation-plan`);
    await fetch(`${base}/api/sessions/${session.id}/investigation-plan/render`);
  });
  assert.equal(waits.length, 2);
  for (const wait of waits) {
    assert.ok(Number.isInteger(wait) && wait <= 25, `read path passed a bounded lock wait (got ${wait})`);
  }
});

test('a busy plan surfaces as a retryable status, and internals stay out of the response', async () => {
  const session = makeSession();
  const readPlanView = () => {
    throw Object.assign(new Error('The investigation plan is busy in another app process. Retry the operation.'), {
      code: 'PLAN_BUSY',
      statusCode: 409,
    });
  };
  await withServer(mount(session, { readPlanView }), async (base) => {
    const res = await fetch(`${base}/api/sessions/${session.id}/investigation-plan`);
    assert.equal(res.status, 409, 'the caller can retry');
    const body = await res.json();
    assert.equal(body.error, 'The investigation plan could not be loaded.');
    assert.equal(body.code, undefined, 'no internal error codes or paths are echoed back');
  });
});

test('a corrupt plan state does not become a 200 with a broken body', async () => {
  const session = makeSession();
  seedPlan(session);
  const state = JSON.parse(fs.readFileSync(path.join(session.workspace, '.investigation-plan.json'), 'utf8'));
  state.revision = 99; // no matching change entry — fails stored-state validation
  fs.writeFileSync(path.join(session.workspace, '.investigation-plan.json'), JSON.stringify(state));

  await withServer(mount(session), async (base) => {
    const res = await fetch(`${base}/api/sessions/${session.id}/investigation-plan`);
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, 'The investigation plan could not be loaded.');
  });
});
