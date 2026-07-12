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

test('sumUsage handles an empty / usage-less transcript', () => {
  assert.deepEqual(sumUsage([]), { cost: 0, tokens: 0 });
  assert.deepEqual(sumUsage([{ type: 'agent_start' }, { type: 'message_end', message: {} }]), { cost: 0, tokens: 0 });
});
