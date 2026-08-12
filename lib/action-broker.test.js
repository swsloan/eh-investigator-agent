// ActionBroker propose seam (agent-facing). Run: node --test lib/action-broker.test.js
// Drives handleRequest with a socket stub and a stub ExcliBroker so no real
// binary or unix socket is needed — asserts validation, persistence, and SSE.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ActionBroker } from './action-broker.js';
import { listActions } from './action-store.js';

function harness({ known = true, accessType = 'write', destructive = false, presenceFor } = {}) {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'eh-action-broker-test-'));
  const recorded = []; // transcript events (action notices + safety events)
  const session = {
    id: '11111111-1111-4111-8111-111111111111',
    workspace,
    recordEvent: (e) => { recorded.push(e); return e; },
  };
  const excliStub = {
    resolveAllowedCwd: (cwd) => {
      if (cwd !== workspace) throw new Error('excli broker rejected a request outside a known session workspace.');
      return { cwd, workspace, session };
    },
    describeCapability: () => ({ catalogLoaded: true, known, accessType, destructive }),
  };
  const events = [];
  const broker = new ActionBroker({
    excli: excliStub,
    broadcast: (id, e) => events.push({ id, e }),
    ...(presenceFor ? { presenceFor } : {}),
    logger: { info() {}, error() {} },
  });
  const writes = [];
  const socket = { destroyed: false, write: (s) => writes.push(JSON.parse(s)), end() { this.destroyed = true; } };
  return { broker, socket, writes, events, recorded, session, workspace };
}

test('a valid write proposal is persisted and broadcast', () => {
  const h = harness();
  h.broker.handleRequest(h.socket, JSON.stringify({
    cwd: h.workspace,
    payload: { capabilityId: 'update_detection', params: { id: 7 }, label: 'close detection 7' },
  }));
  const stored = listActions(h.workspace);
  assert.equal(stored.length, 1);
  assert.equal(stored[0].status, 'proposed');
  assert.equal(stored[0].capabilityId, 'update_detection');
  assert.equal(h.events.length, 1);
  assert.equal(h.events[0].e.type, 'action_proposed');
  assert.match(h.writes[0].result.message, /awaiting human approval/i);
  assert.equal(h.writes[0].result.status, 'proposed');
});

test('a read-only capability is refused (call it directly)', () => {
  const h = harness({ known: true, accessType: 'read' });
  h.broker.handleRequest(h.socket, JSON.stringify({
    cwd: h.workspace,
    payload: { capabilityId: 'get_detection', label: 'peek' },
  }));
  assert.match(h.writes[0].error, /read-only capability/i);
  assert.equal(listActions(h.workspace).length, 0, 'nothing persisted');
  assert.equal(h.events.length, 0, 'no broadcast');
});

test('an unknown capability is refused with a discovery hint', () => {
  const h = harness({ known: false, accessType: 'write' });
  h.broker.handleRequest(h.socket, JSON.stringify({
    cwd: h.workspace,
    payload: { capabilityId: 'frobnicate', label: 'do a thing' },
  }));
  assert.match(h.writes[0].error, /Unknown capability.*-listtools/is);
  assert.equal(listActions(h.workspace).length, 0);
});

test('a proposal from outside a session workspace is rejected', () => {
  const h = harness();
  h.broker.handleRequest(h.socket, JSON.stringify({
    cwd: '/some/other/dir',
    payload: { capabilityId: 'update_detection', label: 'x' },
  }));
  assert.match(h.writes[0].error, /outside a known session workspace/i);
  assert.equal(listActions(h.workspace).length, 0);
});

test('a malformed proposal payload is rejected', () => {
  const h = harness();
  h.broker.handleRequest(h.socket, JSON.stringify({ cwd: h.workspace, payload: { label: 'no capability' } }));
  assert.match(h.writes[0].error, /capabilityId/);
  assert.equal(listActions(h.workspace).length, 0);
});

// ---- Presence stamping (#137) ----

const propose = (h) => h.broker.handleRequest(h.socket, JSON.stringify({
  cwd: h.workspace,
  payload: { capabilityId: 'update_detection', params: { id: 7 }, label: 'close detection 7' },
}));

test('an attended proposal is stamped and tells the agent the user is being prompted', () => {
  const h = harness({ presenceFor: () => ({ attended: true, mode: 'attended', reason: 'session is on screen' }) });
  propose(h);
  const [stored] = listActions(h.workspace);
  assert.equal(stored.presence, 'attended');
  assert.equal(stored.presenceReason, 'session is on screen');
  assert.match(h.writes[0].result.message, /prompted to review it now/i);
  const notice = h.recorded.find((e) => e.type === 'action_notice');
  assert.ok(notice, 'transcript notice recorded');
  assert.match(notice.message, /awaits your approval/i);
  assert.ok(!h.recorded.some((e) => e.type === 'safety_event'), 'attended proposals are not safety-logged');
});

test('an unattended proposal is stamped, safety-logged, and never blocks', () => {
  const h = harness({ presenceFor: () => ({ attended: false, mode: 'unattended', reason: 'eval run' }) });
  propose(h);
  const [stored] = listActions(h.workspace);
  assert.equal(stored.presence, 'unattended');
  assert.equal(stored.presenceReason, 'eval run');
  assert.equal(h.writes[0].result.status, 'proposed', 'responds immediately — nothing to wait on');
  assert.ok(h.socket.destroyed, 'socket closed right away (no deadlock waiting for approval)');
  assert.match(h.writes[0].result.message, /will wait in the approvals queue/i);
  const safety = h.recorded.find((e) => e.type === 'safety_event');
  assert.equal(safety?.kind, 'unattended_proposal');
  assert.equal(safety?.tool, 'update_detection');
  assert.equal(safety?.reason, 'eval run');
  const notice = h.recorded.find((e) => e.type === 'action_notice');
  assert.match(notice.message, /unattended \(eval run\)/i);
});

test('an unattended destructive proposal carries the destructive flag in its safety event', () => {
  const h = harness({
    destructive: true,
    presenceFor: () => ({ attended: false, mode: 'unattended', reason: 'no one is viewing this session' }),
  });
  propose(h);
  const safety = h.recorded.find((e) => e.type === 'safety_event');
  assert.deepEqual(safety?.flags, ['destructive']);
});

test('a throwing presence resolver degrades to unattended without losing the proposal', () => {
  const h = harness({ presenceFor: () => { throw new Error('boom'); } });
  propose(h);
  const [stored] = listActions(h.workspace);
  assert.equal(stored.presence, 'unattended');
  assert.equal(stored.presenceReason, 'presence check failed');
  assert.equal(h.writes[0].result.status, 'proposed');
});

test('presence defaults to unattended when no resolver is wired', () => {
  const h = harness();
  propose(h);
  const [stored] = listActions(h.workspace);
  assert.equal(stored.presence, 'unattended');
});
