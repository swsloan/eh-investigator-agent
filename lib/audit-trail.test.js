// Audit trail core (#30 Slice A). Run: node --test lib/audit-trail.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AuditTrail, verifyTrail, canonical, hashPayload, GENESIS } from './audit-trail.js';
import { getOrCreateSigner, rotateSigningKey } from './audit-keys.js';

const ws = () => fs.mkdtempSync(path.join(os.tmpdir(), 'audit-'));
function mockStore() {
  let s = {};
  return { get: () => ({ ...s }), update: (p) => { s = { ...s, ...p }; } };
}
const linesOf = (text) => text.split('\n').filter(Boolean).map((l) => JSON.parse(l));

test('canonical is key-order independent and deterministic', () => {
  assert.equal(canonical({ b: 1, a: 2 }), canonical({ a: 2, b: 1 }));
  assert.equal(canonical({ a: [1, { y: 1, x: 2 }] }), '{"a":[1,{"x":2,"y":1}]}');
});

test('append chains entries: prevHash links, seq increments, hash covers payload', () => {
  const workspace = ws();
  const t = new AuditTrail();
  const a = t.append(workspace, { type: 'tool_call', summary: 'search_records' });
  const b = t.append(workspace, { type: 'verdict', outcome: 'malicious' });
  assert.equal(a.prevHash, GENESIS);
  assert.equal(a.seq, 1);
  assert.equal(b.prevHash, a.hash, 'b chains to a');
  assert.equal(b.seq, 2);
  // hash is over the payload (line minus prevHash/hash).
  const { hash, prevHash, ...payload } = a;
  assert.equal(hash, hashPayload(prevHash, payload));
  fs.rmSync(workspace, { recursive: true, force: true });
});

test('the trail persists and the head is recovered by a fresh instance (restart)', () => {
  const workspace = ws();
  const t1 = new AuditTrail();
  t1.append(workspace, { type: 'tool_call', summary: 'one' });
  t1.append(workspace, { type: 'tool_call', summary: 'two' });
  // Simulate a restart: a brand-new instance must continue the same chain.
  const t2 = new AuditTrail();
  const third = t2.append(workspace, { type: 'verdict', outcome: 'benign' });
  assert.equal(third.seq, 3, 'seq continues across restart');
  const v = verifyTrail(t2.read(workspace));
  assert.equal(v.ok, true);
  assert.equal(v.entries, 3);
  fs.rmSync(workspace, { recursive: true, force: true });
});

test('verifyTrail: intact chain is OK', () => {
  const workspace = ws();
  const t = new AuditTrail();
  for (let i = 0; i < 5; i++) t.append(workspace, { type: 'tool_call', summary: `q${i}` });
  assert.deepEqual(verifyTrail(t.read(workspace)).ok, true);
  fs.rmSync(workspace, { recursive: true, force: true });
});

test('verifyTrail detects a MUTATED entry and points at it', () => {
  const workspace = ws();
  const t = new AuditTrail();
  t.append(workspace, { type: 'tool_call', summary: 'a' });
  t.append(workspace, { type: 'tool_call', summary: 'b' });
  t.append(workspace, { type: 'tool_call', summary: 'c' });
  const p = path.join(workspace, 'audit', 'trail.jsonl');
  const rows = linesOf(fs.readFileSync(p, 'utf8'));
  rows[1].summary = 'TAMPERED'; // edit content, keep the old hash
  fs.writeFileSync(p, rows.map((r) => JSON.stringify(r)).join('\n'));
  const v = verifyTrail(fs.readFileSync(p, 'utf8'));
  assert.equal(v.ok, false);
  assert.equal(v.brokenAt, 1);
  assert.match(v.reason, /altered/);
  fs.rmSync(workspace, { recursive: true, force: true });
});

test('verifyTrail detects REORDER and mid-trail DELETE', () => {
  const workspace = ws();
  const t = new AuditTrail();
  for (const s of ['a', 'b', 'c', 'd']) t.append(workspace, { type: 'tool_call', summary: s });
  const p = path.join(workspace, 'audit', 'trail.jsonl');
  const rows = linesOf(fs.readFileSync(p, 'utf8'));

  // reorder: swap entries 1 and 2
  const reordered = [rows[0], rows[2], rows[1], rows[3]];
  assert.equal(verifyTrail(reordered.map((r) => JSON.stringify(r)).join('\n')).ok, false);

  // delete a middle entry
  const deleted = [rows[0], rows[1], rows[3]];
  const v = verifyTrail(deleted.map((r) => JSON.stringify(r)).join('\n'));
  assert.equal(v.ok, false);
  assert.equal(v.brokenAt, 2, 'the break shows at the first entry that no longer chains');
  fs.rmSync(workspace, { recursive: true, force: true });
});

test('REDACTION (negative): a secret in an entry never reaches the stored record or its hash', () => {
  const workspace = ws();
  // A redactor that scrubs a known secret, mirroring the central redactor.
  const SECRET = 'sk-live-abcd1234';
  const redact = (obj) => JSON.parse(JSON.stringify(obj).split(SECRET).join('[redacted]'));
  const t = new AuditTrail({ redact });
  const line = t.append(workspace, { type: 'tool_call', summary: `used key ${SECRET}` });
  const raw = fs.readFileSync(path.join(workspace, 'audit', 'trail.jsonl'), 'utf8');
  assert.ok(!raw.includes(SECRET), 'secret absent from the stored trail');
  assert.ok(!JSON.stringify(line).includes(SECRET), 'secret absent from the returned line');
  // And the hash is over the redacted payload, so verification still holds.
  assert.equal(verifyTrail(raw).ok, true);
  fs.rmSync(workspace, { recursive: true, force: true });
});

test('seal signs the head; verifyTrail confirms authenticity against the embedded key', () => {
  const workspace = ws();
  const t = new AuditTrail();
  const signer = getOrCreateSigner(mockStore());
  t.append(workspace, { type: 'tool_call', summary: 'a' });
  t.append(workspace, { type: 'verdict', outcome: 'malicious' });
  const seal = t.seal(workspace, signer);
  assert.equal(seal.type, 'seal');
  assert.equal(seal.keyId, signer.keyId);

  const v = verifyTrail(t.read(workspace));
  assert.equal(v.ok, true);
  assert.equal(v.sealed, true);
  assert.equal(v.seal.ok, true);
  assert.equal(v.seal.keyId, signer.keyId);
  assert.equal(v.unsealedAfterSeal, 0);
  fs.rmSync(workspace, { recursive: true, force: true });
});

test('sealing an empty trail is a no-op', () => {
  const workspace = ws();
  assert.equal(new AuditTrail().seal(workspace, getOrCreateSigner(mockStore())), null);
  fs.rmSync(workspace, { recursive: true, force: true });
});

test('tampering with a sealed trail is caught (chain break before the seal)', () => {
  const workspace = ws();
  const t = new AuditTrail();
  const signer = getOrCreateSigner(mockStore());
  t.append(workspace, { type: 'tool_call', summary: 'a' });
  t.append(workspace, { type: 'tool_call', summary: 'b' });
  t.seal(workspace, signer);
  const p = path.join(workspace, 'audit', 'trail.jsonl');
  const rows = linesOf(fs.readFileSync(p, 'utf8'));
  rows[0].summary = 'TAMPERED';
  fs.writeFileSync(p, rows.map((r) => JSON.stringify(r)).join('\n'));
  const v = verifyTrail(fs.readFileSync(p, 'utf8'));
  assert.equal(v.ok, false, 'the chain break is detected before the seal is even checked');
  assert.equal(v.brokenAt, 0);
  fs.rmSync(workspace, { recursive: true, force: true });
});

test('a seal re-signed with an unknown key fails the trusted-key check', () => {
  const workspace = ws();
  const t = new AuditTrail();
  t.append(workspace, { type: 'tool_call', summary: 'a' });
  const signer = getOrCreateSigner(mockStore());
  t.seal(workspace, signer);
  const text = t.read(workspace);
  // The embedded signature is valid, so a plain verify passes...
  assert.equal(verifyTrail(text).seal.ok, true);
  // ...but pinning to a trusted key set the attacker's key isn't in fails.
  const v = verifyTrail(text, { trustedKeyIds: ['some-other-key'] });
  assert.equal(v.seal.ok, false);
  assert.match(v.seal.error, /not in the trusted key set/);
  fs.rmSync(workspace, { recursive: true, force: true });
});

test('a forged signature (wrong bytes) fails seal verification', () => {
  const workspace = ws();
  const t = new AuditTrail();
  t.append(workspace, { type: 'tool_call', summary: 'a' });
  t.seal(workspace, getOrCreateSigner(mockStore()));
  const p = path.join(workspace, 'audit', 'trail.jsonl');
  const rows = linesOf(fs.readFileSync(p, 'utf8'));
  const sealRow = rows[rows.length - 1];
  sealRow.sig = Buffer.from('not-a-real-signature').toString('base64');
  // Re-hash so the CHAIN still passes and only the SIGNATURE is wrong.
  const { hash, prevHash, ...payload } = sealRow;
  sealRow.hash = hashPayload(prevHash, payload);
  fs.writeFileSync(p, rows.map((r) => JSON.stringify(r)).join('\n'));
  const v = verifyTrail(fs.readFileSync(p, 'utf8'));
  assert.equal(v.ok, true, 'chain still intact');
  assert.equal(v.seal.ok, false, 'but the signature no longer verifies');
  fs.rmSync(workspace, { recursive: true, force: true });
});

test('rotated key: a trail sealed with the old key still verifies via its embedded key', () => {
  const workspace = ws();
  const store = mockStore();
  const t = new AuditTrail();
  t.append(workspace, { type: 'tool_call', summary: 'a' });
  const oldSigner = getOrCreateSigner(store);
  t.seal(workspace, oldSigner);
  rotateSigningKey(store); // app rotates to a new key afterward
  const v = verifyTrail(t.read(workspace));
  assert.equal(v.seal.ok, true, 'the old seal self-verifies via its embedded public key');
  assert.equal(v.seal.keyId, oldSigner.keyId);
  fs.rmSync(workspace, { recursive: true, force: true });
});

test('a caller cannot forge chain fields (seq/prevHash/hash are stamped)', () => {
  const workspace = ws();
  const t = new AuditTrail();
  const line = t.append(workspace, { type: 'tool_call', seq: 999, prevHash: 'fake', hash: 'fake', summary: 'x' });
  assert.equal(line.seq, 1);
  assert.equal(line.prevHash, GENESIS);
  assert.notEqual(line.hash, 'fake');
  fs.rmSync(workspace, { recursive: true, force: true });
});
