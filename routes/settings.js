import express from 'express';
import { BACKENDS, detectBackends } from '../lib/backends/index.js';
import { applyUpdate, credentialsConfigured, publicSettings, saveConfig } from '../lib/settings.js';

async function backendOptions(force = false) {
  const availability = await detectBackends({ force });
  return BACKENDS.map((backend) => ({
    id: backend.id,
    label: backend.label,
    available: Boolean(availability[backend.id]?.ok),
    message: availability[backend.id]?.message || '',
  }));
}

export function settingsRouter({ getConfig, setConfig, secretStore, onConfigChanged, saveConfigFn = saveConfig }) {
  const router = express.Router();

  router.get('/', async (req, res) => {
    const config = getConfig();
    res.json({
      ...publicSettings(config, secretStore),
      backendOptions: await backendOptions(req.query.probe === '1'),
      credentialsConfigured: credentialsConfigured(config, secretStore),
    });
  });

  router.put('/', async (req, res) => {
    const previous = getConfig();
    let config;
    try {
      config = applyUpdate(previous, req.body || {}, { secretStore });
    } catch (err) {
      if (err?.code === 'INVALID_RX360_TENANT_ID') {
        return res.status(400).json({ error: err.message });
      }
      throw err;
    }
    setConfig(config);
    saveConfigFn(config);
    onConfigChanged?.(previous, config);
    res.json({
      ...publicSettings(config, secretStore),
      backendOptions: await backendOptions(),
      credentialsConfigured: credentialsConfigured(config, secretStore),
      note: 'Saved. Defaults apply to new/empty sessions; use the session model picker to switch an active session.',
    });
  });

  return router;
}
