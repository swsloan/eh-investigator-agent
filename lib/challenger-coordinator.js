import crypto from 'node:crypto';
import {
  challengeEvidenceSignature,
  frameChallengePrompt,
  hasChallengeEvidence,
  hasRootHtmlReport,
  normalizeChallengerConfig,
  runChallengerReview,
} from './challenger-agent.js';
import { redactText } from './redaction.js';

function statusMessage(status) {
  return {
    ready: 'Investigator findings are ready for challenger review.',
    reviewing: 'Challenger Agent is reviewing the findings.',
    satisfied: 'Challenger Agent accepted the findings.',
    challenged: 'Challenger Agent found gaps and prepared a counter-prompt.',
    queued: 'Challenger Agent is waiting for the investigator to finish the current turn before delivering its counter-prompt.',
    delivered: 'Challenger Agent sent its counter-prompt to the investigator.',
    skipped: 'Challenger Agent could not find workspace evidence to review.',
    error: 'Challenger Agent review failed.',
  }[status] || 'Challenger Agent status changed.';
}

function lastChallengerStatus(session) {
  for (let i = session.transcript.length - 1; i >= 0; i--) {
    const event = session.transcript[i];
    if (event?.type === 'challenger_status') return event;
  }
  return null;
}

function hasAutomaticReviewRun(session) {
  return session.transcript.some((event) => (
    event?.type === 'challenger_status' && event.trigger === 'automatic'
  ));
}

export function createChallengerCoordinator({
  getConfig,
  getBackend,
  getModelCatalog,
  secretStore,
  logger = console,
  runReview = runChallengerReview,
} = {}) {
  const active = new Map();

  function config() {
    return normalizeChallengerConfig(getConfig?.().challenger || {});
  }

  function record(session, status, details = {}) {
    return session.recordEvent({
      type: 'challenger_status',
      status,
      message: details.message || statusMessage(status),
      challengeId: details.challengeId || crypto.randomUUID(),
      turnId: details.turnId || session.promptCount,
      trigger: details.trigger || 'manual',
      at: Date.now(),
    });
  }

  function closeInterruptedReview(session) {
    const last = lastChallengerStatus(session);
    if (!last || !['reviewing', 'queued'].includes(last.status)) return;
    record(session, 'error', {
      challengeId: last.challengeId,
      turnId: last.turnId,
      trigger: last.trigger,
      message: 'Challenger Agent review was interrupted. Run the review again if these findings still need a second pass.',
    });
  }

  function markReady(session, turnId) {
    const signature = challengeEvidenceSignature(session);
    if (!signature || session.lastChallengerReadySignature === signature) return;
    const last = lastChallengerStatus(session);
    if (last?.status === 'ready' && last.turnId === turnId) return;
    session.lastChallengerReadySignature = signature;
    record(session, 'ready', {
      challengeId: crypto.randomUUID(),
      turnId,
      trigger: 'manual',
    });
  }

  function deliverPrompt(session, pending) {
    if (session.running) {
      session.pendingChallengerPrompt = pending;
      record(session, 'queued', pending);
      return false;
    }
    record(session, 'delivered', pending);
    session.prompt(pending.message, { source: 'challenger' });
    return true;
  }

  async function onAgentEnd(session, meta = {}) {
    if (meta.hadError) return;

    if (session.pendingChallengerPrompt) {
      const pending = session.pendingChallengerPrompt;
      session.pendingChallengerPrompt = null;
      deliverPrompt(session, pending);
      return;
    }

    if (meta.promptSource === 'challenger') return;
    if (!hasChallengeEvidence(session)) return;
    const signature = challengeEvidenceSignature(session);
    if (!signature || session.lastChallengerReviewSignature === signature) return;

    const challenger = config();
    if (!challenger.enabled) return;
    if (challenger.automatic) {
      if (hasAutomaticReviewRun(session)) return;
      if (!hasRootHtmlReport(session)) return;
      try {
        startReview(session, {
          trigger: 'automatic',
          turnId: meta.promptCount || session.promptCount,
          evidenceSignature: signature,
        });
      } catch (err) {
        logger.warn?.(`[challenger:${session.id.slice(0, 8)}] ${err.message}`);
      }
    } else {
      markReady(session, meta.promptCount || session.promptCount);
    }
  }

  function attachSession(session) {
    closeInterruptedReview(session);
    session.on('agent_end', (meta) => {
      onAgentEnd(session, meta).catch((err) => {
        logger.warn?.(`[challenger:${session.id.slice(0, 8)}] ${err.message}`);
      });
    });
  }

  function startReview(session, {
    trigger = 'manual',
    turnId = session.promptCount,
    challengeId = crypto.randomUUID(),
    evidenceSignature = challengeEvidenceSignature(session),
  } = {}) {
    const challenger = config();
    if (!challenger.enabled) {
      const err = new Error('Enable the Challenger Agent in Settings before running a review.');
      err.statusCode = 400;
      throw err;
    }
    if (active.has(session.id)) {
      const err = new Error('Challenger Agent is already reviewing these findings.');
      err.statusCode = 409;
      throw err;
    }
    if (!hasChallengeEvidence(session)) {
      const err = new Error('No workspace evidence is available to challenge yet.');
      err.statusCode = 400;
      throw err;
    }

    if (evidenceSignature) session.lastChallengerReviewSignature = evidenceSignature;
    const run = (async () => {
      record(session, 'reviewing', { challengeId, trigger, turnId });
      try {
        const result = await runReview({
          session,
          config: getConfig(),
          modelCatalog: getModelCatalog?.(),
          oneShot: getBackend?.().runOneShot,
          secretStore,
        });
        if (result.status === 'skipped') {
          record(session, 'skipped', { challengeId, trigger, turnId, message: result.message });
        } else if (result.status === 'satisfied') {
          record(session, 'satisfied', { challengeId, trigger, turnId });
        } else if (result.status === 'challenged') {
          record(session, 'challenged', { challengeId, trigger, turnId });
          const prompt = redactText(result.prompt || '', secretStore);
          deliverPrompt(session, {
            challengeId,
            trigger,
            turnId,
            message: frameChallengePrompt(prompt, { reportFiles: result.reportFiles }),
          });
        } else {
          record(session, 'error', {
            challengeId,
            trigger,
            turnId,
            message: 'Challenger Agent returned an unknown review result.',
          });
        }
      } catch (err) {
        record(session, 'error', {
          challengeId,
          trigger,
          turnId,
          message: redactText(err.message || statusMessage('error'), secretStore),
        });
      } finally {
        active.delete(session.id);
      }
    })();
    active.set(session.id, run);
    return { challengeId };
  }

  return {
    attachSession,
    startReview,
    isReviewing: (sessionId) => active.has(sessionId),
  };
}
