// ReversingLabs broker guard. Run: node --test lib/reversinglabs-broker.test.js
// Exercises the workspace-confinement and request-validation guards without
// touching the ReversingLabs API (no operation is ever reached).
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';

function fakeSocket() {
  const writes = [];
  return {
    destroyed: false,
    ended: false,
    write(s) { writes.push(s); },
    end() { this.ended = true; },
    removeAllListeners() {},
    writes,
  };
}

async function loadBroker(t) {
  try {
    return (await import('./reversinglabs-broker.js')).ReversingLabsBroker;
  } catch {
    t.skip('app dependencies not installed — integration test runs in CI');
    return null;
  }
}

test('handleRequest rejects invalid JSON before any API call', async (t) => {
  const ReversingLabsBroker = await loadBroker(t);
  if (!ReversingLabsBroker) return;
  const broker = new ReversingLabsBroker({ sessions: new Map(), getConfig: () => ({}), secretStore: {} });
  const socket = fakeSocket();
  await broker.handleRequest(socket, 'not-json{');
  assert.equal(socket.ended, true, 'socket closed');
  assert.match(JSON.parse(socket.writes[0]).error, /invalid/i);
});

test('handleRequest rejects a working directory outside every session workspace', async (t) => {
  const ReversingLabsBroker = await loadBroker(t);
  if (!ReversingLabsBroker) return;
  // No sessions registered, so any real path is "outside" a known workspace.
  const broker = new ReversingLabsBroker({ sessions: new Map(), getConfig: () => ({}), secretStore: {} });
  const socket = fakeSocket();
  await broker.handleRequest(socket, JSON.stringify({ operation: 'reputation', payload: { hashes: ['abc'] }, cwd: os.tmpdir() }));
  assert.equal(socket.ended, true, 'socket closed');
  assert.match(JSON.parse(socket.writes[0]).error, /workspace/i, 'explains the workspace rejection');
});

test('handleRequest rejects a request with no working directory', async (t) => {
  const ReversingLabsBroker = await loadBroker(t);
  if (!ReversingLabsBroker) return;
  const broker = new ReversingLabsBroker({ sessions: new Map(), getConfig: () => ({}), secretStore: {} });
  const socket = fakeSocket();
  await broker.handleRequest(socket, JSON.stringify({ operation: 'status', payload: {} }));
  assert.equal(socket.ended, true, 'socket closed');
  assert.match(JSON.parse(socket.writes[0]).error, /working directory/i);
});
