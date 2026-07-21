import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULT_MAX_DURABLE_EVENTS,
  compactDurableTranscript,
  durableReplayEvent,
  serializedJsonBytes,
} from './session-history.js';

// Only completed messages and tool activity are durable; streaming deltas are
// projected out because replay rebuilds from message_end (see durableReplayEvent).
const assistantMessage = (i) => ({
  type: 'message_end',
  message: { role: 'assistant', content: [{ type: 'text', text: `answer ${i}` }] },
});

test('streaming deltas are projected out; completed messages are kept', () => {
  assert.equal(durableReplayEvent({ type: 'message_update' }), null, 'deltas are not durable');
  assert.equal(durableReplayEvent({ type: 'message_start' }), null, 'message_start is not durable');
  assert.equal(durableReplayEvent({ type: 'agent_end' })?.type, 'agent_end');
  assert.equal(durableReplayEvent(assistantMessage(1))?.type, 'message_end');
});

test('a short transcript keeps every durable event and adds no notice', () => {
  const out = compactDurableTranscript([assistantMessage(1), { type: 'agent_end' }]);
  assert.equal(out.length, 2);
  assert.equal(out.some((e) => e.type === 'history_notice'), false);
});

test('drops the oldest events past the event budget and explains the gap', () => {
  const events = Array.from({ length: 40 }, (_, i) => assistantMessage(i));
  const out = compactDurableTranscript(events, { maxEvents: 10, maxBytes: 1_000_000 });
  assert.equal(out[0].type, 'history_notice', 'a notice is prepended when history was pruned');
  assert.ok(out.length <= 10, `stayed within the event budget (was ${out.length})`);
  const serialized = JSON.stringify(out);
  assert.match(serialized, /answer 39/, 'the newest event survived');
  assert.doesNotMatch(serialized, /answer 0"/, 'the oldest event was dropped');
});

test('respects the byte budget independently of the event count', () => {
  const events = Array.from({ length: 50 }, (_, i) => assistantMessage(i));
  const out = compactDurableTranscript(events, { maxEvents: 10_000, maxBytes: 600 });
  assert.ok(serializedJsonBytes(out) <= 600, `stayed within the byte budget (was ${serializedJsonBytes(out)})`);
  assert.equal(out[0]?.type, 'history_notice');
});

test('an unbounded transcript is bounded by the defaults', () => {
  const events = Array.from({ length: DEFAULT_MAX_DURABLE_EVENTS + 500 }, (_, i) => assistantMessage(i));
  const out = compactDurableTranscript(events);
  assert.ok(out.length <= DEFAULT_MAX_DURABLE_EVENTS, `default event cap applied (was ${out.length})`);
  assert.equal(out[0].type, 'history_notice');
});

test('tool activity survives compaction so the replayed timeline stays intact', () => {
  const out = compactDurableTranscript([
    { type: 'tool_execution_start', toolCallId: 't1', toolName: 'bash', args: { command: 'ls' } },
    { type: 'tool_execution_end', toolCallId: 't1', toolName: 'bash', result: { content: [{ type: 'text', text: 'ok' }] } },
    { type: 'agent_end' },
  ]);
  assert.deepEqual(out.map((e) => e.type), ['tool_execution_start', 'tool_execution_end', 'agent_end']);
});
