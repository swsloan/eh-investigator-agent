// Authentication for the browser / API / SSE surfaces (Phase 4, issue #24, slice 1).
//
// The app historically had NO authentication — its security model was "bind to
// loopback only." That is fine for the local alpha but unsafe the moment the
// service is published beyond loopback (the hardened profile's intent). This adds
// a shared-bearer-token gate plus a fail-closed rule so non-loopback exposure can
// never run unauthenticated.
//
// Two credential forms, one secret:
//   - `Authorization: Bearer <token>` — for API/CLI clients (curl, evals).
//   - an httpOnly session cookie — for the browser, because EventSource (SSE)
//     cannot set Authorization headers, so the browser must authenticate with a
//     cookie that rides along automatically. The cookie is minted by POSTing the
//     token to /auth/session (a plain HTML form, so it works under the app's
//     strict CSP with no inline script).
//
// Fail-closed: auth is REQUIRED (the process refuses to start without a token)
// when the deployment profile is `hardened` or HOST is a concrete non-loopback
// address. A wildcard bind (0.0.0.0/::) is NOT treated as exposure on its own —
// the default Docker compose binds 0.0.0.0 inside the container but publishes the
// port only on the host loopback, so requiring a token there would break the
// alpha with no security benefit. Non-loopback publishing is the hardened
// profile, which supplies the token.

import crypto from 'node:crypto';
import express from 'express';
import { isLoopbackHostname } from './local-origin.js';

const COOKIE_NAME = 'eh_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12h; a restart drops sessions (re-login)
const MIN_TOKEN_LEN = 16;

/**
 * Resolve the auth posture from the environment and the bind host. Pure.
 *   - `token`    the shared secret (trimmed EH_AUTH_TOKEN), '' when unset.
 *   - `enabled`  whether the guard enforces anything (a token is configured).
 *   - `required` whether a token MUST be present (fail-closed) given the exposure.
 *   - `reason`   why it is required (for the startup error), or ''.
 */
export function resolveAuthConfig({ env = process.env, listenHost = '' } = {}) {
  const token = String(env.EH_AUTH_TOKEN || '').trim();
  const hardened = String(env.EH_DEPLOYMENT_PROFILE || 'local').trim() === 'hardened';
  const explicit = String(env.EH_REQUIRE_AUTH || '') === '1';

  const host = String(listenHost || env.HOST || '').trim().toLowerCase();
  const wildcard = host === '' || host === '0.0.0.0' || host === '::' || host === '[::]';
  // A concrete, routable bind (not wildcard, not loopback) is real exposure even
  // without Docker port mapping — e.g. a bare-metal run bound to a LAN address.
  const concreteNonLoopback = !wildcard && !isLoopbackHostname(host);

  let reason = '';
  if (hardened) reason = 'the hardened deployment profile is active';
  else if (concreteNonLoopback) reason = `the app is bound to a non-loopback address (${host})`;
  else if (explicit) reason = 'EH_REQUIRE_AUTH=1 is set';

  return {
    token,
    enabled: Boolean(token),
    required: Boolean(reason),
    reason,
    tokenTooShort: Boolean(token) && token.length < MIN_TOKEN_LEN,
  };
}

/**
 * The message to fail startup with, or null when the configuration is safe to run.
 * Called before the server listens so a misconfigured exposure never serves.
 */
export function startupAuthError(config) {
  if (config.required && !config.token) {
    return `Refusing to start: ${config.reason}, but no EH_AUTH_TOKEN is set. `
      + 'Set a strong EH_AUTH_TOKEN (>= 16 chars) so the exposed surface requires authentication, '
      + 'or run the default local (loopback-only) profile.';
  }
  if (config.token && config.tokenTooShort) {
    return `Refusing to start: EH_AUTH_TOKEN is too short (< ${MIN_TOKEN_LEN} characters). Use a strong secret.`;
  }
  return null;
}

/** Constant-time string equality that never short-circuits on length. */
function safeEqual(a, b) {
  const ab = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  if (ab.length !== bb.length) {
    // Still do a comparison to keep timing uniform, then fail.
    crypto.timingSafeEqual(ab, ab);
    return false;
  }
  return crypto.timingSafeEqual(ab, bb);
}

/** Parse a Cookie header into a plain object (no dependency). */
export function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of String(header).split(';')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    const k = part.slice(0, i).trim();
    if (k) out[k] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/**
 * Auth state: the token plus the live set of issued browser sessions. In-memory
 * and single-process, matching the app's session model; a restart invalidates
 * cookies (operators re-login), which is an acceptable, fail-safe default.
 */
export function createAuthState(config, { now = () => Date.now() } = {}) {
  const sessions = new Map(); // sessionId -> expiresAt

  function sweep() {
    const t = now();
    for (const [id, exp] of sessions) if (exp <= t) sessions.delete(id);
  }

  return {
    config,
    get enabled() { return config.enabled; },

    /** Verify a request carries a valid credential (Bearer header or cookie). */
    verify(req) {
      if (!config.enabled) return true;
      const auth = req.get?.('authorization') || req.headers?.authorization || '';
      const m = /^Bearer\s+(.+)$/i.exec(auth);
      if (m && safeEqual(m[1].trim(), config.token)) return true;
      const cookies = parseCookies(req.get?.('cookie') || req.headers?.cookie || '');
      const id = cookies[COOKIE_NAME];
      if (id && sessions.has(id)) {
        sweep();
        return sessions.has(id);
      }
      return false;
    },

    /** Exchange the shared token for a browser session id (or null if wrong). */
    issue(token) {
      if (!safeEqual(token, config.token)) return null;
      const id = crypto.randomBytes(32).toString('hex');
      sessions.set(id, now() + SESSION_TTL_MS);
      return id;
    },

    revoke(id) { if (id) sessions.delete(id); },
    sessionCount() { sweep(); return sessions.size; },
  };
}

const COOKIE_KEY = COOKIE_NAME;

function setSessionCookie(req, res, id) {
  const secure = req.secure || String(req.get('x-forwarded-proto') || '').toLowerCase() === 'https';
  const attrs = [
    `${COOKIE_KEY}=${id}`,
    'HttpOnly',
    'SameSite=Strict',
    'Path=/',
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ];
  if (secure) attrs.push('Secure');
  res.setHeader('Set-Cookie', attrs.join('; '));
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_KEY}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
}

// Minimal, CSP-safe login page: a plain form that POSTs the token. No inline
// script (script-src 'self'), no external assets, styled with an inline <style>
// (style-src allows 'unsafe-inline').
function loginPage({ error = false } = {}) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign in — ExtraHop Investigation Agent</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 15px/1.5 system-ui, sans-serif; margin: 0; min-height: 100vh;
    display: grid; place-items: center; background: Canvas; color: CanvasText; }
  form { width: min(90vw, 340px); padding: 28px; border: 1px solid rgba(128,128,128,.35);
    border-radius: 12px; }
  h1 { font-size: 16px; margin: 0 0 4px; }
  p { margin: 0 0 18px; color: rgba(128,128,128,1); font-size: 13px; }
  label { display: block; font-size: 12px; font-weight: 600; margin-bottom: 6px; }
  input { width: 100%; box-sizing: border-box; padding: 9px 11px; font: inherit;
    border: 1px solid rgba(128,128,128,.5); border-radius: 8px; background: Field; color: FieldText; }
  button { width: 100%; margin-top: 14px; padding: 9px; font: inherit; font-weight: 600;
    border: 0; border-radius: 8px; background: #4b48c4; color: #fff; cursor: pointer; }
  .err { color: #d94c12; font-size: 13px; margin-bottom: 12px; ${error ? '' : 'display:none;'} }
</style></head><body>
<form method="POST" action="/auth/session" autocomplete="off">
  <h1>ExtraHop Investigation Agent</h1>
  <p>This deployment requires a token to continue.</p>
  <div class="err">That token was not accepted. Try again.</div>
  <label for="token">Access token</label>
  <input id="token" name="token" type="password" autofocus required>
  <button type="submit">Sign in</button>
</form></body></html>`;
}

/**
 * Public (unauthenticated) auth endpoints. Mounted BEFORE the guard so the login
 * page and token exchange are always reachable:
 *   GET  /login          — the login form
 *   POST /auth/session    — exchange token -> session cookie, redirect to /
 *   POST /auth/logout     — revoke the session, redirect to /login
 */
export function authPublicRouter(authState) {
  const router = express.Router();
  router.use(express.urlencoded({ extended: false, limit: '4kb' }));

  router.get('/login', (req, res) => {
    if (!authState.enabled) return res.redirect(302, '/');
    if (authState.verify(req)) return res.redirect(302, '/');
    return res.status(200).type('html').send(loginPage());
  });

  router.post('/auth/session', (req, res) => {
    if (!authState.enabled) return res.redirect(302, '/');
    const id = authState.issue(String(req.body?.token || ''));
    if (!id) return res.status(401).type('html').send(loginPage({ error: true }));
    setSessionCookie(req, res, id);
    return res.redirect(303, '/');
  });

  router.post('/auth/logout', (req, res) => {
    const cookies = parseCookies(req.get('cookie') || '');
    authState.revoke(cookies[COOKIE_KEY]);
    clearSessionCookie(res);
    return res.redirect(303, '/login');
  });

  return router;
}

// Paths that must stay reachable without a credential (so login can happen).
const PUBLIC_PATHS = new Set(['/login', '/auth/session', '/auth/logout']);

function wantsHtml(req) {
  return req.method === 'GET' && String(req.get('accept') || '').includes('text/html');
}

/**
 * The guard. When auth is disabled (local alpha, no token) it is a pass-through,
 * so nothing about the current deployment changes. When enabled, every request
 * outside the public allowlist needs a valid Bearer token or session cookie;
 * unauthenticated browser navigations are redirected to /login, everything else
 * gets a 401.
 */
export function authGuard(authState) {
  return function guard(req, res, next) {
    if (!authState.enabled) return next();
    if (PUBLIC_PATHS.has(req.path)) return next();
    if (authState.verify(req)) return next();
    if (wantsHtml(req)) return res.redirect(302, '/login');
    return res.status(401).json({ error: 'Authentication required.' });
  };
}
