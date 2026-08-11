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

/** Drive one handleRequest and return the parsed reply. */
async function askBroker(t, brokerOpts, argv, cwd = '/tmp') {
  let ExcliBroker;
  try {
    ({ ExcliBroker } = await import('./excli-broker.js'));
  } catch {
    t.skip('app dependencies not installed (settings/backends chain) — integration test runs in CI');
    return null;
  }
  const broker = new ExcliBroker({
    sessions: new Map(), getConfig: () => ({}), secretStore: {}, logger: { warn() {} }, ...brokerOpts,
  });
  broker.excliBinaryPath = '/nonexistent/excli'; // spawning would fail loudly
  const writes = [];
  let ended = false;
  const socket = { write: (s) => writes.push(s), end: () => { ended = true; }, removeAllListeners() {} };
  await broker.handleRequest(socket, JSON.stringify({ argv, cwd }));
  return { reply: JSON.parse(writes[0]), ended, writes };
}

test('a write tool is refused with NO flags set — not read-only, no session flag', async (t) => {
  // #135: this is the case that was missing. The refusal used to be conditional
  // on EH_BROKER_READONLY or session.options.readOnly, neither of which is set in
  // an ordinary user session, so writes executed against a live appliance while
  // the system prompt promised they could not.
  const out = await askBroker(t, {}, ['update_detection', '-json', '{"id":4294968622,"status":"closed"}']);
  if (!out) return;
  assert.equal(out.ended, true, 'socket closed');
  assert.match(out.reply.error, /write action and cannot be executed here/i);
  assert.match(out.reply.error, /propose-action/, 'points at the governed path');
  assert.match(out.reply.error, /do not claim the change happened/i);
});

test('every write-class capability is refused from the socket, flags or not', async (t) => {
  for (const tool of ['update_detection', 'create_investigation', 'assign_devicetag_to_devices', 'unassign_devicetag_from_devices', 'create_tuningrule']) {
    const out = await askBroker(t, {}, [tool, '-json', '{}']);
    if (!out) return;
    assert.match(out.reply.error, /cannot be executed here/i, `${tool} must be refused`);
  }
});

test('read tools are unaffected by the write guard', async (t) => {
  // The guard must not become a blanket refusal: a read still reaches cwd
  // resolution, which is what rejects this unknown workspace.
  const out = await askBroker(t, {}, ['search_records', '-json', '{}']);
  if (!out) return;
  assert.doesNotMatch(out.reply.error || '', /cannot be executed here/i, 'not refused as a write');
});

test('a write tool is still refused in read-only mode', async (t) => {
  const out = await askBroker(t, { readOnly: true }, ['update_detection', '-json', '{"id":1}']);
  if (!out) return;
  assert.equal(out.ended, true, 'socket closed');
  assert.match(out.reply.error, /cannot be executed here/i);
});

test('`-help` on a write tool is still allowed', async (t) => {
  // Reading a write tool's help is how the agent learns to propose it correctly.
  const out = await askBroker(t, {}, ['update_detection', '-help']);
  if (!out) return;
  assert.doesNotMatch(out.reply.error || '', /cannot be executed here/i);
});

test('excli 0.0.161 tuning rules: create is write+destructive, preview is read', () => {
  // Annotations copied from `./bin/excli -jsonschema` at excli 0.0.161.
  // create_tuningrule is the first tool upstream marks destructive: it hides
  // detection log entries, so a rule made in error suppresses future evidence.
  // It must stay write-class (hence refused on ./excli-interface and routed
  // through the governed approval path) while its read-only preview stays usable.
  const catalog = parseCapabilityCatalog(JSON.stringify([
    { name: 'create_tuningrule', annotations: { readOnlyHint: false, destructiveHint: true } },
    { name: 'preview_tuningrule', annotations: { readOnlyHint: true, destructiveHint: false } },
    { name: 'search_detectionlogs', annotations: { readOnlyHint: true, destructiveHint: false } },
  ]));
  assert.ok(catalog, 'catalog parses');
  assert.equal(catalog.get('create_tuningrule').accessType, 'write');
  assert.equal(catalog.get('create_tuningrule').destructive, true);
  assert.equal(catalog.get('preview_tuningrule').accessType, 'read');
  assert.equal(catalog.get('preview_tuningrule').destructive, false);

  assert.equal(isMutatingTool(['create_tuningrule', '-json', '{}'], catalog), true);
  assert.equal(isMutatingTool(['preview_tuningrule', '-json', '{}'], catalog), false);
  assert.equal(isMutatingTool(['search_detectionlogs', '-json', '{}'], catalog), false);

  // And with no catalog at all, the `create_` prefix must still block it, so a
  // binary newer than the cached catalog cannot slip a write through.
  assert.equal(isMutatingTool(['create_tuningrule', '-json', '{}']), true);
});
