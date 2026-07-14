// Web-research fetch SSRF guards. Run: node --test lib/research/fetch.test.js
// No real network: DNS lookup and the HTTP transport are injected.
import test from 'node:test';
import assert from 'node:assert/strict';
import { isPublicAddress, validateResearchUrl, fetchReadable, extractReadableContent } from './fetch.js';

test('isPublicAddress accepts public unicast, rejects private/loopback/link-local', () => {
  assert.equal(isPublicAddress('8.8.8.8'), true);
  assert.equal(isPublicAddress('1.1.1.1'), true);
  assert.equal(isPublicAddress('10.0.0.5'), false);
  assert.equal(isPublicAddress('192.168.1.1'), false);
  assert.equal(isPublicAddress('127.0.0.1'), false);
  assert.equal(isPublicAddress('169.254.169.254'), false); // cloud metadata
  assert.equal(isPublicAddress('::1'), false);
});

test('validateResearchUrl rejects non-public and malformed destinations', () => {
  for (const bad of [
    'ftp://example.com/x',
    'http://user:pass@example.com/',
    'https://example.com:8443/',
    'https://localhost/',
    'https://foo.internal/',
    'https://box.local/',
    'https://10.0.0.5/',
    'https://[::1]/',
    'not-a-url',
  ]) {
    assert.throws(() => validateResearchUrl(bad), new RegExp('Research fetch'), `should reject ${bad}`);
  }
  // A plain public HTTPS URL is accepted.
  assert.equal(validateResearchUrl('https://example.com/advisory').hostname, 'example.com');
});

test('fetchReadable refuses a hostname that resolves to a private address (DNS-rebind guard)', async () => {
  const lookup = async () => [{ address: '10.1.2.3', family: 4 }];
  await assert.rejects(
    fetchReadable('https://evil.example.com/', { lookup, requestFn: async () => ({ status: 200, headers: {}, body: '' }) }),
    /non-public address/,
  );
});

test('fetchReadable pins the resolved IP and extracts readable text', async () => {
  const lookup = async () => [{ address: '93.184.216.34', family: 4 }];
  const requestFn = async () => ({
    status: 200,
    headers: { 'content-type': 'text/html' },
    body: '<html><head><title>Advisory</title></head><body><article><h1>CVE</h1><p>Patch now.</p></article></body></html>',
  });
  const out = await fetchReadable('https://example.com/a', { lookup, requestFn });
  assert.equal(out.title, 'Advisory');
  assert.match(out.text, /Patch now\./);
  assert.equal(out.untrusted, true, 'result is flagged untrusted');
});

test('fetchReadable re-validates redirect targets (no redirect to internal)', async () => {
  const lookup = async () => [{ address: '93.184.216.34', family: 4 }];
  const requestFn = async () => ({ status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' }, body: '' });
  await assert.rejects(
    fetchReadable('https://example.com/a', { lookup, requestFn }),
    /Research fetch/,
  );
});

test('extractReadableContent strips scripts and keeps text', () => {
  const { text } = extractReadableContent('<html><body><script>steal()</script><p>Hello</p></body></html>', 'text/html');
  assert.match(text, /Hello/);
  assert.doesNotMatch(text, /steal/);
});
