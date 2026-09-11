// Run: node --test lib/falcon-env.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { renderFalconRuntimeEnv, writeFalconRuntimeEnv } from './falcon-env.js';

test('renders only the values that are present', () => {
  const out = renderFalconRuntimeEnv({
    clientId: 'abc123', clientSecret: 'sh-secret_value', baseUrl: 'https://api.us-2.crowdstrike.com',
  });
  assert.match(out, /^FALCON_CLIENT_ID=abc123$/m);
  assert.match(out, /^FALCON_CLIENT_SECRET=sh-secret_value$/m);
  assert.match(out, /^FALCON_BASE_URL=https:\/\/api\.us-2\.crowdstrike\.com$/m);

  // A half-configured store must not emit empty assignments — FALCON_CLIENT_ID=
  // would override the compose-level fallback with nothing.
  const partial = renderFalconRuntimeEnv({ clientId: 'abc123' });
  assert.match(partial, /^FALCON_CLIENT_ID=abc123$/m);
  assert.doesNotMatch(partial, /FALCON_CLIENT_SECRET/);
  assert.doesNotMatch(partial, /FALCON_BASE_URL/);
  assert.equal(renderFalconRuntimeEnv({}).includes('FALCON_'), false);
});

test('a value that could break out of KEY=value is dropped, not escaped', () => {
  // An env file is parsed line-wise, so a newline in a secret would inject a
  // second assignment. A credential of that shape is malformed, not awkward.
  for (const bad of [
    'abc\nFALCON_BASE_URL=https://evil.example',
    'abc"quote',
    'abc with space',
    "abc'quote",
    'abc\\backslash',
    'abc$(whoami)',
    'abc`id`',
  ]) {
    const out = renderFalconRuntimeEnv({ clientId: bad, clientSecret: 'ok-secret' });
    assert.doesNotMatch(out, /FALCON_CLIENT_ID/, `"${bad}" must be dropped`);
    assert.match(out, /^FALCON_CLIENT_SECRET=ok-secret$/m, 'the good value still renders');
    assert.equal(out.split('\n').filter((l) => l.startsWith('FALCON_')).length, 1);
  }
});

test('the file is written 0600, including when it already exists', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'falconenv-'));
  const file = path.join(dir, 'nested', 'falcon.env');
  assert.equal(writeFalconRuntimeEnv({ clientId: 'a', clientSecret: 'b' }, file), true);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600, 'created 0600');

  // writeFileSync only applies mode on create, so a pre-existing looser file
  // would otherwise keep its permissions — this holds a live API secret.
  fs.chmodSync(file, 0o644);
  writeFalconRuntimeEnv({ clientId: 'c', clientSecret: 'd' }, file);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600, 're-tightened on rewrite');
  assert.match(fs.readFileSync(file, 'utf8'), /FALCON_CLIENT_ID=c/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a write failure is survivable, not fatal', () => {
  // Best-effort by design: the app must boot even if the runtime dir is not
  // writable. The visible consequence is a sidecar that cannot authenticate.
  assert.equal(writeFalconRuntimeEnv({ clientId: 'a' }, '/proc/definitely/not/writable/falcon.env'), false);
});
