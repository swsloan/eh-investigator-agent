import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  addAgentUsage, allCalls, callDuration, childrenOf, endCall, getCall, resetCalls,
  runningCalls, startCall, subscribeCalls, topLevelCalls, updateCall,
} from './tool-store.js';

beforeEach(() => resetCalls());

test('a call is recorded, updated and finished under one id', () => {
  startCall({ toolCallId: 'a', toolName: 'bash', args: { command: 'ls' } }, { phrase: 'Listing files' });
  assert.equal(getCall('a').status, 'running');
  assert.equal(getCall('a').phrase, 'Listing files');

  updateCall({ toolCallId: 'a', status: 'reading 3 of 9' });
  assert.equal(getCall('a').progress, 'reading 3 of 9');

  endCall({ toolCallId: 'a', isError: false }, { output: '{}', summary: [{ text: '9 files' }] });
  const done = getCall('a');
  assert.equal(done.status, 'done');
  assert.equal(done.output, '{}');
  assert.equal(done.progress, '', 'progress is cleared once there is a result');
  assert.deepEqual(done.summary, [{ text: '9 files' }]);
});

test('calls keep the order they started in', () => {
  for (const id of ['a', 'b', 'c']) startCall({ toolCallId: id, toolName: 't' });
  endCall({ toolCallId: 'b' }, {});
  assert.deepEqual(allCalls().map((c) => c.id), ['a', 'b', 'c'], 'finishing one does not reorder');
  assert.deepEqual(runningCalls().map((c) => c.id), ['a', 'c']);
});

test('an update for a call that never started is ignored', () => {
  // Replay can deliver an update whose start was slimmed out of the transcript.
  assert.equal(updateCall({ toolCallId: 'ghost', status: 'x' }), null);
  assert.equal(allCalls().length, 0, 'no phantom call is created');
});

test('an update after the call finished is ignored', () => {
  startCall({ toolCallId: 'a', toolName: 't' });
  endCall({ toolCallId: 'a' }, { output: 'done' });
  assert.equal(updateCall({ toolCallId: 'a', status: 'still going' }), null);
  assert.equal(getCall('a').status, 'done', 'a finished call cannot go back to running');
});

test('an error is a finished call, not a missing one', () => {
  startCall({ toolCallId: 'a', toolName: 't' });
  endCall({ toolCallId: 'a', isError: true }, { output: 'broker is not running' });
  assert.equal(getCall('a').status, 'error');
  assert.equal(getCall('a').isError, true);
  assert.equal(runningCalls().length, 0);
});

test('calls without an id still get one, so two anonymous calls stay distinct', () => {
  const first = startCall({ toolName: 't' });
  const second = startCall({ toolName: 't' });
  assert.notEqual(first.id, second.id);
  assert.equal(allCalls().length, 2);
});

test('subscribers see every change, and one throwing does not stop the rest', () => {
  const seen = [];
  subscribeCalls(() => { throw new Error('bad listener'); });
  const off = subscribeCalls((r) => seen.push(r ? `${r.id}:${r.status}` : 'reset'));

  startCall({ toolCallId: 'a', toolName: 't' });
  updateCall({ toolCallId: 'a', status: 'half' });
  endCall({ toolCallId: 'a' }, { output: 'x' });
  assert.deepEqual(seen, ['a:running', 'a:running', 'a:done']);

  off();
  startCall({ toolCallId: 'b', toolName: 't' });
  assert.equal(seen.length, 3, 'unsubscribed listeners stop hearing');
});

test('duration is null while running and a number once finished', () => {
  const rec = startCall({ toolCallId: 'a', toolName: 't' });
  assert.equal(callDuration(rec), null);
  endCall({ toolCallId: 'a' }, {});
  assert.ok(callDuration(getCall('a')) >= 0);
});

test('reset clears the turn and announces it', () => {
  const seen = [];
  subscribeCalls((r) => seen.push(r));
  startCall({ toolCallId: 'a', toolName: 't' });
  resetCalls();
  assert.equal(allCalls().length, 0);
  assert.equal(seen.at(-1), null, 'a null notification is the signal to re-render empty');
});

// ---- Delegated work (#120 slice 0) ----

/** A lead call that delegates, and the subagent calls threaded under it. */
function delegation() {
  startCall({ toolCallId: 'task', toolName: 'Task', args: { subagent_type: 'telemetry' } });
  startCall({ toolCallId: 'c1', toolName: 'bash', parentToolCallId: 'task', agentModel: 'claude-haiku-4-5-20251001' });
  startCall({ toolCallId: 'c2', toolName: 'bash', parentToolCallId: 'task', agentModel: 'claude-haiku-4-5-20251001' });
}

test('a delegated call records its parent and the tier that ran it', () => {
  delegation();
  assert.equal(getCall('c1').parentId, 'task');
  assert.equal(getCall('c1').agentModel, 'claude-haiku-4-5-20251001');
  assert.equal(getCall('task').parentId, null, "the lead's own call has no parent");
  assert.equal(getCall('task').agentModel, '');
});

test('roots and children partition the turn', () => {
  delegation();
  startCall({ toolCallId: 'own', toolName: 'read' });
  assert.deepEqual(topLevelCalls().map((c) => c.id), ['task', 'own']);
  assert.deepEqual(childrenOf('task').map((c) => c.id), ['c1', 'c2'], 'children keep start order');
  assert.deepEqual(childrenOf('own'), []);
  assert.deepEqual(childrenOf(null), []);
  assert.equal(allCalls().length, 4, 'every call is still in the turn');
});

test('a delegated call whose parent never started is a root, not a disappearance', () => {
  // Replay can slim the parent out of the transcript. Work must never vanish
  // from the view whose whole job is showing all of it.
  startCall({ toolCallId: 'orphan', toolName: 'bash', parentToolCallId: 'gone' });
  assert.deepEqual(topLevelCalls().map((c) => c.id), ['orphan']);
  assert.equal(getCall('orphan').parentId, 'gone', 'it still knows it was delegated');
});

test('subagent usage accumulates onto the delegating call', () => {
  delegation();
  addAgentUsage('task', { input: 10, output: 5, cacheRead: 4000, cacheWrite: 100, totalTokens: 4115 });
  addAgentUsage('task', { input: 2, output: 3, cacheRead: 1000, cacheWrite: 0, totalTokens: 1005 });
  const totals = getCall('task').agentUsage;
  assert.equal(totals.cacheRead, 5000);
  assert.equal(totals.totalTokens, 5120);
  assert.equal(getCall('c1').agentUsage, null, 'usage lands on the parent, not the children');
});

test('usage for a parent that never started is ignored', () => {
  assert.equal(addAgentUsage('ghost', { totalTokens: 10 }), null);
  assert.equal(allCalls().length, 0, 'no phantom call is created');
});

test('usage notifies subscribers so the card can re-render', () => {
  delegation();
  const seen = [];
  subscribeCalls((r) => seen.push(r?.id));
  addAgentUsage('task', { totalTokens: 10 });
  assert.deepEqual(seen, ['task']);
});
