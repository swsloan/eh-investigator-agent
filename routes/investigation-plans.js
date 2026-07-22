import express from 'express';
import {
  readInvestigationPlanView,
  renderInvestigationPlanHtml,
} from '../lib/investigation-plan.js';
import { getSession } from '../lib/route-utils.js';

// The plan store is synchronous, so a contended lock parks the event loop for
// the whole wait. Agent mutations arrive through the broker and keep the 200 ms
// default — losing a write is worse than a brief stall. These UI reads take the
// opposite trade: fail fast with a retryable 409 rather than stall every other
// request. Contention should be unreachable anyway (the store cannot re-enter
// within a process and the CLI has no local execution path), so this is the
// blast radius of a surprise, not a routine cost.
const READ_LOCK = Object.freeze({ lock: Object.freeze({ timeoutMs: 25 }) });

function safeStatusCode(err) {
  const value = Number(err?.statusCode);
  return Number.isInteger(value) && value >= 400 && value <= 599 ? value : 500;
}

function warn(logger, session, operation, err) {
  const code = String(err?.code || err?.name || 'unknown').slice(0, 80);
  logger?.warn?.(`[investigation-plan:${session.id.slice(0, 8)}] ${operation} failed (${code})`);
}

export function investigationPlansRouter({
  sessions,
  readPlanView = readInvestigationPlanView,
  renderPlanHtml = renderInvestigationPlanHtml,
  logger = console,
} = {}) {
  const router = express.Router();

  router.get('/:id/investigation-plan', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const session = getSession(sessions, req, res);
    if (!session) return;
    try {
      const view = await readPlanView(session.workspace, READ_LOCK);
      return res.json(view);
    } catch (err) {
      warn(logger, session, 'read', err);
      return res.status(safeStatusCode(err)).json({
        error: 'The investigation plan could not be loaded.',
      });
    }
  });

  router.get('/:id/investigation-plan/render', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const session = getSession(sessions, req, res);
    if (!session) return;
    try {
      const view = await readPlanView(session.workspace, READ_LOCK);
      const html = await renderPlanHtml(view);
      if (Number.isSafeInteger(view.revision)) {
        res.setHeader('X-Investigation-Plan-Revision', String(view.revision));
      }
      return res.type('html').send(html);
    } catch (err) {
      warn(logger, session, 'render', err);
      return res.status(safeStatusCode(err)).json({
        error: 'The investigation plan could not be rendered.',
      });
    }
  });

  return router;
}
