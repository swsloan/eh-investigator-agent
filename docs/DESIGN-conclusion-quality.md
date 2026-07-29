# Conclusion-quality auditing (#31)

The "quality" facet of agent auditing, split from the #30 activity trail. It asks:
**are the agent's conclusions sound**, not just recorded?

## How it differs from the eval scorer

`eval/harness/score.js` grades an investigation against a **labeled expected
answer** — accuracy, ladder depth vs. the case's `min_rung`, calibration vs.
correctness. It only works on eval cases with ground truth.

`lib/conclusion-quality.js` audits the **internal soundness** of *any* real
investigation with **no ground truth**. It never needs the right answer — only
whether the investigation is self-consistent and grounded in its own evidence.
This lets the team trust and tune the agent on live work, not just the eval set.

It is **pure and read-only**: it reads `evidence/verdict.json` and the workspace
evidence files and returns a report; it never mutates the investigation or memory
(keeping the risk MEDIUM — no enforcement path, per #31).

## The four checks

Input is the verdict schema the reporting/evidence-ladder skills already emit
(`disposition`, `confidence`, `highest_rung_used`, `evidence_chain[{claim,source}]`,
`timeline[{…,evidence}]`, `residual_uncertainty`).

1. **Traceability** — every `evidence_chain` claim and every `timeline` entry
   cites an evidence file that actually exists under the workspace (reuses
   `lib/citation-check.js`). Flags: `uncited_claim`, `missing_evidence`,
   `missing_timeline_evidence`.
2. **Hallucinated entities** — an IPv4 asserted in a claim/timeline that appears
   in **no** evidence file is flagged (`hallucinated_entity`). Conservative by
   design: IPs only (octet-validated), matched against the whole evidence corpus,
   so an entity grounded by any evidence file — even an uncited one — is not a
   false positive.
3. **Evidence-ladder adherence** — the rung a verdict's own claims *require* is
   derived from the verdict alone: a definitive disposition at medium/high
   confidence must corroborate beyond metrics (the ladder discipline is explicit
   that you never close on metrics/the detection object alone). If
   `highest_rung_used` is shallower than that, `ladder_shortfall`.
4. **Confidence calibration** — is stated confidence supported? `high` confidence
   with low citation coverage, uncited claims, a ladder shortfall, unsupported
   entities, or stated residual uncertainty → `over_confident`. A fully-cited,
   ladder-adherent definitive verdict stated at only `low` confidence →
   `under-confident` (soft, no flag).

## Output

`assessConclusionQuality(workspace)` returns a report with an overall `score`
(0–1, transparent weighted blend — traceability 0.40, entities 0.25, ladder 0.15,
calibration 0.10, timeline 0.10), a letter `grade`, the per-check details, and a
`flags[]` list where **every flag points at the offending claim / evidence /
entity**, sorted high-severity first.

## Surfaces

- **In-app:** `GET /api/sessions/:id/quality` (read-only, behind the local-origin
  guard) returns the full report for the active investigation.
- **Eval harness:** each case record gains `quality_score`, `quality_grade`,
  `quality_flags`, and `quality_calibration`, alongside the labeled accuracy
  scoring.

A dedicated in-app quality **panel** (rendering the flags against the report) is a
natural fast-follow; the endpoint already makes the data consumable.

## Tests

`lib/conclusion-quality.test.js` uses labeled good/bad investigations — a sound
one scores ≥ 0.9 with no flags; a weak one flags an uncited claim, a missing
evidence file, a hallucinated IP, a ladder shortfall, and over-confidence, each
pointing at the offender. `routes/sessions-quality.test.js` covers the HTTP
surface.
