# Integration Plan — Porting Agent Studio Features into the Investigation Agent

Status: proposed · Author: review draft · Target repo: `eh-investigator-agent`

This plan turns the Agent Studio review into concrete, file-scoped work. It is
ordered so each phase is independently shippable and testable, and so the
highest-value / lowest-risk change lands first.

## Scope

Five recommendations, in priority order:

1. **Governed write path** — propose → approve → execute "action" model (the one
   capability the app fundamentally lacks today). *Primary.*
2. **Annotation-driven read/write classification** — replace the denylist
   heuristic with `capabilityAccessType()` read from the excli schema. *Enabler
   for #1.*
3. **Capability discovery meta-tools + progressive disclosure** — `list / learn /
   execute` protocol over the excli surface.
4. **Approval dashboard** — async UI surface to review and approve pending
   actions (the UX for #1).
5. **Context hygiene** — anti-premature-stop nudge + keyword-preserving
   truncation. *Small, self-contained.*

Explicitly **out of scope / skipped**: the 13-provider model abstraction (we use
a harness abstraction instead) and the Postgres orchestrator/worker model
(revisit only when going multi-tenant — see Appendix B).

## Design center: the agent never gets write access

The single most important invariant, preserved from today's architecture:

> The agent's excli socket stays **read-only, always.** A write only ever happens
> in a **server-side, in-process** code path, reached by an authenticated
> approval request, and only after the exact argument vector is matched against a
> still-pending proposal the agent itself created.

The agent *proposes*; a different, human-gated path *disposes*. This is
structurally identical to Agent Studio's "propose in one service, execute in
another," adapted to our single-process Node app by making the privileged
execution an in-process method rather than a second service.

---

## Phase 1 — Governed write path (propose → approve → execute)

### 1a. Data model — `lib/action-store.js` (new)

A proposed action is persisted per session, using the existing
`atomicWriteJson` pattern from `lib/session-store.js` (0600 files, atomic rename).
Store under the workspace at `.actions/<actionId>.json` (dot-prefixed so it is
excluded from `visibleFiles()` and never rendered as evidence).

```
{
  id,                       // uuid
  sessionId,
  createdAt,                // UTC ISO
  status,                   // 'proposed' | 'approved' | 'executing' | 'executed' | 'rejected' | 'failed'
  label,                    // human summary the agent wrote, e.g. "Tag device X as compromised"
  capabilityId,             // excli tool name, e.g. 'assign_devicetag_to_devices'
  params,                   // the exact argv payload (validated at propose time)
  accessType,               // 'write' — from capabilityAccessType(), see Phase 2
  decidedAt, decidedBy,     // audit
  result: { exitCode, error, stdoutDigest }  // filled at execution
}
```

Rationale for a dedicated store (not the session JSON): actions must survive a
session reload, be listable across sessions for the dashboard (Phase 4), and be
matched by the privileged executor without loading harness state.

### 1b. Agent-facing tool — `propose_action`

Add one tool to the agent's toolset (both backends). Wire it where the other
brokered interfaces are exposed (see `lib/agent-session.js` — the shims
`./excli-interface`, `./research-interface`, etc.). Simplest and backend-neutral
implementation: a new brokered shim `./propose-action` that writes an action
record via a unix socket to a small in-process handler, mirroring
`excli-interface`.

Contract given to the model (added to `SYSTEM_PROMPT` in `agent-session.js`):

- The agent **cannot** execute write-class excli tools; attempting one returns
  the existing read-only refusal.
- To request a mutation, call `propose_action` with `{capabilityId, params,
  label}`. This does **not** execute — it records a proposal the human will
  review.
- At propose time the handler validates: (a) `capabilityId` exists in the live
  catalog, (b) it is write-class per `capabilityAccessType()` (proposing a
  read-only tool is rejected — "just call it"), (c) `params` parse against the
  tool's `-help` schema. Invalid proposals return a correction, not a record.
- The proposal is echoed back into subsequent turns as an
  `<pending-actions>` context block listing each action and its live status —
  "the source of truth for whether the action actually happened" (mirrors Agent
  Studio §E). This prevents the model from narrating a write as done.

### 1c. Privileged executor — method on `ExcliBroker`

Add `ExcliBroker.executeApproved({ actionId, sessionId })` in
`lib/excli-broker.js`. This is **in-process only** — never reachable over the
agent's socket. It:

1. Loads the action record; asserts `status === 'approved'`.
2. Re-derives `argv` from `capabilityId` + `params` and asserts it still
   classifies as write for that exact tool (defense in depth).
3. Runs the real excli invocation through the **existing** spawn path, but with
   the read-only guard bypassed *for this one call only* (a per-call flag, not a
   mode change on the shared broker).
4. Writes `result` and flips status to `executed` / `failed`.

The read-only refusal in `handleRequest` (`excli-broker.js:175`) is untouched —
the agent path keeps refusing writes exactly as today. Only this new in-process
method can bypass it, and only for a pre-approved, re-validated argv.

### 1d. Approval endpoint — `routes/actions.js` (new)

Mount under `/api/actions` behind the existing `localOriginGuard` (server.js:322)
and secret redaction — same posture as every other mutating route.

- `GET  /api/actions?session=:id` → list (dashboard + in-chat card).
- `POST /api/actions/:id/decide` `{ decision: 'approve' | 'reject' }`
  - `reject`: set status, emit SSE, done.
  - `approve`: set `approved`, call `excliBroker.executeApproved(...)`, stream
    `executing` → terminal status over SSE, append to `activity_log`.
- Guard: reject if the referenced session is currently `running` (avoid racing
  the agent), and enforce one-shot decision (no re-deciding a terminal action).

### 1e. Audit

Log every decision through the existing audit path with
`authorization_method: 'human-approval'`, `actor`, the `capabilityId`, and
outcome — the review already noted these columns exist and are unused. Read/write
badge comes from `accessType` (Phase 2), so enforcement and audit never diverge.

### 1f. SSE / in-chat rendering

Reuse the broadcast helper (server.js:145). Emit `action_proposed`,
`action_decided`, `action_result` events on the session stream. The chat UI
renders a proposed action as an approve/reject card (Phase 4 shares the
component).

**Phase 1 acceptance:** with `EH_BROKER_READONLY` unset, the agent can propose
`assign_devicetag_to_devices`; nothing mutates until a local `POST …/decide
{approve}`; a second approve is a no-op; the agent's own socket still cannot call
the write tool directly (unit test).

---

## Phase 2 — Annotation-driven read/write classification

**Dependency verified (excli v0.0.107).** `./excli-interface -jsonschema` emits a
JSON array of 20 tools, each with a populated `annotations` block. The binary is
built on the official MCP Go SDK (`github.com/modelcontextprotocol/go-sdk/mcp`),
so the hints are first-class: all four (`readOnlyHint`, `destructiveHint`,
`idempotentHint`, `openWorldHint`) have JSON serialization and every tool sets at
least `readOnlyHint`/`destructiveHint`. Annotation-driven classification agrees
100% with today's heuristic across all 20 tools (see the audit at the end of this
section). Phase 2 is unblocked and should be built annotation-first.

Today `lib/excli-readonly.js` classifies via a hand-maintained `MUTATING_TOOLS`
set + verb-prefix rule. Replace the *source of truth* with the tool schema while
keeping the prefix rule as a fallback.

- Add `capabilityAccessType(toolMeta)` reading the MCP hints from `-jsonschema`.
  Rule: **not provably read-only ⇒ `write`** (i.e. `readOnlyHint !== true`). Use
  `destructiveHint` as a second axis for the approval UI — none of today's four
  writes are destructive, but a future `delete_*` would set it and warrant a
  stronger confirmation.
- `isMutatingTool()` becomes: annotation if the tool is found in the cached
  `-jsonschema` catalog, else the existing denylist/prefix heuristic (covers a
  brand-new tool before the catalog is refreshed). A newly added `*_detection`
  write is therefore gated correctly by annotation *and* by prefix.
- One predicate now drives **three** consumers: the broker guard
  (`excli-broker.js:175`), the Phase 1 propose-time validation, and the audit
  badge. Keeps the existing unit tests (`excli-readonly` has coverage) and adds
  annotation cases.

### Verified classification (excli v0.0.107, `-jsonschema`, 20 tools)

| Write (`readOnlyHint:false`) | Read-only (`readOnlyHint:true`) |
|---|---|
| `create_investigation` · `update_detection` · `assign_devicetag_to_devices` · `unassign_devicetag_from_devices` | the other 16 (`search_*`, `get_*`, `list_*`, `execute_metric_query`, `download_pcap`, …) |

All four writes report `destructiveHint:false`. The four writes exactly match the
current `MUTATING_TOOLS` denylist — **zero disagreements**, so the switch is a
safe, behavior-preserving refactor that also future-proofs against new tools.

Practical note for the extractor/build: the bundled binary is quarantined on
macOS (`xattr com.apple.quarantine`), which SIGKILLs it (exit 137) until cleared.
The Linux container path is unaffected; the setup script that installs `bin/excli`
should strip the attribute on macOS dev installs.

---

## Phase 3 — Capability discovery meta-tools + progressive disclosure

Optional token/accuracy optimization; independent of Phases 1–2.

- Add `lib/capability-catalog.js`: caches `./excli-interface -listtools` output
  (name + one-line description + accessType) and lazily fetches per-tool schema
  via `TOOL -help`.
- Expose `list_capabilities` / `learn_capability` to the model instead of
  dumping the full tool list into `SYSTEM_PROMPT`. Mandate `learn_capability`
  before first use of any tool (prompt rule already half-exists at
  `agent-session.js` "ALWAYS run `-help` before using a tool").
- `execute_capability` stays read-only and simply shells the existing interface;
  writes go through `propose_action` (Phase 1), never here.

Ship this only if the excli surface is large enough that the always-on tool list
is costing context — measure first.

---

## Phase 4 — Approval dashboard (async surface)

The UI counterpart to Phase 1, in `public/`.

- New "Actions" view listing pending/decided actions across all sessions
  (`GET /api/actions`), each with label, capability, originating session, live
  status, and approve/reject controls (reusing the in-chat card component).
- Enables deferred approval — an analyst approves a proposed device tag hours
  later without reopening the chat.
- Content is display-only; the actionable params live in the structured record,
  not the rendered text (mirrors Agent Studio's "content is display-only" split).

Depends on Phase 1 endpoints and events. No backend work beyond Phase 1.

---

## Phase 5 — Context hygiene (small, self-contained)

Two mechanisms from Agent Studio §I, portable independently of everything above.
Applies to the harness driver in `lib/agent-session.js` / the backend adapters.

- **Keyword-preserving truncation**: for oversized tool results, keep head +
  tail + snippets around domain keywords (`detection`, `device`, `record`,
  `metric`), append a "narrow your query" notice. Exempt file-read results (they
  feed the workspace, like Studio exempts `read_file`).
- **Anti-premature-stop nudge**: if the harness tries to stop with an
  unfinished plan and no pending tool call, inject one synthetic "continue"
  turn — guarded by an "awaiting user input" regex check and a max of one nudge
  in a row, so it can't loop.

These are robustness wins with no security surface; land them whenever
convenient.

---

## Cross-cutting: security review checklist

Every phase must preserve the existing posture:

- [ ] Agent socket remains read-only; `executeApproved` is in-process only.
- [ ] `/api/actions/*` sits behind `localOriginGuard` + JSON body limit.
- [ ] Approval re-validates argv against the persisted proposal; params are
      spawned as an argv array (no shell), reusing the current no-injection path.
- [ ] Proposed `label`/`params` are untrusted model output → redact on the way
      to the browser via the existing redactor; never eval, never string-concat
      into a shell.
- [ ] Action records are 0600, dot-prefixed, excluded from `visibleFiles()`.
- [ ] Decisions are one-shot and audited with `authorization_method`/`actor`.
- [ ] Read-only eval mode (`EH_BROKER_READONLY=1`, per-session `readOnly`) must
      also **refuse to execute** approved actions — evals never mutate.

## Test plan

- Unit: `capabilityAccessType` (annotation + heuristic + fallback);
  propose-time validation (unknown tool, read-only tool, bad params);
  `executeApproved` state machine (approve/reject/double-decide/eval-blocked).
- Integration (cassette): agent proposes a write → record persisted, nothing
  mutates; approve → single excli invocation observed; reject → none.
- Security: assert the agent's socket path cannot reach `executeApproved`;
  assert read-only eval blocks execution even after approval.
- Existing suites (`excli-readonly`, `excli-broker`, `telemetry-taint`) stay
  green; extend rather than replace.

## Sequencing & effort (rough)

| Phase | Depends on | Relative size | Ship independently? |
|---|---|---|---|
| 2 (annotation gating) | — | S | yes |
| 1 (propose/approve/execute) | 2 (soft) | L | yes (heuristic fallback) |
| 5 (context hygiene) | — | S | yes |
| 4 (dashboard) | 1 | M | after 1 |
| 3 (discovery meta-tools) | 2 | M | optional, measure first |

Suggested order: **2 → 1 → 4**, with **5** slotted in anytime and **3** gated on
a measured context-cost problem.

---

## Appendix A — Files touched

| File | Change |
|---|---|
| `lib/excli-readonly.js` | add `capabilityAccessType()`; annotation-first `isMutatingTool()` |
| `lib/excli-broker.js` | add in-process `executeApproved()`; per-call read-only bypass |
| `lib/action-store.js` *(new)* | persist/list/transition action records |
| `lib/capability-catalog.js` *(new, Phase 3)* | catalog + lazy schema cache |
| `lib/agent-session.js` | `propose_action` tool + `<pending-actions>` block + prompt rules; truncation/nudge (Phase 5) |
| `routes/actions.js` *(new)* | `GET /api/actions`, `POST /api/actions/:id/decide` |
| `server.js` | wire `actionsRouter`; pass broker/executor; SSE events |
| `public/` | in-chat action card + Actions dashboard view (Phase 4) |
| `*.test.js` | new coverage per Test plan |

## Appendix B — Deliberately deferred

- **Postgres orchestrator + worker pool** (Agent Studio §H): adopt only when the
  app goes multi-user / needs horizontal scale or durable scheduled headless
  runs. Today's single-process `session-store.js` is sufficient; the action
  store above is intentionally file-based to match it and can migrate to a table
  later without changing the propose/approve contract.
- **Multi-provider model abstraction** (§J): superseded by the harness
  abstraction; not adopted.
