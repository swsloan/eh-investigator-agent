// ExtraHop REST client. Run: node --test lib/extrahop-rest.test.js
// No network: every test injects `request`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { clearTokenCache, extrahopGet, resolveRestTarget } from './extrahop-rest.js';

const selfManaged = {
  cfg: { extrahop: { host: 'eda.acmelegal.lab', family: 'eda' } },
  secretStore: { get: () => ({ apiKey: 'SUPER-SECRET-KEY' }) },
};
const rx360 = {
  cfg: { extrahop: { host: 'abc123', family: 'rx360' } },
  secretStore: { get: () => ({ clientId: 'client-abc', clientSecret: 'SUPER-SECRET-SECRET' }) },
};

/** Record calls and reply with a canned response. */
function recorder(reply) {
  const calls = [];
  const request = async (opts) => {
    calls.push(opts);
    const r = typeof reply === 'function' ? reply(opts, calls.length) : reply;
    return { status: 200, headers: {}, text: '{}', ...r };
  };
  return { calls, request };
}

test('self-managed target uses the API key header and honours insecure', () => {
  const t = resolveRestTarget(selfManaged.cfg, selfManaged.secretStore);
  assert.equal(t.baseUrl, 'https://eda.acmelegal.lab/api/v1');
  assert.equal(t.auth.mode, 'apikey');
  assert.equal(t.insecure, false);

  const insecure = resolveRestTarget(
    { extrahop: { host: 'eda.acmelegal.lab', insecure: true } }, selfManaged.secretStore,
  );
  assert.equal(insecure.insecure, true, 'self-signed appliances need this');
});

test('rx360 target resolves the tenant to an API host and never allows insecure', () => {
  const t = resolveRestTarget(rx360.cfg, rx360.secretStore);
  assert.equal(t.auth.mode, 'oauth2');
  assert.match(t.baseUrl, /^https:\/\/.+\/api\/v1$/);
  assert.equal(t.insecure, false, 'a public endpoint must always verify TLS');
});

test('missing configuration fails with an actionable message and no secret', () => {
  assert.throws(() => resolveRestTarget({ extrahop: {} }, { get: () => ({}) }), /host is not configured/);
  assert.throws(
    () => resolveRestTarget({ extrahop: { host: 'h' } }, { get: () => ({}) }),
    /API key is not configured/,
  );
  assert.throws(
    () => resolveRestTarget({ extrahop: { family: 'rx360', host: 'abc123' } }, { get: () => ({}) }),
    /client ID and secret/,
  );
});

test('a GET sends the api-key credential and returns parsed JSON', async () => {
  const { calls, request } = recorder({ text: JSON.stringify([{ id: 7, description: 'noisy scanner' }]) });
  const out = await extrahopGet('/detections/rules/hiding', { ...selfManaged, request });
  assert.deepEqual(out, [{ id: 7, description: 'noisy scanner' }]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://eda.acmelegal.lab/api/v1/detections/rules/hiding');
  assert.equal(calls[0].headers.Authorization, 'ExtraHop apikey=SUPER-SECRET-KEY');
});

test('rx360 exchanges client credentials for a bearer, then caches the token', async () => {
  clearTokenCache();
  const { calls, request } = recorder((opts) => (
    opts.url.endsWith('/oauth2/token')
      ? { text: JSON.stringify({ access_token: 'tok-1', expires_in: 3600 }) }
      : { text: '[]' }
  ));
  await extrahopGet('/detections/rules/hiding', { ...rx360, request });
  assert.equal(calls.length, 2, 'token exchange then the read');
  assert.equal(calls[0].method, 'POST');
  assert.match(calls[0].headers.Authorization, /^Basic /);
  assert.equal(calls[0].body, 'grant_type=client_credentials');
  assert.equal(calls[1].headers.Authorization, 'Bearer tok-1');

  await extrahopGet('/detections/rules/hiding', { ...rx360, request });
  assert.equal(calls.length, 3, 'second read reuses the cached token');
  assert.equal(calls[2].headers.Authorization, 'Bearer tok-1');
});

test('an expired cached token is re-fetched rather than reused', async () => {
  clearTokenCache();
  let issued = 0;
  const { calls, request } = recorder((opts) => (
    opts.url.endsWith('/oauth2/token')
      // expires_in of 30s is inside the 60s refresh margin, so it is never reused.
      ? { text: JSON.stringify({ access_token: `tok-${++issued}`, expires_in: 30 }) }
      : { text: '[]' }
  ));
  await extrahopGet('/detections/rules/hiding', { ...rx360, request });
  await extrahopGet('/detections/rules/hiding', { ...rx360, request });
  assert.equal(issued, 2, 'a near-expiry token is replaced');
  assert.equal(calls.at(-1).headers.Authorization, 'Bearer tok-2');
});

test('a failed token exchange never echoes the credential back', async () => {
  clearTokenCache();
  const { request } = recorder((opts) => (
    opts.url.endsWith('/oauth2/token')
      // A hostile or careless token endpoint repeating the secret must not reach
      // the agent, the transcript, or a log line.
      ? { status: 401, text: JSON.stringify({ error: 'bad client_secret SUPER-SECRET-SECRET' }) }
      : { text: '[]' }
  ));
  await assert.rejects(
    () => extrahopGet('/detections/rules/hiding', { ...rx360, request }),
    (err) => {
      assert.match(err.message, /token request failed \(HTTP 401\)/);
      assert.doesNotMatch(err.message, /SUPER-SECRET-SECRET/, 'the secret must not appear in the error');
      return true;
    },
  );
});

test('HTTP failures map to messages the analyst can act on', async () => {
  for (const [status, pattern] of [[401, /refused the request/], [403, /refused the request/], [404, /no such resource/], [500, /HTTP 500/]]) {
    const { request } = recorder({ status, text: '' });
    await assert.rejects(() => extrahopGet('/detections/rules/hiding', { ...selfManaged, request }), pattern);
  }
});

test('a non-JSON body is reported rather than returned as garbage', async () => {
  const { request } = recorder({ text: '<html>gateway</html>' });
  await assert.rejects(() => extrahopGet('/x', { ...selfManaged, request }), /non-JSON body/);
});

test('an empty body reads as null, not a parse error', async () => {
  const { request } = recorder({ status: 204, text: '' });
  assert.equal(await extrahopGet('/x', { ...selfManaged, request }), null);
});

test('a path must be rooted, so a caller cannot escape the API base', async () => {
  const { request } = recorder({ text: '[]' });
  await assert.rejects(
    () => extrahopGet('https://evil.example/steal', { ...selfManaged, request }),
    /must start with "\/"/,
  );
});
