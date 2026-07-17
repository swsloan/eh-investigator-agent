// In-memory index of OPEN write actions across all sessions (issue #13, Phase B).
//
// The file store (lib/action-store.js) remains the source of truth. This is a
// derived cache: seeded once at startup and updated from the broadcast fan-out
// as actions are proposed/decided, so the cross-session approval reads (the
// /api/actions/pending endpoint and the /api/actions/stream snapshot) are O(open
// actions) and never re-scan the filesystem per request or per event.
import { isOpenAction } from './action-store.js';

export class ActionIndex {
  constructor() {
    this.open = new Map(); // actionId -> action record (open states only)
  }

  /** Replace the index from a list of action records (startup seed / rebuild). */
  seed(actions = []) {
    this.open.clear();
    for (const a of actions) {
      if (a && a.id && isOpenAction(a.status)) this.open.set(a.id, a);
    }
    return this;
  }

  /** Upsert an action from a lifecycle event; terminal states are removed. */
  apply(action) {
    if (!action || !action.id) return;
    if (isOpenAction(action.status)) this.open.set(action.id, action);
    else this.open.delete(action.id);
  }

  /**
   * Live view for the dashboard: open actions whose session still exists,
   * enriched from `getSessionInfo(sessionId)` which returns `{ title, running }`
   * or null/undefined for a session that was deleted (such entries are evicted
   * here, so the index self-heals without a delete hook). Oldest-first, plus
   * `pendingCount` (actions awaiting a human decision = 'proposed').
   */
  snapshot(getSessionInfo = () => ({ title: '', running: false })) {
    const actions = [];
    for (const a of [...this.open.values()]) {
      const info = getSessionInfo(a.sessionId);
      if (info == null) { this.open.delete(a.id); continue; } // session gone — evict
      actions.push({ ...a, sessionTitle: info.title || '', sessionRunning: !!info.running });
    }
    actions.sort((x, y) => (x.createdAt > y.createdAt ? 1 : -1));
    const pendingCount = actions.reduce((n, a) => n + (a.status === 'proposed' ? 1 : 0), 0);
    return { pendingCount, actions };
  }
}
