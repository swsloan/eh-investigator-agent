// Cost/token capture from a session transcript. Run: node --test lib/eval-runner.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { sumUsage, mapPool } from './eval-runner.js';

test('mapPool runs all items with a bounded number in flight', async () => {
  const items = Array.from({ length: 10 }, (_, i) => i);
  const done = [];
  let inFlight = 0, maxInFlight = 0;
  await mapPool(items, 3, async (n) => {
    inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    done.push(n); inFlight--;
  });
  assert.equal(done.length, 10, 'every item processed');
  assert.deepEqual([...done].sort((a, b) => a - b), items, 'all items exactly once');
  assert.ok(maxInFlight <= 3, `never exceeded the limit (saw ${maxInFlight})`);
  assert.ok(maxInFlight > 1, 'actually ran concurrently');
});

test('sumUsage sums cost (authoritative) and tokens from message_end events', () => {
  const transcript = [
    { type: 'agent_start' },
    { type: 'message_end', message: { role: 'assistant', usage: { totalTokens: 1200, cost: { total: 0 } } } },
    { type: 'message_end', message: { role: 'assistant', usage: { totalTokens: 800, cost: { total: 0 } } } },
    { type: 'tool_execution_end' },
    // the result event carries the authoritative cumulative cost
    { type: 'message_end', message: { role: 'assistant', usage: { cost: { total: 0.58 } } } },
    { type: 'agent_end' },
  ];
  const { cost, tokens } = sumUsage(transcript);
  assert.equal(cost, 0.58, 'cost taken from the result usage');
  assert.equal(tokens, 2000, 'tokens summed across assistant message_end events');
});

const ZERO = {
  cost: 0, tokens: 0, cacheRead: 0, delegatedTokens: 0, delegatedCacheRead: 0, delegations: 0,
};

test('sumUsage handles an empty / usage-less transcript', () => {
  assert.deepEqual(sumUsage([]), ZERO);
  assert.deepEqual(sumUsage([{ type: 'agent_start' }, { type: 'message_end', message: {} }]), ZERO);
});

// ---- Delegation accounting (#120 slice 1) ----

test('sumUsage counts delegated tokens — a subagent is not free', () => {
  // The failure this guards against: subagent usage arrives on its own event
  // type, so a sum that only read message_end would report a delegated run as
  // dramatically cheaper than it was, and the slice would "prove" its premise
  // by not measuring the cost it moved.
  const transcript = [
    { type: 'message_end', message: { usage: { totalTokens: 1000, cacheRead: 900, cost: { total: 0 } } } },
    { type: 'tool_execution_start', toolCallId: 't1', toolName: 'Task' },
    { type: 'tool_execution_start', toolCallId: 'c1', toolName: 'Bash', parentToolCallId: 't1' },
    { type: 'subagent_usage', parentToolCallId: 't1', usage: { totalTokens: 400, cacheRead: 380 } },
    { type: 'subagent_usage', parentToolCallId: 't1', usage: { totalTokens: 100, cacheRead: 90 } },
    { type: 'message_end', message: { usage: { cost: { total: 1.25 } } } },
  ];
  const u = sumUsage(transcript);
  assert.equal(u.tokens, 1500, 'delegated tokens are part of the total');
  assert.equal(u.cacheRead, 1370, 'cache reads likewise — the number the premise rests on');
  assert.equal(u.delegatedTokens, 500);
  assert.equal(u.delegatedCacheRead, 470);
  assert.equal(u.delegations, 1, 'the Task counts once; its nested calls do not');
  assert.equal(u.cost, 1.25, 'subagent usage carries no cost of its own — no double-count');
});

test('sumUsage counts only top-level Task calls as delegations', () => {
  const u = sumUsage([
    { type: 'tool_execution_start', toolCallId: 't1', toolName: 'Task' },
    { type: 'tool_execution_start', toolCallId: 't2', toolName: 'Task', parentToolCallId: 't1' },
    { type: 'tool_execution_start', toolCallId: 'b1', toolName: 'Bash' },
  ]);
  assert.equal(u.delegations, 1, 'a nested Task is part of its parent delegation, not a new one');
});

test('a run with no delegation reports zeroes, so runs stay comparable', () => {
  const u = sumUsage([
    { type: 'message_end', message: { usage: { totalTokens: 900, cacheRead: 850, cost: { total: 0.4 } } } },
  ]);
  assert.equal(u.delegatedTokens, 0);
  assert.equal(u.delegations, 0);
  assert.equal(u.cacheRead, 850, 'the baseline still reports cache reads on the same field');
});
