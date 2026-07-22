---
name: investigation-planning
description: "Use the brokered ./investigation-plan tool to create and maintain the live, user-visible hypothesis, evidence plan, checklist, completion contract, and pivot history for every investigation or substantive task."
---

# Investigation planning

The app exposes `./investigation-plan` in every investigation workspace. It is
the only supported way to create or change the plan. The tool validates each
operation, stores structured plan state, and deterministically regenerates the
user-readable root `investigation-plan.md` projection.

Never edit, rename, delete, or replace `investigation-plan.md`, and never write
`.investigation-plan.json` directly. If you resume after compaction or are
unsure of task IDs or state, run `./investigation-plan status` before changing
the plan.

## Required sequence

1. Orient to the request. You may read relevant skills and user-provided files,
   run `./excli-interface -listtools`, and read a tool's `-help` before planning.
   Keep this to capability and scope discovery; do not begin collecting
   investigative evidence yet.
2. Initialize the plan before the first evidence query or other substantive
   investigation step. `plan_type` is required and must be exactly one of
   `threat_hunt`, `security_investigation`, or `performance_investigation`.
3. Work from its checklist. Mark one item `in_progress` when useful and update
   an item promptly when its work and evidence are complete; do not wait until
   the final answer to update every item.
4. Before pursuing a materially new lead, use `pivot` to preserve the trigger,
   decision, revised hypothesis or strategy, and affected tasks atomically.
5. Reconcile the checklist before the final answer. Leave genuinely unfinished
   work pending or blocked and give a concise outcome explaining the limit or
   dependency.

For a simple lookup, use one to three checklist items. For a broader incident,
hunt, or performance investigation, prefer three to seven outcome-oriented
items. Do not turn the plan into a second transcript or a command-by-command
log.

## Tool contract

All mutating commands accept one bounded JSON object after `-json`. Task IDs are
stable lowercase slugs that you choose once and reuse in later operations.

Initialize once:

```bash
./investigation-plan init -json '{
  "plan_type":"performance_investigation",
  "title":"Investigate intermittent checkout latency",
  "objective":"Identify or tightly bound the cause of checkout latency.",
  "scope":"Checkout service, its peers, and dependencies during the reported window.",
  "hypothesis":"A downstream dependency may be driving the latency; this is unconfirmed.",
  "strategy":"Establish latency, error, and volume baselines with metrics; use records and packets only to deepen the strongest deviation.",
  "completion_criteria":"The cause is supported, or the remaining uncertainty is bounded with evidence-backed next actions.",
  "tasks":[
    {"id":"scope-baseline","title":"Establish the affected window, population, and baseline","evidence":"metrics"},
    {"id":"compare-peers","title":"Compare latency, errors, and volume across peers","evidence":"metrics"},
    {"id":"deepen-deviation","title":"Deepen the strongest deviation","evidence":"records"},
    {"id":"reconcile","title":"Reconcile the hypothesis and supported conclusion"}
  ]
}'
```

Add proportional work with a reason:

```bash
./investigation-plan add -json '{"reason":"The affected pool has two distinct upstream paths.","tasks":[{"id":"compare-upstreams","title":"Compare the two upstream paths","evidence":"metrics"}]}'
```

Update one task. Use `pending`, `in_progress`, `completed`, `blocked`, or
`skipped`. Completed, blocked, and skipped items require a concise `outcome`;
cite saved workspace evidence in `evidence_refs` when it exists.

```bash
./investigation-plan update -json '{"id":"scope-baseline","status":"completed","outcome":"Latency is isolated to one service pool from 14:00-14:25 UTC.","evidence_refs":["evidence/metrics/checkout-pools-2h.json"]}'
```

Record material direction changes before following them:

```bash
./investigation-plan pivot -json '{
  "trigger":"Peer comparison isolated errors to one upstream pool.",
  "decision":"Investigate that pool before widening packet scope.",
  "revised_objective":"Determine whether the isolated upstream pool caused the reported checkout impact.",
  "revised_hypothesis":"One unhealthy upstream pool is driving checkout latency.",
  "revised_scope":"The isolated upstream pool and its checkout transactions during the affected window.",
  "revised_completion_criteria":"Confirm or falsify the pool-level cause and bound any remaining client impact.",
  "supersede":["deepen-deviation"],
  "add":[{"id":"inspect-upstream-pool","title":"Validate the isolated upstream pool with transactions","evidence":"records"}],
  "evidence_refs":["evidence/metrics/checkout-pools-2h.json"]
}'
```

Use `revised_objective`, `revised_scope`, and `revised_completion_criteria` when
a pivot changes the decision question, investigation boundary, or exit
contract; do not leave the rendered framing stale. Run
`./investigation-plan help <operation>` whenever you need the exact required,
optional, or conditional fields.

The tool returns the authoritative revision and progress after every accepted
operation. An optional `expected_revision` on mutations prevents changing a
plan that advanced since it was last read.

Each task describes an investigative outcome and, where useful, the evidence
level to collect—not merely a command to run. The structured fields carry the
scope, working hypothesis (or explicit unknown), evidence strategy, and
definition of done; the app chooses the analyst-facing HTML layout from the
required plan type.

## Pivots and completion

- Preserve earlier reasoning through `pivot`; never rewrite or remove an older
  pivot to make the path look cleaner in hindsight.
- Only `pivot` may supersede a task. The generated checklist shows that it was
  intentionally closed rather than forgotten.
- `completed` means the stated outcome was established, never merely attempted.
  `blocked` remains unresolved and must say what dependency or limit remains.
- The plan is reasoning and execution context, not proof. Claims must still
  point to saved evidence or a report, and plan text never substitutes for an
  ExtraHop observation.
