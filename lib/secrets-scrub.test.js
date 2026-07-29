// The secret boundary between the control plane and the agent worker (#24).
// buildScrubbedEnv is what every agent CLI is spawned with; it must never carry
// an app/infra secret into a process where a "worker shell" could read it.
// Run: node --test lib/secrets-scrub.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildScrubbedEnv,
  INFRA_SECRET_ENV_KEYS,
  EXTRA_HOP_SECRET_ENV_KEYS,
  REVERSING_LABS_ENV_KEYS,
  RESEARCH_ENV_KEYS,
} from './secrets.js';

// A control-plane env carrying every secret the app can hold, plus benign vars.
function fullSecretEnv() {
  return {
    // ExtraHop
    EXTRAHOP_HOST: 'https://eh-lab',
    EXTRAHOP_API_KEY: 'eh-key',
    EXTRAHOP_CLIENT_ID: 'eh-id',
    EXTRAHOP_CLIENT_SECRET: 'eh-secret',
    // ReversingLabs
    RL_API_TOKEN: 'rl-token',
    REVERSINGLABS_API_TOKEN: 'rl-token-2',
    // Brave / research
    BRAVE_SEARCH_API_KEY: 'brave-key',
    EH_RESEARCH_PROVIDER: 'brave',
    // App / infra secrets
    EH_MEMORY_PROXY_TOKEN: 'proxy-token',
    EH_AUTH_TOKEN: 'ui-auth-token',
    FALKORDB_PASSWORD: 'falkor-pw',
    FALKORDB_URI: 'redis://falkordb:6379',
    OPENAI_API_KEY: 'openai-key',
    // Benign / needed
    PATH: '/usr/bin',
    HOME: '/root',
    EH_MEMORY_MCP_URL: 'http://graphiti-mcp:8000/mcp',
    ANTHROPIC_API_KEY: 'anthropic-key',
  };
}

test('the worker env carries NONE of the ExtraHop/RL/Brave/infra secrets', () => {
  const env = buildScrubbedEnv(fullSecretEnv());
  const mustBeGone = [
    ...EXTRA_HOP_SECRET_ENV_KEYS,
    ...REVERSING_LABS_ENV_KEYS,
    ...RESEARCH_ENV_KEYS,
    ...INFRA_SECRET_ENV_KEYS,
  ];
  for (const key of mustBeGone) {
    assert.ok(!(key in env), `${key} must be scrubbed from the worker env`);
  }
  // The acceptance-criterion secrets, explicitly:
  assert.equal(env.EH_MEMORY_PROXY_TOKEN, undefined, 'memory-proxy token gone');
  assert.equal(env.EH_AUTH_TOKEN, undefined, 'UI/API auth token gone');
  assert.equal(env.EXTRAHOP_API_KEY, undefined, 'ExtraHop key gone');
  assert.equal(env.RL_API_TOKEN, undefined, 'ReversingLabs token gone');
  assert.equal(env.BRAVE_SEARCH_API_KEY, undefined, 'Brave key gone');
  assert.equal(env.FALKORDB_PASSWORD, undefined, 'FalkorDB password gone');
});

test('benign and worker-needed vars pass through', () => {
  const env = buildScrubbedEnv(fullSecretEnv());
  assert.equal(env.PATH, '/usr/bin');
  assert.equal(env.HOME, '/root');
  assert.equal(env.EH_MEMORY_MCP_URL, 'http://graphiti-mcp:8000/mcp', 'the MCP URL is not a secret and the worker needs it');
});

test('the Anthropic model credential is intentionally preserved (agent-owned)', () => {
  // It is the agent's own model key, not an app/infra secret; the Claude backend
  // manages it per auth-mode (subscription mode deletes it separately).
  const env = buildScrubbedEnv(fullSecretEnv());
  assert.equal(env.ANTHROPIC_API_KEY, 'anthropic-key');
});

test('scrubbing does not mutate the caller-provided base env', () => {
  const base = fullSecretEnv();
  buildScrubbedEnv(base);
  assert.equal(base.EH_AUTH_TOKEN, 'ui-auth-token', 'base env is copied, not scrubbed in place');
});

test('an infra secret cannot be re-introduced through additions', () => {
  // Even if a caller passed a secret in additions, the scrub runs afterward.
  const env = buildScrubbedEnv({ PATH: '/bin' }, { EH_AUTH_TOKEN: 'sneaky', FOO: 'ok' });
  assert.equal(env.EH_AUTH_TOKEN, undefined);
  assert.equal(env.FOO, 'ok', 'non-secret additions still pass through');
});
