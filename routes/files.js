import express from 'express';
import fs from 'node:fs';
import { createEvidenceSummaryContext, startDeviceEntityBackfills } from '../lib/evidence-backfill.js';
import { exportJsonFileAsCsv, summarizeEvidenceFile } from '../lib/evidence-summary.js';
import { sendPdf } from '../lib/pdf-export.js';
import { getSession } from '../lib/route-utils.js';
import { createUploadMiddleware } from '../lib/uploads.js';
import { detectWireshark, isPacketCapturePath, openPacketCaptureInWireshark } from '../lib/wireshark.js';
import { presentWorkspaceFiles } from '../lib/workspace-file-presentation.js';

export function filesRouter({
  sessions,
  startBackfills = startDeviceEntityBackfills,
  wiresharkDetector = detectWireshark,
  wiresharkOpener = openPacketCaptureInWireshark,
  logger = console,
} = {}) {
  const router = express.Router();
  const upload = createUploadMiddleware(sessions);

  router.post('/:id/files', upload.array('files', 10), (req, res) => {
    const session = getSession(sessions, req, res);
    if (!session) return;
    res.json({
      files: (req.files || []).map((f) => ({ name: f.filename, size: f.size })),
    });
  });

  router.get('/:id/files', (req, res) => {
    const session = getSession(sessions, req, res);
    if (!session) return;
    res.json({ files: presentWorkspaceFiles(session) });
  });

  router.get('/:id/summaries', (req, res) => {
    const session = getSession(sessions, req, res);
    if (!session) return;
    try {
      const context = createEvidenceSummaryContext(session);
      const result = summarizeEvidenceFile(session, req.query.path, context);
      if (result.pendingBackfills?.length) {
        startBackfills(session, result.pendingBackfills.map((item) => item.object_id), { logger });
      }
      return res.json({ ok: true, ...result });
    } catch (err) {
      return res.status(err.statusCode || 400).json({ error: err.message || 'Could not summarize evidence.' });
    }
  });

  router.post('/:id/files/*/open-wireshark', async (req, res) => {
    const session = getSession(sessions, req, res);
    if (!session) return;
    const relPath = decodeURIComponent(req.params[0] || '');
    if (!isPacketCapturePath(relPath)) {
      return res.status(400).json({ error: 'Only packet capture files can be opened in Wireshark.' });
    }
    let abs;
    try {
      abs = session.resolveFile(relPath);
    } catch {
      return res.status(400).json({ error: 'Invalid path' });
    }
    if (!fs.existsSync(abs) || !fs.lstatSync(abs).isFile()) {
      return res.status(404).json({ error: 'File not found' });
    }
    const availability = await wiresharkDetector();
    if (!availability.ok) {
      return res.status(409).json({ error: 'Wireshark is not installed or not available on this machine.' });
    }
    try {
      await wiresharkOpener(abs);
      return res.json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: err.message || 'Could not open Wireshark.' });
    }
  });

  // ?dl=1 forces a download; default serves inline for the in-app viewer.
  router.get('/:id/files/*', (req, res) => {
    const session = getSession(sessions, req, res);
    if (!session) return;
    let abs;
    try {
      abs = session.resolveFile(decodeURIComponent(req.params[0]));
    } catch {
      return res.status(400).json({ error: 'Invalid path' });
    }
    if (!fs.existsSync(abs) || !fs.lstatSync(abs).isFile()) {
      return res.status(404).json({ error: 'File not found' });
    }
    if (req.query.format === 'pdf') return sendPdf(res, abs, { sessionId: req.params.id });
    if (req.query.format === 'csv') {
      try {
        const result = exportJsonFileAsCsv(session, decodeURIComponent(req.params[0]));
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${result.filename.replace(/"/g, '')}"`);
        return res.send(result.csv);
      } catch (err) {
        return res.status(err.statusCode || 400).json({ error: err.message || 'Could not export CSV.' });
      }
    }
    if (req.query.dl) return res.download(abs);
    return res.sendFile(abs);
  });

  return router;
}
