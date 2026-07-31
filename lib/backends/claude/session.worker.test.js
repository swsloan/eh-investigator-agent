// Claude worker-isolation bridge (#97). Run: node --test lib/backends/claude/session.worker.test.js
//
// Exercises the non-root subprocess path via the spawnWorkerFn/workerSpawnUserFn
// seams with a fake child: the parent must translate the child's newline-delimited
// SDK messages through the SAME handleSdkMessage path the in-process turn uses.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { ClaudeSession } from './session.js';

class FakeChild extends EventEmitter {
  constructor() {
    super();
    this.exitCode = null;
    this.stdinData = [];
    this.stdin = { write: (s) => { this.stdinData.push(s); return true; } };
    this.stdout = new EventEmitter();
    this.stderr = new EventEmitter();
    this.killed = null;
  }

  kill(sig) { this.killed = sig || 'SIGTERM'; this.exitCode = -1; }
  line(obj) { this.stdout.emit('data', Buffer.from(`${JSON.stringify(obj)}\n`)); }
  finish(code = 0, signal = null) { this.exitCode = code; this.emit('exit', code, signal); }
}

function makeSession(fake, extra = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-worker-'));
  const events = [];
  const session = new ClaudeSession(crypto.randomUUID(), root, {
    redact: (x) => x,
    workerSpawnUserFn: () => ({ uid: 10001, gid: 10001, home: '/home/worker' }),
    spawnWorkerFn: () => fake,
    ...extra,
  });
  session.on('event', (e) => events.push(e));
  return { session, events, root };
}

test('worker path bridges SDK messages and spawns a lowered child', async () => {
  const fake = new FakeChild();
  const { session, events, root } = makeSession(fake);

  const p = session.prompt('investigate host 10.0.0.5');
  // The Promise executor runs synchronously, so the init line is already written
  // and the stdout listeners are attached by the time prompt() returns.
  assert.equal(fake.stdinData.length, 1, 'init envelope written to the worker');
  const init = JSON.parse(fake.stdinData[0]);
  assert.equal(init.prompt, 'investigate host 10.0.0.5');
  assert.equal(init.options.cwd, session.workspace, 'serializable options carry the workspace cwd');
  assert.equal(init.options.permissionMode, 'bypassPermissions');
  assert.equal(init.sessionId, session.id);

  fake.line({ type: 'system', subtype: 'init', session_id: 'claude-abc', model: 'claude-opus-4-8' });
  fake.line({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }] } });
  fake.line({ type: 'result', subtype: 'success', is_error: false, session_id: 'claude-abc', total_cost_usd: 0.02 });
  fake.finish(0);
  await p;

  assert.equal(session.claudeSessionId, 'claude-abc', 'resume id captured from the streamed messages');
  const types = events.map((e) => e.type);
  assert.ok(types.includes('agent_start'));
  assert.ok(types.includes('tool_execution_start'), 'tool call surfaced through the bridge');
  assert.ok(types.includes('agent_end'));
  assert.ok(!types.includes('session_error'), 'a clean turn produces no error');
  fs.rmSync(root, { recursive: true, force: true });
});

test('worker __workerError line surfaces as a turn failure', async () => {
  const fake = new FakeChild();
  const { session, events, root } = makeSession(fake);
  let endMeta = null;
  session.on('agent_end', (m) => { endMeta = m; });

  const p = session.prompt('hi');
  fake.line({ __workerError: '401 Invalid bearer token' });
  fake.finish(1);
  await p;

  const err = events.find((e) => e.type === 'session_error');
  assert.ok(err, 'a session_error event is emitted');
  assert.match(err.error, /401 Invalid bearer token/);
  assert.equal(endMeta?.hadError, true, 'the turn end reports the error');
  fs.rmSync(root, { recursive: true, force: true });
});

test('abort() sends a control line to the worker', async () => {
  const fake = new FakeChild();
  const { session, root } = makeSession(fake);
  const p = session.prompt('long task');
  session.abort();
  const control = fake.stdinData.map((l) => JSON.parse(l)).find((m) => m.type === 'abort');
  assert.ok(control, 'an abort control message was written to the worker');
  fake.finish(0);
  await p;
  fs.rmSync(root, { recursive: true, force: true });
});

test('the in-process path is unchanged when no worker UID resolves', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-inproc-'));
  const seen = [];
  async function* fakeQuery() {
    yield { type: 'system', subtype: 'init', session_id: 'c1', model: 'claude-opus-4-8' };
    yield { type: 'result', subtype: 'success', is_error: false, session_id: 'c1' };
  }
  const session = new ClaudeSession(crypto.randomUUID(), root, {
    redact: (x) => x,
    workerSpawnUserFn: () => null, // isolation off → in-process queryFn path
    queryFn: (args) => { seen.push(args); return fakeQuery(); },
  });
  await session.prompt('hello');
  assert.equal(seen.length, 1, 'the in-process queryFn was used');
  assert.ok(seen[0].options.env, 'in-process options still carry env + functions');
  assert.equal(session.claudeSessionId, 'c1');
  fs.rmSync(root, { recursive: true, force: true });
});
