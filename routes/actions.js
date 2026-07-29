import express from 'express';
import {
  readAction, listActions, transitionAction, isValidActionId, listActionsAcrossWorkspaces,
  isExpired,
} from '../lib/action-store.js';
import {
  isVerifiable, desiredStateFor, readbackState, preconditionOk, verifyWrite,
} from '../lib/action-verify.js';

/**
 * Human-in-the-loop approval surface for proposed write actions (Phase 1 + the
 * Phase B cross-session stream). Mounted behind the local-origin guard. HTTP
 * responses and the per-session SSE are redacted centrally in server.js (the
 * res.json override and broadcast()); the /stream endpoint writes SSE directly,
 * so it applies `redact` itself. The agent proposes (via the action broker);
 * this route is the ONLY place a proposal is approved and dispatched to the
 * privileged executor.
 */
export function actionsRouter({
  sessions,
  executeApproved,
  observe = async () => ({}), // (probes, {workspace}) => { subject: {ok,record,error} } — read-back
  broadcast = () => {},
  actionIndex = null,
  getSessionInfo = () => ({ title: '', running: false }),
  globalActionClients = new Set(),
  redact = (v) => v,
}) {
  const router = express.Router();

  /** GET /api/actions?session=:id — list a session's actions (newest first). */
  router.get('/', (req, res) => {
    const session = sessions.get(String(req.query.session || ''));
    if (!session) return res.status(404).json({ error: 'Session not found' });
    return res.json(listActions(session.workspace));
  });

  /**
   * GET /api/actions/pending — cross-session aggregate for the approval
   * dashboard: every open action (proposed/approved/executing) across all
   * sessions, oldest-first, each stamped with its origin session, plus
   * `pendingCount`. Served from the in-memory index (Phase B); falls back to a
   * filesystem scan if no index was wired. Read-only.
   */
  router.get('/pending', (req, res) => {
    if (actionIndex) return res.json(actionIndex.snapshot(getSessionInfo));
    const entries = [...sessions.values()].map((s) => ({
      sessionId: s.id,
      sessionTitle: s.title || 'New session',
      workspace: s.workspace,
    }));
    return res.json(listActionsAcrossWorkspaces(entries));
  });

  /**
   * GET /api/actions/stream — global SSE channel for the approval dashboard,
   * independent of any session. Sends the current pending count on connect and
   * on every action lifecycle change (fanned out from server.js broadcast()), so
   * the badge updates in real time; the panel re-fetches /pending on a poke. The
   * snapshot IS the resume, so no cursor is needed on reconnect.
   */
  router.get('/stream', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    const pendingCount = actionIndex ? actionIndex.snapshot(getSessionInfo).pendingCount : 0;
    res.write(`data: ${JSON.stringify(redact({ type: 'snapshot', pendingCount }))}\n\n`);
    globalActionClients.add(res);
    const keepalive = setInterval(() => {
      try { res.write(': keepalive\n\n'); } catch { /* closed */ }
    }, 15000);
    req.on('close', () => {
      clearInterval(keepalive);
      globalActionClients.delete(res);
    });
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
    // A stale proposal must not silently execute against drifted state: retire it
    // and refuse. Rejecting an expired proposal is still allowed (it's a no-op
    // cleanup), so only gate the approve path.
    if (decision === 'approve' && isExpired(action)) {
      try {
        const expired = transitionAction(session.workspace, id, 'expired', {
          decidedAt: new Date().toISOString(), decidedBy: 'system:expiry',
        });
        broadcast(session.id, { type: 'action_decided', action: expired });
      } catch { /* raced — fall through to the 409 */ }
      return res.status(409).json({ error: 'This proposal has expired. Ask the agent to re-propose it against current state.' });
    }
    // Don't race the agent mid-turn (it may be about to reference this action).
    if (session.running) {
      return res.status(409).json({ error: 'Wait for the agent to finish its turn before deciding an action.' });
    }

    const decidedAt = new Date().toISOString();

    // A persistence/transition failure (fs error, illegal state) must still send
    // a response — this is an async handler, and Express 4 does not route a
    // rejected promise to the error middleware, so an unguarded throw would hang
    // the request.
    try {
      if (decision === 'reject') {
        const updated = transitionAction(session.workspace, id, 'rejected', { decidedAt, decidedBy: 'user' });
        broadcast(session.id, { type: 'action_decided', action: updated });
        return res.json({ ok: true, action: updated });
      }

      // Approve → execute → verify. Persist the approval, then flip to executing
      // before dispatching so a crash mid-execution leaves a recoverable,
      // non-'proposed' record (it will never silently re-run). Broadcast every
      // transition so the open-action index reflects each persisted state.
      const { workspace } = session;
      const cap = action.capabilityId;
      const params = action.params || {};
      const verifiable = isVerifiable(cap);

      const approved = transitionAction(workspace, id, 'approved', { decidedAt, decidedBy: 'user' });
      broadcast(session.id, { type: 'action_decided', action: approved });
      const executing = transitionAction(workspace, id, 'executing', {});
      broadcast(session.id, { type: 'action_decided', action: executing });

      // Before-state capture + precondition revalidation (verifiable caps only).
      // A read-back failure here is non-fatal to the before-snapshot: preconditionOk
      // treats an unreadable target as drift and refuses to execute.
      let beforeState = null;
      const desiredState = desiredStateFor(cap, params);
      if (verifiable) {
        try { beforeState = await readbackState(cap, params, (p) => observe(p, { workspace })); }
        catch { beforeState = null; }
        const pre = preconditionOk(cap, beforeState);
        if (!pre.ok) {
          const blocked = transitionAction(workspace, id, 'failed', {
            beforeState, desiredState,
            result: { ok: false, error: `Precondition failed: ${pre.detail}` },
            verification: { status: 'precondition_failed', checkedAt: new Date().toISOString(), detail: pre.detail, mismatches: [] },
          });
          broadcast(session.id, { type: 'action_result', action: blocked });
          return res.status(409).json({ ok: false, action: blocked });
        }
      }

      let result;
      try {
        result = await executeApproved(executing, { workspace });
      } catch (err) {
        const failed = transitionAction(workspace, id, 'failed', {
          beforeState, desiredState,
          result: { ok: false, error: err.message || 'Execution failed before running.' },
        });
        broadcast(session.id, { type: 'action_result', action: failed });
        return res.status(500).json({ ok: false, action: failed });
      }

      // The write itself failed (excli non-zero) — no verification to do.
      if (!result.ok) {
        const failed = transitionAction(workspace, id, 'failed', { result, beforeState, desiredState });
        broadcast(session.id, { type: 'action_result', action: failed });
        return res.json({ ok: false, action: failed });
      }

      // Accepted. Without a verifier, that's the terminal `executed` (pre-Phase-3
      // meaning: accepted, not read-back-confirmed).
      if (!verifiable) {
        const done = transitionAction(workspace, id, 'executed', {
          result, beforeState, desiredState,
          verification: { status: 'unsupported', checkedAt: new Date().toISOString(), detail: 'No read-back verifier for this capability.', mismatches: [] },
        });
        broadcast(session.id, { type: 'action_result', action: done });
        return res.json({ ok: true, action: done });
      }

      // Read back and confirm the desired state actually holds.
      const verifying = transitionAction(workspace, id, 'verifying', { result, beforeState, desiredState });
      broadcast(session.id, { type: 'action_decided', action: verifying });
      const vw = await verifyWrite(cap, params, (p) => observe(p, { workspace }));
      const done = transitionAction(workspace, id, vw.actionStatus, {
        result, beforeState, desiredState, afterState: vw.afterState, verification: vw.verification,
      });
      broadcast(session.id, { type: 'action_result', action: done });
      return res.json({ ok: done.status === 'verified', action: done });
    } catch (err) {
      return res.status(500).json({ error: err.message || 'Could not record the action decision.' });
    }
  });

  return router;
}
