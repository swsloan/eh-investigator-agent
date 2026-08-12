// Subagent (Task) activity threading (#120 slice 0).
// Run: node --test lib/backends/claude/session.subagent.test.js
//
// Drives handleSdkMessage directly with the SDK message shapes a delegated turn
// produces. The contract under test: a subagent's TOOL activity reaches the UI
// threaded to the call that delegated it, while its PROSE does not — because
// subagent text belongs to the subagent's own context, and letting it through
// would both misattribute it to the lead and desynchronise the lead's
// content-block cursor.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ClaudeSession } from './session.js';

function makeSession() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-subagent-'));
  const events = [];
  const session = new ClaudeSession(crypto.randomUUID(), root, { redact: (x) => x });
  session.on('event', (e) => events.push(e));
  return { session, events, root, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

const PARENT = 'task-1';

/** The lead delegating: a `Task` tool_use in its own assistant message. */
const leadDelegates = {
  type: 'assistant',
  message: {
    model: 'claude-opus-5',
    content: [{ type: 'tool_use', id: PARENT, name: 'Task', input: { subagent_type: 'telemetry', description: 'Sweep SMB records' } }],
  },
};

/** The subagent working: same shape, but stamped with the delegating call. */
const subagentCalls = (id, command) => ({
  type: 'assistant',
  parent_tool_use_id: PARENT,
  message: {
    model: 'claude-haiku-4-5-20251001',
    content: [{ type: 'tool_use', id, name: 'Bash', input: { command } }],
    usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 4000, cache_creation_input_tokens: 100 },
  },
});

const subagentResult = (id, text) => ({
  type: 'user',
  parent_tool_use_id: PARENT,
  message: { content: [{ type: 'tool_result', tool_use_id: id, content: text }] },
});

test('a subagent tool call surfaces threaded to the call that delegated it', () => {
  const h = makeSession();
  h.session.handleSdkMessage(leadDelegates);
  h.session.handleSdkMessage(subagentCalls('c1', './excli-interface search_records'));
  h.session.handleSdkMessage(subagentResult('c1', '184 records'));

  const starts = h.events.filter((e) => e.type === 'tool_execution_start');
  assert.equal(starts.length, 2, 'the Task and the subagent call both surface');
  assert.equal(starts[0].toolName, 'Task');
  assert.equal(starts[0].parentToolCallId, undefined, "the lead's own call has no parent");
  assert.equal(starts[1].toolName, 'Bash');
  assert.equal(starts[1].parentToolCallId, PARENT, 'threaded to the delegating call');
  assert.equal(starts[1].agentModel, 'claude-haiku-4-5-20251001', 'the tier that ran it is named');

  const end = h.events.find((e) => e.type === 'tool_execution_end');
  assert.equal(end.toolCallId, 'c1');
  assert.equal(end.parentToolCallId, PARENT, 'the result is threaded to the same parent');
  assert.equal(end.toolName, 'Bash', 'result keeps the tool name from its start');
  h.cleanup();
});

test("a subagent's prose never enters the lead's transcript", () => {
  const h = makeSession();
  h.session.handleSdkMessage(leadDelegates);
  // Streamed text/thinking from inside the subagent.
  h.session.handleSdkMessage({
    type: 'stream_event',
    parent_tool_use_id: PARENT,
    event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'I will sweep the records' } },
  });
  h.session.handleSdkMessage({ type: 'stream_event', parent_tool_use_id: PARENT, event: { type: 'message_start' } });
  // A subagent assistant message carrying only text.
  h.session.handleSdkMessage({
    type: 'assistant',
    parent_tool_use_id: PARENT,
    message: { model: 'claude-haiku-4-5-20251001', content: [{ type: 'text', text: 'Found 184 records.' }] },
  });

  assert.equal(h.events.filter((e) => e.type === 'message_update').length, 0, 'no subagent deltas');
  assert.equal(h.events.filter((e) => e.type === 'message_start').length, 0, 'no subagent message bubble');
  // The lead's own delegating message still ends normally; what must never
  // appear is the subagent's text inside any message the lead is credited with.
  const text = h.events
    .filter((e) => e.type === 'message_end')
    .flatMap((e) => e.message?.content || [])
    .map((block) => block.text || '')
    .join(' ');
  assert.ok(!text.includes('Found 184 records'), "the subagent's prose is not attributed to the lead");
  assert.ok(!text.includes('I will sweep'), 'streamed subagent text never lands either');
  h.cleanup();
});

test("a subagent does not advance the lead's content-block cursor", () => {
  const h = makeSession();
  h.session.handleSdkMessage({
    type: 'assistant',
    message: { content: [{ type: 'thinking' }, { type: 'text', text: 'Delegating the sweep.' }] },
  });
  assert.equal(h.session.assistantBlockIndex, 2);

  h.session.handleSdkMessage(leadDelegates);              // +1 block (the Task)
  h.session.handleSdkMessage(subagentCalls('c1', 'ls'));  // must not move the cursor
  h.session.handleSdkMessage({
    type: 'assistant',
    parent_tool_use_id: PARENT,
    message: { content: [{ type: 'text', text: 'done' }, { type: 'text', text: 'really done' }] },
  });
  assert.equal(h.session.assistantBlockIndex, 3, "only the lead's own blocks advance the cursor");

  // The lead's next message must therefore still line up with its own deltas.
  h.session.handleSdkMessage({ type: 'assistant', message: { content: [{ type: 'text', text: 'Concluding.' }] } });
  const last = h.events.filter((e) => e.type === 'message_end').pop();
  assert.equal(last.message.contentBase, 3);
  h.cleanup();
});

test("a subagent's tokens are reported, and carry no cost of their own", () => {
  const h = makeSession();
  h.session.handleSdkMessage(leadDelegates);
  h.session.handleSdkMessage(subagentCalls('c1', 'ls'));

  const usage = h.events.filter((e) => e.type === 'subagent_usage');
  assert.equal(usage.length, 1);
  assert.equal(usage[0].parentToolCallId, PARENT);
  assert.equal(usage[0].agentModel, 'claude-haiku-4-5-20251001');
  assert.equal(usage[0].usage.cacheRead, 4000, 'cache reads are the number #120 is about');
  assert.equal(usage[0].usage.totalTokens, 4115);
  // Cost arrives once for the whole turn on the result message; a per-subagent
  // cost here would double-count the bill.
  assert.equal(usage[0].usage.cost.total, 0);
  h.cleanup();
});

test('a subagent message with no tool calls and no usage emits nothing', () => {
  const h = makeSession();
  h.session.handleSdkMessage(leadDelegates);
  const before = h.events.length;
  h.session.handleSdkMessage({
    type: 'assistant',
    parent_tool_use_id: PARENT,
    message: { model: 'claude-haiku-4-5-20251001', content: [{ type: 'text', text: 'thinking out loud' }] },
  });
  assert.equal(h.events.length, before, 'prose-only subagent traffic is silent');
  h.cleanup();
});

test("the lead's own calls are unchanged by the threading", () => {
  const h = makeSession();
  h.session.handleSdkMessage({
    type: 'assistant',
    message: { content: [{ type: 'tool_use', id: 'own-1', name: 'Bash', input: { command: 'ls' } }] },
  });
  h.session.handleSdkMessage({
    type: 'user',
    message: { content: [{ type: 'tool_result', tool_use_id: 'own-1', content: 'a b c' }] },
  });
  const start = h.events.find((e) => e.type === 'tool_execution_start');
  const end = h.events.find((e) => e.type === 'tool_execution_end');
  assert.equal(start.parentToolCallId, undefined);
  assert.equal(end.parentToolCallId, undefined);
  assert.equal(end.result.content[0].text, 'a b c');
  h.cleanup();
});

test('a result arriving without a parent id is still threaded by its start', () => {
  // Defensive: the pairing must come from the recorded call, not from whichever
  // message the result happens to ride on.
  const h = makeSession();
  h.session.handleSdkMessage(leadDelegates);
  h.session.handleSdkMessage(subagentCalls('c1', 'ls'));
  h.session.handleSdkMessage({
    type: 'user',
    message: { content: [{ type: 'tool_result', tool_use_id: 'c1', content: 'ok' }] },
  });
  const end = h.events.find((e) => e.type === 'tool_execution_end');
  assert.equal(end.parentToolCallId, PARENT);
  h.cleanup();
});
