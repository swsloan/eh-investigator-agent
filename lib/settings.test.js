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
  resolveGroupId,
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

test('deriveGroupId precedence: config > env > host > default', () => {
  // The UI setting is the authority — a stale .env line must never silently
  // shadow it (that hidden-config trap is what fragmented memory originally).
  assert.equal(deriveGroupId('any.host', { EH_MEMORY_GROUP_ID: 'evallab' }, 'PocExtraHop'), 'pocextrahop');
  // With nothing configured, EH_MEMORY_GROUP_ID is the deployment default.
  assert.equal(deriveGroupId('any.host', { EH_MEMORY_GROUP_ID: 'evallab' }, ''), 'evallab');
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

test('resolveGroupId reports the effective namespace and where it came from', () => {
  const cfg = { memory: { groupId: '' }, extrahop: { host: 'eh-lab.securityintersect.com' } };
  // A configured group wins over an env default, and is reported as 'config'.
  assert.deepEqual(resolveGroupId({ memory: { groupId: 'pocextrahop' } }, { EH_MEMORY_GROUP_ID: 'evallab' }), { value: 'pocextrahop', source: 'config' });
  // Env only surfaces when nothing is configured.
  assert.deepEqual(resolveGroupId(cfg, { EH_MEMORY_GROUP_ID: 'evallab' }), { value: 'evallab', source: 'env' });
  assert.deepEqual(resolveGroupId(cfg, {}), { value: 'ehehlabsecurityintersectcom', source: 'host' });
  assert.deepEqual(resolveGroupId({}, {}), { value: 'ehdefault', source: 'default' });
});

test('publicSettings exposes the effective group for the picker', () => {
  const cfg = baseConfig();
  cfg.memory = { ...cfg.memory, groupId: 'pocextrahop' };
  const pub = publicSettings(cfg, store());
  assert.equal(pub.memory.groupId, 'pocextrahop', 'the configured value round-trips to the field');
  assert.equal(pub.memory.groupIdEffective, 'pocextrahop');
  assert.equal(pub.memory.groupIdSource, 'config');
});

test('the tuning socket reaches the agent env, and carries no credential', () => {
  const socket = '/tmp/tuning.sock';
  const cfg = { extrahop: { host: 'eda.lab' } };

  const wired = buildAgentEnv(cfg, { tuningBrokerSocketPath: socket });
  assert.equal(wired.EH_TUNING_BROKER_SOCKET, socket);
  // Suppression visibility is read-only and always useful, so unlike the
  // ReversingLabs socket it is not gated on an integration toggle.
  assert.equal(buildAgentEnv(cfg, {}).EH_TUNING_BROKER_SOCKET, undefined);

  // The whole point of brokering: the agent gets a socket, never a credential.
  // The broker resolves ExtraHop auth in-process.
  const env = buildAgentEnv(cfg, { tuningBrokerSocketPath: socket });
  for (const key of Object.keys(env)) {
    assert.doesNotMatch(key, /API_KEY|CLIENT_SECRET|APIKEY/i, `${key} must not be in the agent env`);
  }
  assert.equal(env.EXTRAHOP_API_KEY, undefined);
  assert.equal(env.EXTRAHOP_CLIENT_SECRET, undefined);
});

test('falcon settings normalize, and a bad module list falls back rather than reaching the CLI', () => {
  const normalizeConfig = (cfg) => applyUpdate(baseConfig(), cfg);
  const d = normalizeConfig({}).falcon;
  assert.equal(d.enabled, false, 'off until explicitly enabled');
  assert.match(d.url, /^http/);
  assert.equal(d.modules, 'detections,hosts,incidents,intel');

  const ok = normalizeConfig({ falcon: { enabled: true, modules: 'detections,hosts' } }).falcon;
  assert.equal(ok.enabled, true);
  assert.equal(ok.modules, 'detections,hosts');

  // The module string is passed to falcon-mcp's argv. Anything outside the
  // expected charset falls back to the default set instead of being forwarded.
  for (const bad of ['detections; rm -rf /', 'a b', '$(whoami)', '']) {
    assert.equal(
      normalizeConfig({ falcon: { modules: bad } }).falcon.modules,
      'detections,hosts,incidents,intel',
      `"${bad}" should not survive normalization`,
    );
  }
});

test('falcon credentials can actually be entered, and are never echoed back', () => {
  const secrets = {};
  const st = {
    source: 'memory',
    get: () => ({ ...secrets }),
    update: (patch) => Object.assign(secrets, patch),
  };
  let cfg = applyUpdate(baseConfig(), {
    falcon: { enabled: true, clientId: 'CID-abc', clientSecret: 'CSEC-xyz' },
  }, { secretStore: st });

  assert.equal(secrets.falconClientId, 'CID-abc');
  assert.equal(secrets.falconClientSecret, 'CSEC-xyz');
  // The secret must never be persisted into config.json.
  assert.equal(JSON.stringify(cfg).includes('CSEC-xyz'), false, 'secret stays out of the config');

  const pub = publicSettings(cfg, st);
  assert.equal(pub.falcon.enabled, true);
  assert.equal(pub.falcon.credentialsSet, true);
  assert.equal(pub.falcon.configured, true, 'toggle + credentials = the agent sees the server');
  assert.equal(JSON.stringify(pub).includes('CSEC-xyz'), false, 'publicSettings never echoes the secret');

  // '' keeps the existing value (a UI that submits an untouched field).
  cfg = applyUpdate(cfg, { falcon: { clientSecret: '' } }, { secretStore: st });
  assert.equal(secrets.falconClientSecret, 'CSEC-xyz');
  // '-' clears it, and the capability stops being advertised.
  cfg = applyUpdate(cfg, { falcon: { clientSecret: '-' } }, { secretStore: st });
  assert.equal(secrets.falconClientSecret, '');
  assert.equal(publicSettings(cfg, st).falcon.configured, false);
});

test('falcon enabled without credentials is reported as not configured', () => {
  // The distinction the gating depends on: the toggle alone must not read as
  // "the agent has Falcon", or an operator sees an enabled feature that is absent.
  const st = { source: 'memory', get: () => ({}), update: () => {} };
  const cfg = applyUpdate(baseConfig(), { falcon: { enabled: true } }, { secretStore: st });
  const pub = publicSettings(cfg, st);
  assert.equal(pub.falcon.enabled, true);
  assert.equal(pub.falcon.credentialsSet, false);
  assert.equal(pub.falcon.configured, false);
});
