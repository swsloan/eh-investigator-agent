# Design: a multi-agent investigation with per-agent model tiers

## Problem

One investigation costs **$30.88**. A network mapping run costs **$8.85**. Both ran
on Opus at `effort: high` with two prompts each. At demo or pilot scale that is
fine; at "every analyst runs ten a day against their own API key" it is the
product's main objection.

The instinct is "use a cheaper model". The measurements say that is the second
lever, not the first.

### Where the money actually goes

Measured from the persisted transcripts
(`/app/workspaces/<id>/.session.json` → sum `transcript[].message.usage`):

| Session | Cost | input | output | cache read | cache write |
|---|---|---|---|---|---|
| Ransomware investigation | $30.88 | 458 | 2,479 | **47,455,974** | 2,233,586 |
| Network mapping run | $8.85 | 307 | 1,480 | **15,337,773** | 664,726 |

At Opus-5 rates — $5.00/MTok input, $25.00/MTok output, cache read 0.1× input
($0.50/MTok), cache write 1.25× input ($6.25/MTok) — the 47.5M cache reads are
≈ $23.7 of the $30.88 and the 2.2M cache writes ≈ $14. Input and output tokens
are rounding errors: **458 tokens in, 2,479 out, on a $31 session.**

So the cost function is essentially:

```
cost ≈ (turns) × (context size at that turn) × cache-read rate
```

249 assistant messages, each re-reading a context that only ever grows. The
levers, in order of effect:

1. **Scope context per unit of work.** A subagent that reads three files and
   returns a summary pays cache reads on *its own* small context, not on the
   lead's 47M-token history. This is the big one.
2. **Reduce turn count.** Fewer, better-specified turns beat many small ones.
3. **Tier the model.** Real, but it only scales the rate — Sonnet cuts the
   cache-read line ~40%, Haiku ~80%, against a context size that is unchanged.

A design that only did (3) would leave most of the money on the table. This
design does (1) and (3) together.

> **Under `claudeAuth: subscription` these dollar figures are notional** — Claude
> Code derives them from token counts at API list prices, and a Max subscription
> is not billed per token. They remain the right number for a customer running on
> their own API key, and for the Graphiti `/memory-llm` path, which always uses
> the metered `anthropicApiKey`.

---

## What already exists

This is not a from-scratch build. Two seams are already in place.

**1. Subagent traffic already flows through the session.** `lib/backends/claude/session.js`
carries three guards — `handleStreamEvent` (:214), `handleAssistantMessage` (:237),
and `handleToolResults` (:269) — each of which returns early on
`msg.parent_tool_use_id`. Claude Code's `Task` tool already spawns subagents and
the session already recognises their traffic. See the **critical caveat** below
for what those guards currently do to the UI.

**2. Per-agent model selection is an established pattern.** The challenger is
already a second agent with its own model, resolved in
`lib/challenger-agent.js:339` as `challenger.model || config.mainModel`, with its
own `reasoning` level and a catalog check that downgrades to `reasoning: 'off'`
when the chosen model has no thinking. `config.backends.<id>.challenger.model` is
already a first-class setting in `config.json` and Settings → Agent.

**What is missing:** `.claude/agents/` definitions (the directory does not exist),
and a roster/config surface for them.

---

## Target roster

| Agent | Model | Rate (in/out per MTok) | Why this tier |
|---|---|---|---|
| **Orchestrator** | Sonnet 5 | $3 / $15 | Sequencing and routing. Needs judgment about *what* to delegate, not depth. Its own context stays small by construction. |
| **Lead investigator** | **Opus 5** | $5 / $25 | Owns the evidence ladder, the disposition, and the verdict. This is what `false_close_rate` measures — do not economise here. |
| **Telemetry specialist** | Haiku 4.5 | $1 / $5 | excli queries, JSON → summary, counting records, window arithmetic. High volume, mechanical, well-specified. |
| **Research / enrichment** | Sonnet 5 | $3 / $15 | RDAP, CVE/KEV, ATT&CK lookups, ReversingLabs. Comprehension, not deep reasoning. |
| **Reporter** | Sonnet 5 | $3 / $15 | Report + `verdict.json` from evidence the lead has already judged. |
| **Challenger** | Opus 5 | $5 / $25 | Already exists. Adversarial review belongs at the top tier. |

The shape to keep in mind: **one Opus agent doing judgment, cheap agents doing
volume.** The telemetry specialist is expected to make the most calls and hold
the least context.

---

## Constraints that shape the implementation

### 1. Prompt caches are model-scoped — never switch mid-conversation

Switching a conversation's model invalidates its entire prompt cache. Since cache
reads are ~97% of the bill, a design that switched models mid-loop would spend
more than it saved. The sanctioned pattern is the one this design uses: **each
agent stays on one model for its whole life, and the saving comes from each
subagent owning a small context.**

Corollary: the lead investigator's model must not change mid-investigation, even
between phases.

### 2. Opus 5 delegates readily — cap it

Opus 5 reaches for subagents more freely than Opus 4.8 (a documented direction
change). That helps adoption here, but uncapped it trades cache-read cost for
spawn cost: each subagent re-establishes context, re-explores, reports back, and
the lead then re-reads the report. The lead's prompt needs an explicit ceiling and
a "don't delegate what you can finish in a few tool calls" rule.

### 3. This touches the agent loop — it is eval-gated

Same gate as PR 6.4. We now have a working live eval and a clean baseline to
measure against (`eval-2026-08-06T08-46-01-716Z`: `false_close_rate` 0,
`verdict_accuracy` 1.0, gate PASS, 9 cases). Every slice below runs the eval
before merge. The gate that matters is `false_close_rate` — a cheaper model that
closes a real incident is not a saving.

Watch `ladder_adherence` too: it is currently 0.44 with `false_climb` 0.56 (the
agent climbing to `packets` when `records` would do). Delegating telemetry work
to a cheap agent could plausibly make that better (the lead stops doing its own
sweeps) or worse (the specialist over-collects). It is a secondary metric, not a
gate, but it should be read on every run.

---

## ⚠️ Critical caveat: multi-agent currently makes the live view *worse*

The three `parent_tool_use_id` guards drop subagent traffic from the event stream
entirely — not just its text, but its `tool_execution_start` /
`tool_execution_end` events. What the analyst sees for a delegated unit of work is
**one card** — `Subagent · general-purpose` — and nothing inside it. The inline
comment ("UI shows tool cards only") describes the parent's own `Task` card, not
the subagent's internals.

That directly conflicts with the requirement that drove the last round of live-view
work: this surface is shown to customers to argue for agentic investigation, so the
tool activity and artifacts have to be legible. Today a single-agent investigation
renders ~85 informative cards. The same work under this design would render a
handful of opaque `Subagent` cards — a **regression in exactly the thing we just
improved**, for a cost win the customer cannot see.

**Therefore: surfacing subagent activity is not a follow-up, it is a prerequisite.**
Slice 0 below covers it, and no delegation slice should merge before it.

The event data needed is already arriving — `parent_tool_use_id` is precisely the
thread key. The work is to stop discarding it and to render nested activity
(indented under the parent card, or a per-agent lane in the tool rail) rather than
flattening it away.

---

## Slices

Sequenced so the expensive question — *does tiering actually move the 47M cache
reads?* — gets answered early and cheaply, and so nothing ships that degrades the
demo.

### Slice 0 — Surface subagent activity (prerequisite, UI only)

Stop dropping subagent events; thread them by `parent_tool_use_id`; render nested
tool activity under the delegating card, labelled with the agent that ran it.
No agent-loop change, so **not eval-gated** — it is a pure read of events already
on the wire. Ship and verify against a real delegated run before Slice 1.

Acceptance: a `Task`-delegated unit of work shows its own tool calls, with the
subagent's name and model visible.

### Slice 1 — Telemetry specialist on Haiku (the measurement)

One agent, the highest-volume and most mechanical role. Define
`.claude/agents/telemetry.md` with a Haiku model override; give the lead a
delegation rule for excli sweeps and JSON summarisation.

This slice exists to produce a number: run the eval, then compare
`cost_per_case_usd` and the cache-read total against the $7.97/case baseline. If
the saving is small, the context-scoping premise is wrong and the rest of the
design should be reconsidered rather than built.

Acceptance: eval gate PASS, `false_close_rate` still 0, and a measured
cache-read delta reported in the PR.

### Slice 2 — Research + reporter on Sonnet

Two more roles, both natural boundaries: research is already isolated behind
`research-interface`, and reporting already happens after the verdict is formed.

### Slice 3 — Orchestrator on Sonnet

Only worth doing once there are ≥3 specialists to sequence. Until then the lead
can dispatch directly and the orchestrator is an extra hop that costs context
without earning it.

### Slice 4 — Roster as configuration

Promote the per-agent model map into Settings → Agent, following the challenger's
existing `config.backends.<id>.challenger.model` precedent, so an operator can
retier without editing files. Include a "single-agent" preset that reverts to
today's behaviour — the escape hatch if a customer's own eval disagrees with ours.

---

## Open decisions

1. **Does the orchestrator earn its hop?** A lead that dispatches directly is one
   fewer agent, one fewer context, and one fewer thing to explain in a demo.
   Recommend deferring to Slice 3 and deciding on evidence.
2. **Haiku's context ceiling is 200K, not 1M.** Every other model in the roster is
   1M. A telemetry specialist handed a large record set could exceed it where the
   lead would not. Needs either a chunking contract in the specialist's prompt or a
   Sonnet fallback on overflow.
3. **Does the challenger stay a special case?** It has its own coordinator, config
   shape, and UI affordance today. Folding it into a general roster is tidier but
   touches a shipped, working feature — recommend leaving it alone until Slice 4.
4. **Cost attribution per agent.** `span`-level usage is per model request; the
   usage readout currently sums a session. Showing "$4 of $9 was the lead" is what
   makes the tiering legible to a customer — worth doing, probably in Slice 1
   alongside the measurement it needs anyway.

---

## Risks

| Risk | Mitigation |
|---|---|
| Cheap agent misreads telemetry, lead inherits a wrong premise | Specialists return data and counts, never dispositions. The evidence ladder stays entirely with the lead. Eval gate on `false_close_rate`. |
| Delegation overhead exceeds the cache-read saving | Slice 1 measures before Slice 2 commits. Spawn cap in the lead's prompt. |
| Live view regresses for demos | Slice 0 is a prerequisite, not a follow-up. |
| Haiku context overflow on large record sets | Open decision 2 — chunking contract or Sonnet fallback. |
| Per-agent model config drifts from what actually ran | Surface the model on each agent's cards (Slice 0 already needs the label). |

---

## Testing strategy

- **Every agent-loop slice runs the live eval** (`POST /api/eval/run`) against the
  `eval-2026-08-06T08-46-01-716Z` baseline. Gate: `false_close_rate` ≤ 0.05 and
  `verdict_accuracy` ≥ 0.8. Report `cost_per_case_usd` and cache-read totals in
  the PR regardless of gate outcome — the cost delta is the point.
- **Slice 0 is browser-tested, not eval-tested** (`smoke/activity.spec.js`): a
  staged delegated turn renders nested subagent activity.
- **Read `ladder_adherence` and `false_climb` on every run** as secondary signals
  (see Constraint 3).
- **Both themes + reduced motion** on any live-view change, per the redesign plan's
  standing requirement.

---

## Appendix: the tool-reason prompt instruction

Tracked here because it is a change to the same system prompt and belongs in the
same eval-gated batch, not because it is part of the multi-agent work.

The live view's tool cards lead with the agent's own reason for a call, read from
`args.description` on Bash tool calls — present on **79 of 85** calls in a real
mapping run. A one-line system-prompt instruction ("always write a description for
every command") lifts that to ~100%.

**Model selection is not a factor.** Writing a one-line reason is
instruction-following, not reasoning; every current model complies. This does not
influence the roster tiers above.

**Known limit:** `Skill` and `ToolSearch` calls have no description field in their
tool schemas, so no prompt reaches them. Those cards show source + action only
(`Skill · network-topology`), which is already self-explanatory. "A reason on every
card" is therefore not achievable; "a reason wherever it adds information" is.

Cheap to eval — it cannot affect `false_close_rate` — so it can ride along with
Slice 1's eval run rather than needing its own.
