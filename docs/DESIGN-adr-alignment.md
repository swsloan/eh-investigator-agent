# Design: what to take from Uber's ADR

## Source and provenance

[github.com/uber/ADR](https://github.com/uber/ADR) — "ADR: Agentic AI Detection and
Response", Apache-2.0, deployed in production at Uber, paper accepted to MLSys 2026.

> The paper link circulated internally (`arxiv.org/pdf/2605.173880v1`) has a digit
> too many. The working link is **arxiv.org/abs/2605.17380**, and the PDF is
> vendored in the repo at `docs/adr-paper.pdf` with slides alongside it.

**What this review is based on:** the repository — `README.md`, `Sensor/README.md`,
`Detection/README.md`, and a direct inspection of `Detection/tasks.json` (303
tasks, parsed). **I have not read the paper PDF.** Every number below comes from
the repo. Where I am reasoning rather than reporting, it says so.

## Why it applies here

This application sits in an unusual double position, and both halves matter.

1. **It is a security tool built as an agent.** ADR is prior art for the problems
   we keep rediscovering: how to observe what an agent did, how to benchmark
   whether its defences hold, how to detect when it misbehaves, and how to stop
   unsafe actions.
2. **It is also a thing ADR watches.** ADR Sensor ingests Claude Code sessions
   from `~/.claude/projects/` — the format our own embedded agent produces. A
   customer running ADR would want this agent's activity in that pipeline.

The second point is the one that is easy to miss. We are not only a consumer of
these ideas; we are a subject of them.

## What we already have, honestly compared

ADR's four capabilities, against what exists in this repo today:

| ADR capability | Our equivalent | Assessment |
|---|---|---|
| **Observability** — intent, tool use, execution traces | Session transcripts (`.session.json`), `recordSafetyEvent` safety log (#32), live activity view | Comparable in substance, private in format. No export, no SIEM path. |
| **Benchmark** — 303 tasks, 133 MCP servers, 17 techniques | `eval/cases` (7 cases), `eval/injection-cases` (6), `eval/injection-probes` (4), gate on `false_close_rate` / `verdict_accuracy` / `injection_resist_rate` | Ours is far smaller, and its *executed* composition drifts towards malicious via promotion — see below. |
| **Detection** — two-tier: high-recall triage, then agentic reasoning | Challenger agent (adversarial second opinion), evidence ladder, conclusion-quality audit | We have the expensive tier and no cheap one. Inverted. |
| **Prevention** — not open-sourced | Governed propose/approve/verify write path, read-only broker guards, `MUTATING_PREFIXES`, untrusted-telemetry envelope | **We are ahead here.** ADR withheld this component; ours ships. |

## Adoptable, in order of value

### 1. Benchmark composition: 86% benign

`Detection/tasks.json` is **303 tasks: 261 benign, 42 malicious.** Uber built a
benchmark that is overwhelmingly benign.

That is a deliberate design statement, and it is the single most useful thing in
the repo for us. A detector that flags benign agent activity is worthless in
production regardless of its recall — so the benchmark is weighted towards the
failure mode that actually kills deployments.

Checking our own numbers before drawing the obvious conclusion changed it. Our
**committed** case set is already reasonably balanced — and the skew is somewhere
more interesting:

| Set | malicious | benign | false-positive | benign+FP |
|---|---:|---:|---:|---:|
| `eval/cases` (committed, 7) | 2 | 3 | 2 | **71%** |
| As executed, 08-10 run (10) | 5 | 3 | 2 | **50%** |
| ADR-Bench (303) | 42 | — | — | **86%** |

The committed fixtures are fine. The gap opens in the **promoted** cases: the three
extra cases in that run all came from promotion (`ransomware`,
`investigate-a-suspected-ransomware-incident…`, `review-the-latest-security-detection…`)
and all three are `malicious`.

That points at the workflow rather than the fixtures. Analysts promote
investigations that were *interesting*, and interesting means malicious — nobody
promotes the sweep that turned out to be a printer. So the executed set drifts
towards malicious over time even though the committed baseline does not, and the
drift is invisible unless someone counts.

And we have direct evidence it matters: `plaintext-http-creds` is expected
`benign` and the agent called it `malicious` in **3 of 4 controlled runs** at high
confidence (#128), across two excli builds.

**Proposal, two parts.**

1. **Gate over-calling.** Report a false-positive rate beside `false_close_rate`
   and gate it. Today we gate missing a threat but not inventing one; both are
   wrong answers and only one fails the build.
2. **Watch promotion drift.** Have the eval report print the executed
   composition, so a set sliding towards malicious is visible in every run
   instead of discovered by hand.

Neither requires adopting their tasks — the composition *ratio* is the
transferable insight, and our cases have to be ExtraHop-shaped regardless.

### 2. The 17-technique taxonomy as a coverage checklist

From `threat_technique` across the 42 malicious tasks:

| Count | Technique |
|---:|---|
| 13 | Agentic Control-Flow Hijacking |
| 4 | Semantic Data Poisoning |
| 3 | Exploitation of Excessive Tool Permissions |
| 3 | Agent-Facilitated Resource Exhaustion |
| 2 | Agent Identity Spoofing |
| 2 | Indirect Prompt Injection |
| 2 | Tool Shadowing |
| 2 | Malicious Agent Collusion |
| 2 | Unvetted MCP Server Connection |
| 2 | Long-Term Goal Hijacking |
| 1 each | Temporal Data Attack · Insecure Supply Chain for Agentic Components · Abuse of Agent's Code Interpreter · Insecure Output Handling · Tool Rug Pull · Tool Hallucination Manipulation · Model-Layer Denial of Service |

Reading this against our defences is uncomfortable in a useful way:

- **Indirect Prompt Injection is 2 of 42.** Our `<untrusted-telemetry>` envelope,
  injection probes, and injection cases are almost entirely aimed at this one
  technique. We have hardened the narrow case well.
- **Agentic Control-Flow Hijacking is 13 of 42 — the plurality.** Getting an
  agent to *do the wrong sequence of things* is the dominant technique, and we
  have no eval coverage for it. The nearest thing we measure is
  `ladder_adherence` / `false_climb`, which is currently 0.40 / 0.50 and is not
  gated. That metric may be closer to a security signal than we have treated it.
- **Exploitation of Excessive Tool Permissions (3)** is what the governed write
  path and `capabilityAccessType` fail-safe exist for — we should be able to
  score well here and currently do not measure it at all.
- **Insecure Supply Chain (1)** maps to `verify-vendored-artifacts.sh`. We
  exercise that in CI, so it is covered by construction rather than by eval.
- **Temporal Data Attack (1)** is worth a hard look: our telemetry is
  time-windowed, and we just shipped guidance about `limit` truncation and stale
  suppression rules. Time-shifted evidence is a live concern for us specifically.

**Proposal.** Use the taxonomy as a coverage matrix in `docs/DESIGN-eval-harness.md`:
for each technique, record whether we have a control, an eval case, both, or
neither. Not to chase 17/17, but so the gaps are stated rather than assumed.

### 3. Two-tier detection validates — and inverts — our cost design

ADR runs **triage on `gpt-4o`, then agentic reasoning on `claude-sonnet-4-6`** only
for sessions triage finds suspicious, and the paper reports PR curves against
latency and cost.

That is the same structural answer as `DESIGN-multi-agent-investigation.md`, with
one difference worth taking seriously: **their cheap tier runs first and gates the
expensive one.** Ours has no cheap tier — every investigation runs Opus at
`effort: high` end to end (measured: 15.7M tokens and ~$8 per eval case), and the
challenger adds a *second* expensive pass.

This is production evidence for the design we sketched, and an argument for
sequencing it as triage-first rather than delegate-under-a-lead. It does not
resolve the Slice 0 blocker (#120) — subagent activity still has to be visible in
the UI before delegation ships — but it strengthens the case for doing that work.

### 4. `is_dispatch`: unattended runs are a different risk class

The Sensor tags delegated background sessions with a distinct id prefix and
`is_dispatch: true` in `session_context`, "so detection rules can treat unattended
runs differently from interactive ones".

That distinction is missing from our model and we have three places that need it:

- **Eval runs** are unattended and read-only by construction
  (`eval-runner.js:99`), but nothing in a transcript records that.
- **Scheduled or cron-driven investigations** would be unattended with a human
  nowhere in the loop.
- **Subagents** (#120) are unattended by definition — and the approval path
  should arguably be stricter for a write proposed by an unattended run than one
  a human is watching.

**Proposal.** Add an explicit attended/unattended flag to session context, surface
it in the transcript and the safety log, and let the governed write path consider
it. Cheap, and it is the kind of thing that is painful to retrofit after the fact.

### 5. An export path — and a baseline we can borrow

`adr-sensor` normalizes to an `AgentEvent` schema (`session_id`, `timestamp`,
`chat_history`, `tools`, `model`) and exports JSON/JSONL for "your detection
pipeline / SIEM".

Two uses. First, emitting that schema would let a customer already running ADR
ingest this agent's activity without writing a parser — a real enterprise
selling point for a tool whose pitch is agentic investigation. Second, their
detector baselines (`llamafirewall`, `f_secure`, `isolate_gpt`, `nemo`, `pfi`,
`react`) are ready-made comparators; the README notes `--detector llamafirewall`
runs **keyless**, so we could get an external reference point for
`injection_resist_rate` cheaply, where today we report it against nothing.

## What not to take

- **Do not vendor the benchmark into this repo or CI.** `Detection/README.md` says
  plainly it is a research artifact, "not for production", with dependencies
  pinned to versions carrying known CVEs and fixtures containing synthetic
  credentials and live prompt-injection payloads. Our image is scanned by
  `image-security` and our repo is public. If we run ADR-Bench, it runs in a
  throwaway container, out of tree.
- **Do not wait for their Prevention component.** It is unreleased, and our
  governed write path with read-back verification already covers this ground.
- **Do not adopt their model choices.** `gpt-4o` triage would add a second
  provider and a second key to a stack that deliberately has one.

## Suggested sequencing

1. **Eval rebalance + false-positive gate** (#128 is the live evidence). Highest
   value, no new dependencies, directly measurable.
2. **Technique coverage matrix** in the eval-harness design doc. Cheap, and it
   converts unknown gaps into stated ones.
3. **Attended/unattended session flag.** Small, and a prerequisite for treating
   subagent and scheduled writes correctly.
4. **`AgentEvent` export** behind a setting, once the schema is stable upstream.
5. **Triage tier** — only after #120 Slice 0 (subagent visibility) lands.

## Open questions

- Is `ladder_adherence` / `false_climb` actually a security metric rather than a
  quality one? If control-flow hijacking is the dominant technique, an agent that
  wanders off its plan is a security signal, and we do not gate it.
- Would emitting `AgentEvent` create an exfiltration surface? It contains
  `chat_history`, which for us includes telemetry and analyst prompts. It would
  need the same redaction path as transcripts, and probably an explicit opt-in.
- Their benchmark measures detectors watching an agent. We *are* the agent. Some
  of ADR-Bench is therefore a test of Claude Code's own behaviour rather than of
  our code — worth separating before quoting any score.
