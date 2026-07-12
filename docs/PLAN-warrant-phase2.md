# Implementation plan — Warrant Phase 2 (hypothesis-first + early challenger)

Phase 2 of the Warrant harness (see [DESIGN-warrant-harness.md](DESIGN-warrant-harness.md) §4).
Phases 0 (eval) and 1 (evidence-ladder skill + ledger) are shipped; this builds
on them. **Because Phase 2 changes investigation *behavior*, it must be measured
as an A/B against the signed 7-case baseline** (the same discipline as the
evidence-ladder skill edits) — not shipped on faith.

## Goal / definition of done

Two coupled changes:

1. **Hypothesis-first, enforced.** The investigator commits to a written
   hypothesis **and its disconfirming (benign) test** *before* it climbs to
   records/packets — and an **early challenger** critiques that framing while it's
   still cheap to redirect, instead of only reviewing at the end.
2. **Citations enforceable.** Every factual claim in the verdict/report maps to an
   evidence file that exists; uncited claims are flagged deterministically, not
   left to good intentions.

Done when: (a) a run writes `evidence/hypothesis.json` before any Tier‑2/3
evidence; (b) the early challenger fires on that framing and can inject a
redirect before deep queries; (c) a citation check reports coverage and flags
uncited claims; (d) an A/B vs the signed baseline shows **false-close stays 0**
and verdict accuracy holds or improves, with the framing/citation metrics visible
on the dashboard.

## Current state (what we build on)

- **Challenger exists but is post-hoc.** `lib/challenger-coordinator.js` triggers a
  one-shot review on `agent_end` *after* a root HTML report + evidence exist
  (`hasRootHtmlReport`, `hasChallengeEvidence`), then injects a counter-prompt
  (`frameChallengePrompt`, delivered as a `source:'challenger'` turn).
  `lib/challenger-agent.js` builds the review prompt (`buildChallengerPrompt`) and
  parses `satisfied | challenged` (`parseChallengerResponse`). Config:
  `normalizeChallengerConfig` (`enabled`, `automatic`).
- **Skill already asks for hypothesis-first + citations** (`skills/evidence-ladder/SKILL.md`
  §2 hypothesis + disconfirming test, §5 ledger, §6 `verdict.json.evidence_chain`),
  but nothing *enforces* ordering or citation coverage.
- **Scorer has a `groundedness` metric** (`eval/harness/score.js`, =1.0 on the
  baseline) we can extend for citation coverage.
- Runs on `runOneShot` → **backend-agnostic** (Pi + Claude), matching the doc's
  "Phase 2 is backend-agnostic."

## Design

### A. Structured framing artifact — `evidence/hypothesis.json`
The skill writes this at the end of framing (after Tier‑1 metrics + entity
resolution, before Tier‑2). Minimal schema:

```json
{
  "hypothesis": "10.0.20.5 is beaconing to a C2 endpoint",
  "disconfirming_test": "If the destination is a known-good update/telemetry endpoint and the periodicity matches a scheduled job, this is benign.",
  "entities_in_scope": ["10.0.20.5 (WIN-BACKUP01)", "10.0.10.4 (DC01)"],
  "detection_source": "ids | behavioral | ard | unknown",
  "planned_rung": "records"
}
```

This artifact is the **trigger + the review target** for the early challenger, and
it makes "did the agent frame before digging?" a checkable fact.

### B. Early-challenger checkpoint (coordinator)
Add a second, *earlier* trigger to `challenger-coordinator.js`:

- **Fires when:** `evidence/hypothesis.json` exists **AND** no deep evidence yet
  (`evidence/records/*` and `evidence/packets/*` empty) **AND** no early review has
  run this session. New helper `hasDeepEvidence(session)` + `hasFramingArtifact(session)`.
- **Reviews only the framing** (a new `mode:'framing'` path in `runChallengerReview`
  + `buildFramingPrompt`): *is the disconfirming/benign test present, specific, and
  genuinely able to kill the hypothesis? are the in-scope entities right? is the
  planned rung appropriate to the detection source?* Parse `satisfied | challenged`
  (reuse `parseChallengerResponse`).
- **If challenged**, inject the redirect **before** the agent climbs (reuse
  `deliverPrompt` / `frameChallengePrompt`, tagged as a framing challenge). The
  agent addresses it, *then* proceeds to records/packets.
- The existing **post-hoc** review stays as-is (final verdict pass). So a run gets
  up to two challenger passes: framing (early) + verdict (late).

### C. Citation enforcement — deterministic
- **Skill (§6):** every claim in the report/verdict **must** appear in
  `verdict.json.evidence_chain` with a `source` that is a real evidence file.
- **`lib/citation-check.js` (new, pure):** given a workspace, read
  `verdict.json.evidence_chain`, verify each `source` path exists, compute
  **citation coverage** (= cited-and-present / total claims) and list uncited
  claims. No model needed.
- **Surfaced two ways:** (1) the late challenger prompt includes uncited claims so
  it can push back; (2) the reporting template shows a citation-coverage indicator
  (extends the existing evidence-depth strip).

### D. Config / UI
- `normalizeChallengerConfig` gains `earlyFraming: boolean` (default on when
  challenger enabled). Settings → Challenger gets one checkbox. No new surface.

### E. Eval integration (the measured part)
- **Scorer (`eval/harness/score.js`):** add `framing_present` (was a
  hypothesis.json written before deep evidence?) and `citation_coverage`
  (from `citation-check`), and fold citation coverage into `groundedness`.
- **Run as an A/B**: baseline = the signed 7-case run
  (`eval-2026-07-11T02-52-07`, acc 1.0 / fc 0). Ship Phase 2 to an isolated
  `eh-eval` instance, run the 7 cases, compare on the dashboard.
- **Gate to pass:** false-close **stays 0**; verdict accuracy ≥ baseline; framing
  present on ≥ N cases; citation coverage up; cost/latency increase acceptable
  (the early pass adds one `runOneShot` per case — budget it).

## Work items (in order)

1. **Skill:** write `evidence/hypothesis.json` at end of framing; hard rule "do not
   pull records/packets until it exists"; strengthen §6 citation requirement.
   *(skills/evidence-ladder/SKILL.md — baked, needs image rebuild.)*
2. **`lib/citation-check.js`** + unit test (pure; verify coverage math + missing-file detection).
3. **`challenger-agent.js`:** `buildFramingPrompt`, `mode:'framing'` in
   `runChallengerReview`; include uncited claims in the late prompt.
4. **`challenger-coordinator.js`:** `hasDeepEvidence` / `hasFramingArtifact`; early
   trigger on `agent_end` (framing-present, no-deep-evidence, once per session);
   new `challenger_status` trigger value `'framing'`.
5. **Config + Settings checkbox** (`earlyFraming`).
6. **Reporting template:** citation-coverage indicator.
7. **Scorer metrics** (`framing_present`, `citation_coverage`) + dashboard surfacing.
8. **A/B run** vs the signed baseline in the isolated instance; compare; decide.

## Risks / tradeoffs

- **Cost/latency:** an extra early `runOneShot` per case (~+1 model call). Cheaper
  than a wasted deep-evidence dig on a bad hypothesis, but measure it.
- **"When is framing done?"** relies on the skill writing `hypothesis.json` before
  deep queries. If the agent skips it, the early pass simply doesn't fire (fails
  open — no worse than today). The scorer's `framing_present` catches skips.
- **Over-gating simple cases:** a metrics-only false-positive (e.g. `ssdp`) shouldn't
  need a heavy framing loop. Keep the early pass lightweight and let it return
  `satisfied` fast; don't force a redirect when the framing is already sound.
- **Two challenger passes** could feel chatty. The framing pass is short and only
  injects when the benign test is genuinely weak.
- **Backend:** framing pass uses `runOneShot` (both backends). Fine.

## Verification

- Unit: `citation-check` (coverage + missing-file), `parseChallengerResponse`
  framing path, `hasDeepEvidence`/`hasFramingArtifact` on fixtures.
- Integration: run one real detection; confirm `hypothesis.json` lands before
  records, the early pass fires, a weak benign test triggers a redirect.
- **Measured A/B** vs the signed baseline — the real acceptance test.

## Revision (build-time finding — 26.07.10)

Reading the code changed the sequencing. **The eval runner runs each case as a
single awaited `session.prompt` and reads `verdict.json` immediately, then
disposes the session** (`lib/eval-runner.js`). The challenger fires on `agent_end`
*after* that and injects a *new* turn the runner neither awaits nor keeps alive —
and in one autonomous turn, framing + climb + verdict happen together, so there is
no "pause after framing" for an early pass to hook. Therefore:

- **The early-challenger as a separate coordinator pass (items 3–4) cannot be
  A/B-measured by the current eval, and only has meaning in the interactive
  multi-turn flow.** Shipping it unmeasured/unverified would violate Phase 2's own
  discipline. **Deferred** until either the eval runner is extended to drive the
  interactive challenger loop, or it's validated by interactive use (needs the
  browser bridge, which was down).

**Built + measured instead (the eval-gated core of Phase 2):**
- Skill: `evidence/hypothesis.json` written before deep evidence (hard gate) +
  citation requirement (§6).
- `lib/citation-check.js` (+ 5 unit tests) — deterministic coverage.
- `lib/eval-runner.js` captures `framing_present` + `citation_coverage` per case;
  `grounded` now derives from citation coverage (≥0.8), not a hardcoded `true`.
- `eval/harness/score.js` adds `framing_present` + `citation_coverage` aggregates
  and per-case scores.
- Late challenger (`buildChallengerPrompt`) now surfaces uncited/missing-file
  claims so the *existing* interactive reviewer pushes on ungrounded claims (a
  low-risk enhancement to a feature that already ships).

This delivers "hypothesis-first + citations, made enforceable and **measurable**"
— the substance of Phase 2 — gated by an A/B vs the signed 7-case baseline. The
namesake *early challenger* remains the one deferred piece, for the honest reason
that the harness can't yet measure it.

## Outcome (26.07.10)

Shipped the measurable core ("v1"). A/B vs the signed 7-case baseline:
false-close **0**, accuracy **1.00**, framing **1.0**, citation coverage **0.97**,
cost/case **$1.90 → $2.67**. A "v2" proportionality tweak (curb cost on simple
cases) was tested and **not shipped**: a single-run A/B showed a one-case accuracy
dip (a false *alarm*, not a false close) that couldn't be distinguished from noise
at 7 cases × 1 run. Lesson: **the eval needs more cases (and/or multi-run
averaging) before tuning skill wording this finely**, and the gate should gain an
**accuracy floor** (it currently gates only false-close + cost).

## Sequencing note

Items 1–2 are safe and independently useful (hypothesis artifact + citation
check) and can ship/measure first. Items 3–4 (the early challenger) are the
behavioral core and the reason to A/B. Do not enable `earlyFraming` in prod until
the A/B clears the gate.
