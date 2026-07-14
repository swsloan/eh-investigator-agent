// Research broker guards + provider resolution. Run: node --test lib/research-broker.test.js
// The workspace-confinement guard is exercised without any network access.
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { researchSettings, ResearchService } from './research/service.js';

function fakeSocket() {
  const writes = [];
  return { destroyed: false, ended: false, write(s) { writes.push(s); }, end() { this.ended = true; }, removeAllListeners() {}, writes };
}

async function loadBroker(t) {
  try {
    return (await import('./research-broker.js')).ResearchBroker;
  } catch {
    t.skip('app dependencies not installed — integration test runs in CI');
    return null;
  }
}

test('researchSettings resolves the effective provider', () => {
  const braved = { get: () => ({ braveApiKey: 'k' }) };
  const empty = { get: () => ({}) };
  assert.equal(researchSettings({ integrations: { webResearch: { provider: 'auto' } } }, braved).effectiveProvider, 'brave');
  assert.equal(researchSettings({ backend: 'claude', integrations: { webResearch: { provider: 'auto' } } }, empty).effectiveProvider, 'claude');
  assert.equal(researchSettings({ backend: 'pi', integrations: { webResearch: { provider: 'auto' } } }, empty).effectiveProvider, 'duckduckgo');
  assert.equal(researchSettings({ integrations: { webResearch: { provider: 'duckduckgo' } } }, braved).effectiveProvider, 'duckduckgo');
});

test('service rejects a query containing a configured secret or internal host (exfil guard)', async () => {
  const svc = new ResearchService({
    getConfig: () => ({ extrahop: { host: 'eda.corp.example' } }),
    secretStore: { values: () => ['s3cr3t-token'], get: () => ({}) },
  });
  await assert.rejects(svc.execute('search', { query: 'lookup s3cr3t-token' }), /configured secret/);
  await assert.rejects(svc.execute('search', { query: 'what is eda.corp.example' }), /internal hostname|non-public/);
  await assert.rejects(svc.execute('fetch', { url: 'https://10.0.0.9/' }), /Research fetch|non-public/);
});

test('broker rejects a working directory outside every session workspace', async (t) => {
  const ResearchBroker = await loadBroker(t);
  if (!ResearchBroker) return;
  const broker = new ResearchBroker({ sessions: new Map(), getConfig: () => ({}), secretStore: { values: () => [], get: () => ({}) } });
  const socket = fakeSocket();
  await broker.handleRequest(socket, JSON.stringify({ operation: 'search', payload: { query: 'x' }, cwd: os.tmpdir() }));
  assert.equal(socket.ended, true);
  assert.match(JSON.parse(socket.writes[0]).error, /workspace/i);
});

test('broker rejects a request with no working directory', async (t) => {
  const ResearchBroker = await loadBroker(t);
  if (!ResearchBroker) return;
  const broker = new ResearchBroker({ sessions: new Map(), getConfig: () => ({}), secretStore: { values: () => [], get: () => ({}) } });
  const socket = fakeSocket();
  await broker.handleRequest(socket, JSON.stringify({ operation: 'status', payload: {} }));
  assert.equal(socket.ended, true);
  assert.match(JSON.parse(socket.writes[0]).error, /working directory/i);
});
