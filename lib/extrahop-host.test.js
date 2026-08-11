// Shared ExtraHop host validation. Run: node --test lib/extrahop-host.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { assertPlainHost, isPlainHost } from './extrahop-host.js';
import { buildExcliEnv, credentialsConfigured } from './settings.js';

// Confirmed against the excli binary (#134): with a userinfo host it dials the
// address after the "@" and begins TLS there, so these are exfiltration shapes,
// not cosmetic ones.
const REJECT = [
  'trusted.example@evil.example',  // credential goes to evil.example
  'user:pass@eda.lab',
  'https://eda.lab',               // host becomes literally "https"
  'eda.lab/api/v1',                // path injection
  'eda.lab?x=1',                   // API path folds into a query
  'eda.lab#frag',                  // ...and into a fragment
  'eda.lab evil.example',          // whitespace
  'eda.lab:not-a-port',
  '',
  '   ',
];
const ACCEPT = ['eda.lab', 'eda.acmelegal.lab', 'EDA.Acmelegal.LAB', '10.0.0.5', 'eda.lab:8443', '[2001:db8::1]', '[2001:db8::1]:8443'];

test('a URL-shaped host is refused; a real host is not', () => {
  for (const h of REJECT) {
    assert.equal(isPlainHost(h), false, `${JSON.stringify(h)} must be refused`);
    assert.throws(() => assertPlainHost(h), /hostname or IP address/, JSON.stringify(h));
  }
  for (const h of ACCEPT) assert.equal(isPlainHost(h), true, h);
});

test('the thrown error carries the code the settings route turns into a 400', () => {
  try {
    assertPlainHost('trusted.example@evil.example');
    assert.fail('should have thrown');
  } catch (err) {
    assert.equal(err.code, 'INVALID_EXTRAHOP_HOST');
    assert.doesNotMatch(err.message, /apikey|secret/i);
  }
});

test('buildExcliEnv withholds host AND credential when the stored host is invalid', () => {
  // A config saved before this validation existed could still hold a URL-shaped
  // host. Passing it through would mail the API key to whatever follows the "@",
  // so the env must carry neither.
  const env = buildExcliEnv(
    { extrahop: { host: 'trusted.example@evil.example' } },
    { get: () => ({ apiKey: 'SUPER-SECRET-KEY' }) },
    {},
  );
  assert.equal(env.EXTRAHOP_HOST, undefined, 'no host');
  assert.equal(env.EXTRAHOP_API_KEY, undefined, 'and crucially no credential');
  for (const v of Object.values(env)) assert.notEqual(v, 'SUPER-SECRET-KEY');
});

test('buildExcliEnv still passes a legitimate host and credential', () => {
  const env = buildExcliEnv(
    { extrahop: { host: 'eda.acmelegal.lab', insecure: true } },
    { get: () => ({ apiKey: 'K' }) },
    {},
  );
  assert.equal(env.EXTRAHOP_HOST, 'eda.acmelegal.lab');
  assert.equal(env.EXTRAHOP_API_KEY, 'K');
  assert.equal(env.EXTRAHOP_INSECURE, 'true');
});

test('an invalid host does not count as configured', () => {
  const store = { get: () => ({ apiKey: 'K' }) };
  assert.equal(credentialsConfigured({ extrahop: { host: 'eda.lab' } }, store), true);
  assert.equal(credentialsConfigured({ extrahop: { host: 'trusted.example@evil.example' } }, store), false);
});
