import assert from 'node:assert/strict';
import { test } from 'node:test';
import { settingsRouter } from './settings.js';
import { loadConfig } from '../lib/settings.js';
import { withServer } from '../lib/http-test-harness.js';

// A secret store holding distinctive values; none of these must appear in the
// public settings response — only the derived `*Set` booleans.
const SECRETS = {
  apiKey: 'SECRET-EXTRAHOP-APIKEY',
  clientId: 'SECRET-EXTRAHOP-CLIENTID',
  clientSecret: 'SECRET-EXTRAHOP-CLIENTSECRET',
  anthropicApiKey: 'SECRET-ANTHROPIC-KEY',
  claudeOauthToken: 'SECRET-CLAUDE-OAUTH',
  reversingLabsApiToken: 'SECRET-RL-TOKEN',
  braveApiKey: 'SECRET-BRAVE-KEY',
};

function mount() {
  const config = loadConfig('/nonexistent-settings-test-config.json', {});
  config.extrahop.host = 'eh.example.com';
  const secretStore = { source: 'memory', get: () => ({ ...SECRETS }) };
  return (app) => app.use('/api/settings', settingsRouter({
    getConfig: () => config,
    setConfig: () => {},
    secretStore,
    onConfigChanged: () => {},
    saveConfigFn: () => {},
  }));
}

test('GET /api/settings never leaks secret values, only *Set booleans', async () => {
  await withServer(mount(), async (base) => {
    const res = await fetch(`${base}/api/settings`);
    assert.equal(res.status, 200);
    const body = await res.json();

    // No raw secret string appears anywhere in the serialized response.
    const serialized = JSON.stringify(body);
    for (const secret of Object.values(SECRETS)) {
      assert.equal(serialized.includes(secret), false, `leaked secret: ${secret}`);
    }
    assert.equal(serialized.includes('SECRET-'), false);

    // The presence booleans are surfaced instead.
    assert.equal(body.anthropicKeySet, true);
    assert.equal(body.claudeOauthTokenSet, true);
    assert.equal(body.extrahop.apiKeySet, true);
    assert.equal(body.extrahop.clientIdSet, true);
    assert.equal(body.extrahop.clientSecretSet, true);
    assert.equal(body.integrations.reversingLabs.apiTokenSet, true);
    assert.equal(body.integrations.webResearch.braveApiKeySet, true);
    // Non-secret config is still returned.
    assert.equal(body.extrahop.host, 'eh.example.com');
  });
});
