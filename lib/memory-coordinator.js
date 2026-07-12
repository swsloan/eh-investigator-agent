import { challengeEvidenceSignature, hasChallengeEvidence, hasRootHtmlReport } from './challenger-agent.js';

/**
 * Automatic write-path for Graphiti memory (Phase 2).
 *
 * When an investigation concludes — a user turn that produced non-upload
 * workspace evidence AND a root HTML report (the same "investigation is done"
 * proxy the automatic challenger uses) — inject a capture prompt so the agent
 * records a durable episode via its `add_memory` MCP tool. This reuses the
 * Phase 1 MCP wiring (the agent already has the tool + the investigation-memory
 * skill) rather than adding a separate MCP client to the server, and gives the
 * episode full investigation context.
 *
 * Only the Claude backend has the memory tools wired today; Pi is skipped.
 */
const CAPTURE_SOURCE = 'memory-capture';

const CAPTURE_PROMPT = [
  '[[EH_MEMORY_CAPTURE]] Internal system step (not from the user).',
  'This investigation has produced findings and a report. Using the',
  'investigation-memory skill, record ONE concise episode to long-term memory',
  'now by calling your memory save tool (add_memory on Claude, or memory_add on',
  'Pi). Capture: devices (IP + hostname)',
  'and their roles/classifications; identities involved; the detection type and',
  'any MITRE technique; the disposition/verdict; and any analyst preference',
  'expressed this session. Do not include secrets or raw evidence dumps.',
  'After the tool call, reply with a single short line naming what you stored.',
  'If nothing durable is worth storing, reply "No new memory to store" and do',
  'not call the tool.',
].join(' ');

export function createMemoryCoordinator({ getConfig, logger = console } = {}) {
  function enabled() {
    return Boolean(getConfig?.().memory?.enabled);
  }

  // Both backends can write: Claude via native MCP, Pi via the memory extension.
  function supportsWrite(session) {
    return ['claude', 'pi'].includes(session?.backend || session?.constructor?.backend);
  }

  function deliver(session, signature) {
    if (session.running) {
      session.pendingMemoryCapture = signature; // deliver on the next free turn
      return false;
    }
    session.lastMemoryCaptureSignature = signature;
    session.recordEvent?.({ type: 'memory_status', status: 'capturing', at: Date.now() });
    session.prompt(CAPTURE_PROMPT, { source: CAPTURE_SOURCE });
    return true;
  }

  function onAgentEnd(session, meta = {}) {
    if (!enabled() || !supportsWrite(session)) return;

    // Flush a capture that was queued while the session was busy.
    if (session.pendingMemoryCapture && !session.running) {
      const signature = session.pendingMemoryCapture;
      session.pendingMemoryCapture = null;
      if (hasChallengeEvidence(session)) deliver(session, signature);
      return;
    }

    if (meta.hadError) return;
    if (meta.promptSource !== 'user') return;      // capture real investigation turns only; avoid loops
    if (!hasChallengeEvidence(session)) return;     // needs non-upload evidence
    if (!hasRootHtmlReport(session)) return;        // "investigation concluded" proxy
    const signature = challengeEvidenceSignature(session);
    if (!signature || session.lastMemoryCaptureSignature === signature) return; // dedup unchanged state
    deliver(session, signature);
  }

  function attachSession(session) {
    session.on('agent_end', (meta) => {
      try { onAgentEnd(session, meta); }
      catch (err) { logger.warn?.(`[memory:${session.id.slice(0, 8)}] ${err.message}`); }
    });
  }

  return { attachSession };
}
