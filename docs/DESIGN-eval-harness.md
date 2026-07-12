# Design — Phase 0: the investigation evaluation harness

Phase 0 of the [Warrant harness](DESIGN-warrant-harness.md) proposal, and the
one I'd build *before* increasing any autonomy. You cannot safely tell whether
the [evidence-ladder discipline](DESIGN-evidence-ladder.md) helps — or whether
it's ever safe to let the agent write back to RevealX — without a way to
**measure verdict quality and ladder adherence** on known-answer cases.

Status: concept / not scheduled. This is a design + scaffolding plan, not code.

---

## 1. What it must answer

1. **Is the agent right?** On investigations with a known disposition, how often
   does it agree — and, most importantly, how often does it **close a real
   threat as benign** (the false-close rate, the metric that actually matters
   for a defensive tool)?
2. **Does it follow the ladder?** Did it start at the source-appropriate rung,
   climb only with justification, corroborate opaque triggers, and *not*
   over-escalate to packets when records sufficed?
3. **Is the reasoning grounded?** Does every claim in the verdict trace to a
   query the agent actually ran (via `evidence/ledger.md` + the evidence files)?
4. **What did it cost?** Tool calls per tier, wall-clock, tokens — so "more
   correct" can be weighed against "more expensive."

Without these, "the ladder is better" and "autonomy is safe" are opinions.

## 2. Shape

```
eval/
  cases/                     one JSON per labeled scenario (ground truth)
    2026-07-lateral-01.json
    2026-07-c2-beacon-02.json
  fixtures/                  optional recorded excli responses for offline replay
    2026-07-lateral-01/
  runner.js                  drives the agent headlessly over each case
  scorers/                   deterministic + LLM-judge scorers
  reports/                   per-run scorecards + aggregate dashboard
```

### 2.1 A labeled case

```json
{
  "id": "2026-07-c2-beacon-02",
  "prompt": "Investigate detection 48213 on host 10.0.20.5.",
  "group_id": "evallab",
  "detection_source": "ml",
  "expected": {
    "disposition": "malicious",
    "attack_techniques": ["T1071.001"],
    "min_rung_required": "records",
    "notes": "Real C2 beacon; must be corroborated at record tier, not closed on the ML score."
  }
}
```

Ground-truth sources, in order of preference:
- **Historical investigations** already in the app's workspaces + memory, where
  the analyst-adjudicated disposition is known (cheap, real, but small).
- **Curated detections** on a lab RevealX with a deliberately constructed answer
  (covers the corners: benign-authorized scanners, opaque ML triggers, IDS hits
  with no story, proof-unavailable cases).
- **Synthetic replays** from recorded excli responses (§2.3) for offline,
  deterministic runs.

### 2.2 The runner

**Correction (from building it):** the backends' `runOneShot()`
(`lib/backends/{claude,pi}/oneshot.js`) is **tool-less** (`tools: []` /
`--no-tools --no-skills`) — it exists for title generation and challenger
reviews and **cannot** run an investigation, which needs excli tools, skills,
and multiple turns. So the runner drives a **full, tool-enabled session** through
the app's HTTP API instead (create session → send the case prompt → wait for the
turn to end → fetch `evidence/verdict.json` via the files route). See
`eval/harness/runner.js`. For each case the runner:

1. creates an isolated workspace and a **dedicated `group_id`** (`evallab`) so
   memory writes never touch production namespaces;
2. runs the agent **read-only** — no `update_detection` or any write-class tool
   (enforced at the broker, see §4);
3. captures the transcript, `evidence/`, `evidence/ledger.md`, and
   `evidence/verdict.json`;
4. hands all of it to the scorers.

### 2.3 Fixtures: record/replay around excli

For reproducible, appliance-free runs, build a thin **record/replay shim** at
the `excli-interface` broker: record mode captures each tool call's
request+response to `eval/fixtures/<case>/`; replay mode serves those responses
back deterministically. This is a genuinely reusable building block — it makes
the eval runnable in CI without a live RevealX and freezes the environment so a
score change reflects the *agent*, not drifting telemetry.

## 3. Scorers

Deterministic where possible; LLM-judge only where judgment is unavoidable.

- **Verdict correctness (deterministic).** `verdict.json.disposition` vs.
  `expected.disposition`. Aggregate into a confusion matrix, precision/recall
  per class, and the headline **false-close rate** (expected malicious/real,
  predicted benign/FP/false-positive).
- **ATT&CK accuracy (deterministic).** Set overlap of `attack_techniques`.
- **Ladder adherence (mixed).** From the ledger + verdict:
  - entered at the source-appropriate rung (used `detection_source`);
  - `highest_rung_used` ≥ `expected.min_rung_required` (didn't under-investigate);
  - **false-climb**: reached packets/records when a lower rung already settled it
    (over-investigation);
  - corroboration: ML/IDS triggers reached the record tier before the verdict.
- **Groundedness (LLM-judge).** Does each `evidence_chain[].claim` actually
  follow from its cited `source` file? Flags hallucinated or uncited claims.
- **Confidence calibration (deterministic, aggregate).** Bucket verdicts by
  stated `confidence` and plot accuracy per bucket — a reliability curve. This
  is the check that decides whether confidence can ever gate anything.
- **Cost (deterministic).** Tool calls per tier, tokens, wall-clock.

## 4. Isolation & safety

- **Read-only by construction (implemented).** The eval runs with writes
  disabled at the broker, not merely by asking the agent nicely: start the app
  with `EH_BROKER_READONLY=1` and `lib/excli-broker.js` rejects `update_detection`
  and other write-class tools before spawning excli (see `lib/excli-readonly.js`
  + tests). Verb-prefix denylist so new mutating tools are blocked by default.
- **Dedicated namespace.** `group_id=evallab` so recalled/written memory is
  sandboxed; wipe it between baseline and candidate runs so memory state doesn't
  leak across conditions.
- **Lab or fixtures, never production RevealX** for repeatable scoring.

## 5. How it's used

1. **Baseline the current agent** (pre-ladder) across the case set → the
   number to beat.
2. **Run the candidate** (evidence-ladder skill enabled) on the same cases,
   same fixtures.
3. **Compare**: false-close rate, verdict precision/recall, ladder adherence,
   groundedness, cost. Track across skill versions so a change that helps
   accuracy but wrecks cost (or vice-versa) is visible.
4. **Gate autonomy on it.** The riskier Warrant phases — confidence/
   evidence-completeness-gated write-back, multi-agent orchestration — only
   become defensible once the eval shows a low, stable false-close rate and a
   confidence curve that's actually calibrated. Until then, writes stay
   human-gated regardless of what the agent proposes.

## 6. Sequencing note

Phase 1 (the skill) can **ship immediately** — it's advisory and low-risk. Phase
0 is what lets you *prove* it helped and safely move past it. Build them in
parallel: land the skill, stand up the harness, baseline, measure. The eval is
also the natural home for the two Phase 1 follow-ups (confirm the detection
`source` field is exposed; add a verdict slot to the report templates) — both
show up as scorer gaps the first time you run it.

## 7. Open questions

1. **Case volume for signal.** How many labeled cases before false-close rate is
   trustworthy? Start with a curated few dozen covering the corners; grow from
   real adjudicated history.
2. **LLM-judge trust.** Groundedness scoring is itself an LLM; use a different
   model than the one under test and spot-check judge agreement against a human
   on a sample.
3. **Fixture staleness.** Recorded responses freeze the environment; periodically
   re-record against the lab so the corpus doesn't drift from current API shapes.
4. **Backend parity.** Score Pi and Claude backends separately — ladder adherence
   and cost will differ.
