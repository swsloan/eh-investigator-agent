import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  DEFAULT_BROKER_MAX_REQUEST_BYTES,
  DEFAULT_BROKER_REQUEST_TIMEOUT_MS,
  SingleRequestBrokerLifecycle,
  resolveBrokerWorkspace,
} from './single-request-broker.js';

function socketPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eh-broker-test-'));
  return { dir, socketPath: path.join(dir, 'broker.sock') };
}

/** Send one line and resolve with the single reply the broker writes back. */
function request(sock, line) {
  return new Promise((resolve, reject) => {
    const client = net.createConnection(sock);
    let buffer = '';
    client.setEncoding('utf8');
    client.on('connect', () => client.write(line));
    client.on('data', (chunk) => { buffer += chunk; });
    client.on('error', reject);
    client.on('close', () => resolve(buffer.trim()));
  });
}

async function withBroker(options, fn) {
  const { dir, socketPath: sock } = socketPath();
  const lifecycle = new SingleRequestBrokerLifecycle({ brokerName: 'Test broker', logger: { error() {}, warn() {} }, ...options });
  lifecycle.listen(sock);
  try {
    return await fn(sock, lifecycle);
  } finally {
    lifecycle.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('exposes the documented default bounds', () => {
  assert.equal(DEFAULT_BROKER_MAX_REQUEST_BYTES, 64 * 1024);
  assert.equal(DEFAULT_BROKER_REQUEST_TIMEOUT_MS, 35_000);
});

test('serves one request and replies through finish()', async () => {
  const reply = await withBroker({
    onRequest: (socket, line, context) => {
      assert.ok(context.signal, 'handler receives an AbortSignal');
      context.lifecycle?.finish?.(socket, { echo: line });
    },
  }, (sock, lifecycle) => {
    lifecycle.onRequest = (socket, line) => lifecycle.finish(socket, { echo: line });
    return request(sock, 'hello\n');
  });
  assert.match(reply, /hello/);
});

test('rejects a request larger than maxRequestBytes instead of buffering it', async () => {
  const reply = await withBroker({
    maxRequestBytes: 64,
    onRequest: (socket, line, context) => context.lifecycle.finish(socket, { ok: true }),
  }, (sock, lifecycle) => {
    lifecycle.onRequest = (socket) => lifecycle.finish(socket, { ok: true });
    // No newline, so the only thing that can end this is the size bound.
    return request(sock, 'x'.repeat(4096));
  });
  assert.match(reply, /too large/i, 'oversized input is refused');
});

test('aborts the handler signal when the request deadline passes', async () => {
  let aborted = false;
  await withBroker({
    requestTimeoutMs: 40,
    onRequest: (socket, line, context) => {
      // Never call finish(): let the deadline fire.
      context.signal.addEventListener('abort', () => { aborted = true; }, { once: true });
    },
  }, (sock) => request(sock, 'slow\n'));
  assert.equal(aborted, true, 'the deadline aborted the in-flight request');
});

test('resolveBrokerWorkspace authorizes a cwd inside a known session workspace', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eh-broker-ws-'));
  const workspace = path.join(dir, 'session-a');
  const inside = path.join(workspace, 'evidence');
  fs.mkdirSync(inside, { recursive: true });
  // A plain Map, which is how this fork still stores sessions.
  const sessions = new Map([['session-a', { id: 'session-a', workspace }]]);

  const ok = resolveBrokerWorkspace(sessions, inside, { brokerName: 'Test broker' });
  assert.equal(ok.workspace, fs.realpathSync.native(workspace));

  assert.throws(
    () => resolveBrokerWorkspace(sessions, dir, { brokerName: 'Test broker' }),
    /outside a known session workspace/,
  );
  assert.throws(
    () => resolveBrokerWorkspace(sessions, '', { brokerName: 'Test broker' }),
    /did not include a working directory/,
  );
  fs.rmSync(dir, { recursive: true, force: true });
});
