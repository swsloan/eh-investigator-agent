import express from 'express';

export function backendUpdatesRouter({ manager }) {
  const router = express.Router();

  router.get('/', async (req, res) => {
    const status = await manager.checkActive({ force: req.query.refresh === '1' });
    res.json(status);
  });

  router.post('/', async (req, res) => {
    try {
      res.json(await manager.updateActive());
    } catch (err) {
      res.status(err.statusCode || 500).json({
        ...(err.publicState || {}),
        error: err.publicState?.message || err.message || 'Backend update failed.',
      });
    }
  });

  return router;
}
