import express from 'express';
import { getBackend, publicBackendInfo } from '../lib/backends/index.js';

export function modelsRouter({ getActiveBackend, getModelCatalog }) {
  const router = express.Router();

  // Model catalog for the active backend, or ?backend=<id> so the settings UI
  // can browse a backend's models before switching to it.
  router.get('/', async (req, res) => {
    const requested = typeof req.query.backend === 'string' ? getBackend(req.query.backend) : null;
    const backend = requested || getActiveBackend();
    const search = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    try {
      res.json({
        backend: publicBackendInfo(backend),
        models: await getModelCatalog(backend.id).list(search),
        source: backend.id,
        generatedAt: Date.now(),
      });
    } catch (err) {
      const status = err.code === 'ENOENT' ? 503 : 500;
      const detail = (err.stderr || err.message || '').trim().split('\n').slice(-3).join(' ');
      res.status(status).json({
        backend: publicBackendInfo(backend),
        models: [],
        error: status === 503
          ? `The ${backend.label} CLI was not found on PATH.`
          : `Could not load ${backend.label} models${detail ? `: ${detail}` : '.'}`,
      });
    }
  });

  return router;
}
