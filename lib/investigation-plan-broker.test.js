import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { InvestigationPlanBroker } from './investigation-plan-broker.js';

const run = promisify(execFile);
const ROOT = path.resolve(import.meta.dirname, '..');
const CLI = path.join(ROOT, 'investigation-plan');

const INIT_PAYLOAD = JSON.stringify({
  plan_type: 'threat_hunt',
  title: 'Beaconing sweep',
  objective: 'Find periodic outbound sessions that survive a jitter filter.',
  scope: 'Egress traffic from the user VLAN over the last 7 days.',
  hypothesis: 'A host is beaconing to a low-reputation destination on a fixed interval.',
  strategy: 'Rank external peers by session regularity, then read the records for the top talkers.',
  completion_criteria: 'Every periodic peer is attributed or escalated.',
  tasks: [{ id: 'rank-peers', title: 'Rank external peers by regularity' }],
});

/** A session double with the surface the broker actually touches. */
function fakeSession(id, workspace) {
  const events = [];
  return {
    id,
    workspace,
    events,
    emit(name, event) { events.push({ name, event }); return true; },
  };
}

function harness() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-broker-'));
  const workspace = path.join(dir, 'session-a');
  fs.mkdirSync(workspace, { recursive: true });
  const session = fakeSession('session-a', workspace);
  const sessions = new Map([[session.id, session]]);
  const broker = new InvestigationPlanBroker({ root: ROOT, sessions, logger: { warn() {}, error() {} } });
  return { dir, workspace, session, sessions, broker };
}

/** Drive the real CLI the way the agent does: from the workspace, with env only. */
function cli(args, { workspace, socketPath, capability }) {
  return run(process.execPath, [CLI, ...args], {
    cwd: workspace,
    env: {
      ...process.env,
      ...(socketPath ? { EH_INVESTIGATION_PLAN_BROKER_SOCKET: socketPath } : {}),
      ...(capability ? { EH_INVESTIGATION_PLAN_CAPABILITY: capability } : {}),
    },
  });
}

test('the CLI refuses to act without a broker socket or a capability', async () => {
  // This is the invariant the whole synchronous design rests on: every plan
  // operation runs inside the app process, so the workspace lock is never
  // contended. A local-execution fallback here would break that.
  const { dir, workspace, broker } = harness();
  const socketPath = broker.start();
  try {
    await assert.rejects(
      () => cli(['status'], { workspace }),
      (err) => {
        assert.match(err.stderr, /broker is not configured/i);
        return true;
      },
      'no socket in the environment',
    );
    await assert.rejects(
      () => cli(['status'], { workspace, socketPath }),
      (err) => {
        assert.match(err.stderr, /capability is not configured/i);
        return true;
      },
      'a socket but no capability',
    );
    assert.equal(fs.existsSync(path.join(workspace, '.investigation-plan.json')), false, 'nothing was written locally');
  } finally {
    broker.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a capability-bearing CLI call executes and reports a compact result', async () => {
  const { dir, workspace, session, broker } = harness();
  const socketPath = broker.start();
  const capability = broker.issueSessionCapability(session.id, workspace);
  try {
    const init = JSON.parse((await cli(['init', '-json', INIT_PAYLOAD], { workspace, socketPath, capability })).stdout);
    assert.equal(init.ok, true);
    assert.equal(init.operation, 'init');
    assert.equal(init.changed, true);
    assert.equal(init.revision, 1);
    assert.equal(init.plan, undefined, 'mutations return a compact result, not the whole plan');
    assert.equal(fs.existsSync(path.join(workspace, '.investigation-plan.json')), true, 'state was committed');

    const status = JSON.parse((await cli(['status'], { workspace, socketPath, capability })).stdout);
    assert.equal(status.operation, 'status');
    assert.equal(status.plan.title, 'Beaconing sweep', 'status returns the full view');
    assert.equal(status.plan.tasks.length, 1);
  } finally {
    broker.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a committed mutation notifies the session without touching the transcript', async () => {
  const { dir, workspace, session, broker } = harness();
  const socketPath = broker.start();
  const capability = broker.issueSessionCapability(session.id, workspace);
  try {
    await cli(['init', '-json', INIT_PAYLOAD], { workspace, socketPath, capability });
    assert.equal(session.events.length, 1, 'the mutation emitted exactly one event');
    assert.equal(session.events[0].name, 'event', 'delivered as a plain SSE event, not a tracked transcript push');
    assert.equal(session.events[0].event.type, 'investigation_plan_updated');
    assert.equal(session.events[0].event.view.revision, 1);
    assert.equal(session.events[0].event.view.operation, undefined, 'the event carries a view, not the mutation envelope');

    await cli(['status'], { workspace, socketPath, capability });
    assert.equal(session.events.length, 1, 'an unchanged read emits nothing');
  } finally {
    broker.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('an unknown, revoked, or reissued capability is refused', async () => {
  const { dir, workspace, session, broker } = harness();
  const socketPath = broker.start();
  try {
    const first = broker.issueSessionCapability(session.id, workspace);
    await assert.rejects(
      () => cli(['status'], { workspace, socketPath, capability: 'not-a-real-capability' }),
      (err) => {
        assert.match(err.stdout + err.stderr, /capability is invalid or expired/i);
        return true;
      },
      'an unknown capability',
    );

    // Reissuing (as a session restore or backend switch does) must retire the
    // capability a stale agent process may still be holding.
    const second = broker.issueSessionCapability(session.id, workspace);
    assert.notEqual(first, second);
    await assert.rejects(
      () => cli(['status'], { workspace, socketPath, capability: first }),
      (err) => {
        assert.match(err.stdout + err.stderr, /capability is invalid or expired/i);
        return true;
      },
      'the superseded capability',
    );
    assert.equal(JSON.parse((await cli(['status'], { workspace, socketPath, capability: second })).stdout).ok, true);

    broker.revokeSessionCapability(session);
    await assert.rejects(
      () => cli(['status'], { workspace, socketPath, capability: second }),
      (err) => {
        assert.match(err.stdout + err.stderr, /capability is invalid or expired/i);
        return true;
      },
      'an explicitly revoked capability',
    );
  } finally {
    broker.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a capability cannot reach another session\'s workspace', async () => {
  const { dir, workspace, session, sessions, broker } = harness();
  const other = fakeSession('session-b', path.join(dir, 'session-b'));
  fs.mkdirSync(other.workspace, { recursive: true });
  sessions.set(other.id, other);
  const socketPath = broker.start();
  const capability = broker.issueSessionCapability(session.id, workspace);
  try {
    // Same live capability, but invoked from the other session's workspace.
    await assert.rejects(
      () => cli(['status'], { workspace: other.workspace, socketPath, capability }),
      (err) => {
        assert.match(err.stdout + err.stderr, /capability is invalid or expired/i);
        return true;
      },
      'a cwd belonging to a different session',
    );
    assert.equal(fs.existsSync(path.join(other.workspace, '.investigation-plan.json')), false);
  } finally {
    broker.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a capability dies with its session', async () => {
  const { dir, workspace, session, sessions, broker } = harness();
  const socketPath = broker.start();
  const capability = broker.issueSessionCapability(session.id, workspace);
  try {
    sessions.delete(session.id); // what DELETE /api/sessions/:id does first
    await assert.rejects(
      () => cli(['status'], { workspace, socketPath, capability }),
      (err) => {
        assert.match(err.stdout + err.stderr, /capability is invalid or expired/i);
        return true;
      },
      'a capability whose session is gone',
    );
  } finally {
    broker.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('capabilityForSession reflects the live binding only', () => {
  const { dir, workspace, session, broker } = harness();
  try {
    assert.equal(broker.capabilityForSession(session), '', 'nothing issued yet');
    const capability = broker.issueSessionCapability(session.id, workspace);
    assert.equal(broker.capabilityForSession(session), capability, 'the env rebuild path finds the live capability');
    assert.equal(
      broker.capabilityForSession({ id: session.id, workspace: path.join(dir, 'elsewhere') }),
      '',
      'a workspace mismatch yields nothing rather than a usable capability',
    );
    broker.revokeSessionCapability(session.id);
    assert.equal(broker.capabilityForSession(session), '');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('stop() releases the socket and every issued capability', () => {
  const { dir, workspace, session, broker } = harness();
  const socketPath = broker.start();
  broker.issueSessionCapability(session.id, workspace);
  assert.equal(fs.existsSync(socketPath), true);

  broker.stop();
  assert.equal(fs.existsSync(socketPath), false, 'the socket file is gone');
  assert.equal(broker.socketPath, null);
  assert.equal(broker.capabilityForSession(session), '', 'capabilities did not survive the stop');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('preflight reports the interface and the broker', () => {
  const { dir, broker } = harness();
  try {
    const down = broker.status();
    assert.deepEqual(down.map((check) => check.id), ['investigation_plan_interface', 'investigation_plan_broker']);
    assert.equal(down[0].ok, true, './investigation-plan ships executable');
    assert.equal(down[1].ok, false, 'reported down before start()');

    broker.start();
    assert.equal(broker.status()[1].ok, true, 'reported up once listening');
  } finally {
    broker.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
