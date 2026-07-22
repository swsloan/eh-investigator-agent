import express from 'express';
import { publicBackendInfo } from '../lib/backends/index.js';
import { credentialsConfigured } from '../lib/settings.js';
import { getSystemPreflight } from '../lib/system-preflight.js';
import { getAppVersion } from '../lib/app-version.js';

export function healthRouter({
  getConfig, sessions, root, getActiveBackend, getModelCatalog, secretStore,
  excliBroker, reversingLabsBroker, researchBroker, investigationPlanBroker,
}) {
  const router = express.Router();

  router.get('/health', (req, res) => {
    const config = getConfig();
    res.json({
      ok: true,
      version: getAppVersion(),
      backend: publicBackendInfo(getActiveBackend()),
      extrahopConfigured: credentialsConfigured(config, secretStore),
      host: config.extrahop.host || null,
      sessions: sessions.size,
    });
  });

  router.get('/preflight', async (req, res) => {
    const backend = getActiveBackend();
    const status = await getSystemPreflight({
      root,
      config: getConfig(),
      backend,
      modelCatalog: getModelCatalog(backend.id),
      secretStore,
      excliBroker,
      reversingLabsBroker,
      researchBroker,
      investigationPlanBroker,
    });
    res.status(status.ok ? 200 : 503).json(status);
  });

  return router;
}
