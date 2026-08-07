import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evalRouter } from './eval.js';
import { withServer } from '../lib/http-test-harness.js';

// A red gate can mean two very different things: the model regressed, or the
// cases never ran. The runners emit `phase: 'error'` per case; these tests pin
// that the route surfaces it instead of reporting a clean `done` over a
// contaminated gate.
const GATE = { pass: false, false_close_target: 0.05, reasons: ['false-close rate 1 exceeds target 0.05'] };
const AGGREGATES = { false_close_rate: 1, verdict_accuracy: 0 };

/**
 * Mount the router with a fake runner that replays a given progress script and
 * then resolves with a scored record, as startEval does.
 */
function mount(progressEvents) {
  return (app) => app.use('/api/eval', evalRouter({
    startEval: async ({ onProgress }) => {
      for (const p of progressEvents) onProgress(p);
      return { record: { gate: GATE, aggregates: AGGREGATES } };
    },
    reportsDir: '/nonexistent-eval-test-reports',
    casesDir: '/nonexistent-eval-test-cases',
    overridesPath: '/nonexistent-eval-test-overrides.json',
    buildDashboard: () => {},
    getSession: () => null,
  }));
}

async function runAndPoll(base) {
  const started = await fetch(`${base}/api/eval/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ backend: 'claude' }),
  });
  assert.equal(started.status, 200);
  // startEval is invoked after the response is sent; poll until it settles.
  for (let i = 0; i < 50; i++) {
    const s = await (await fetch(`${base}/api/eval/status`)).json();
    if (s.status !== 'running') return s;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('run never settled');
}

test('a case that fails to run is reported as an error, not a clean red gate', async () => {
  const events = [
    { phase: 'error', id: 'smbv1-dc', error: 'Claude Code returned an error result: Credit balance is too low' },
    { phase: 'done', id: 'smbv1-dc', completed: 1, total: 2 },
    { phase: 'done', id: 'ssdp-dlink-fp', completed: 2, total: 2 },
  ];
  await withServer(mount(events), async (base) => {
    const s = await runAndPoll(base);

    assert.equal(s.status, 'error');
    assert.match(s.error, /1 of 2 cases did not run/);
    assert.match(s.error, /Credit balance is too low/);
    assert.match(s.error, /not a valid signal/);
    assert.deepEqual(s.caseErrors, [{
      id: 'smbv1-dc',
      error: 'Claude Code returned an error result: Credit balance is too low',
    }]);

    // The scored detail is still there to inspect — it is labeled, not discarded.
    assert.deepEqual(s.gate, GATE);
    assert.deepEqual(s.aggregates, AGGREGATES);
  });
});

test('a clean run still reports done with no error', async () => {
  const events = [
    { phase: 'done', id: 'smbv1-dc', completed: 1, total: 2 },
    { phase: 'done', id: 'ssdp-dlink-fp', completed: 2, total: 2 },
  ];
  await withServer(mount(events), async (base) => {
    const s = await runAndPoll(base);

    assert.equal(s.status, 'done');
    assert.equal(s.error, null);
    assert.deepEqual(s.caseErrors, []);
    assert.equal(s.index, 2);
    assert.equal(s.total, 2);
  });
});

test('case errors are redacted and bounded', async () => {
  const events = [];
  for (let i = 0; i < 30; i++) {
    events.push({ phase: 'error', id: `case-${i}`, error: 'boom SECRET-VALUE' });
    events.push({ phase: 'done', id: `case-${i}`, completed: i + 1, total: 30 });
  }
  await withServer((app) => app.use('/api/eval', evalRouter({
    startEval: async ({ onProgress }) => {
      for (const p of events) onProgress(p);
      return { record: { gate: GATE, aggregates: AGGREGATES } };
    },
    reportsDir: '/nonexistent-eval-test-reports',
    casesDir: '/nonexistent-eval-test-cases',
    overridesPath: '/nonexistent-eval-test-overrides.json',
    buildDashboard: () => {},
    getSession: () => null,
    redact: (v) => String(v).replaceAll('SECRET-VALUE', '[redacted]'),
  })), async (base) => {
    const s = await runAndPoll(base);

    assert.equal(s.status, 'error');
    assert.equal(s.caseErrors.length, 20, 'the displayed sample is capped');
    assert.equal(s.caseErrorCount, 30, 'but the reported total is not');
    assert.equal(JSON.stringify(s).includes('SECRET-VALUE'), false);
    assert.match(s.error, /30 of 30 cases did not run/);
  });
});
