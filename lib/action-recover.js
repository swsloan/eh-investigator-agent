// Crash recovery for interrupted governed writes (Phase 3, issue #23).
//
// The decide route persists `executing` before dispatching a write and `verifying`
// before reading it back, so a process crash between execution and confirmation
// leaves a record in one of those two transient states. On restart we must resolve
// each one WITHOUT ever blindly re-executing (a write like `create_investigation`
// is not idempotent). Instead we read the target back and let the observed state
// decide the outcome:
//
//   - `verifying`  — the write already ran; read back → verified | verification_failed.
//   - `executing`, verifiable — the write MAY have run; read back to see whether the
//                   desired state holds now (it landed) or not (interrupted). We route
//                   it through `verifying` first so the state graph stays honest.
//   - `executing`, not verifiable — we cannot read it back and must not re-run it, so
//                   we mark it `failed` ("interrupted; outcome unconfirmed") for a human
//                   to re-propose. Honest over optimistic.
//
// Pure orchestration over injected I/O so it is unit-testable without a broker.

import { listActions, transitionAction } from './action-store.js';
import { verifyWrite, isVerifiable } from './action-verify.js';

/**
 * Resolve every action left in a transient state across the given workspaces.
 * @param {object}   deps
 * @param {Array}    deps.entries   [{ sessionId, workspace }]
 * @param {Function} deps.observe   (probes, { workspace }) => { subject: {ok,record,error} }
 * @param {Function} [deps.broadcast] (sessionId, event) => void
 * @param {object}   [deps.logger]
 * @returns {Promise<Array>} the resolved action records.
 */
export async function recoverInterruptedActions({ entries = [], observe, broadcast = () => {}, logger = console } = {}) {
  const resolved = [];
  for (const entry of entries) {
    const workspace = entry?.workspace;
    if (!workspace) continue;
    let interrupted;
    try {
      interrupted = listActions(workspace).filter((a) => a.status === 'executing' || a.status === 'verifying');
    } catch { continue; }
    for (const action of interrupted) {
      try {
        const done = await recoverOne({ action, workspace, observe });
        if (done) {
          resolved.push(done);
          broadcast(entry.sessionId, { type: 'action_result', action: done });
          logger?.info?.(`[action-recover] ${action.id.slice(0, 8)} ${action.status} -> ${done.status}`);
        }
      } catch (err) {
        logger?.warn?.(`[action-recover] could not resolve ${action.id.slice(0, 8)}: ${err?.message || err}`);
      }
    }
  }
  return resolved;
}

async function recoverOne({ action, workspace, observe }) {
  const cap = action.capabilityId;
  const params = action.params || {};

  // Not verifiable + interrupted mid-execution: cannot confirm, must not re-run.
  if (!isVerifiable(cap)) {
    return transitionAction(workspace, action.id, 'failed', {
      result: {
        ...(action.result || {}),
        ok: false,
        error: 'Interrupted before completion (process restart); outcome unconfirmed — re-propose if still needed.',
      },
      verification: { status: 'interrupted', checkedAt: new Date().toISOString(), detail: 'Recovered after restart; no read-back verifier to confirm the write.', mismatches: [] },
    });
  }

  // Verifiable: normalize an interrupted `executing` into `verifying`, then read
  // back. The observed state — not the crash timing — decides verified vs. failed.
  let current = action;
  if (current.status === 'executing') {
    current = transitionAction(workspace, action.id, 'verifying', {});
  }
  const vw = await verifyWrite(cap, params, (p) => observe(p, { workspace }));
  const detail = `Recovered after restart. ${vw.verification.detail}`;
  return transitionAction(workspace, action.id, vw.actionStatus, {
    afterState: vw.afterState,
    verification: { ...vw.verification, detail },
  });
}
