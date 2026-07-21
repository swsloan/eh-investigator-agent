import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createShutdownCoordinator, drainingGuard } from './shutdown-coordinator.js';

const quietLogger = { error() {}, warn() {}, log() {} };

function fakeServer() {
  return {
    listening: true,
    close(cb) { this.listening = false; cb?.(); },
    closeIdleConnections() {},
    closeAllConnections() {},
  };
}

function fakeSession() {
  return { disposed: false, aborted: false, abort() { this.aborted = true; }, dispose() { this.disposed = true; } };
}

function fakeBroker() {
  return { stopped: false, stop() { this.stopped = true; } };
}

test('stops sessions, brokers, SSE clients and the listener, then reports completion', async () => {
  const server = fakeServer();
  const session = fakeSession();
  // The fork stores sessions and SSE clients in plain Maps.
  const sessions = new Map([['s1', session]]);
  const ended = [];
  const sseClients = new Map([['s1', new Set([{ end() { ended.push('client'); } }])]]);
  const brokers = [fakeBroker(), fakeBroker(), fakeBroker(), fakeBroker()];
  let auxiliaryRan = false;
  let drainingSet = null;

  const coordinator = createShutdownCoordinator({
    getServer: () => server,
    sessions,
    sseClients,
    brokers,
    stopAuxiliary: () => { auxiliaryRan = true; return true; },
    setDraining: (value) => { drainingSet = value; },
    logger: quietLogger,
  });

  const result = await coordinator.shutdown('SIGTERM');

  assert.equal(result.completed, true, 'shutdown completed cleanly');
  assert.equal(result.timedOut, false);
  assert.equal(result.reason, 'SIGTERM');
  assert.equal(drainingSet, true, 'draining was signalled before work began');
  assert.equal(server.listening, false, 'HTTP listener was closed');
  assert.equal(session.disposed, true, 'loaded session was disposed');
  assert.equal(auxiliaryRan, true, 'auxiliary cleanup ran');
  assert.deepEqual(ended, ['client'], 'SSE clients were ended');
  assert.equal(sseClients.size, 0, 'SSE registry was cleared');
  assert.ok(brokers.every((b) => b.stopped), 'every broker was stopped');
});

test('is idempotent — repeated calls share one shutdown', async () => {
  const coordinator = createShutdownCoordinator({
    getServer: () => fakeServer(),
    sessions: new Map(),
    sseClients: new Map(),
    logger: quietLogger,
  });
  const first = coordinator.shutdown('SIGINT');
  const second = coordinator.shutdown('SIGINT');
  assert.equal(first, second, 'the same promise is returned');
  await first;
});

test('a failing broker is reported instead of silently ignored', async () => {
  const coordinator = createShutdownCoordinator({
    getServer: () => fakeServer(),
    sessions: new Map(),
    sseClients: new Map(),
    brokers: [{ stop() { throw new Error('socket stuck'); } }],
    logger: quietLogger,
  });
  const result = await coordinator.shutdown('SIGTERM');
  assert.equal(result.completed, false, 'a failed step means shutdown did not complete cleanly');
  assert.ok(result.failures.length > 0, 'the failing step is named');
});

test('drainingGuard refuses mutating requests only while draining', () => {
  let draining = false;
  const guard = drainingGuard(() => draining);
  const run = (method) => {
    let status = null;
    let nexted = false;
    guard(
      { method },
      { status(code) { status = code; return { json() {} }; } },
      () => { nexted = true; },
    );
    return { status, nexted };
  };

  assert.equal(run('POST').nexted, true, 'writes pass when not draining');

  draining = true;
  assert.equal(run('GET').nexted, true, 'reads still pass while draining');
  const post = run('POST');
  assert.equal(post.nexted, false, 'writes are refused while draining');
  assert.equal(post.status, 503);
});
