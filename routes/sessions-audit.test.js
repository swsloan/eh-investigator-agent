// GET /:id/audit + /:id/audit/export (#30 Slice A). Run: node --test routes/sessions-audit.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { sessionsRouter } from './sessions.js';
import { withServer } from '../lib/http-test-harness.js';
import { AuditTrail } from '../lib/audit-trail.js';

function mount(session) {
  const sessions = new Map(session ? [[session.id, session]] : []);
  return (app) => {
    app.use(express.json());
    app.use('/api/sessions', sessionsRouter({
      sessions, sseClients: new Set(), createSession: () => ({}), generateTitle: () => {},
      getConfig: () => ({}), getActiveBackend: () => ({ id: 'claude' }), getModelCatalog: () => ({}),
      secretStore: {}, brokerSocketPath: '', buildSessionEnv: () => ({}), challenger: {},
    }));
  };
}

function sessionWithTrail() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'auditrt-'));
  const t = new AuditTrail();
  t.append(workspace, { type: 'tool_call', summary: 'search_records' });
  t.append(workspace, { type: 'verdict', outcome: 'benign' });
  return { id: 'sess-a', workspace, backend: 'claude' };
}

test('GET /:id/audit reports an intact chain', async () => {
  const session = sessionWithTrail();
  await withServer(mount(session), async (base) => {
    const res = await fetch(`${base}/api/sessions/sess-a/audit`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.present, true);
    assert.equal(body.entries, 2);
    assert.equal(body.verify.ok, true);
  });
  fs.rmSync(session.workspace, { recursive: true, force: true });
});

test('GET /:id/audit flags a tampered chain (and export returns raw JSONL)', async () => {
  const session = sessionWithTrail();
  const p = path.join(session.workspace, 'audit', 'trail.jsonl');
  const rows = fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  rows[0].summary = 'TAMPERED';
  fs.writeFileSync(p, rows.map((r) => JSON.stringify(r)).join('\n'));

  await withServer(mount(session), async (base) => {
    const summary = await (await fetch(`${base}/api/sessions/sess-a/audit`)).json();
    assert.equal(summary.verify.ok, false);
    assert.equal(summary.verify.brokenAt, 0);

    const exp = await fetch(`${base}/api/sessions/sess-a/audit/export`);
    assert.match(exp.headers.get('content-type'), /x-ndjson/);
    assert.match(exp.headers.get('content-disposition'), /audit-sess-a\.jsonl/);
    assert.ok((await exp.text()).split('\n').filter(Boolean).length === 2);
  });
  fs.rmSync(session.workspace, { recursive: true, force: true });
});

test('GET /:id/audit is 404 for an unknown session', async () => {
  await withServer(mount(null), async (base) => {
    assert.equal((await fetch(`${base}/api/sessions/ghost/audit`)).status, 404);
  });
});
