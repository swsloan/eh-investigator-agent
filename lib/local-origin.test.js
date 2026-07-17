import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  isLocalHostHeader,
  isLoopbackHostname,
  isSameLocalOrigin,
  localOriginGuard,
} from './local-origin.js';

test('isLoopbackHostname accepts loopback forms and rejects others', () => {
  for (const ok of ['localhost', '127.0.0.1', '127.5.6.7', '::1', '[::1]', 'LOCALHOST']) {
    assert.equal(isLoopbackHostname(ok), true, ok);
  }
  for (const bad of ['evil.com', '10.0.0.1', '192.168.1.5', '0.0.0.0', '']) {
    assert.equal(isLoopbackHostname(bad), false, bad);
  }
});

test('isLocalHostHeader parses host:port and checks loopback', () => {
  assert.equal(isLocalHostHeader('127.0.0.1:3100'), true);
  assert.equal(isLocalHostHeader('localhost:3100'), true);
  assert.equal(isLocalHostHeader('evil.com:3100'), false);
  assert.equal(isLocalHostHeader(''), false);
});

test('isSameLocalOrigin requires loopback host and an exact host match', () => {
  assert.equal(isSameLocalOrigin('http://127.0.0.1:3100', '127.0.0.1:3100'), true);
  assert.equal(isSameLocalOrigin('http://127.0.0.1:3200', '127.0.0.1:3100'), false); // port mismatch
  assert.equal(isSameLocalOrigin('http://evil.com', '127.0.0.1:3100'), false);
  assert.equal(isSameLocalOrigin('http://127.0.0.1:3100', 'evil.com:3100'), false); // non-loopback target
});

function fakeReq({ method = 'POST', headers = {} }) {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return { method, get: (name) => lower[String(name).toLowerCase()] };
}

function runGuard(reqOpts) {
  const req = fakeReq(reqOpts);
  const res = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  let nexted = false;
  localOriginGuard(req, res, () => { nexted = true; });
  return { res, nexted };
}

test('localOriginGuard allows safe methods regardless of origin', () => {
  const { nexted, res } = runGuard({ method: 'GET', headers: { host: 'evil.com', origin: 'http://evil.com' } });
  assert.equal(nexted, true);
  assert.equal(res.statusCode, 200);
});

test('localOriginGuard passes a same-origin loopback mutation', () => {
  const { nexted } = runGuard({
    method: 'POST',
    headers: { host: '127.0.0.1:3100', origin: 'http://127.0.0.1:3100', 'sec-fetch-site': 'same-origin' },
  });
  assert.equal(nexted, true);
});

test('localOriginGuard blocks a non-loopback Host', () => {
  const { nexted, res } = runGuard({ method: 'POST', headers: { host: 'evil.com' } });
  assert.equal(nexted, false);
  assert.equal(res.statusCode, 403);
});

test('localOriginGuard blocks a cross-site sec-fetch-site', () => {
  const { nexted, res } = runGuard({
    method: 'POST',
    headers: { host: '127.0.0.1:3100', 'sec-fetch-site': 'cross-site' },
  });
  assert.equal(nexted, false);
  assert.equal(res.statusCode, 403);
});

test('localOriginGuard blocks a cross-origin Origin header', () => {
  const { nexted, res } = runGuard({
    method: 'POST',
    headers: { host: '127.0.0.1:3100', origin: 'http://evil.com' },
  });
  assert.equal(nexted, false);
  assert.equal(res.statusCode, 403);
});
