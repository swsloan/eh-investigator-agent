// The GET /:id/safety route (#32). Run: node --test routes/sessions-safety.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { sessionsRouter } from './sessions.js';
import { withServer } from '../lib/http-test-harness.js';
import { SAFETY_EVENT } from '../lib/safety-log.js';

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

test('GET /:id/safety summarizes the session safety events, payload-free', async () => {
  const session = {
    id: 'sess-s', workspace: '/tmp/x', backend: 'claude',
    transcript: [
      { type: SAFETY_EVENT, kind: 'injection_suspected', at: 2, flags: ['imperative'], source: 'excli search_records' },
      { type: SAFETY_EVENT, kind: 'write_refused', at: 3, tool: 'update_detection' },
      { type: 'message_end', message: {} }, // non-safety, ignored
    ],
  };
  await withServer(mount(session), async (base) => {
    const res = await fetch(`${base}/api/sessions/sess-s/safety`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.total, 2);
    assert.equal(body.by_kind.injection_suspected, 1);
    assert.equal(body.by_kind.write_refused, 1);
    assert.deepEqual(body.injection_flags, ['imperative']);
    assert.ok(!JSON.stringify(body).includes('message_end'));
  });
});

test('GET /:id/safety is 404 for an unknown session', async () => {
  await withServer(mount(null), async (base) => {
    assert.equal((await fetch(`${base}/api/sessions/ghost/safety`)).status, 404);
  });
});
