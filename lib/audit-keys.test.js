// Audit signing-key management (#30 Slice B). Run: node --test lib/audit-keys.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { getOrCreateSigner, rotateSigningKey, keyIdFor, verifySignature } from './audit-keys.js';

// A minimal in-memory secret store matching the get/update surface used here.
function mockStore() {
  let secrets = {};
  return {
    get: () => ({ ...secrets }),
    update: (patch) => { secrets = { ...secrets, ...patch }; },
    _raw: () => secrets,
  };
}

test('getOrCreateSigner generates once, persists, and is stable', () => {
  const store = mockStore();
  const a = getOrCreateSigner(store);
  assert.match(a.keyId, /^[0-9a-f]{16}$/);
  assert.match(a.publicKeyPem, /BEGIN PUBLIC KEY/);
  assert.ok(store._raw().auditSigningKey, 'private key persisted to the store');
  assert.match(store._raw().auditSigningKey, /BEGIN PRIVATE KEY/);
  // Second call reuses the same key (no regeneration).
  const b = getOrCreateSigner(store);
  assert.equal(b.keyId, a.keyId);
  assert.equal(b.publicKeyPem, a.publicKeyPem);
});

test('keyId is derived from the public key', () => {
  const store = mockStore();
  const s = getOrCreateSigner(store);
  assert.equal(keyIdFor(s.publicKeyPem), s.keyId);
});

test('sign/verify round-trips; a wrong key fails', () => {
  const s = getOrCreateSigner(mockStore());
  const other = getOrCreateSigner(mockStore());
  const sig = s.sign('chain-head-abc');
  assert.equal(verifySignature('chain-head-abc', sig, s.publicKeyPem), true);
  assert.equal(verifySignature('chain-head-abc', sig, other.publicKeyPem), false, 'wrong key');
  assert.equal(verifySignature('tampered', sig, s.publicKeyPem), false, 'wrong data');
});

test('rotate mints a new key; old public key still verifies its old signatures', () => {
  const store = mockStore();
  const oldSigner = getOrCreateSigner(store);
  const oldSig = oldSigner.sign('head-1');
  const newSigner = rotateSigningKey(store);
  assert.notEqual(newSigner.keyId, oldSigner.keyId, 'a fresh key');
  assert.equal(getOrCreateSigner(store).keyId, newSigner.keyId, 'store now holds the new key');
  // The old signature still verifies against the old (embedded) public key.
  assert.equal(verifySignature('head-1', oldSig, oldSigner.publicKeyPem), true);
});
