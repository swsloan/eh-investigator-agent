// Auth gate for browser/API/SSE surfaces (#24). Run: node --test lib/auth.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveAuthConfig, startupAuthError, createAuthState,
  authGuard, authPublicRouter, parseCookies,
} from './auth.js';
import { withServer } from './http-test-harness.js';

// --- config resolution ---------------------------------------------------------

test('resolveAuthConfig: local loopback with no token => disabled, not required', () => {
  const c = resolveAuthConfig({ env: {}, listenHost: '127.0.0.1' });
  assert.equal(c.enabled, false);
  assert.equal(c.required, false);
  assert.equal(startupAuthError(c), null, 'the loopback alpha starts fine unauthenticated');
});

test('resolveAuthConfig: a wildcard bind (0.0.0.0) is NOT treated as exposure', () => {
  // Docker binds 0.0.0.0 inside the container but publishes only on host loopback.
  const c = resolveAuthConfig({ env: { HOST: '0.0.0.0' }, listenHost: '0.0.0.0' });
  assert.equal(c.required, false);
  assert.equal(startupAuthError(c), null);
});

test('resolveAuthConfig: hardened profile requires a token (fail closed)', () => {
  const missing = resolveAuthConfig({ env: { EH_DEPLOYMENT_PROFILE: 'hardened' }, listenHost: '0.0.0.0' });
  assert.equal(missing.required, true);
  assert.match(startupAuthError(missing), /Refusing to start/);

  const ok = resolveAuthConfig({ env: { EH_DEPLOYMENT_PROFILE: 'hardened', EH_AUTH_TOKEN: 'x'.repeat(40) }, listenHost: '0.0.0.0' });
  assert.equal(ok.enabled, true);
  assert.equal(startupAuthError(ok), null);
});

test('resolveAuthConfig: a concrete non-loopback bind requires a token', () => {
  const c = resolveAuthConfig({ env: {}, listenHost: '192.168.1.10' });
  assert.equal(c.required, true);
  assert.match(c.reason, /non-loopback/);
  assert.match(startupAuthError(c), /192\.168\.1\.10/);
});

test('resolveAuthConfig: a short token is rejected at startup', () => {
  const c = resolveAuthConfig({ env: { EH_AUTH_TOKEN: 'short' }, listenHost: '127.0.0.1' });
  assert.equal(c.enabled, true);
  assert.match(startupAuthError(c), /too short/);
});

test('EH_REQUIRE_AUTH=1 forces the requirement even on loopback', () => {
  const c = resolveAuthConfig({ env: { EH_REQUIRE_AUTH: '1' }, listenHost: '127.0.0.1' });
  assert.equal(c.required, true);
  assert.match(startupAuthError(c), /EH_REQUIRE_AUTH/);
});

// --- session store -------------------------------------------------------------

test('createAuthState: issue only for the right token; sessions expire', () => {
  let clock = 1000;
  const state = createAuthState({ enabled: true, token: 'secret-token-value' }, { now: () => clock });
  assert.equal(state.issue('wrong'), null);
  const id = state.issue('secret-token-value');
  assert.ok(id && id.length >= 32);
  assert.ok(state.verify({ headers: { cookie: `eh_session=${id}` } }));
  clock += 13 * 60 * 60 * 1000; // past the 12h TTL
  assert.equal(state.verify({ headers: { cookie: `eh_session=${id}` } }), false, 'expired cookie rejected');
  assert.equal(state.sessionCount(), 0, 'expired session swept');
});

test('parseCookies handles multiple pairs and whitespace', () => {
  assert.deepEqual(parseCookies('a=1; eh_session=xyz; b=2'), { a: '1', eh_session: 'xyz', b: '2' });
  assert.deepEqual(parseCookies(''), {});
});

// --- guard behavior over HTTP --------------------------------------------------

const TOKEN = 'a-strong-token-of-sufficient-length-01';

function mountGuarded(env) {
  const config = resolveAuthConfig({ env, listenHost: '127.0.0.1' });
  const state = createAuthState(config);
  return (app) => {
    app.use(authPublicRouter(state));
    app.use(authGuard(state));
    app.get('/api/thing', (_req, res) => res.json({ ok: true }));
    app.get('/', (_req, res) => res.type('html').send('<!doctype html>app'));
  };
}

test('disabled auth is a pass-through (current alpha unchanged)', async () => {
  await withServer(mountGuarded({}), async (base) => {
    assert.equal((await fetch(`${base}/api/thing`)).status, 200);
  });
});

test('enabled auth: API without a credential is 401; with the Bearer token is 200', async () => {
  await withServer(mountGuarded({ EH_AUTH_TOKEN: TOKEN, EH_REQUIRE_AUTH: '1' }), async (base) => {
    assert.equal((await fetch(`${base}/api/thing`)).status, 401);
    const ok = await fetch(`${base}/api/thing`, { headers: { authorization: `Bearer ${TOKEN}` } });
    assert.equal(ok.status, 200);
    const bad = await fetch(`${base}/api/thing`, { headers: { authorization: 'Bearer nope' } });
    assert.equal(bad.status, 401);
  });
});

test('enabled auth: an unauthenticated HTML navigation is redirected to /login', async () => {
  await withServer(mountGuarded({ EH_AUTH_TOKEN: TOKEN, EH_REQUIRE_AUTH: '1' }), async (base) => {
    const res = await fetch(`${base}/`, { headers: { accept: 'text/html' }, redirect: 'manual' });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/login');
  });
});

test('enabled auth: the login page and token exchange are public and mint a cookie', async () => {
  await withServer(mountGuarded({ EH_AUTH_TOKEN: TOKEN, EH_REQUIRE_AUTH: '1' }), async (base) => {
    assert.equal((await fetch(`${base}/login`)).status, 200);

    // Wrong token re-renders the login form (401), no cookie.
    const bad = await fetch(`${base}/auth/session`, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'token=wrong', redirect: 'manual',
    });
    assert.equal(bad.status, 401);
    assert.equal(bad.headers.get('set-cookie'), null);

    // Correct token sets an httpOnly session cookie and redirects home.
    const good = await fetch(`${base}/auth/session`, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: `token=${encodeURIComponent(TOKEN)}`, redirect: 'manual',
    });
    assert.equal(good.status, 303);
    const cookie = good.headers.get('set-cookie');
    assert.match(cookie, /eh_session=/);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);

    // That cookie then authenticates an API call (the SSE/browser path).
    const sid = /eh_session=([^;]+)/.exec(cookie)[1];
    const authed = await fetch(`${base}/api/thing`, { headers: { cookie: `eh_session=${sid}` } });
    assert.equal(authed.status, 200);
  });
});
