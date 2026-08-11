// Read-only tuning broker. Run: node --test lib/tuning-broker.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { TuningBroker } from './tuning-broker.js';
import { executeTuningOperation, TUNING_OPERATIONS } from './tuning-rules.js';

/** Drive the broker over its real socket, as ./tuning-interface does. */
function ask(socketPath, request) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    let buf = '';
    socket.on('connect', () => socket.write(`${JSON.stringify(request)}\n`));
    socket.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      const nl = buf.indexOf('\n');
      if (nl === -1) return;
      try { resolve(JSON.parse(buf.slice(0, nl))); } catch (err) { reject(err); }
      socket.end();
    });
    socket.on('error', reject);
  });
}

function startBroker({ execute, cfg = { extrahop: { host: 'eda.lab' } }, secrets = { apiKey: 'k' } } = {}) {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'tuning-ws-'));
  const sessions = new Map([['s1', { id: 's1', workspace }]]);
  const broker = new TuningBroker({
    sessions,
    getConfig: () => cfg,
    secretStore: { get: () => secrets },
    logger: { warn() {}, error() {}, log() {} },
    execute,
  });
  broker.start();
  return { broker, workspace };
}

test('list returns rules inside the untrusted-telemetry envelope', async () => {
  const rules = [{ id: 4, description: 'hide scanner noise', author: 'ops' }];
  const { broker, workspace } = startBroker({ execute: async () => ({ count: 1, rules }) });
  try {
    const res = await ask(broker.socketPath, { operation: 'list', payload: {}, cwd: workspace });
    assert.equal(res.error, undefined);
    const text = res.result.enveloped;
    // Rule text is operator-authored and can quote wire values, so it must arrive
    // enveloped like any other telemetry rather than as trusted app output.
    assert.match(text, /<untrusted-telemetry source="tuning list"/);
    assert.match(text, /<\/untrusted-telemetry>/);
    assert.match(text, /hide scanner noise/);
  } finally { broker.stop(); }
});

test('status is app-local truth, so it is NOT enveloped', async () => {
  const { broker, workspace } = startBroker({
    execute: (op, payload, deps) => executeTuningOperation(op, payload, deps),
  });
  try {
    const res = await ask(broker.socketPath, { operation: 'status', payload: {}, cwd: workspace });
    assert.equal(res.result.configured, true);
    assert.equal(res.result.host, 'eda.lab');
    assert.equal(res.result.auth, 'apikey');
    assert.equal(res.result.readOnly, true);
    assert.equal(res.result.enveloped, undefined);
  } finally { broker.stop(); }
});

test('status separates "not configured" from "configured with no rules"', async () => {
  const { broker, workspace } = startBroker({
    execute: (op, payload, deps) => executeTuningOperation(op, payload, deps),
    cfg: { extrahop: {} },
    secrets: {},
  });
  try {
    const res = await ask(broker.socketPath, { operation: 'status', payload: {}, cwd: workspace });
    assert.equal(res.result.configured, false);
    assert.match(res.result.reason, /host is not configured/);
  } finally { broker.stop(); }
});

test('write-shaped operations are refused — this surface cannot author suppressions', async () => {
  const { broker, workspace } = startBroker({ execute: async () => ({ count: 0, rules: [] }) });
  try {
    for (const op of ['create', 'create_tuningrule', 'delete', 'update', 'patch', '']) {
      const res = await ask(broker.socketPath, { operation: op, payload: {}, cwd: workspace });
      assert.match(res.error || '', /Unknown tuning operation/, `"${op}" must be refused`);
    }
    assert.deepEqual(TUNING_OPERATIONS, ['status', 'list', 'get'], 'the surface stays read-only');
  } finally { broker.stop(); }
});

test('a caller outside a live session workspace is refused', async () => {
  const { broker } = startBroker({ execute: async () => ({ count: 0, rules: [] }) });
  try {
    const res = await ask(broker.socketPath, { operation: 'list', payload: {}, cwd: '/tmp' });
    assert.ok(res.error, 'must not serve an unknown workspace');
  } finally { broker.stop(); }
});

test('an upstream failure surfaces as an error, not an empty rule list', async () => {
  // Reporting zero rules when the read failed would assert "nothing is hidden"
  // on no evidence — the exact false-negative this feature exists to prevent.
  const { broker, workspace } = startBroker({
    execute: async () => { throw new Error('ExtraHop refused the request (HTTP 403).'); },
  });
  try {
    const res = await ask(broker.socketPath, { operation: 'list', payload: {}, cwd: workspace });
    assert.match(res.error, /HTTP 403/);
    assert.equal(res.result, undefined);
  } finally { broker.stop(); }
});

test('status() reports the interface and broker for the health panel', () => {
  const { broker } = startBroker({ execute: async () => ({}) });
  try {
    const rows = broker.status();
    assert.deepEqual(rows.map((r) => r.id), ['tuning_interface', 'tuning_broker']);
    assert.equal(rows.find((r) => r.id === 'tuning_broker').ok, true);
    assert.match(rows.find((r) => r.id === 'tuning_broker').label, /read-only/i);
  } finally { broker.stop(); }
});

test('an unrecognised list payload is refused, not read as "nothing suppressed"', async () => {
  // A shape we do not understand must never become count:0 — the skill treats
  // that as "no rule explains this result".
  const { listTuningRules } = await import('./tuning-rules.js');
  for (const body of [{ items: [] }, { data: { rules: [] } }, 'unexpected', 42, {}]) {
    await assert.rejects(
      () => listTuningRules({ request: async () => ({ status: 200, headers: {}, text: JSON.stringify(body) }),
        cfg: { extrahop: { host: 'h' } }, secretStore: { get: () => ({ apiKey: 'k' }) } }),
      /unexpected tuning-rule list response/,
      `body ${JSON.stringify(body)} must be refused`,
    );
  }
  // Both supported shapes still work.
  const asArray = await listTuningRules({ request: async () => ({ status: 200, headers: {}, text: '[{"id":1}]' }),
    cfg: { extrahop: { host: 'h' } }, secretStore: { get: () => ({ apiKey: 'k' }) } });
  assert.deepEqual(asArray, { count: 1, rules: [{ id: 1 }] });
  const asObject = await listTuningRules({ request: async () => ({ status: 200, headers: {}, text: '{"rules":[]}' }),
    cfg: { extrahop: { host: 'h' } }, secretStore: { get: () => ({ apiKey: 'k' }) } });
  assert.deepEqual(asObject, { count: 0, rules: [] });
});

test('a rule id survives as given — no Number() rounding past 2^53', async () => {
  const { getTuningRule } = await import('./tuning-rules.js');
  const seen = [];
  const deps = {
    request: async (opts) => { seen.push(opts.url); return { status: 200, headers: {}, text: '{}' }; },
    cfg: { extrahop: { host: 'h' } }, secretStore: { get: () => ({ apiKey: 'k' }) },
  };
  // Number("9007199254740993") is 9007199254740992 — a different rule, or a 404.
  await getTuningRule('9007199254740993', deps);
  assert.ok(seen[0].endsWith('/detections/rules/hiding/9007199254740993'), seen[0]);

  await getTuningRule(42, deps);
  assert.ok(seen[1].endsWith('/detections/rules/hiding/42'));
  await getTuningRule(' 7 ', deps);
  assert.ok(seen[2].endsWith('/detections/rules/hiding/7'));

  // A numeric id that cannot be represented exactly is refused rather than rounded.
  await assert.rejects(() => getTuningRule(9007199254740993, deps), /safe integer/);
  for (const bad of ['abc', '', '1e3', '-1', null, undefined, {}, '12.5']) {
    await assert.rejects(() => getTuningRule(bad, deps), /must be an integer|safe integer/, `${JSON.stringify(bad)}`);
  }
});
