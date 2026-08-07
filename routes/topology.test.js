import assert from 'node:assert/strict';
import { test } from 'node:test';
import { topologyRouter } from './topology.js';
import { withServer } from '../lib/http-test-harness.js';

// The reads take `?group=`; a write carries a JSON body and puts the group there.
// `pickGroup` originally read only the query string, so `PUT /segment-name`
// discarded the group the client asked for and fell back to the resolved one —
// invisible on a single-group deployment, and a write into the wrong graph on any
// other. These tests pin both sources.

const GRAPHS = ['pocextrahoptopology', 'otherenvtopology'];

/** Records every mutation so a test can assert which graph was written. */
function fakeClient() {
  const mutations = [];
  return {
    mutations,
    async listGraphs() { return GRAPHS; },
    async mutate(graph, cypher) { mutations.push({ graph, cypher }); return { columns: [], rows: [] }; },
    async query() { return { columns: ['key', 'name'], rows: [] }; },
  };
}

function mount(client, { resolveGroup = () => 'pocextrahop' } = {}) {
  return (app) => app.use('/api/topology', topologyRouter({
    getConfig: () => ({ memory: { enabled: true } }),
    client,
    coordinator: null,
    sessions: new Map(),
    resolveGroup,
  }));
}

const nameIt = (base, body) => fetch(`${base}/api/topology/segment-name`, {
  method: 'PUT',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

test('a write honours the group in the request body', async () => {
  const client = fakeClient();
  await withServer(mount(client), async (base) => {
    const res = await nameIt(base, { key: 'vlan:20', name: 'Storage & Backup', group: 'otherenv' });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).group, 'otherenv');
  });
  // The name must land in the requested group's sibling graph, not the resolved one.
  const write = client.mutations.find((m) => /TopoSegmentName/.test(m.cypher));
  assert.equal(write.graph, 'otherenvtopology');
});

test('the query string still wins, and still overrides the resolved group', async () => {
  const client = fakeClient();
  await withServer(mount(client), async (base) => {
    const res = await fetch(`${base}/api/topology/segment-name?group=otherenv`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      // A body that disagrees with the query string: the query string is explicit
      // routing and takes precedence.
      body: JSON.stringify({ key: 'vlan:20', name: 'Storage', group: 'pocextrahop' }),
    });
    assert.equal(res.status, 200);
  });
  assert.equal(client.mutations.find((m) => /TopoSegmentName/.test(m.cypher)).graph, 'otherenvtopology');
});

test('with no group anywhere it falls back to the resolved one', async () => {
  const client = fakeClient();
  await withServer(mount(client), async (base) => {
    assert.equal((await nameIt(base, { key: 'vlan:20', name: 'Storage' })).status, 200);
  });
  assert.equal(client.mutations.find((m) => /TopoSegmentName/.test(m.cypher)).graph, 'pocextrahoptopology');
});

test('an unknown group cannot reach FalkorDB as a graph key', async () => {
  const client = fakeClient();
  await withServer(mount(client), async (base) => {
    await nameIt(base, { key: 'vlan:20', name: 'Storage', group: 'no-such-env' });
  });
  // Not in the live graph list, so it is refused and the resolved group is used.
  assert.equal(client.mutations.find((m) => /TopoSegmentName/.test(m.cypher)).graph, 'pocextrahoptopology');
});

test('a write still requires a segment key', async () => {
  const client = fakeClient();
  await withServer(mount(client), async (base) => {
    const res = await nameIt(base, { name: 'Storage', group: 'otherenv' });
    assert.equal(res.status, 400);
  });
  assert.equal(client.mutations.length, 0, 'nothing is written without a key');
});
