// Audit-trail retention (#30 Slice D). Run: node --test lib/audit-retention.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  resolveRetentionPolicy, policyIsActive, selectTrailsToPrune,
  trailStatus, pruneAuditTrails,
} from './audit-retention.js';
import { AuditTrail, readTrail, hashPayload } from './audit-trail.js';
import { getOrCreateSigner } from './audit-keys.js';

const DAY = 24 * 60 * 60 * 1000;
const mockStore = () => { let s = {}; return { get: () => ({ ...s }), update: (p) => { s = { ...s, ...p }; } }; };

test('resolveRetentionPolicy: default is keep-everything (inactive)', () => {
  assert.deepEqual(resolveRetentionPolicy({}), { maxAgeMs: null, maxCount: null });
  assert.equal(policyIsActive(resolveRetentionPolicy({})), false);
  assert.deepEqual(resolveRetentionPolicy({ EH_AUDIT_RETENTION_DAYS: '30' }), { maxAgeMs: 30 * DAY, maxCount: null });
  assert.equal(resolveRetentionPolicy({ EH_AUDIT_RETENTION_MAX: '5' }).maxCount, 5);
  assert.equal(policyIsActive(resolveRetentionPolicy({ EH_AUDIT_RETENTION_MAX: '5' })), true);
});

test('selectTrailsToPrune: only SEALED trails are eligible; age + count filters', () => {
  const now = 100 * DAY;
  const trails = [
    { id: 'old-sealed', sealed: true, sealedAt: new Date(now - 40 * DAY).toISOString() },
    { id: 'new-sealed', sealed: true, sealedAt: new Date(now - 1 * DAY).toISOString() },
    { id: 'old-unsealed', sealed: false, sealedAt: null },
  ];
  // Age policy prunes only the old SEALED one; never the unsealed one.
  assert.deepEqual(selectTrailsToPrune(trails, { maxAgeMs: 30 * DAY }, now), ['old-sealed']);
  // Count policy keeps the newest N sealed, prunes the rest.
  assert.deepEqual(selectTrailsToPrune(trails, { maxCount: 1 }, now), ['old-sealed']);
  // No policy → prune nothing.
  assert.deepEqual(selectTrailsToPrune(trails, {}, now), []);
  // An unsealed trail is never selected even if ancient.
  assert.deepEqual(selectTrailsToPrune([{ id: 'x', sealed: false, sealedAt: null }], { maxAgeMs: 1 }, now), []);
});

test('trailStatus reports present/sealed/sealedAt', () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'ret-'));
  assert.deepEqual(trailStatus(ws), { present: false, sealed: false, sealedAt: null });
  const t = new AuditTrail();
  t.append(ws, { type: 'tool_call', summary: 'a' });
  assert.deepEqual(trailStatus(ws), { present: true, sealed: false, sealedAt: null });
  t.seal(ws, getOrCreateSigner(mockStore()));
  const st = trailStatus(ws);
  assert.equal(st.sealed, true);
  assert.ok(st.sealedAt, 'sealedAt is the seal entry time');
  fs.rmSync(ws, { recursive: true, force: true });
});

test('pruneAuditTrails removes only sealed trail files; leaves unsealed and workspace intact', () => {
  const mk = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ret-'));
  const signer = getOrCreateSigner(mockStore());
  const sealedWs = mk();
  const unsealedWs = mk();
  const ts = new AuditTrail();
  ts.append(sealedWs, { type: 'tool_call', summary: 'a' });
  const sealLine = ts.seal(sealedWs, signer);
  // Backdate the seal so the age policy catches it, keeping the chain valid by
  // recomputing the seal entry's hash over its edited payload (the signature signs
  // `root`, not `at`, so it stays valid; trailStatus requires an intact chain).
  const p = path.join(sealedWs, 'audit', 'trail.jsonl');
  const rows = readTrail(sealedWs).split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const sealRow = rows[rows.length - 1];
  sealRow.at = new Date(Date.now() - 90 * DAY).toISOString();
  const { hash, prevHash, ...payload } = sealRow;
  sealRow.hash = hashPayload(prevHash, payload);
  fs.writeFileSync(p, rows.map((r) => JSON.stringify(r)).join('\n'));

  const tu = new AuditTrail();
  tu.append(unsealedWs, { type: 'tool_call', summary: 'b' }); // unsealed

  const pruned = pruneAuditTrails({
    entries: [{ sessionId: 'sealed', workspace: sealedWs }, { sessionId: 'unsealed', workspace: unsealedWs }],
    policy: { maxAgeMs: 30 * DAY },
  });
  assert.deepEqual(pruned, ['sealed']);
  assert.equal(fs.existsSync(p), false, 'sealed trail file removed');
  assert.equal(fs.existsSync(sealedWs), true, 'workspace itself is untouched');
  assert.equal(readTrail(unsealedWs).length > 0, true, 'unsealed trail is preserved');
  assert.ok(sealLine.type === 'seal');
  fs.rmSync(sealedWs, { recursive: true, force: true });
  fs.rmSync(unsealedWs, { recursive: true, force: true });
});

test('pruneAuditTrails is a no-op when the policy is inactive', () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'ret-'));
  const t = new AuditTrail();
  t.append(ws, { type: 'tool_call', summary: 'a' });
  t.seal(ws, getOrCreateSigner(mockStore()));
  const pruned = pruneAuditTrails({ entries: [{ sessionId: 's', workspace: ws }], policy: {} });
  assert.deepEqual(pruned, []);
  assert.ok(readTrail(ws).length > 0, 'nothing pruned when policy is inactive');
  fs.rmSync(ws, { recursive: true, force: true });
});
