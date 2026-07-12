// Read-only broker guard. Run: node --test lib/excli-broker.test.js
// The classifier tests use the dependency-free lib/excli-readonly.js so they run
// without node_modules; the handleRequest integration test loads the full broker
// and skips when app dependencies aren't installed (e.g. this source tree).
import test from 'node:test';
import assert from 'node:assert/strict';
import { isMutatingTool } from './excli-readonly.js';

test('isMutatingTool classifies read vs write tools', () => {
  for (const t of ['search_records', 'get_detection', 'execute_metric_query', 'download_pcap', 'search_devices', 'list_devicetags_for_device', 'get_appliance_metadata']) {
    assert.equal(isMutatingTool([t, '-json', '{}']), false, `${t} should be read-only`);
  }
  for (const t of ['update_detection', 'create_investigation', 'assign_devicetag_to_devices', 'unassign_devicetag_from_devices', 'delete_something', 'set_config']) {
    assert.equal(isMutatingTool([t, '-json', '{}']), true, `${t} should be mutating`);
  }
  assert.equal(isMutatingTool(['update_detection', '-help']), false, 'help on a write tool is read-only');
});

test('handleRequest rejects a write tool in read-only mode before spawning', async (t) => {
  let ExcliBroker;
  try {
    ({ ExcliBroker } = await import('./excli-broker.js'));
  } catch {
    t.skip('app dependencies not installed (settings/backends chain) — integration test runs in CI');
    return;
  }
  const broker = new ExcliBroker({ sessions: new Map(), getConfig: () => ({}), secretStore: {}, readOnly: true, logger: { warn() {} } });
  broker.excliBinaryPath = '/nonexistent/excli';
  const writes = [];
  let ended = false;
  const socket = { write: (s) => writes.push(s), end: () => { ended = true; }, removeAllListeners() {} };

  broker.handleRequest(socket, JSON.stringify({ argv: ['update_detection', '-json', '{"id":1}'], cwd: '/tmp' }));

  assert.equal(ended, true, 'socket closed');
  assert.match(JSON.parse(writes[0]).error, /read-only/i, 'explains the read-only rejection');
});
