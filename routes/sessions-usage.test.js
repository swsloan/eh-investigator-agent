// The GET /:id/usage route — how the live eval harness learns what a case cost.
// Run: node --test routes/sessions-usage.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { sessionsRouter } from './sessions.js';
import { withServer } from '../lib/http-test-harness.js';

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

const session = {
  id: 'sess-u',
  workspace: '/tmp/x',
  backend: 'claude',
  transcript: [
    { type: 'message_end', message: { usage: { totalTokens: 1000, cacheRead: 900, cost: { total: 0 } } } },
    { type: 'tool_execution_start', toolCallId: 'a1', toolName: 'Agent' },
    { type: 'tool_execution_start', toolCallId: 'c1', toolName: 'Bash', parentToolCallId: 'a1' },
    { type: 'subagent_usage', parentToolCallId: 'a1', usage: { totalTokens: 400, cacheRead: 380 } },
    { type: 'message_end', message: { usage: { cost: { total: 2.5 } } } },
  ],
};

test('GET /:id/usage reports cost, tokens and the delegated share', async () => {
  await withServer(mount(session), async (base) => {
    const res = await fetch(`${base}/api/sessions/${session.id}/usage`);
    assert.equal(res.status, 200);
    const u = await res.json();
    assert.equal(u.cost, 2.5, 'the whole-turn cost, which live runs previously could not see at all');
    assert.equal(u.tokens, 1400, 'delegated tokens are part of the total');
    assert.equal(u.cacheRead, 1280);
    assert.equal(u.delegatedTokens, 400);
    assert.equal(u.delegations, 1);
  });
});

test('a session that has run nothing reports zeroes, not an error', async () => {
  await withServer(mount({ id: 'sess-empty', workspace: '/tmp/x', backend: 'claude', transcript: [] }), async (base) => {
    const res = await fetch(`${base}/api/sessions/sess-empty/usage`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), {
      cost: 0, tokens: 0, cacheRead: 0, delegatedTokens: 0, delegatedCacheRead: 0, delegations: 0,
    });
  });
});

test('a session with no transcript at all does not throw', async () => {
  await withServer(mount({ id: 'sess-bare', workspace: '/tmp/x', backend: 'claude' }), async (base) => {
    const res = await fetch(`${base}/api/sessions/sess-bare/usage`);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).cost, 0);
  });
});

test('an unknown session is a 404, not a zero-cost answer', async () => {
  // Scoring a missing session as $0 is how a broken run reads as a cheap one.
  await withServer(mount(session), async (base) => {
    const res = await fetch(`${base}/api/sessions/nope/usage`);
    assert.equal(res.status, 404);
  });
});
