import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { Readable, Writable } from 'node:stream';
import test from 'node:test';
import {
  LOCAL_MEMORY_PROXY_TOKEN,
  createMemoryLlmProxyHandler,
  resolveMemoryProxyConfig,
  tokensMatch,
} from './memory-llm-proxy.js';

function baseConfig(overrides = {}) {
  return {
    profile: 'local',
    token: LOCAL_MEMORY_PROXY_TOKEN,
    maxBodyBytes: 1024,
    timeoutMs: 100,
    maxRequestsPerMinute: 10,
    maxConcurrent: 2,
    ...overrides,
  };
}

function createProxy(options = {}) {
  return createMemoryLlmProxyHandler({
    getAnthropicApiKey: () => 'real-anthropic-key',
    proxyConfig: baseConfig(),
    fetchImpl: async () => new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
    ...options,
  });
}

class MockResponse extends Writable {
  constructor() {
    super();
    this.statusCode = 200;
    this.headers = new Map();
    this.chunks = [];
  }

  _write(chunk, _encoding, callback) {
    this.headersSent = true;
    this.chunks.push(Buffer.from(chunk));
    callback();
  }

  status(code) {
    this.statusCode = code;
    return this;
  }

  setHeader(name, value) {
    this.headers.set(String(name).toLowerCase(), String(value));
  }

  getHeader(name) {
    return this.headers.get(String(name).toLowerCase());
  }

  json(value) {
    this.setHeader('content-type', 'application/json');
    this.end(JSON.stringify(value));
    return this;
  }

  bodyText() {
    return Buffer.concat(this.chunks).toString('utf8');
  }

  bodyJson() {
    return JSON.parse(this.bodyText());
  }
}

async function invoke(handler, {
  method = 'POST',
  pathname = '/v1/messages',
  token = LOCAL_MEMORY_PROXY_TOKEN,
  body = '{}',
  headers = {},
} = {}) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(body)]);
  req.method = method;
  req.originalUrl = `/memory-llm${pathname}`;
  req.url = pathname;
  req.headers = {
    'content-type': 'application/json',
    'x-api-key': token,
    ...headers,
  };
  const res = new MockResponse();
  const finished = once(res, 'finish');
  await handler(req, res);
  if (!res.writableFinished) await finished;
  return res;
}

test('local profile preserves the zero-configuration proxy token', () => {
  const config = resolveMemoryProxyConfig({});
  assert.equal(config.profile, 'local');
  assert.equal(config.token, LOCAL_MEMORY_PROXY_TOKEN);
  assert.equal(config.tokenSource, 'local-default');
});

test('hardened profiles reject the public local token and short overrides', () => {
  assert.throws(
    () => resolveMemoryProxyConfig({ EH_DEPLOYMENT_PROFILE: 'hardened' }),
    /requires a non-default memory proxy token/,
  );
  assert.throws(
    () => resolveMemoryProxyConfig({ EH_DEPLOYMENT_PROFILE: 'remote', EH_MEMORY_PROXY_TOKEN: 'too-short' }),
    /at least 32 characters/,
  );
});

test('hardened profile accepts a generated token file', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'eh-proxy-token-'));
  const tokenFile = path.join(directory, 'token');
  const token = 'a'.repeat(64);
  fs.writeFileSync(tokenFile, `${token}\n`, { mode: 0o600 });
  try {
    const config = resolveMemoryProxyConfig({
      EH_DEPLOYMENT_PROFILE: 'hardened',
      EH_MEMORY_PROXY_TOKEN_FILE: tokenFile,
    });
    assert.equal(config.token, token);
    assert.equal(config.tokenSource, 'file');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('token comparison handles matching and different-length values safely', () => {
  assert.equal(tokensMatch('same', 'same'), true);
  assert.equal(tokensMatch('short', 'a-much-longer-token'), false);
  assert.equal(tokensMatch(undefined, 'expected'), false);
});

test('proxy forwards the characterized Graphiti Anthropic operation', async () => {
  let forwarded;
  const handler = createProxy({
    fetchImpl: async (url, options) => {
      forwarded = { url, options, body: Buffer.from(options.body).toString('utf8') };
      return new Response(JSON.stringify({ id: 'msg_test' }), {
        status: 201,
        headers: { 'content-type': 'application/json', 'request-id': 'req_test' },
      });
    },
  });
  const response = await invoke(handler, { body: JSON.stringify({ model: 'test' }) });
  assert.equal(response.statusCode, 201);
  assert.deepEqual(response.bodyJson(), { id: 'msg_test' });
  assert.equal(forwarded.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(forwarded.options.method, 'POST');
  assert.equal(forwarded.options.headers['x-api-key'], 'real-anthropic-key');
  assert.equal(forwarded.body, JSON.stringify({ model: 'test' }));
});

test('proxy rejects bad tokens, methods, and paths before calling upstream', async () => {
  let calls = 0;
  const handler = createProxy({ fetchImpl: async () => { calls += 1; return new Response(); } });
  assert.equal((await invoke(handler, { token: 'wrong' })).statusCode, 403);
  assert.equal((await invoke(handler, { method: 'GET', body: undefined })).statusCode, 405);
  assert.equal((await invoke(handler, { pathname: '/v1/models' })).statusCode, 404);
  assert.equal(calls, 0);
});

test('proxy enforces the configured request-body limit', async () => {
  const handler = createProxy({ proxyConfig: baseConfig({ maxBodyBytes: 8 }) });
  const response = await invoke(handler, { body: JSON.stringify({ tooLarge: true }) });
  assert.equal(response.statusCode, 413);
  assert.match(response.bodyJson().error, /too large/);
});

test('proxy aborts and reports a timed-out upstream request', async () => {
  const handler = createProxy({
    proxyConfig: baseConfig({ timeoutMs: 10 }),
    fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }),
  });
  const response = await invoke(handler);
  assert.equal(response.statusCode, 504);
  assert.match(response.bodyJson().error, /timed out/);
});

test('proxy timeout remains active while an upstream response body is streaming', async () => {
  const handler = createProxy({
    proxyConfig: baseConfig({ timeoutMs: 10 }),
    fetchImpl: async (_url, { signal }) => new Response(new ReadableStream({
      start(controller) {
        signal.addEventListener('abort', () => controller.error(signal.reason), { once: true });
      },
    })),
  });
  const response = await invoke(handler);
  assert.equal(response.statusCode, 504);
  assert.match(response.bodyJson().error, /timed out/);
});

test('proxy rate limiting is bounded and returns retry guidance', async () => {
  const handler = createProxy({ proxyConfig: baseConfig({ maxRequestsPerMinute: 1 }) });
  assert.equal((await invoke(handler)).statusCode, 200);
  const limited = await invoke(handler);
  assert.equal(limited.statusCode, 429);
  assert.equal(limited.getHeader('retry-after'), '60');
});

test('proxy limits concurrent upstream calls', async () => {
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  const handler = createProxy({
    proxyConfig: baseConfig({ maxConcurrent: 1 }),
    fetchImpl: async () => { await held; return new Response('{}'); },
  });
  const first = invoke(handler);
  await new Promise((resolve) => setTimeout(resolve, 10));
  const second = await invoke(handler);
  assert.equal(second.statusCode, 429);
  release();
  assert.equal((await first).statusCode, 200);
});
