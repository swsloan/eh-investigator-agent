import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyUpdate,
  buildAgentEnv,
  buildExcliEnv,
  credentialsConfigured,
  deriveGroupId,
  loadConfig,
  publicSettings,
  rx360ApiHostFromTenantId,
  rx360TenantIdFromTarget,
  sanitizeGroupId,
} from './settings.js';

const baseConfig = () => loadConfig('/nonexistent-rx360-test-config.json', {});
const store = (secrets = {}) => ({ source: 'memory', get: () => ({ ...secrets }) });

test('rx360TenantIdFromTarget recovers the tenant from IDs and legacy hosts', () => {
  assert.equal(rx360TenantIdFromTarget('acme'), 'acme');
  assert.equal(rx360TenantIdFromTarget('ACME'), 'acme'); // lowercased
  assert.equal(rx360TenantIdFromTarget('acme.api.cloud.extrahop.com'), 'acme');
  assert.equal(rx360TenantIdFromTarget('acme.cloud.extrahop.com'), 'acme'); // legacy web host
  assert.equal(rx360TenantIdFromTarget('https://acme.cloud.extrahop.com/'), 'acme');
  assert.equal(rx360TenantIdFromTarget('acme.cloud.extrahop.com.'), 'acme'); // trailing dot
});

test('rx360TenantIdFromTarget rejects malformed / unsafe targets', () => {
  assert.equal(rx360TenantIdFromTarget(''), '');
  assert.equal(rx360TenantIdFromTarget('   '), '');
  assert.equal(rx360TenantIdFromTarget('not a tenant'), ''); // space
  assert.equal(rx360TenantIdFromTarget('acme.example.com'), ''); // wrong suffix
  assert.equal(rx360TenantIdFromTarget('acme.cloud.extrahop.com:8443'), ''); // port
  assert.equal(rx360TenantIdFromTarget('https://acme.cloud.extrahop.com/path'), ''); // path
});

test('rx360ApiHostFromTenantId builds the fixed API host, throws on non-tenant input', () => {
  assert.equal(rx360ApiHostFromTenantId('acme'), 'acme.api.cloud.extrahop.com');
  assert.equal(rx360ApiHostFromTenantId(''), '');
  assert.throws(() => rx360ApiHostFromTenantId('acme.cloud.extrahop.com'), { code: 'INVALID_RX360_TENANT_ID' });
  assert.throws(() => rx360ApiHostFromTenantId('https://acme'), { code: 'INVALID_RX360_TENANT_ID' });
});

test('applyUpdate: rx360 tenantId constructs the stored API host', () => {
  const next = applyUpdate(baseConfig(), { extrahop: { family: 'rx360', tenantId: 'acme' } });
  assert.equal(next.extrahop.family, 'rx360');
  assert.equal(next.extrahop.host, 'acme.api.cloud.extrahop.com');
});

test('applyUpdate: rx360 legacy host field is canonicalized; junk host throws', () => {
  const ok = applyUpdate(baseConfig(), { extrahop: { family: 'rx360', host: 'acme.cloud.extrahop.com' } });
  assert.equal(ok.extrahop.host, 'acme.api.cloud.extrahop.com');
  assert.throws(
    () => applyUpdate(baseConfig(), { extrahop: { family: 'rx360', host: 'nonsense.example.com' } }),
    { code: 'INVALID_RX360_TENANT_ID' },
  );
});

test('applyUpdate: enterprise host passes through unchanged', () => {
  const next = applyUpdate(baseConfig(), { extrahop: { family: 'enterprise', host: 'eda.example.com' } });
  assert.equal(next.extrahop.host, 'eda.example.com');
});

test('publicSettings exposes tenantId for rx360 and empty for enterprise', () => {
  const rx = baseConfig();
  rx.extrahop = { family: 'rx360', host: 'acme.api.cloud.extrahop.com' };
  assert.equal(publicSettings(rx, store()).extrahop.tenantId, 'acme');

  const ent = baseConfig();
  ent.extrahop = { family: 'enterprise', host: 'eda.example.com' };
  assert.equal(publicSettings(ent, store()).extrahop.tenantId, '');
});

test('buildExcliEnv canonicalizes rx360 host for the broker', () => {
  const rx = baseConfig();
  rx.extrahop = { family: 'rx360', host: 'acme' }; // bare tenant stored
  const env = buildExcliEnv(rx, store({ clientId: 'id', clientSecret: 'sec' }), {});
  assert.equal(env.EXTRAHOP_HOST, 'acme.api.cloud.extrahop.com');
  assert.equal(env.EXTRAHOP_CLIENT_ID, 'id');

  const ent = baseConfig();
  ent.extrahop = { family: 'enterprise', host: 'eda.example.com' };
  assert.equal(buildExcliEnv(ent, store({ apiKey: 'k' }), {}).EXTRAHOP_HOST, 'eda.example.com');
});

test('credentialsConfigured requires a valid tenant for rx360', () => {
  const rx = baseConfig();
  rx.extrahop = { family: 'rx360', host: 'acme.api.cloud.extrahop.com' };
  assert.equal(credentialsConfigured(rx, store({ clientId: 'id', clientSecret: 'sec' })), true);
  assert.equal(credentialsConfigured(rx, store({ clientId: 'id' })), false); // missing secret

  const bad = baseConfig();
  bad.extrahop = { family: 'rx360', host: '' };
  assert.equal(credentialsConfigured(bad, store({ clientId: 'id', clientSecret: 'sec' })), false);
});

test('the plan interface stays inert unless both halves of its env are present', () => {
  const socket = '/tmp/plan.sock';
  const capability = 'cap-abc';

  const wired = buildAgentEnv({}, {
    investigationPlanBrokerSocketPath: socket,
    investigationPlanCapability: capability,
  });
  assert.equal(wired.EH_INVESTIGATION_PLAN_BROKER_SOCKET, socket);
  assert.equal(wired.EH_INVESTIGATION_PLAN_CAPABILITY, capability);

  // A session with no live capability (e.g. an env rebuild that could not find
  // one) must not get a socket it cannot use — ./investigation-plan reports a
  // clear setup error instead of a capability rejection from the broker.
  for (const partial of [
    { investigationPlanBrokerSocketPath: socket },
    { investigationPlanCapability: capability },
    {},
  ]) {
    const env = buildAgentEnv({}, partial);
    assert.equal(env.EH_INVESTIGATION_PLAN_BROKER_SOCKET, undefined);
    assert.equal(env.EH_INVESTIGATION_PLAN_CAPABILITY, undefined);
  }
});

test('sanitizeGroupId keeps FalkorDB-safe alphanumerics only', () => {
  assert.equal(sanitizeGroupId('PocExtraHop'), 'pocextrahop');
  assert.equal(sanitizeGroupId('eh-lab.securityintersect.com'), 'ehlabsecurityintersectcom');
  assert.equal(sanitizeGroupId('  spaces & !@# '), 'spaces');
  assert.equal(sanitizeGroupId(''), '');
  assert.equal(sanitizeGroupId(undefined), '');
  assert.equal(sanitizeGroupId('x'.repeat(200)).length, 63, 'bounded length');
});

test('deriveGroupId precedence: env > config > host > default', () => {
  // Env wins because it is what the graphiti sidecar (GRAPHITI_GROUP_ID) uses,
  // so the app stays aligned with the actual write group.
  assert.equal(deriveGroupId('any.host', { EH_MEMORY_GROUP_ID: 'pocextrahop' }, 'configured'), 'pocextrahop');
  // With env unset, a persisted config group takes effect (sanitized).
  assert.equal(deriveGroupId('any.host', {}, 'PocExtraHop'), 'pocextrahop');
  // With neither, derive from the host.
  assert.equal(deriveGroupId('eh-lab.securityintersect.com', {}, ''), 'ehehlabsecurityintersectcom');
  // With nothing at all, the generic default (the silent-drift value we hit).
  assert.equal(deriveGroupId('', {}, ''), 'ehdefault');
});

test('applyUpdate persists a sanitized memory.groupId', () => {
  const next = applyUpdate(baseConfig(), { memory: { groupId: 'Poc-ExtraHop!' } });
  assert.equal(next.memory.groupId, 'pocextrahop');
  // Unset stays empty (derive/default behavior preserved).
  assert.equal(applyUpdate(baseConfig(), {}).memory.groupId, '');
});
