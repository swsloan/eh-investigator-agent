// External audit sink (#30 Slice C). Run: node --test lib/audit-sink.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAuditSink, sealDigest, resolveAuditSinkConfig } from './audit-sink.js';

const seal = { keyId: 'abc123', root: 'deadbeef', alg: 'ed25519', at: '2026-07-29T00:00:00Z', sig: 'SIGNATURE', pubKey: 'PEM' };

test('sealDigest is non-secret: id/keyId/root/alg/time only, no sig or key material', () => {
  const d = sealDigest('sess-1', seal);
  assert.deepEqual(Object.keys(d).sort(), ['alg', 'keyId', 'root', 'sealedAt', 'sessionId', 'type']);
  assert.equal(d.sessionId, 'sess-1');
  assert.equal(d.root, 'deadbeef');
  const s = JSON.stringify(d);
  assert.ok(!s.includes('SIGNATURE') && !s.includes('PEM'), 'no signature or key material in the digest');
});

test('resolveAuditSinkConfig is environment-first, falling back to app config', () => {
  assert.deepEqual(resolveAuditSinkConfig({}, {}), { type: 'none' });
  assert.deepEqual(resolveAuditSinkConfig({ EH_AUDIT_SINK: 'file', EH_AUDIT_SINK_PATH: '/w/a.jsonl' }, {}),
    { type: 'file', path: '/w/a.jsonl' });
  assert.deepEqual(resolveAuditSinkConfig({}, { audit: { sink: { type: 'http', url: 'https://siem/x' } } }),
    { type: 'http', url: 'https://siem/x', token: '' });
});

test('none sink is a no-op that reports not-emitted', async () => {
  const sink = createAuditSink(() => ({ type: 'none' }));
  assert.deepEqual(await sink.emit(sealDigest('s', seal)), { ok: true, type: 'none', emitted: false });
});

test('file sink appends the digest as JSONL (WORM-substitute path)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sink-'));
  const p = path.join(dir, 'nested', 'anchor.jsonl');
  const sink = createAuditSink(() => ({ type: 'file', path: p }));
  await sink.emit(sealDigest('s1', seal));
  await sink.emit(sealDigest('s2', seal));
  const lines = fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.equal(lines.length, 2);
  assert.equal(lines[0].sessionId, 's1');
  assert.equal(lines[1].sessionId, 's2');
  assert.ok(!fs.readFileSync(p, 'utf8').includes('SIGNATURE'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('http sink POSTs the digest with optional bearer', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => { calls.push({ url, opts }); return { ok: true, status: 200 }; };
  const sink = createAuditSink(() => ({ type: 'http', url: 'https://siem/hec', token: 'T' }), { fetchImpl });
  const r = await sink.emit(sealDigest('s1', seal));
  assert.equal(r.ok, true);
  assert.equal(r.emitted, true);
  assert.equal(calls[0].url, 'https://siem/hec');
  assert.equal(calls[0].opts.method, 'POST');
  assert.equal(calls[0].opts.headers.authorization, 'Bearer T');
  assert.equal(JSON.parse(calls[0].opts.body).sessionId, 's1');
});

test('emit never throws / never blocks the seal — a failing sink is swallowed', async () => {
  const fetchImpl = async () => { throw new Error('SIEM down'); };
  const sink = createAuditSink(() => ({ type: 'http', url: 'https://siem/hec' }), { fetchImpl });
  const r = await sink.emit(sealDigest('s', seal));
  assert.equal(r.ok, false);
  assert.match(r.error, /SIEM down/);
});

test('misconfigured sinks report an error without throwing', async () => {
  assert.equal((await createAuditSink(() => ({ type: 'file' })).emit({})).ok, false, 'file without path');
  assert.equal((await createAuditSink(() => ({ type: 'http' })).emit({})).ok, false, 'http without url');
  assert.equal((await createAuditSink(() => ({ type: 'nope' })).emit({})).ok, false, 'unknown type');
});
