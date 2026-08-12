// Session presence (#137): is a human actually there to see an approval?
//
// The governed write path delivers a proposal passively (tray + badge), which is
// right for a run nobody is watching and wrong for a user sitting in the app.
// This module gives that distinction a name. A session is ATTENDED when it is an
// interactive session that someone currently has on screen; it is UNATTENDED
// when it was created for a background purpose (eval run, injection probe,
// network-map enrichment — and, later, subagents #120), or when no browser is
// connected to its event stream.
//
// "On screen" is derived from the per-session SSE stream: the client opens
// exactly one, for the session currently displayed, and closes it on switch —
// so a live stream is a faithful "this session is foregrounded somewhere"
// signal without any new heartbeat plumbing. Presence is evaluated at the
// moment it matters (proposal time) and stamped, never assumed to persist.

/**
 * Mark a session as inherently unattended (never prompts, never blocks),
 * with a short reason recorded on everything it proposes.
 */
export function markUnattended(session, reason) {
  if (!session?.options) return;
  session.options.unattended = reason || 'background run';
}

/**
 * Resolve a session's presence right now.
 *
 * @param {object} session      AgentSession (options.unattended = static reason)
 * @param {number} viewerCount  live SSE clients on this session's event stream
 * @returns {{attended: boolean, mode: 'attended'|'unattended', reason: string}}
 */
export function resolvePresence(session, viewerCount = 0) {
  const staticReason = session?.options?.unattended;
  if (staticReason) {
    return { attended: false, mode: 'unattended', reason: String(staticReason) };
  }
  if (!(viewerCount > 0)) {
    return { attended: false, mode: 'unattended', reason: 'no one is viewing this session' };
  }
  return { attended: true, mode: 'attended', reason: 'session is on screen' };
}
