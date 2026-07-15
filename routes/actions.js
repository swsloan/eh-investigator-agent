import express from 'express';
import { readAction, listActions, transitionAction, isValidActionId } from '../lib/action-store.js';

/**
 * Human-in-the-loop approval surface for proposed write actions (Phase 1).
 * Mounted behind the local-origin guard + secret redaction like every other
 * mutating route. The agent proposes (via the action broker); this route is the
 * ONLY place a proposal is approved and dispatched to the privileged executor.
 */
export function actionsRouter({ sessions, executeApproved, broadcast = () => {}, redact = (v) => v }) {
  const router = express.Router();

  /** GET /api/actions?session=:id — list a session's actions (newest first). */
  router.get('/', (req, res) => {
    const session = sessions.get(String(req.query.session || ''));
    if (!session) return res.status(404).json({ error: 'Session not found' });
    return res.json(listActions(session.workspace));
  });

  /** POST /api/actions/:id/decide { session, decision: 'approve' | 'reject' } */
  router.post('/:id/decide', async (req, res) => {
    const { id } = req.params;
    if (!isValidActionId(id)) return res.status(400).json({ error: 'Invalid action id.' });

    const session = sessions.get(String(req.body?.session || ''));
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const decision = req.body?.decision;
    if (decision !== 'approve' && decision !== 'reject') {
      return res.status(400).json({ error: 'decision must be "approve" or "reject".' });
    }

    const action = readAction(session.workspace, id);
    if (!action || action.sessionId !== session.id) {
      return res.status(404).json({ error: 'Action not found' });
    }
    // One-shot: a decided action can never be re-decided.
    if (action.status !== 'proposed') {
      return res.status(409).json({ error: `This action was already ${action.status}.` });
    }
    // Don't race the agent mid-turn (it may be about to reference this action).
    if (session.running) {
      return res.status(409).json({ error: 'Wait for the agent to finish its turn before deciding an action.' });
    }

    const decidedAt = new Date().toISOString();

    if (decision === 'reject') {
      const updated = transitionAction(session.workspace, id, 'rejected', { decidedAt, decidedBy: 'user' });
      broadcast(session.id, { type: 'action_decided', action: updated });
      return res.json({ ok: true, action: updated });
    }

    // Approve → execute. Persist the approval, then flip to executing before
    // dispatching so a crash mid-execution leaves a recoverable, non-'proposed'
    // record (it will never silently re-run).
    transitionAction(session.workspace, id, 'approved', { decidedAt, decidedBy: 'user' });
    const executing = transitionAction(session.workspace, id, 'executing', {});
    broadcast(session.id, { type: 'action_decided', action: executing });

    let result;
    try {
      result = await executeApproved(executing, { workspace: session.workspace });
    } catch (err) {
      const failed = transitionAction(session.workspace, id, 'failed', {
        result: { ok: false, error: err.message || 'Execution failed before running.' },
      });
      broadcast(session.id, { type: 'action_result', action: failed });
      return res.status(500).json({ ok: false, action: failed });
    }

    const done = transitionAction(session.workspace, id, result.ok ? 'executed' : 'failed', { result });
    broadcast(session.id, { type: 'action_result', action: done });
    return res.json({ ok: result.ok, action: done });
  });

  return router;
}
