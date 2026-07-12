# Design (future) — "Warrant": the RevealX investigation harness

A future-direction proposal for evolving this app from a *single-agent chat that
can investigate* into a *structured investigation harness* whose every verdict is
warranted by evidence it can replay.

The full reference architecture (visual) is preserved at
[warrant-harness.html](warrant-harness.html). This doc captures the idea in the
repo's design-doc form, maps it onto the code that exists today, and records an
honest engineering assessment — what's strong, what's a real lift, and what
should come first.

Status: **concept / not scheduled.** Companion to
[DESIGN-graphiti-memory.md](DESIGN-graphiti-memory.md) (the memory layer) and
[DESIGN-memory-visualization.md](DESIGN-memory-visualization.md).

---

## 1. The idea in one paragraph

An **orchestrator** ("Case Lead") runs an investigation of a RevealX detection
end to end. It states a hypothesis and its *disconfirming* test, then dispatches
short-lived **specialist agents** (Entity Resolver, Timeline & Scope, Transaction
Analyst, Packet Prover) that gather evidence by climbing a fixed **evidence
ladder** — *metrics → records → packets* — going only as deep as the question
demands. Every query, pivot, and decision lands in an **immutable case ledger**;
the model reasons and narrates, but ExtraHop's deterministic queries produce the
facts. Output is an ATT&CK-mapped **verdict with a confidence score and the full
evidence chain attached**, not another ticket. Writes (tuning, containment) are
gated behind a confidence threshold and a human.

The six stated principles: entity-centric not alert-centric; evidence-laddered
depth; deterministic evidence + LLM reasoning; glass-box by construction;
human-in-the-loop, confidence-gated; and telemetry treated as untrusted input.

---

## 2. Why this fits *this* application specifically

The proposal isn't generic agent hype — it lands on the exact seams this codebase
already has. That's the strongest thing about it.

| Warrant concept | Already exists here | Gap to close |
|---|---|---|
| **Evidence ladder** (metrics→records→packets) | The `exmcp` tool surface is a near-perfect 1:1: `execute_metric_query`/`search_metric_catalog` (Tier 1), `search_records`/`search_detectionactivity`/`get_detectiontypemetadata` (Tier 2), `download_pcap` (Tier 3), plus `excli` | The ladder is a *policy*, not code. Today the agent can call any tier freely. Needs to be encoded as a skill + orchestration discipline. |
| **Case ledger (immutable, replayable)** | The per-session transcript + evidence store + root HTML report already give a replayable chain | Formalize as an append-only ledger with the *decision* points (hypothesis, rung-escalation justification), not just tool calls |
| **Case Ledger + Memory** substrate | The Graphiti temporal-memory layer *is* the "carries prior-case context across investigations" half | Wire memory reads into the orchestrator's kickoff (already the skill's intent) |
| **Entity-centric, not alert-centric** | The memory ontology is already entity-centric (Device, Identity, Detection…); `deriveGroupId` namespaces per environment | The live investigation still starts from a detection; needs an Entity Resolver step that builds the case around the device/peer group |
| **Deterministic evidence, LLM reasoning** | This is already the app's whole premise — the model drives excli/exmcp; the tools produce facts | Make "cite the query behind every claim" enforceable, not just encouraged |
| **Disconfirming hypothesis / adversarial check** | The existing **challenger** is exactly this instinct — an independent reviewer that argues the other side | Move it *earlier* (state the benign test before deep queries), not only as a post-hoc review |
| **Human-in-the-loop, confidence-gated writes** | The permission model exists; the app already refuses to send creds to the model | Container runs `bypassPermissions`; write-class actions (`update_detection`, containment) need a real confidence gate + approval surface |
| **Telemetry is untrusted input** | Redaction + `containsSecretMaterial` exist; the system prompt is defensive | Prompt-injection from attacker-controlled wire fields (hostnames, URIs, cert CNs) is **not** yet handled as a first-class boundary |
| **Orchestrator + short-lived specialists** | The Claude backend can spawn subagents (Agent/Task); Pi is single-agent | This is the biggest architectural lift — see §4 |

The short version: **roughly half of Warrant is latent in the code already.** The
memory layer, the challenger, the deterministic-tool premise, and the
replayable transcript are all present. What's missing is the *orchestration
discipline* that turns them into a harness.

---

## 3. My assessment — what's strong, what I'd push back on

### What's genuinely excellent

1. **The evidence ladder is the best idea in the document, and it's cheap to
   start.** It's a real cost model (metrics are broad/cheap, packets are
   expensive/proof) reframed as an escalation *rule*. It doubles as
   analyst-mimicry, so the reasoning chain reads as sound to a human reviewer. It
   can ship first as a **skill** (`skills/evidence-ladder/`) that instructs the
   existing single agent — no new architecture required to get 80% of the value.
2. **It's honest about its own weaknesses.** §06 of the reference names
   cross-sensor entity resolution, ML opacity, injection, packet availability,
   and the missing benchmark. A design that ships its own threat model is one I
   trust more. This is rare and correct.
3. **Detection-source awareness** (rule vs. ML vs. ARD vs. IDS, each entering the
   ladder at a different rung and requiring different corroboration) is a
   sophisticated, correct insight that most "AI SOC" pitches miss entirely.
4. **Glass-box is nearly free here** because the transcript + evidence + report
   already exist. Formalizing them into a ledger is incremental, not net-new.

### Where I'd push back or sequence differently

1. **Confidence-gating on a model-reported confidence number is a weak control.**
   LLM self-reported confidence is poorly calibrated and gameable by its own
   narrative. I'd gate on **evidence-completeness heuristics** (did we reach the
   rung the detection-source table demands? is there corroboration for an ML
   trigger?) rather than a vibes-based 0–100. Confidence can *inform* the human,
   but shouldn't be the *gate*.
2. **The "no benchmark yet" gap should come first, not last.** You cannot safely
   increase autonomy without an eval harness — labeled investigations, verdict
   precision/recall, and a tracked false-close rate. I'd build the evaluation
   scaffold *before* the multi-agent orchestration, because it's the only thing
   that tells you whether any of this is working. Right now §06 lists it as the
   final caveat; I'd promote it to a Phase 0.
3. **Prompt injection from the wire is not "future work" — it's load-bearing.**
   excli/exmcp output *is* attacker-controllable (a hostname or cert CN chosen by
   an adversary flows straight into model context). Principle 6 states the intent
   but the mitigation is unbuilt. Given the app can call `update_detection` and
   create investigations, an injected instruction that flips a verdict or
   suppresses a detection is a concrete attack. This deserves a real boundary
   (structured tool output, provenance tagging of untrusted fields, and never
   letting wire-derived text be read as instructions) before autonomy grows.
4. **Multi-agent orchestration is a large lift and I'd delay it.** The current
   model is one session = one agent, per-turn queries. "Orchestrator + four
   short-lived specialists" means subagent spawning, cross-agent context
   plumbing, and 3–5× the token/latency cost per case. The Claude backend can do
   it (Agent/Task subagents); Pi can't natively. Most of the *value* (laddered
   depth, hypothesis-first, glass-box) is achievable with a **single agent
   following the ladder skill** — so I'd prove the discipline single-agent first
   and only shard into specialists once the eval harness shows a specific reason
   to (e.g., context bleed between lines of inquiry biasing verdicts, which is
   the real argument the doc makes for short-lived agents).
5. **Cross-sensor entity resolution interacts with the memory design.** The
   `group_id`-per-environment namespacing and the entity ontology already touch
   this. Worth designing them together — the Entity Resolver and the memory
   graph's identity/device nodes are the same problem viewed twice.
6. **The feedback loop is the highest-risk action class.** Auto-tuning that
   writes a suppression from a wrong verdict *hides a real threat*. Keep it
   proposal-only and human-gated until verdict accuracy is independently trusted
   — the doc says this, and it's right; I'd make it a hard architectural
   invariant, not a config default.

### Bottom line

The architecture is sound and, unusually, *already half-built here*. Its best
ideas (the ladder, glass-box, detection-source awareness) are near-term and
low-risk. Its riskiest ideas (model-confidence gating, autonomous write-back,
full multi-agent orchestration) are exactly the ones I'd hold behind an
evaluation harness and a real injection boundary. Sequence it so the cheap,
high-trust pieces ship first and *earn* the autonomy the later pieces assume.

---

## 4. Suggested phasing (if pursued)

| Phase | Scope | Rationale |
|---|---|---|
| **0 — Evaluation harness** | Labeled investigation set; verdict precision/recall + false-close rate; replay a case and score it | Nothing else is safe to escalate without this. Turns "best" from a claim into a measurement. |
| **1 — Ladder + ledger, single agent** | `skills/evidence-ladder/` encoding the metrics→records→packets rule + detection-source table; formalize the transcript into an append-only decision ledger; hypothesis-first prompt structure | ~80% of the value, ~20% of the lift. No new architecture. Uses today's `exmcp`/`excli` tools and the existing report/evidence store. |
| **2 — Hypothesis + early challenger** | Move the challenger to state the disconfirming (benign) test *before* deep queries; require a cited query behind each factual claim | Turns the existing adversarial reviewer into a front-loaded control. |
| **3 — Injection boundary** | Treat wire-derived fields as tainted; structured/provenance-tagged tool output; guardrail between telemetry and model context | Prerequisite for any write-class autonomy. |
| **4 — Confidence gating on writes** | Evidence-completeness gate (not raw model confidence) for `update_detection`/containment; human-approval surface | Only after 0 and 3. |
| **5 — Multi-agent orchestration** | Orchestrator + short-lived specialists (Claude subagents) | Only if the eval harness shows single-agent context bleed materially hurts verdicts. |

Each phase is independently useful and each earns the next. Phase 1 alone is a
meaningful upgrade to the current experience.

---

## 5. Open questions

1. **Confidence signal** — evidence-completeness heuristic vs. model self-report
   vs. a calibrated classifier over verdict features. (I favor the first two
   combined; the third needs the eval set.)
2. **Backend scope** — is the harness Claude-only (subagents available) or must
   it degrade to Pi single-agent? Phase 1 is backend-agnostic; Phase 5 isn't.
3. **Ledger vs. memory boundary** — the case ledger (this investigation's
   replayable chain) and Graphiti memory (cross-case knowledge) overlap. Define
   which owns what before building either further.
4. **Air-gapped mode** — ML/threat-intel/briefing accelerators are cloud-fed; the
   ladder degrades to rule-based + records. Worth an explicit reduced-capability
   profile rather than silent degradation.
