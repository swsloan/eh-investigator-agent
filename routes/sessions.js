import express from 'express';
import fs from 'node:fs';
import { getBackend } from '../lib/backends/index.js';
import { sessionSummary } from '../lib/session-store.js';
import { getSession } from '../lib/route-utils.js';
import { validateAttachments } from '../lib/uploads.js';
import { containsSecretMaterial } from '../lib/redaction.js';
import { renderPendingActionsBlock } from '../lib/action-store.js';

export function sessionsRouter({
  sessions,
  sseClients,
  createSession,
  generateTitle,
  getConfig, // resolved view: active backend's model prefs at the root
  getActiveBackend,
  getModelCatalog,
  secretStore,
  brokerSocketPath,
  buildSessionEnv,
  onSessionRemoved = () => {},
  challenger,
  redact = (value) => value,
}) {
  const router = express.Router();

  /** Sessions are pinned to the backend that created them; conversation
   *  history lives inside that harness and cannot cross over. */
  function rejectForeignBackend(session, res) {
    const active = getActiveBackend();
    if (!session.backend || session.backend === active.id) return false;
    const label = getBackend(session.backend)?.label || session.backend;
    res.status(409).json({
      error: `This session was created with ${label}. Switch the backend to ${label} in Settings to continue it.`,
    });
    return true;
  }

  router.get('/', (req, res) => {
    res.json([...sessions.values()].map(sessionSummary));
  });

  router.post('/', (req, res) => {
    // Reuse an existing empty session instead of stacking blank ones.
    const active = getActiveBackend();
    const empty = [...sessions.values()]
      .find((s) => s.promptCount === 0 && (!s.backend || s.backend === active.id));
    if (empty) return res.json(sessionSummary(empty));
    const session = createSession();
    return res.json(sessionSummary(session));
  });

  router.get('/:id/events', (req, res) => {
    const session = getSession(sessions, req, res);
    if (!session) return;

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    // Replay history so a (re)connecting client can rebuild the conversation.
    res.write(`data: ${JSON.stringify({
      type: 'snapshot',
      running: session.running,
      backend: session.backend,
      state: session.agentState || {
        requestedModel: session.options.model || '',
        requestedThinking: session.options.thinking || '',
        modelPinned: session.modelPinned,
      },
      events: session.transcript,
    })}\n\n`);

    if (!sseClients.has(session.id)) sseClients.set(session.id, new Set());
    sseClients.get(session.id).add(res);

    const keepalive = setInterval(() => res.write(': keepalive\n\n'), 25_000);
    req.on('close', () => {
      clearInterval(keepalive);
      sseClients.get(session.id)?.delete(res);
    });
  });

  router.post('/:id/message', (req, res) => {
    const session = getSession(sessions, req, res);
    if (!session) return;
    if (rejectForeignBackend(session, res)) return;
    const { text, attachments } = req.body || {};
    let safeAttachments;
    try {
      safeAttachments = validateAttachments(session, attachments || []);
    } catch (err) {
      return res.status(err.statusCode || 400).json({ error: err.message || 'Invalid attachments' });
    }
    if (!text?.trim() && !safeAttachments.length) {
      return res.status(400).json({ error: 'Empty message' });
    }
    if (session.running) {
      return res.status(409).json({ error: 'Agent is already working — abort first or wait.' });
    }
    if (containsSecretMaterial(text || '', secretStore)) {
      return res.status(400).json({
        error: 'That message appears to contain ExtraHop credentials. Add or update credentials in Settings instead of sending them to the model.',
      });
    }

    let message = text?.trim() || 'Please look at the file(s) I shared.';
    if (safeAttachments.length) {
      const lines = safeAttachments.map((a) => `- ./uploads/${a.name} (${a.size} bytes)`);
      message += `\n\n[The user shared ${safeAttachments.length} file(s) with you, saved in your working directory:\n${lines.join('\n')}]`;
    }
    // Prepend the live status of any actions this session proposed, so the model
    // never re-proposes or misreports a write. Server-generated (trusted) context.
    const pendingActions = renderPendingActionsBlock(session.workspace);
    if (pendingActions) message = `${pendingActions}\n\n${message}`;
    const isFirst = session.promptCount === 0;
    if (isFirst && !session.modelPinned) {
      const config = getConfig();
      // Rebuild the full session env (incl. Claude auth) — not bare buildAgentEnv,
      // which would drop the API key / OAuth token on a reused empty session.
      const { env, claudeSubscription } = buildSessionEnv(config, session.backend, session);
      session.applyDefaults({
        model: config.mainModel || '',
        thinking: config.mainReasoning || '',
        env,
      });
      session.options.subscriptionAuth = claudeSubscription;
    }
    session.prompt(message);
    if (isFirst) generateTitle(session, text?.trim() || message).catch((err) => {
      console.error(`[title:${session.id.slice(0, 8)}]`, redact(err.message));
    });
    return res.json({ ok: true });
  });

  router.post('/:id/abort', (req, res) => {
    const session = getSession(sessions, req, res);
    if (!session) return;
    session.abort();
    res.json({ ok: true });
  });

  router.patch('/:id', (req, res) => {
    const session = getSession(sessions, req, res);
    if (!session) return;
    // Toggle the "keep for review" flag.
    if (typeof req.body?.saved === 'boolean') {
      session.setSaved(req.body.saved);
      return res.json({ ok: true, session: sessionSummary(session) });
    }
    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    if (!title || title.length > 120) {
      return res.status(400).json({ error: 'Title must be 1-120 characters.' });
    }
    session.setTitle(title); // marks titleGenerated so auto-naming won't overwrite it
    return res.json({ ok: true, session: sessionSummary(session) });
  });

  router.delete('/:id', (req, res) => {
    const session = getSession(sessions, req, res);
    if (!session) return;
    sessions.delete(session.id);
    for (const client of sseClients.get(session.id) || []) {
      try { client.end(); } catch { /* already closed */ }
    }
    sseClients.delete(session.id);
    try { session.abort(); } catch { /* best effort */ }
    session.dispose();
    // Release per-session resources the server owns (today: the investigation
    // plan capability). Removal from `sessions` already makes them unusable;
    // this keeps the bookkeeping from growing across a long-lived server.
    try { onSessionRemoved(session); } catch { /* best effort */ }
    try {
      fs.rmSync(session.workspace, { recursive: true, force: true });
    } catch (err) {
      return res.status(500).json({ error: redact(`Session removed, but its workspace could not be deleted: ${err.message}`) });
    }
    return res.json({ ok: true });
  });

  router.post('/:id/challenge', (req, res) => {
    const session = getSession(sessions, req, res);
    if (!session) return;
    if (rejectForeignBackend(session, res)) return;
    if (session.running) {
      return res.status(409).json({ error: 'Wait for the investigator to finish before starting a manual challenger review.' });
    }
    try {
      const requestedChallengeId = typeof req.body?.challengeId === 'string' && req.body.challengeId.length <= 120
        ? req.body.challengeId
        : undefined;
      const review = challenger.startReview(session, {
        trigger: 'manual',
        challengeId: requestedChallengeId,
      });
      return res.json({ ok: true, ...review });
    } catch (err) {
      return res.status(err.statusCode || 400).json({ error: err.message || 'Could not start challenger review.' });
    }
  });

  router.put('/:id/model', async (req, res) => {
    const session = getSession(sessions, req, res);
    if (!session) return;
    if (rejectForeignBackend(session, res)) return;
    if (session.running) {
      return res.status(409).json({ error: 'Agent is already working — wait or abort before changing models.' });
    }

    const backend = getActiveBackend();
    const reasoningLevels = new Set(['', ...backend.reasoningLevels]);
    const rawModel = typeof req.body?.model === 'string' ? req.body.model.trim() : '';
    let reasoning = typeof req.body?.reasoning === 'string' ? req.body.reasoning.trim() : '';
    if (!reasoningLevels.has(reasoning)) {
      return res.status(400).json({ error: 'Invalid reasoning level.' });
    }

    try {
      const config = getConfig();
      if (!rawModel && session.promptCount > 0) {
        return res.status(400).json({ error: 'Choose a concrete model to switch an active session.' });
      }
      // Blank in the per-session picker means "follow the app default" for a
      // not-yet-started session, not "force the backend default".
      const requestedModel = rawModel || config.mainModel || '';
      if (!rawModel && !reasoning) reasoning = config.mainReasoning || '';
      const model = await getModelCatalog(backend.id).resolveSelection(requestedModel);
      if (model && !model.thinking) reasoning = 'off';
      await session.setSessionModel({
        provider: model?.provider,
        modelId: model?.id,
        modelValue: model?.value || requestedModel,
        thinking: reasoning,
        pinned: Boolean(rawModel),
      });
      return res.json({ ok: true, session: sessionSummary(session) });
    } catch (err) {
      const status = err.statusCode || (/timed out|exited/i.test(err.message) ? 504 : 500);
      return res.status(status).json({ error: err.message || 'Could not switch model.' });
    }
  });

  return router;
}
