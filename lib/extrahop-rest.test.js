// ExtraHop REST client. Run: node --test lib/extrahop-rest.test.js
// No network: every test injects `request`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { clearTokenCache, extrahopGet, httpsRequest, resolveRestTarget } from './extrahop-rest.js';

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

test('concurrent reads share one token exchange', async () => {
  clearTokenCache();
  let exchanges = 0;
  const request = async (opts) => {
    if (opts.url.endsWith('/oauth2/token')) {
      exchanges += 1;
      await new Promise((r) => setTimeout(r, 20)); // in flight while others arrive
      return { status: 200, headers: {}, text: JSON.stringify({ access_token: 'tok', expires_in: 3600 }) };
    }
    return { status: 200, headers: {}, text: '[]' };
  };
  await Promise.all(Array.from({ length: 5 }, () => extrahopGet('/detections/rules/hiding', { ...rx360, request })));
  assert.equal(exchanges, 1, 'five concurrent reads must not buy five tokens');
});

test('a failed exchange is not cached, so the next call retries', async () => {
  clearTokenCache();
  let attempts = 0;
  const request = async (opts) => {
    if (opts.url.endsWith('/oauth2/token')) {
      attempts += 1;
      return attempts === 1
        ? { status: 500, headers: {}, text: '' }
        : { status: 200, headers: {}, text: JSON.stringify({ access_token: 'tok', expires_in: 3600 }) };
    }
    return { status: 200, headers: {}, text: '[]' };
  };
  await assert.rejects(() => extrahopGet('/x', { ...rx360, request }));
  await extrahopGet('/x', { ...rx360, request });
  assert.equal(attempts, 2, 'the in-flight entry must be dropped on failure');
});

test('OAuth credentials are form-encoded before Base64 (RFC 6749 §2.3.1)', async () => {
  clearTokenCache();
  const tricky = {
    cfg: { extrahop: { host: 'abc123', family: 'rx360' } },
    secretStore: { get: () => ({ clientId: 'id:with:colons', clientSecret: 'se&cret:with?specials' }) },
  };
  let basic = null;
  const request = async (opts) => {
    if (opts.url.endsWith('/oauth2/token')) {
      basic = opts.headers.Authorization.replace(/^Basic /, '');
      return { status: 200, headers: {}, text: JSON.stringify({ access_token: 't', expires_in: 3600 }) };
    }
    return { status: 200, headers: {}, text: '[]' };
  };
  await extrahopGet('/x', { ...tricky, request });
  const decoded = Buffer.from(basic, 'base64').toString('utf8');
  // Exactly one ":" may separate the two halves, or the server splits in the
  // wrong place and authenticates as a different client.
  assert.equal(decoded.split(':').length, 2, `ambiguous credential: ${decoded}`);
  assert.equal(decoded, `${encodeURIComponent('id:with:colons')}:${encodeURIComponent('se&cret:with?specials')}`);
});

test('the caller timeout bounds its wait, not the shared token transport', async () => {
  // A caller's deadline must bound the whole operation, but it must NOT be handed
  // to the shared token exchange — that exchange is reused by other callers, so
  // one caller's deadline cannot be allowed to govern it. The read it owns
  // outright still gets the caller's timeout.
  clearTokenCache();
  const seen = [];
  const request = async (opts) => {
    seen.push({ url: opts.url, timeoutMs: opts.timeoutMs });
    return opts.url.endsWith('/oauth2/token')
      ? { status: 200, headers: {}, text: JSON.stringify({ access_token: 't', expires_in: 3600 }) }
      : { status: 200, headers: {}, text: '[]' };
  };
  await extrahopGet('/x', { ...rx360, request, timeoutMs: 1234 });
  assert.equal(seen.length, 2);
  assert.ok(seen[0].url.endsWith('/oauth2/token'));
  assert.notEqual(seen[0].timeoutMs, 1234, 'the shared exchange must not inherit one caller timeout');
  assert.equal(seen[1].timeoutMs, 1234, 'the read this caller owns does honour it');
  // The caller's deadline still bounds the wait — asserted separately by
  // "a caller's own deadline bounds its wait on a shared exchange".
});

test('an already-aborted signal rejects without an unhandled request error', async () => {
  // Destroying a fresh https.request before its 'error' handler is attached makes
  // Node emit an unhandled 'error' — which would take down the app process, since
  // the brokers run in it. So the signal is checked before the request exists.
  const ac = new AbortController();
  ac.abort();
  const uncaught = [];
  const onUncaught = (e) => uncaught.push(e);
  process.on('uncaughtException', onUncaught);
  try {
    await assert.rejects(
      () => httpsRequest({ url: 'https://127.0.0.1:59999/x', signal: ac.signal }),
      /aborted/,
    );
    await new Promise((r) => setTimeout(r, 100)); // let any async error surface
    assert.deepEqual(uncaught.map((e) => e.message), [], 'must not emit an uncaught exception');
  } finally {
    process.removeListener('uncaughtException', onUncaught);
  }
});

test('one caller aborting does not cancel the shared token exchange for others', async () => {
  clearTokenCache();
  let exchanges = 0;
  const request = async (opts) => {
    if (opts.url.endsWith('/oauth2/token')) {
      exchanges += 1;
      await new Promise((res, rej) => {
        const t = setTimeout(res, 150);
        opts.signal?.addEventListener('abort', () => { clearTimeout(t); rej(new Error('aborted')); }, { once: true });
      });
      return { status: 200, headers: {}, text: JSON.stringify({ access_token: 'tok', expires_in: 3600 }) };
    }
    return { status: 200, headers: {}, text: '[]' };
  };
  const first = new AbortController();
  const second = new AbortController();
  const a = extrahopGet('/x', { ...rx360, request, signal: first.signal });
  await new Promise((r) => setTimeout(r, 20)); // a starts the exchange
  const b = extrahopGet('/x', { ...rx360, request, signal: second.signal });
  await new Promise((r) => setTimeout(r, 20));
  first.abort(); // the initiator walks away

  await assert.rejects(() => a, /aborted/, 'the aborting caller fails');
  await b; // the other caller must still complete
  assert.equal(exchanges, 1, 'and it is still a single shared exchange');
});

test("a caller's own deadline bounds its wait on a shared exchange", async () => {
  clearTokenCache();
  const request = async (opts) => (opts.url.endsWith('/oauth2/token')
    ? new Promise((r) => setTimeout(() => r({ status: 200, headers: {}, text: JSON.stringify({ access_token: 't', expires_in: 3600 }) }), 400))
    : { status: 200, headers: {}, text: '[]' });
  // A short-deadline caller must give up on its own schedule rather than
  // inheriting whatever the first caller asked for.
  await assert.rejects(
    () => extrahopGet('/x', { ...rx360, request, timeoutMs: 60 }),
    /timed out/,
  );
});

test('a host setting that is really a URL is refused before the key is used', async () => {
  // The severe one: userinfo makes the *host* evil.example, so the API key header
  // would be sent there. The others silently relocate or destroy the API path.
  const attacks = [
    'trusted.example@evil.example',   // credential goes to evil.example
    'eda.lab/api/v1',                 // path injection
    'eda.lab?x=1',                    // API path folds into a query string
    'eda.lab#frag',                   // ...and into a fragment
    'https://eda.lab',                // host becomes literally "https"
    'eda.lab evil.example',           // whitespace
    'user:pass@eda.lab',
    '',
  ];
  for (const host of attacks) {
    assert.throws(
      () => resolveRestTarget({ extrahop: { host } }, { get: () => ({ apiKey: 'K' }) }),
      /host/i,
      `"${host}" must be refused`,
    );
  }
  // And nothing legitimate is caught by it.
  for (const host of ['eda.lab', 'eda.acmelegal.lab', '10.0.0.5', 'eda.lab:8443', '[2001:db8::1]', '[2001:db8::1]:8443']) {
    const t = resolveRestTarget({ extrahop: { host } }, { get: () => ({ apiKey: 'K' }) });
    assert.equal(t.baseUrl, `https://${host}/api/v1`, host);
  }
});

test('a refused host never reaches a request at all', async () => {
  let called = false;
  const request = async () => { called = true; return { status: 200, headers: {}, text: '[]' }; };
  await assert.rejects(
    () => extrahopGet('/detections/rules/hiding', {
      cfg: { extrahop: { host: 'trusted.example@evil.example' } },
      secretStore: { get: () => ({ apiKey: 'SUPER-SECRET-KEY' }) },
      request,
    }),
    /host/i,
  );
  assert.equal(called, false, 'no request may be attempted with a credential-redirecting host');
});
