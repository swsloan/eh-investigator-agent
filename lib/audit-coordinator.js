// Audit-trail capture coordinator (issue #30, Phase 5, Slice A).
//
// Projects the meaningful events that already flow through the server's
// `broadcast(sessionId, event)` fan-out — every session event AND every action
// lifecycle event pass through it — into the append-only, hash-chained trail
// (lib/audit-trail.js). One integration point: server.js calls `capture(session,
// event)` from broadcast. Observe-only: capture never changes behavior and never
// throws out (the writer swallows failures).
//
// What is captured (a projection, not a transcript — actions, not chatter):
//   tool_execution_start           -> tool_call
//   action_proposed/decided/result -> the write-path lifecycle (ref by action id)
//   safety_event (#32)             -> safety_event
//   memory_status (captured/…)     -> memory_capture
//   agent_end (user turn)          -> verdict (read from evidence/verdict.json)

import fs from 'node:fs';
import path from 'node:path';
import { AuditTrail } from './audit-trail.js';

export function createAuditCoordinator({ redact = (x) => x, logger = console, getSigner = null } = {}) {
  const trail = new AuditTrail({ redact, logger });

  function append(session, entry) {
    if (session?.workspace) trail.append(session.workspace, entry);
  }

  function captureVerdict(session) {
    try {
      const verdict = JSON.parse(fs.readFileSync(path.join(session.workspace, 'evidence', 'verdict.json'), 'utf8'));
      append(session, {
        type: 'verdict',
        outcome: verdict.disposition || 'unknown',
        confidence: verdict.confidence || null,
        highest_rung_used: verdict.highest_rung_used || null,
      });
    } catch { /* no verdict yet — nothing to record */ }
  }

  /** Map one fanned-out event to a trail entry (or ignore it). Fast no-op for the
   * majority of events, so appending only happens for audit-worthy ones. */
  function capture(session, event) {
    if (!session?.workspace || !event || typeof event !== 'object') return;
    try {
      switch (event.type) {
        case 'tool_execution_start':
          append(session, { type: 'tool_call', summary: String(event.toolName || event.name || 'tool') });
          break;
        case 'action_proposed':
          append(session, { type: 'action_proposed', ref: event.action?.id || null, summary: `${event.action?.capabilityId || ''} — ${event.action?.label || ''}`.trim() });
          break;
        case 'action_decided':
        case 'action_result':
          append(session, { type: event.type, ref: event.action?.id || null, outcome: event.action?.status || null, decidedBy: event.action?.decidedBy || null });
          break;
        case 'safety_event':
          append(session, { type: 'safety_event', summary: event.kind || 'safety', ref: event.source || null });
          break;
        case 'memory_status':
          if (event.status === 'captured' || event.status === 'skipped' || event.status === 'failed') {
            append(session, { type: 'memory_capture', outcome: event.status });
          }
          break;
        default:
          break;
      }
    } catch (err) {
      logger?.warn?.(`[audit] capture failed: ${err?.message || err}`);
    }
  }

  /**
   * Seal the session's trail (layer 3) with the current signing key. Returns the
   * seal line, or null when there is nothing to seal / no signer configured.
   */
  function seal(session) {
    if (!session?.workspace || typeof getSigner !== 'function') return null;
    return trail.seal(session.workspace, getSigner());
  }

  // agent_end is a separate emitter signal (not routed through broadcast), so the
  // end-of-turn verdict is captured by subscribing directly.
  function attachSession(session) {
    session.on('agent_end', (meta = {}) => {
      try { if (meta.promptSource === 'user') captureVerdict(session); }
      catch (err) { logger?.warn?.(`[audit] verdict capture failed: ${err?.message || err}`); }
    });
  }

  return { trail, capture, attachSession, seal };
}
