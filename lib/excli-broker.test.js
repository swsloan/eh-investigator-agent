// Read-only broker guard. Run: node --test lib/excli-broker.test.js
// The classifier tests use the dependency-free lib/excli-readonly.js so they run
// without node_modules; the handleRequest integration test loads the full broker
// and skips when app dependencies aren't installed (e.g. this source tree).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isMutatingTool,
  capabilityAccessType,
  isDestructiveCapability,
  parseCapabilityCatalog,
} from './excli-readonly.js';

test('isMutatingTool classifies read vs write tools', () => {
  for (const t of ['search_records', 'get_detection', 'execute_metric_query', 'download_pcap', 'search_devices', 'list_devicetags_for_device', 'get_appliance_metadata']) {
    assert.equal(isMutatingTool([t, '-json', '{}']), false, `${t} should be read-only`);
  }
  for (const t of ['update_detection', 'create_investigation', 'assign_devicetag_to_devices', 'unassign_devicetag_from_devices', 'delete_something', 'set_config']) {
    assert.equal(isMutatingTool([t, '-json', '{}']), true, `${t} should be mutating`);
  }
  assert.equal(isMutatingTool(['update_detection', '-help']), false, 'help on a write tool is read-only');
});

test('capabilityAccessType fails safe to write unless provably read-only', () => {
  assert.equal(capabilityAccessType({ readOnlyHint: true }), 'read');
  assert.equal(capabilityAccessType({ readOnlyHint: false }), 'write');
  assert.equal(capabilityAccessType({}), 'write', 'no hint => write');
  assert.equal(capabilityAccessType(null), 'write', 'no annotations => write');
  assert.equal(capabilityAccessType({ readOnlyHint: 'true' }), 'write', 'non-boolean hint => write');
});

test('isDestructiveCapability only true on explicit destructiveHint', () => {
  assert.equal(isDestructiveCapability({ destructiveHint: true }), true);
  assert.equal(isDestructiveCapability({ destructiveHint: false }), false);
  assert.equal(isDestructiveCapability(null), false);
});

test('parseCapabilityCatalog builds a classification map from -jsonschema output', () => {
  const schema = JSON.stringify([
    { name: 'get_detection', annotations: { readOnlyHint: true, destructiveHint: false } },
    { name: 'update_detection', annotations: { readOnlyHint: false, destructiveHint: false } },
    { name: 'purge_records', annotations: { readOnlyHint: false, destructiveHint: true } },
    { name: 'weird_tool' }, // no annotations => write (fail-safe)
    { notName: true }, // skipped
  ]);
  const catalog = parseCapabilityCatalog(schema);
  assert.equal(catalog.get('get_detection').accessType, 'read');
  assert.equal(catalog.get('update_detection').accessType, 'write');
  assert.equal(catalog.get('purge_records').destructive, true);
  assert.equal(catalog.get('weird_tool').accessType, 'write');
  assert.equal(catalog.has('nonexistent'), false);
});

test('parseCapabilityCatalog returns null on malformed/empty input', () => {
  assert.equal(parseCapabilityCatalog('not json'), null);
  assert.equal(parseCapabilityCatalog('{}'), null, 'object, not array');
  assert.equal(parseCapabilityCatalog('[]'), null, 'empty array => null (fall back to heuristic)');
});

test('isMutatingTool is annotation-first when a catalog is supplied', () => {
  // A catalog can correct the heuristic in BOTH directions.
  const catalog = parseCapabilityCatalog(JSON.stringify([
    // Heuristic would call this read (no mutating prefix), annotation says write.
    { name: 'tag_devices', annotations: { readOnlyHint: false } },
    // Heuristic would call this write (set_ prefix), annotation says read.
    { name: 'set_view_only', annotations: { readOnlyHint: true } },
  ]));
  assert.equal(isMutatingTool(['tag_devices', '-json', '{}'], catalog), true, 'annotation overrides read heuristic');
  assert.equal(isMutatingTool(['set_view_only', '-json', '{}'], catalog), false, 'annotation overrides write heuristic');
  // help is always read-only, even for an annotated write tool.
  assert.equal(isMutatingTool(['tag_devices', '-help'], catalog), false);
  // A tool absent from the catalog falls back to the heuristic.
  assert.equal(isMutatingTool(['delete_everything', '-json', '{}'], catalog), true, 'unknown tool => heuristic');
  assert.equal(isMutatingTool(['search_records', '-json', '{}'], catalog), false, 'unknown read tool => heuristic');
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
