// Audit trail core (#30 Slice A). Run: node --test lib/audit-trail.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AuditTrail, verifyTrail, canonical, hashPayload, GENESIS } from './audit-trail.js';

const ws = () => fs.mkdtempSync(path.join(os.tmpdir(), 'audit-'));
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

test('a caller cannot forge chain fields (seq/prevHash/hash are stamped)', () => {
  const workspace = ws();
  const t = new AuditTrail();
  const line = t.append(workspace, { type: 'tool_call', seq: 999, prevHash: 'fake', hash: 'fake', summary: 'x' });
  assert.equal(line.seq, 1);
  assert.equal(line.prevHash, GENESIS);
  assert.notEqual(line.hash, 'fake');
  fs.rmSync(workspace, { recursive: true, force: true });
});
