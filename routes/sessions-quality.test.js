// The GET /:id/quality route (#31). Run: node --test routes/sessions-quality.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { sessionsRouter } from './sessions.js';
import { withServer } from '../lib/http-test-harness.js';

// The quality route touches only `sessions` + the workspace; the rest of the
// router's deps are irrelevant here, so they default/no-op.
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

function workspaceWithVerdict(verdict, files = {}) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'cqroute-'));
  fs.mkdirSync(path.join(ws, 'evidence', 'records'), { recursive: true });
  fs.writeFileSync(path.join(ws, 'evidence', 'verdict.json'), JSON.stringify(verdict));
  for (const [rel, content] of Object.entries(files)) fs.writeFileSync(path.join(ws, rel), content);
  return ws;
}

test('GET /:id/quality returns the audit report for the session', async () => {
  const workspace = workspaceWithVerdict(
    {
      disposition: 'malicious', confidence: 'high', highest_rung_used: 'records',
      evidence_chain: [{ claim: 'beacon to 203.0.113.10', source: 'evidence/records/ssl.json' }],
      residual_uncertainty: '',
    },
    { 'evidence/records/ssl.json': '{"dst":"203.0.113.10"}' },
  );
  const session = { id: 'sess-q', workspace, backend: 'claude' };
  await withServer(mount(session), async (base) => {
    const res = await fetch(`${base}/api/sessions/sess-q/quality`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.has_verdict, true);
    assert.deepEqual(body.flags, []);
    assert.ok(body.score >= 0.9);
    assert.equal(body.calibration.signal, 'calibrated');
  });
  fs.rmSync(workspace, { recursive: true, force: true });
});

test('GET /:id/quality is 404 for an unknown session', async () => {
  await withServer(mount(null), async (base) => {
    assert.equal((await fetch(`${base}/api/sessions/ghost/quality`)).status, 404);
  });
});
