// Privileged executor guard rules for the governed write path.
// Run: node --test lib/action-execute.test.js
// These assert the security invariants of ExcliBroker.executeApproved WITHOUT
// ever spawning excli: every rejection must happen before the binary runs.
import test from 'node:test';
import assert from 'node:assert/strict';

let ExcliBroker;
try {
  ({ ExcliBroker } = await import('./excli-broker.js'));
} catch {
  // App dependencies (settings/backends chain) not installed in this tree.
  test('executeApproved guards', { skip: 'app dependencies not installed — runs in CI' }, () => {});
}

function brokerWithCatalog({ readOnly = false } = {}) {
  const broker = new ExcliBroker({ sessions: new Map(), getConfig: () => ({}), secretStore: {}, readOnly, logger: { warn() {}, info() {} } });
  // Pin a known catalog so classification is deterministic (no live binary).
  broker.catalog = new Map([
    ['update_detection', { accessType: 'write', destructive: false }],
    ['get_detection', { accessType: 'read', destructive: false }],
  ]);
  // Point at a binary that does not exist; a guard must reject before we'd spawn it.
  broker.excliBinaryPath = '/nonexistent/excli';
  return broker;
}

const approved = (over = {}) => ({ id: 'a', status: 'approved', capabilityId: 'update_detection', params: { id: 1 }, ...over });

test('executeApproved runs only on an approved action', async () => {
  if (!ExcliBroker) return;
  const broker = brokerWithCatalog();
  await assert.rejects(() => broker.executeApproved(approved({ status: 'proposed' }), { workspace: '/tmp' }), /approved action/i);
  await assert.rejects(() => broker.executeApproved(approved({ status: 'executed' }), { workspace: '/tmp' }), /approved action/i);
});

test('executeApproved refuses a non-write capability (defense in depth)', async () => {
  if (!ExcliBroker) return;
  const broker = brokerWithCatalog();
  await assert.rejects(
    () => broker.executeApproved(approved({ capabilityId: 'get_detection' }), { workspace: '/tmp' }),
    /not a write capability/i,
  );
});

test('executeApproved refuses to run in read-only mode even after approval', async () => {
  if (!ExcliBroker) return;
  const broker = brokerWithCatalog({ readOnly: true });
  await assert.rejects(() => broker.executeApproved(approved(), { workspace: '/tmp' }), /read-only/i);
});

test('executeApproved rejects a workspace outside any known session', async () => {
  if (!ExcliBroker) return;
  const broker = brokerWithCatalog();
  // sessions map is empty, so resolveAllowedCwd rejects the workspace before spawning.
  await assert.rejects(() => broker.executeApproved(approved(), { workspace: '/tmp' }), /outside|does not exist|working directory/i);
});

test('describeCapability reflects the catalog and warm-up state', async () => {
  if (!ExcliBroker) return;
  const broker = brokerWithCatalog();
  assert.deepEqual(broker.describeCapability('update_detection'), { catalogLoaded: true, known: true, accessType: 'write', destructive: false });
  assert.equal(broker.describeCapability('get_detection').accessType, 'read');
  assert.equal(broker.describeCapability('brand_new_tool').known, false, 'unknown tool not in catalog');
  // With no catalog loaded, fall back to the heuristic and flag warm-up.
  broker.catalog = null;
  const warm = broker.describeCapability('update_detection');
  assert.equal(warm.catalogLoaded, false);
  assert.equal(warm.accessType, 'write', 'heuristic still classifies update_* as write during warm-up');
});
