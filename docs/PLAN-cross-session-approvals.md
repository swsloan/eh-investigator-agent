# Plan — Cross-session approval dashboard (issue #13)

Status: proposed · Depends on: PR #12 (governed write path, merged) · Repo: `eh-investigator-agent`

Turns the per-session approval **tray** (Phase 4) into a production capability
where a proposed write is **never missed regardless of which session is open**,
and can be approved from a single surface independent of the originating chat.

## Problem (verified against current code)

The approval surface is strictly per-session:

- `GET /api/actions?session=:id` → `sessions.get(id).workspace` → `listActions()`
  ([routes/actions.js](../routes/actions.js)). No aggregate.
- The tray loads/renders only the **active** session's actions
  ([public/js/actions.js](../public/js/actions.js)); live `action_*` SSE events
  are dropped unless they match the on-screen session.
- SSE is one `EventSource` per active session (`GET /api/sessions/:id/events`);
  there is no global channel. `broadcast(sessionId, event)` fans out per session
  via `sseClients: Map<sessionId, Set<res>>` ([server.js](../server.js)).

Consequence: a write proposed in session A while you're in session B (or while a
run works unattended) is invisible — no signal, no count, and the client even
discards the live event. At the current lab scale (23 sessions) this is already
a real gap for concurrent or unattended investigations.

## Non-goals

- **Multi-user / team approval queues.** The app is single-user with no auth;
  `actor`/`decidedBy` are stubbed to `'user'`. A real team queue (identity,
  proposer≠approver separation, per-user visibility) depends on the auth work,
  which is a separate, larger effort. See "Future / out of scope" below. This
  plan targets **one analyst across many sessions** (and unattended runs).
- Changing the write/execute security model — unchanged. `POST
  /api/actions/:id/decide` already takes `session` in the body, validates
  `action.sessionId === session.id`, is one-shot, and won't race a running
  session. Approving from a dashboard needs **no API or security change**.

## Data model

No schema change needed. Action records already carry `id`, `sessionId`,
`createdAt`, `status`, `capabilityId`, `params`, `label`, `destructive`,
`decidedAt`, `decidedBy`, `result`. "Open" = `proposed | approved | executing`;
"terminal" = `executed | rejected | failed` (from `ALLOWED_TRANSITIONS`). The
badge counts **`proposed`** (awaiting a human); the panel shows open actions.

---

## Phase A — MVP: visibility + cross-session approval (poll-based)

**Goal:** an analyst never misses a pending approval, and can approve/reject from
one surface without hunting for the originating session. Ships as a header
**count badge** + a **panel**, updated by polling (no new streaming infra yet).

**Acceptance:** with a write proposed in a background session, a badge count is
visible from any session within one poll interval; opening the panel lists it
with the session it came from; approving there executes it (reusing the Phase 4
path) and the count decrements; the whole thing survives a page reload.

### Tasks

- [ ] **A1. `isOpenAction(status)` + aggregate helper** — `lib/action-store.js`:
  add `isOpenAction(status)` (`proposed|approved|executing`) and
  `listActionsAcrossWorkspaces(entries)` where `entries` is `[{sessionId,
  sessionTitle, workspace}]`; returns records with `sessionTitle` attached,
  sorted **oldest-first** (triage order). Pure/testable (takes data, not the
  live `sessions` map).
- [ ] **A2. Aggregate endpoint** — `routes/actions.js`: `GET
  /api/actions/pending` (no `session` param). Builds `entries` from
  `sessions.values()` (`{id, title, workspace}`), calls the helper, returns
  `{ pendingCount, actions }` where `pendingCount` counts `proposed`. Read-only,
  behind the existing local-origin guard + global `res.json` redaction.
- [ ] **A3. API client** — `public/js/api.js`: `listPendingActions()` →
  `GET /api/actions/pending`. (`decideAction` already exists and takes `session`.)
- [ ] **A4. Header badge** — `public/index.html`: an `#approvals-btn` `icon-btn`
  beside `#memory-btn`/`#settings-btn`, with a count pill (hidden at 0).
  `public/styles.css`: badge + pill styles using existing tokens.
- [ ] **A5. Approvals module** — `public/js/approvals.js` (new):
  `initApprovals()` + `refreshApprovals()` (fetch aggregate → set badge count),
  poll on an interval **only while the document is visible**
  (`visibilitychange`), and refresh immediately after any local `action_*` SSE
  event and after any decide. Wire `initApprovals()` into
  [public/js/app.js](../public/js/app.js) `startApp()`.
- [ ] **A6. Panel** — clicking the badge opens a modal/overlay (mirror the
  Settings/Memory pattern) listing open actions grouped by session, each with an
  **approve/reject** control and a **"Open session"** link (`switchSession`).
  Reuse the card renderer + decide flow from `actions.js` — refactor `actionCard`
  and `decide` there to be **exported** so the tray and the dashboard share one
  implementation (no duplication).
- [ ] **A7. Busy/edge states** — if a decide returns 409 ("wait for the agent to
  finish"), surface it inline; empty state ("No approvals waiting"); `Esc` closes
  the panel (extend `initEscapeHandling`).
- [ ] **A8. Tests** — `lib/action-store.test.js`: `isOpenAction`,
  `listActionsAcrossWorkspaces` (attaches title, filters terminal, oldest-first).
  Manual/browser check of the badge+panel against the running app.

**Deliberate MVP limitation:** polling (default ~15s while visible). Cheap and
robust at local scale; replaced by streaming in Phase B. No filesystem index yet
— the aggregate scans workspaces per request (fine for tens of sessions).

---

## Phase B — Real-time global event stream

**Goal:** replace polling with a single global channel so the badge and panel
update the instant a write is proposed/decided in any session, and remove
per-request filesystem scans.

### Tasks

- [ ] **B1. Open-action index** — an in-memory `Map<actionId, {sessionId,
  status, …summary}>` of open actions, seeded on startup by scanning workspaces
  once, updated on `createAction` / `transitionAction`. File store stays the
  source of truth; index gives O(1) count and no per-poll scans. Rebuildable.
- [ ] **B2. Global SSE endpoint** — `GET /api/actions/stream`: one `EventSource`
  independent of any session. On connect, send a snapshot (`pendingCount` + open
  actions). Maintain a `globalActionClients: Set<res>` alongside `sseClients`.
- [ ] **B3. Fan-out** — where `broadcast()` emits `action_proposed` /
  `action_decided` / `action_result`, also push to `globalActionClients` with
  `sessionId` + `sessionTitle` + current `pendingCount`. Redact identically.
  Keep-alive + cursor/resume parity with the per-session stream.
- [ ] **B4. Client swap** — `approvals.js` subscribes to `/api/actions/stream`;
  drop the poll (keep a slow poll as a reconnect safety net). Badge + panel
  update live from stream events.
- [ ] **B5. Tests** — index transitions (create → count++, decide → count--,
  terminal never reopens); snapshot-on-connect; fan-out shape.

---

## Phase C — Production hardening / operations

**Goal:** the features that make deferred, unattended approval trustworthy.

### Tasks

- [ ] **C1. Staleness surfacing** — show each pending action's age (from
  `createdAt`); highlight ones older than a configurable threshold (e.g. 1h).
  This is the key signal for unattended runs — an approval sitting unnoticed.
  Sort/filter by age.
- [ ] **C2. Session-busy indicator** — reflect `session.running` in the panel so
  a user sees *why* approve is temporarily blocked, instead of hitting a 409.
- [ ] **C3. Recently-decided context** — optionally show the last N
  executed/failed actions (with outcome) in the panel for confidence, separate
  from the actionable list.
- [ ] **C4. Optional desktop notification** — with the user's permission, a
  browser notification when a new approval arrives while the tab is backgrounded.
  Opt-in; off by default.
- [ ] **C5. A11y + polish** — focus management, keyboard nav, theme parity
  (light/dark), reduced-motion, empty/error/reconnecting states.
- [ ] **C6. Load sanity** — confirm the aggregate/index behaves at 100+ sessions
  (index makes this O(open actions), not O(sessions)).

---

## Future / out of scope (tracked separately)

- **Team approval queue** — needs auth/identity first. Once the app has real
  users, extend records with proposer/approver identity, add per-user or
  role-scoped visibility, and consider proposer≠approver enforcement for
  sensitive writes. Depends on the (separate) authentication capability; the
  data model already reserves `actor` / `authorization_method` / `decidedBy`.
- **Approval policy** — auto-approve read-adjacent or non-destructive writes by
  rule, require dual approval for `destructive` ones. A policy layer on top of
  the existing `accessType` / `destructive` classification. Post-auth.

## Sequencing

Ship **Phase A (MVP)** first — it closes the worst failure mode (invisible
background approvals) with minimal, low-risk code and no new streaming infra.
**Phase B** is the real-time upgrade once the MVP proves the UX. **Phase C** is
driven by real unattended-run usage (C1 staleness is the highest-value item
there). Team use (Future) waits on auth.

| Phase | Theme | Rough size | Ships independently? |
|---|---|---|---|
| A (MVP) | Visibility + cross-session approve, poll-based | M | yes |
| B | Real-time global stream + index | M | yes (after A) |
| C | Ops hardening (staleness, busy, a11y) | S–M each | yes (à la carte) |
| Future | Team queues / policy | L | needs auth first |
