// What the agent has run this turn, as data rather than as DOM.
//
// Tool cards used to exist only as elements appended into whichever assistant
// message was streaming, so the transcript WAS the model: there was nowhere to read
// "what has this turn done" from, and a second surface could not render the same
// calls without re-parsing the first one's markup.
//
// This holds the calls; renderers subscribe. The chat transcript and the live
// activity view are two views of it, and neither owns the data.

const calls = new Map();       // toolCallId -> record, in start order
const listeners = new Set();
let anonymous = 0;             // ids for calls that arrive without one

function notify(record) {
  for (const fn of listeners) {
    try { fn(record); } catch { /* one bad listener must not stop the others */ }
  }
}

/** Subscribe to every change; returns an unsubscribe. */
export function subscribeCalls(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const idOf = (ev) => ev?.toolCallId || `anon-${++anonymous}`;

/**
 * A tool call has started. `phrase` and `summary` are filled in by the caller, so
 * this module stays free of presentation and the two renderers cannot disagree
 * about what a call is called.
 */
export function startCall(ev, { phrase = '', integrationSource = '', label = null, reason = '' } = {}) {
  const id = idOf(ev);
  const record = {
    id,
    name: ev?.toolName || '',
    args: ev?.args ?? null,
    phrase,
    // How the call is named to a human ({source, action}), and the agent's own
    // reason for making it. Supplied by the caller for the same reason `phrase` is:
    // the store holds what ran, not how it reads.
    label,
    reason,
    integrationSource,
    status: 'running',
    progress: '',
    output: '',
    isError: false,
    summary: null,
    startedAt: Date.now(),
    endedAt: null,
  };
  calls.set(id, record);
  notify(record);
  return record;
}

/**
 * Progress on a running call.
 *
 * The backend has always emitted this and the client has never listened, so a
 * long-running call was indistinguishable from a hung one. Unknown ids are ignored
 * rather than creating a phantom call: an update without a start is a replay
 * artefact, not a new tool run.
 */
export function updateCall(ev) {
  const record = calls.get(ev?.toolCallId);
  if (!record || record.status !== 'running') return null;
  record.progress = typeof ev.status === 'string' ? ev.status : '';
  notify(record);
  return record;
}

/** A call has finished. `summary` is the caller's humanised result, or null. */
export function endCall(ev, { output = '', summary = null } = {}) {
  const id = ev?.toolCallId;
  const record = id && calls.get(id);
  if (!record) return null;
  record.status = ev?.isError ? 'error' : 'done';
  record.isError = Boolean(ev?.isError);
  record.output = output;
  record.summary = summary;
  record.progress = '';
  record.endedAt = Date.now();
  notify(record);
  return record;
}

export function getCall(id) { return calls.get(id) || null; }

/** Every call this turn, oldest first — Map preserves insertion order. */
export function allCalls() { return [...calls.values()]; }

export function runningCalls() {
  return [...calls.values()].filter((c) => c.status === 'running');
}

/** Wall-clock duration, or null while still running. */
export function callDuration(record) {
  return record?.endedAt ? record.endedAt - record.startedAt : null;
}

/** New session, or a fresh replay: drop everything. */
export function resetCalls() {
  calls.clear();
  anonymous = 0;
  notify(null);
}
