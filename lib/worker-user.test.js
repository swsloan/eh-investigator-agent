// Non-root worker identity resolution (#97). Run: node --test lib/worker-user.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { resolveWorkerUser, workerSpawnUser, secureBrokerForWorker } from './worker-user.js';

test('resolveWorkerUser returns null when no worker UID is configured', () => {
  assert.equal(resolveWorkerUser({ env: {} }), null);
  assert.equal(resolveWorkerUser({ env: { EH_WORKER_UID: '' } }), null);
  assert.equal(resolveWorkerUser({ env: { EH_WORKER_UID: 'abc' } }), null);
  assert.equal(resolveWorkerUser({ env: { EH_WORKER_UID: '-3' } }), null);
});

test('resolveWorkerUser reads uid/gid/home, defaulting gid=uid and home=/home/worker', () => {
  assert.deepEqual(resolveWorkerUser({ env: { EH_WORKER_UID: '10001' } }),
    { uid: 10001, gid: 10001, home: '/home/worker' });
  assert.deepEqual(
    resolveWorkerUser({ env: { EH_WORKER_UID: '10001', EH_WORKER_GID: '10002', EH_WORKER_HOME: '/srv/w' } }),
    { uid: 10001, gid: 10002, home: '/srv/w' });
});

test('workerSpawnUser returns the identity only when configured AND root', () => {
  const env = { EH_WORKER_UID: '10001' };
  assert.deepEqual(workerSpawnUser({ env, getuid: () => 0 }), { uid: 10001, gid: 10001, home: '/home/worker' });
  assert.equal(workerSpawnUser({ env: {}, getuid: () => 0 }), null, 'not configured → null');
});

test('workerSpawnUser fails closed when hardened + configured + not root', () => {
  assert.throws(
    () => workerSpawnUser({ env: { EH_WORKER_UID: '10001', EH_DEPLOYMENT_PROFILE: 'hardened' }, getuid: () => 1000 }),
    /not running as root/,
    'hardened must refuse to run the worker as root',
  );
});

test('workerSpawnUser warns and falls back to in-process when not hardened + not root', () => {
  const warnings = [];
  const out = workerSpawnUser({
    env: { EH_WORKER_UID: '10001' },
    getuid: () => 1000,
    logger: { warn: (m) => warnings.push(m) },
  });
  assert.equal(out, null);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /not root/);
});

test('secureBrokerForWorker is inert when isolation is off (no server touched)', () => {
  // Not configured → returns without inspecting the server.
  let listenerAdded = false;
  const server = { get listening() { return false; }, once: () => { listenerAdded = true; } };
  secureBrokerForWorker({ server, dir: '/nope', socketPath: '/nope/s.sock', env: {}, getuid: () => 0 });
  assert.equal(listenerAdded, false);
});

test('secureBrokerForWorker is inert when configured but not root', () => {
  let listenerAdded = false;
  const server = new EventEmitter();
  server.listening = false;
  server.once = (...a) => { listenerAdded = true; return EventEmitter.prototype.once.call(server, ...a); };
  secureBrokerForWorker({
    server, dir: '/nope', socketPath: '/nope/s.sock',
    env: { EH_WORKER_UID: '10001' }, getuid: () => 1000,
  });
  assert.equal(listenerAdded, false, 'non-root must not attempt to chown or hook the socket');
});
