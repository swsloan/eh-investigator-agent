// Topology ingest coordinator. Run: node --test lib/topology-coordinator.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { artifactSignature, createTopologyCoordinator, readArtifact } from './topology-coordinator.js';

const quiet = { info: () => {}, warn: () => {} };

const ARTIFACT = {
  collected_at: '2026-07-31T00:00:00Z',
  devices: [
    { id: '1', name: 'dc1', ipaddr: '10.0.0.10', role: 'domain_controller', vlanid: '10' },
    { id: '2', name: 'pc1', ipaddr: '10.0.0.50', role: 'pc', vlanid: '10' },
  ],
  edges: [{ src: '2', dst: '1', bytes_out: 100, bytes_in: 50 }],
};

function makeSession({ artifact = ARTIFACT } = {}) {
  const s = new EventEmitter();
  s.id = 'sess-topology-1';
  s.workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'topo-coord-'));
  if (artifact) {
    fs.mkdirSync(path.join(s.workspace, 'evidence', 'topology'), { recursive: true });
    fs.writeFileSync(path.join(s.workspace, 'evidence', 'topology', 'topology.json'), JSON.stringify(artifact));
  }
  s.events = [];
  s.recordEvent = (e) => s.events.push(e);
  return s;
}

function fakeClient() {
  const mutations = [];
  return {
    mutations,
    async mutate(graph, cypher) { mutations.push({ graph, cypher }); return { columns: [], rows: [] }; },
    async query() { return { columns: [], rows: [] }; }, // no prior snapshot
  };
}

const cfgOn = () => ({ memory: { enabled: true } });
const cfgOff = () => ({ memory: { enabled: false } });

test('readArtifact returns null when the file is absent or malformed', () => {
  const none = makeSession({ artifact: null });
  assert.equal(readArtifact(none.workspace), null);
  fs.mkdirSync(path.join(none.workspace, 'evidence', 'topology'), { recursive: true });
  fs.writeFileSync(path.join(none.workspace, 'evidence', 'topology', 'topology.json'), '{ not json');
  assert.equal(readArtifact(none.workspace), null, 'malformed JSON is not a crash');
  assert.equal(readArtifact(''), null);
  fs.rmSync(none.workspace, { recursive: true, force: true });
});

test('ingest normalizes, lays out, and writes to the sibling topology graph', async () => {
  const client = fakeClient();
  const co = createTopologyCoordinator({ client, getConfig: cfgOn, resolveGroup: () => 'pocextrahop', logger: quiet });
  const s = makeSession();
  const result = await co.ingest(s.workspace);
  assert.equal(result.ok, true);
  assert.equal(result.nodes, 2);
  assert.equal(result.edges, 1);
  assert.ok(client.mutations.length > 0);
  for (const m of client.mutations) {
    assert.equal(m.graph, 'pocextrahoptopology', 'never writes to the memory graph');
  }
  assert.match(client.mutations.map((m) => m.cypher).join('\n'), /x: -?\d/, 'coordinates were computed and stored');
  fs.rmSync(s.workspace, { recursive: true, force: true });
});

test('ingest is inert when storage is disabled or the artifact is missing', async () => {
  const client = fakeClient();
  const off = createTopologyCoordinator({ client, getConfig: cfgOff, resolveGroup: () => 'g', logger: quiet });
  const s = makeSession();
  assert.equal((await off.ingest(s.workspace)).ok, false);
  assert.equal(client.mutations.length, 0);

  const on = createTopologyCoordinator({ client, getConfig: cfgOn, resolveGroup: () => 'g', logger: quiet });
  const empty = makeSession({ artifact: null });
  const res = await on.ingest(empty.workspace);
  assert.equal(res.ok, false);
  assert.match(res.reason, /no topology artifact/);
  assert.equal(client.mutations.length, 0);
  fs.rmSync(s.workspace, { recursive: true, force: true });
  fs.rmSync(empty.workspace, { recursive: true, force: true });
});

test('an artifact with no usable devices is refused rather than stored empty', async () => {
  const client = fakeClient();
  const co = createTopologyCoordinator({ client, getConfig: cfgOn, resolveGroup: () => 'g', logger: quiet });
  const s = makeSession({ artifact: { devices: [], edges: [] } });
  const res = await co.ingest(s.workspace);
  assert.equal(res.ok, false);
  assert.match(res.reason, /no usable devices/);
  assert.equal(client.mutations.length, 0);
  fs.rmSync(s.workspace, { recursive: true, force: true });
});

test('a user turn with a new artifact stores it exactly once', async () => {
  const client = fakeClient();
  const co = createTopologyCoordinator({ client, getConfig: cfgOn, resolveGroup: () => 'g', logger: quiet });
  const s = makeSession();
  co.attachSession(s);

  s.emit('agent_end', { promptSource: 'user' });
  await new Promise((r) => setTimeout(r, 50));
  const afterFirst = client.mutations.length;
  assert.ok(afterFirst > 0, 'stored on the first user turn');
  assert.ok(s.events.some((e) => e.type === 'topology_status' && e.status === 'stored'));

  // Same unchanged artifact on a later turn must not write a duplicate snapshot.
  s.emit('agent_end', { promptSource: 'user' });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(client.mutations.length, afterFirst, 'unchanged artifact is not re-stored');
  fs.rmSync(s.workspace, { recursive: true, force: true });
});

test('non-user turns and errored turns never trigger ingest', async () => {
  const client = fakeClient();
  const co = createTopologyCoordinator({ client, getConfig: cfgOn, resolveGroup: () => 'g', logger: quiet });
  const s = makeSession();
  co.attachSession(s);
  s.emit('agent_end', { promptSource: 'memory-capture' });
  s.emit('agent_end', { promptSource: 'user', hadError: true });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(client.mutations.length, 0);
  fs.rmSync(s.workspace, { recursive: true, force: true });
});

test('a rewritten artifact produces a new snapshot', async () => {
  const client = fakeClient();
  const co = createTopologyCoordinator({ client, getConfig: cfgOn, resolveGroup: () => 'g', logger: quiet });
  const s = makeSession();
  const first = artifactSignature(s.workspace);
  // Rewrite with different content (and a distinct mtime).
  await new Promise((r) => setTimeout(r, 10));
  fs.writeFileSync(path.join(s.workspace, 'evidence', 'topology', 'topology.json'),
    JSON.stringify({ ...ARTIFACT, devices: [...ARTIFACT.devices, { id: '3', ipaddr: '10.0.0.99' }] }));
  assert.notEqual(artifactSignature(s.workspace), first, 'signature tracks content changes');

  co.attachSession(s);
  s.emit('agent_end', { promptSource: 'user' });
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(client.mutations.length > 0);
  fs.rmSync(s.workspace, { recursive: true, force: true });
});

test('a storage failure is surfaced as an event, never thrown into the session', async () => {
  const client = {
    async mutate() { throw new Error('falkordb unreachable'); },
    async query() { return { columns: [], rows: [] }; },
  };
  const co = createTopologyCoordinator({ client, getConfig: cfgOn, resolveGroup: () => 'g', logger: quiet });
  const s = makeSession();
  co.attachSession(s);
  assert.doesNotThrow(() => s.emit('agent_end', { promptSource: 'user' }));
  await new Promise((r) => setTimeout(r, 50));
  const failed = s.events.find((e) => e.type === 'topology_status' && e.status === 'failed');
  assert.ok(failed, 'the failure is reported, not hidden');
  assert.match(failed.reason, /unreachable/);
  fs.rmSync(s.workspace, { recursive: true, force: true });
});

test('a session without a workspace is inert', async () => {
  const co = createTopologyCoordinator({ client: fakeClient(), getConfig: cfgOn, resolveGroup: () => 'g', logger: quiet });
  assert.equal(artifactSignature(undefined), '');
  assert.equal((await co.ingest(undefined)).ok, false);
});
