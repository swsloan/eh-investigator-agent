// Audit-seal signing keys (issue #30, Slice B).
//
// An Ed25519 keypair signs the audit-trail session seal. The PRIVATE key lives
// only in the secret store (never exposed to the agent worker); the PUBLIC key is
// embedded in each seal so an exported trail verifies offline with no external key
// file. The keyId is derived from the public key (sha256 of its DER), so it needs
// no separate storage and always matches its key. Rotation just mints a new key —
// old seals keep their own embedded public key and still verify. The trust root
// against a host that HOLDS the private key is the external anchor (Slice C), not
// this module.

import crypto from 'node:crypto';

const SECRET_FIELD = 'auditSigningKey';

/** Stable short id for a public key: first 16 hex of sha256(DER). */
export function keyIdFor(publicKeyPem) {
  const der = crypto.createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' });
  return crypto.createHash('sha256').update(der).digest('hex').slice(0, 16);
}

function signerFromPrivatePem(privateKeyPem) {
  const privateKey = crypto.createPrivateKey(privateKeyPem);
  const publicKeyPem = crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'pem' });
  const keyId = keyIdFor(publicKeyPem);
  return {
    keyId,
    publicKeyPem,
    // Ed25519: algorithm is null (the key type fixes it). Sign/verify over bytes.
    sign: (data) => crypto.sign(null, Buffer.from(data), privateKey).toString('base64'),
  };
}

/**
 * Return the current signer, generating and persisting a keypair on first use.
 * `secretStore` is the app secret store (get/update). Never returns the private
 * key to callers — only { keyId, publicKeyPem, sign }.
 */
export function getOrCreateSigner(secretStore) {
  const existing = secretStore.get?.()?.[SECRET_FIELD];
  if (existing) return signerFromPrivatePem(existing);
  const { privateKey } = crypto.generateKeyPairSync('ed25519');
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  secretStore.update?.({ [SECRET_FIELD]: pem }, { persist: true });
  return signerFromPrivatePem(pem);
}

/**
 * Rotate: mint a fresh keypair and persist it as the new current key. Old seals
 * embed their own (old) public key, so they keep verifying — no historical
 * registry is needed. Returns the new signer.
 */
export function rotateSigningKey(secretStore) {
  const { privateKey } = crypto.generateKeyPairSync('ed25519');
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  secretStore.update?.({ [SECRET_FIELD]: pem }, { persist: true });
  return signerFromPrivatePem(pem);
}

/** Verify an Ed25519 signature (base64) over `data` against a public key PEM.
 * Pure and dependency-free so the offline verifier can call it. */
export function verifySignature(data, sigB64, publicKeyPem) {
  try {
    return crypto.verify(null, Buffer.from(data), crypto.createPublicKey(publicKeyPem), Buffer.from(sigB64, 'base64'));
  } catch {
    return false;
  }
}
