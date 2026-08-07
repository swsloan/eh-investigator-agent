import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createMemoryCoordinator, classifyCapture, SAVE_TOOL_RE, NO_OP_RE } from './memory-coordinator.js';

// A minimal session double: a real EventEmitter carrying the surface the
// coordinator touches. `prompt` records the call and marks the turn running,
// exactly as the real backends do on delivery.
function mockSession({ files = [], backend = 'claude' } = {}) {
  const s = new EventEmitter();
  s.id = 'testsession-abcdef';
  s.backend = backend;
  s.running = false;
  s.events = [];
  s.prompts = [];
  s.recordEvent = (e) => s.events.push(e);
  s.prompt = (text, opts = {}) => { s.prompts.push({ text, source: opts.source }); s.running = true; return Promise.resolve(true); };
  s.listFiles = () => files;
  return s;
}

const REPORT = [{ path: 'report.html', size: 100, mtime: 1000 }]; // reviewable + root html
const SIGNATURE = 'report.html:100:1000';
const enabledConfig = () => ({ memory: { enabled: true } });

// Drive a user investigation turn to completion (the trigger path).
function endUserTurn(s) { s.running = false; s.emit('agent_end', { promptSource: 'user' }); }

// Drive a capture turn: stream its tool/text events, then end it. `toolField`
// selects which name the tool event carries — Claude uses `toolName`, Pi `name`.
function endCaptureTurn(s, { tools = [], text = '', hadError = false, toolField = 'toolName' } = {}) {
  for (const t of tools) s.emit('event', { type: 'tool_execution_start', [toolField]: t });
  if (text) s.emit('event', { type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text }] } });
  s.running = false;
  s.emit('agent_end', { promptSource: 'memory-capture', hadError });
}

const statuses = (s) => s.events.filter((e) => e.type === 'memory_status').map((e) => e.status);

test('classifyCapture: tool call = captured, explicit no-op = skipped, neither = unconfirmed', () => {
  assert.equal(classifyCapture({ sawSaveTool: true }), 'captured');
  assert.equal(classifyCapture({ sawSaveTool: true, lastText: 'anything' }), 'captured');
  assert.equal(classifyCapture({ sawSaveTool: false, lastText: 'No new memory to store.' }), 'skipped');
  assert.equal(classifyCapture({ sawSaveTool: false, lastText: 'I revised the report.' }), 'unconfirmed');
  assert.equal(classifyCapture({}), 'unconfirmed');
});

test('SAVE_TOOL_RE matches the real save tools and rejects lookalikes', () => {
  assert.ok(SAVE_TOOL_RE.test('mcp__graphiti__add_memory'), 'Claude MCP tool');
  assert.ok(SAVE_TOOL_RE.test('memory_add'), 'Pi extension tool');
  assert.ok(SAVE_TOOL_RE.test('add_memory'), 'bare name');
  assert.ok(!SAVE_TOOL_RE.test('mcp__graphiti__search_nodes'), 'a read tool');
  assert.ok(!SAVE_TOOL_RE.test('memory_search'), 'recall, not save');
  assert.ok(!SAVE_TOOL_RE.test('add_memory_helper'), 'must anchor to the end');
  assert.ok(NO_OP_RE.test('  No New Memory To Store  '), 'case-insensitive no-op phrase');
});

test('does NOT mark captured on delivery — only after the save tool is observed', () => {
  const coord = createMemoryCoordinator({ getConfig: enabledConfig });
  const s = mockSession({ files: REPORT });
  coord.attachSession(s);

  endUserTurn(s); // investigation concludes -> capture prompt delivered
  assert.equal(s.prompts.length, 1, 'one capture prompt fired');
  assert.equal(s.prompts[0].source, 'memory-capture');
  assert.equal(s.lastMemoryCaptureSignature, undefined, 'NOT marked done yet (this was the bug)');
  assert.equal(s.captureInFlight.signature, SIGNATURE, 'tracked as in-flight instead');
  assert.deepEqual(statuses(s), ['capturing']);

  // The agent calls the save tool, then replies.
  endCaptureTurn(s, { tools: ['mcp__graphiti__add_memory'], text: 'Stored DC01 + LameHug verdict.' });
  assert.equal(s.captureInFlight, null, 'cleared once confirmed');
  assert.equal(s.lastMemoryCaptureSignature, SIGNATURE, 'now genuinely marked done');
  assert.deepEqual(statuses(s), ['capturing', 'captured']);
});

test('an explicit "no new memory to store" resolves the state without a write', () => {
  const coord = createMemoryCoordinator({ getConfig: enabledConfig });
  const s = mockSession({ files: REPORT });
  coord.attachSession(s);

  endUserTurn(s);
  endCaptureTurn(s, { tools: [], text: 'No new memory to store.' });
  assert.equal(s.lastMemoryCaptureSignature, SIGNATURE, 'a legitimate no-op still resolves the signature');
  assert.deepEqual(statuses(s), ['capturing', 'skipped']);
});

test('a capture that never called the tool retries, then fails loudly (no silent loss)', () => {
  const warns = [];
  const coord = createMemoryCoordinator({ getConfig: enabledConfig, logger: { warn: (m) => warns.push(m) } });
  const s = mockSession({ files: REPORT });
  coord.attachSession(s);

  endUserTurn(s); // attempt 1
  assert.equal(s.captureInFlight.attempts, 1);
  endCaptureTurn(s, { tools: [], text: 'I updated the report but did not save.' }); // no tool, no no-op
  assert.equal(s.prompts.length, 2, 'retried once');
  assert.equal(s.captureInFlight.attempts, 2, 'attempt 2 in flight');
  assert.equal(s.lastMemoryCaptureSignature, undefined, 'still not marked done during retry');

  endCaptureTurn(s, { tools: [], text: 'Still nothing.' }); // second failure
  assert.equal(s.prompts.length, 2, 'does not retry past the cap');
  assert.equal(s.captureInFlight, null);
  assert.equal(s.lastMemoryCaptureSignature, SIGNATURE, 'signature marked so it stops looping on this state');
  assert.deepEqual(statuses(s), ['capturing', 'capturing', 'failed']);
  assert.equal(warns.length, 1, 'the failure is surfaced, not swallowed');
});

test('an errored capture turn is treated as unconfirmed (retried), never confirmed', () => {
  const coord = createMemoryCoordinator({ getConfig: enabledConfig });
  const s = mockSession({ files: REPORT });
  coord.attachSession(s);
  endUserTurn(s);
  endCaptureTurn(s, { tools: [], text: '', hadError: true });
  assert.equal(s.prompts.length, 2, 'errored capture is retried');
  assert.equal(s.lastMemoryCaptureSignature, undefined);
});

test('a confirmed state is not re-captured while unchanged', () => {
  const coord = createMemoryCoordinator({ getConfig: enabledConfig });
  const s = mockSession({ files: REPORT });
  coord.attachSession(s);
  endUserTurn(s);
  endCaptureTurn(s, { tools: ['mcp__graphiti__add_memory'], text: 'Stored.' });
  assert.equal(s.prompts.length, 1);

  endUserTurn(s); // same evidence signature -> no new capture
  assert.equal(s.prompts.length, 1, 'dedup on the confirmed signature');
});

test('the Pi backend and its memory_add tool are handled the same way', () => {
  const coord = createMemoryCoordinator({ getConfig: enabledConfig });
  const s = mockSession({ files: REPORT, backend: 'pi' });
  coord.attachSession(s);
  endUserTurn(s);
  // Pi's raw tool event names the field `name`, not `toolName`.
  endCaptureTurn(s, { tools: ['memory_add'], text: 'Saved.', toolField: 'name' });
  assert.equal(s.lastMemoryCaptureSignature, SIGNATURE);
  assert.deepEqual(statuses(s), ['capturing', 'captured']);
});

test('disabled memory does nothing', () => {
  const coord = createMemoryCoordinator({ getConfig: () => ({ memory: { enabled: false } }) });
  const s = mockSession({ files: REPORT });
  coord.attachSession(s);
  endUserTurn(s);
  assert.equal(s.prompts.length, 0);
  assert.equal(s.captureInFlight, undefined);
});

// ---- Stage-2 read-back: the tool firing is not persistence ----------------
// Graphiti extracts asynchronously, so add_memory can succeed and the episode
// still die in the sidecar's queue (observed live: billing 400 on the
// extraction LLM — the trail said captured, the graph held nothing).

/** A fake FalkorDB client whose episode count is a mutable box. */
function fakeFalkor(box) {
  return {
    query: async () => {
      if (box.fail) throw new Error('graph unreachable');
      return { columns: ['c'], rows: [[box.count]] };
    },
  };
}
const flush = () => new Promise((r) => { setImmediate(r); });

test('captured is only reported once the episode is readable in the graph', async () => {
  const box = { count: 16 };
  const coord = createMemoryCoordinator({
    getConfig: enabledConfig, client: fakeFalkor(box), resolveGroup: () => 'pocextrahop',
    persistPollMs: 1, persistTimeoutMs: 200,
  });
  const s = mockSession({ files: REPORT });
  coord.attachSession(s);

  endUserTurn(s);
  endCaptureTurn(s, { tools: ['mcp__graphiti__add_memory'], text: 'Stored the topology episode.' });
  await flush();
  assert.deepEqual(statuses(s), ['capturing', 'persisting'], 'not yet captured — the graph has not grown');
  assert.equal(s.lastMemoryCaptureSignature, SIGNATURE, 'signature marked so the state cannot loop');

  box.count = 17; // extraction lands
  await new Promise((r) => { setTimeout(r, 30); });
  assert.deepEqual(statuses(s), ['capturing', 'persisting', 'captured']);
});

test('a save tool that never persists is reported failed, not captured', async () => {
  const box = { count: 16 };
  const warnings = [];
  const coord = createMemoryCoordinator({
    getConfig: enabledConfig, client: fakeFalkor(box), resolveGroup: () => 'pocextrahop',
    persistPollMs: 1, persistTimeoutMs: 20, logger: { warn: (m) => warnings.push(m) },
  });
  const s = mockSession({ files: REPORT });
  coord.attachSession(s);

  endUserTurn(s);
  endCaptureTurn(s, { tools: ['mcp__graphiti__add_memory'], text: 'Stored one episode.' });
  await new Promise((r) => { setTimeout(r, 60); }); // let the window close

  const events = s.events.filter((e) => e.type === 'memory_status');
  assert.deepEqual(events.map((e) => e.status), ['capturing', 'persisting', 'failed']);
  assert.equal(events[2].reason, 'not_persisted');
  assert.ok(warnings.some((w) => /no episode appeared/.test(w)), 'points at the sidecar');
  assert.equal(s.prompts.length, 1, 'infra failure is NOT re-prompted at the agent');
});

test('an unreadable graph is a failure, never silent trust', async () => {
  const box = { count: 0, fail: true };
  const coord = createMemoryCoordinator({
    getConfig: enabledConfig, client: fakeFalkor(box), resolveGroup: () => 'pocextrahop',
    persistPollMs: 1, persistTimeoutMs: 20, logger: { warn: () => {} },
  });
  const s = mockSession({ files: REPORT });
  coord.attachSession(s);

  endUserTurn(s);
  endCaptureTurn(s, { tools: ['add_memory'], text: 'Stored.' });
  await new Promise((r) => { setTimeout(r, 60); });
  assert.deepEqual(statuses(s), ['capturing', 'persisting', 'failed']);
});

test('first-ever capture: a missing graph baseline still confirms once episodes appear', async () => {
  const box = { count: 0, fail: true }; // baseline read fails — graph does not exist yet
  const coord = createMemoryCoordinator({
    getConfig: enabledConfig, client: fakeFalkor(box), resolveGroup: () => 'pocextrahop',
    persistPollMs: 1, persistTimeoutMs: 200,
  });
  const s = mockSession({ files: REPORT });
  coord.attachSession(s);

  endUserTurn(s);
  await flush(); // baseline promise settles (null)
  box.fail = false; box.count = 1; // the write creates the graph with one episode
  endCaptureTurn(s, { tools: ['add_memory'], text: 'Stored.' });
  await new Promise((r) => { setTimeout(r, 30); });
  assert.deepEqual(statuses(s), ['capturing', 'persisting', 'captured']);
});

test('the skipped no-op never waits on the graph', async () => {
  const coord = createMemoryCoordinator({
    getConfig: enabledConfig, client: fakeFalkor({ count: 5 }), resolveGroup: () => 'pocextrahop',
    persistPollMs: 1, persistTimeoutMs: 20,
  });
  const s = mockSession({ files: REPORT });
  coord.attachSession(s);

  endUserTurn(s);
  endCaptureTurn(s, { text: 'No new memory to store' });
  assert.deepEqual(statuses(s), ['capturing', 'skipped']);
});

test('without a client the tool-fired verification stands alone, as before', () => {
  const coord = createMemoryCoordinator({ getConfig: enabledConfig });
  const s = mockSession({ files: REPORT });
  coord.attachSession(s);

  endUserTurn(s);
  endCaptureTurn(s, { tools: ['add_memory'], text: 'Stored.' });
  assert.deepEqual(statuses(s), ['capturing', 'captured']);
});
