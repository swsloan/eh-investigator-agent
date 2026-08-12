// Workspace wiring for the subagent roster (#120 slice 1).
// Run: node --test lib/agent-roster.test.js
//
// The roster only exists for a session if the definitions are reachable from the
// workspace the agent actually runs in. A prompt that offers a subagent the
// harness cannot load fails silently — the lead simply never delegates, and the
// slice would report "no saving" for a plumbing reason rather than a real one.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AgentSession } from './agent-session.js';

const ROOT = path.resolve(import.meta.dirname, '..');

function makeSession() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eh-roster-'));
  const session = new AgentSession('11111111-1111-4111-8111-111111111111', root, { redact: (x) => x });
  return { session, root, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test('a session workspace can reach the agent roster', () => {
  const h = makeSession();
  h.session.linkWorkspaceResources('.claude');
  const link = path.join(h.session.workspace, '.claude', 'agents');
  assert.ok(fs.existsSync(link), 'the agents directory is linked into the workspace');
  assert.equal(fs.realpathSync(link), fs.realpathSync(path.join(ROOT, 'agents')));
  assert.ok(
    fs.existsSync(path.join(link, 'telemetry.md')),
    'the telemetry specialist is reachable at the path the harness loads from',
  );
  h.cleanup();
});

test('linking is idempotent — a restored session does not fail on its own links', () => {
  const h = makeSession();
  h.session.linkWorkspaceResources('.claude');
  assert.doesNotThrow(() => h.session.linkWorkspaceResources('.claude'), 'relinking an existing workspace is safe');
  h.cleanup();
});

test('skills and agents are linked side by side, not one instead of the other', () => {
  const h = makeSession();
  h.session.linkWorkspaceResources('.claude');
  const configDir = path.join(h.session.workspace, '.claude');
  for (const name of ['skills', 'agents']) {
    assert.ok(fs.existsSync(path.join(configDir, name)), `${name} is present`);
  }
  h.cleanup();
});
