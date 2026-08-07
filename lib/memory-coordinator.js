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
 * The capture is **verified, not assumed** — in two stages, because it can be
 * lost in two places. Delivering the prompt used to mark the state as captured
 * immediately, so a turn that never actually called the save tool (the model
 * declined, drifted, or errored) looked done and never retried — a silent write
 * loss. The coordinator watches the capture turn's event stream for the save
 * tool firing (or the agent's explicit "nothing to store"), retries a bounded
 * number of times otherwise, and surfaces a failure instead of hiding it.
 *
 * The tool firing is still not persistence: Graphiti's add_memory queues the
 * episode and extracts entities asynchronously, so the tool call succeeds and
 * the episode can then die in the sidecar's queue (observed live: the
 * extraction LLM returned a billing 400 for every attempt; the audit trail said
 * "captured" while the graph held nothing). So after the tool fires, the
 * coordinator reads the graph back — the episode count in the effective group
 * must actually grow past its pre-capture baseline before the state is reported
 * captured. Persistence failure is not re-prompted (the agent did its part, and
 * the failure is infrastructure-side); it is reported as failed, loudly.
 *
 * Both backends can write: Claude via native MCP, Pi via the memory extension.
 */
const CAPTURE_SOURCE = 'memory-capture';

// The memory save tools as they appear in the tool-call event stream:
// `mcp__graphiti__add_memory` (Claude MCP) and `memory_add` (Pi extension). The
// leading `(?:^|_)` anchors to a tool-name boundary so an MCP namespace prefix
// matches but an unrelated `..._add_memory_foo` would not.
export const SAVE_TOOL_RE = /(?:^|_)(?:add_memory|memory_add)$/i;
// The capture prompt instructs this verbatim reply when nothing is worth
// storing — a legitimate no-op, not a failure.
export const NO_OP_RE = /no new memory to store/i;
// Deliver once, retry at most once more, then stop looping on this exact state.
const MAX_CAPTURE_ATTEMPTS = 2;
// Graphiti's extraction is queued and LLM-bound, so the episode lands well after
// add_memory returns. How long the read-back waits for it, and how often it looks.
const PERSIST_TIMEOUT_MS = 240_000;
const PERSIST_POLL_MS = 15_000;

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

/** Plain text an assistant message carries, tolerant of both backends' shapes. */
function assistantText(content) {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content
    .map((b) => (typeof b === 'string' ? b : (b && (b.type === 'text' || typeof b.text === 'string') ? b.text || '' : '')))
    .join(' ')
    .trim();
}

/**
 * What a finished capture turn actually did, from what we observed:
 *   `captured`    — the save tool ran;
 *   `skipped`     — the agent explicitly declined (nothing durable to store);
 *   `unconfirmed` — neither, so the write did NOT happen and must be retried
 *                   rather than silently marked done.
 * Pure and exported for testing.
 */
export function classifyCapture({ sawSaveTool, lastText } = {}) {
  if (sawSaveTool) return 'captured';
  if (NO_OP_RE.test(lastText || '')) return 'skipped';
  return 'unconfirmed';
}

export function createMemoryCoordinator({
  getConfig, logger = console,
  // Read-back verification. `client` is the shared read-only FalkorDB client and
  // `resolveGroup` the same group resolution the sidecar's env file is rendered
  // from. Optional: without them the coordinator still verifies the tool fired,
  // it just cannot verify the episode landed.
  client = null, resolveGroup = null,
  persistTimeoutMs = PERSIST_TIMEOUT_MS, persistPollMs = PERSIST_POLL_MS,
} = {}) {
  function enabled() {
    return Boolean(getConfig?.().memory?.enabled);
  }

  /**
   * Episodes currently in the group's graph. `null` means "could not read" —
   * which includes the graph not existing yet (a legitimate zero, first capture
   * ever) — so callers treat null as 0 for the baseline but never accept it as
   * proof of persistence.
   */
  async function episodeCount(group) {
    try {
      const { columns, rows } = await client.query(group, 'MATCH (e:Episodic) RETURN count(e) AS c');
      const i = Math.max(0, columns.indexOf('c'));
      const v = Array.isArray(rows?.[0]) ? rows[0][i] : null;
      return Number.isFinite(Number(v)) ? Number(v) : null;
    } catch { return null; }
  }

  /**
   * Wait for the group's episode count to grow past the pre-capture baseline.
   * Resolves true the first time it does, false when the window closes — which
   * means the episode died in the sidecar's async pipeline (or the graph was
   * never readable, which deserves the same loud failure rather than trust).
   */
  async function waitForPersist(group, baseline, { timeoutMs = persistTimeoutMs, pollMs = persistPollMs } = {}) {
    const floor = baseline ?? 0;
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const count = await episodeCount(group);
      if (count !== null && count > floor) return true;
      if (Date.now() >= deadline) return false;
      await new Promise((r) => { setTimeout(r, pollMs); });
    }
  }

  // Both backends can write: Claude via native MCP, Pi via the memory extension.
  function supportsWrite(session) {
    return ['claude', 'pi'].includes(session?.backend || session?.constructor?.backend);
  }

  // Fire the capture prompt and record it IN FLIGHT — deliberately not
  // `lastMemoryCaptureSignature`, which now means "confirmed written" and is only
  // set once verifyCapture sees the write actually happen.
  function deliver(session, signature) {
    if (session.running) {
      session.pendingMemoryCapture = signature; // deliver on the next free turn
      return false;
    }
    const priorAttempts = session.captureInFlight?.signature === signature
      ? session.captureInFlight.attempts : 0;
    const attempt = priorAttempts + 1;
    // Snapshot the episode count BEFORE the agent can write, so the read-back has
    // a baseline to grow past. A promise: verifyCapture awaits it after the turn.
    const group = client ? resolveGroup?.() : '';
    const baseline = group ? episodeCount(group) : null;
    session.captureInFlight = { signature, attempts: attempt, sawSaveTool: false, lastText: '', group, baseline };
    session.recordEvent?.({ type: 'memory_status', status: 'capturing', at: Date.now(), attempt });
    session.prompt(CAPTURE_PROMPT, { source: CAPTURE_SOURCE });
    return true;
  }

  // The capture turn finished — confirm the write really happened, else retry a
  // bounded number of times, else give up loudly (never silently mark it done).
  function verifyCapture(session) {
    const inflight = session.captureInFlight;
    if (!inflight) return; // nothing pending, or already resolved
    const outcome = classifyCapture(inflight);

    if (outcome !== 'unconfirmed') {
      session.captureInFlight = null;
      // The signature is marked either way — persistence failure is infra-side,
      // and re-prompting the agent against a dead extraction pipeline would just
      // enqueue another doomed episode. A new investigation state re-triggers
      // naturally with a new signature.
      session.lastMemoryCaptureSignature = inflight.signature;

      // The agent's part is confirmed. If the write can be read back, the state
      // is not "captured" until the episode actually exists in the graph.
      if (outcome === 'captured' && inflight.group) {
        session.recordEvent?.({ type: 'memory_status', status: 'persisting', at: Date.now() });
        Promise.resolve(inflight.baseline)
          .catch(() => null)
          .then((baseline) => waitForPersist(inflight.group, baseline))
          .then((persisted) => {
            if (persisted) {
              session.recordEvent?.({ type: 'memory_status', status: 'captured', at: Date.now() });
            } else {
              session.recordEvent?.({ type: 'memory_status', status: 'failed', at: Date.now(), reason: 'not_persisted' });
              logger.warn?.(`[memory:${session.id?.slice(0, 8)}] the save tool ran but no episode appeared in '${inflight.group}' — check the graphiti sidecar (its extraction LLM may be failing)`);
            }
          })
          .catch(() => { /* observation only — never disrupt the session */ });
        return;
      }

      session.recordEvent?.({ type: 'memory_status', status: outcome, at: Date.now() });
      return;
    }

    if (inflight.attempts < MAX_CAPTURE_ATTEMPTS && !session.running) {
      deliver(session, inflight.signature); // one more try
      return;
    }
    // Give up on this exact state: mark the signature so we don't loop on it, but
    // surface the failure instead of pretending it wrote. A genuinely new
    // investigation state yields a new signature and re-triggers naturally.
    session.captureInFlight = null;
    session.lastMemoryCaptureSignature = inflight.signature;
    session.recordEvent?.({ type: 'memory_status', status: 'failed', at: Date.now(), attempts: inflight.attempts });
    logger.warn?.(`[memory:${session.id?.slice(0, 8)}] capture did not persist after ${inflight.attempts} attempt(s)`);
  }

  function onAgentEnd(session, meta = {}) {
    if (!enabled() || !supportsWrite(session)) return;

    // A capture turn we started just ended — verify it wrote before trusting it.
    if (meta.promptSource === CAPTURE_SOURCE) {
      verifyCapture(session);
      return;
    }

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
    if (!signature || session.lastMemoryCaptureSignature === signature) return; // dedup confirmed state
    if (session.captureInFlight?.signature === signature) return;               // already capturing this state
    deliver(session, signature);
  }

  // While a capture is in flight, watch that turn's event stream for the two
  // signals verifyCapture needs: the save tool firing, and the agent's final text.
  function onEvent(session, ev) {
    const inflight = session.captureInFlight;
    if (!inflight || !ev) return;
    // Claude names the field `toolName`; Pi's raw event uses `name` — mirror the
    // same fallback session-history.js uses when normalizing tool events.
    if (ev.type === 'tool_execution_start' && SAVE_TOOL_RE.test(String(ev.toolName || ev.name || ''))) {
      inflight.sawSaveTool = true;
    } else if (ev.type === 'message_end' && ev.message?.role === 'assistant') {
      const text = assistantText(ev.message.content);
      if (text) inflight.lastText = text;
    }
  }

  function attachSession(session) {
    session.on('agent_end', (meta) => {
      try { onAgentEnd(session, meta); }
      catch (err) { logger.warn?.(`[memory:${session.id.slice(0, 8)}] ${err.message}`); }
    });
    session.on('event', (ev) => {
      try { onEvent(session, ev); }
      catch { /* observation only — never let it disrupt the session */ }
    });
  }

  return { attachSession };
}
