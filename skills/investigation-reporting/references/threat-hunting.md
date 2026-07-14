# Threat hunt report

For a proactive, hypothesis-driven sweep — not triggered by a single alert. The question is *"is anyone doing X across the environment?"* Template: `assets/threat-hunting-template.html`.

## Two rules specific to this type

- **A clean result is a result.** "No evidence found" is a valid, valuable outcome. State it plainly — don't manufacture findings to justify the hunt.
- **Coverage bounds the conclusion.** You can only call clean what you actually hunted. Always state how much of the population and time window the hunt reached, and what it didn't.

## Structure

1. **Title / subtitle.**
2. **Outcome** — three cells: *Outcome* · *Confidence* · *Severity* (of findings; *Informational* if none).
3. **Hunt Summary** — the hypothesis, what was hunted, what was found, what it means. Stands alone.
4. **Key Numbers** — window, hosts/assets in scope, records reviewed, leads/findings count.
5. **Hypothesis and Scope** — the explicit hypothesis, the ATT&CK technique(s) targeted, data sources, time window, and what's in and out of scope.
6. **Methodology** — the analytic technique per step (stack counting, entropy/outlier scoring, beacon-timing, IOC sweep, enrichment), written so another analyst could repeat it.
7. **Entities Identified** — any hosts/domains the hunt surfaced, with role.
8. **Hunt Findings** — per lead: one-line answer, why it mattered, `[Observed]`/`[Assessed]`, evidence refs, confidence, MITRE ID(s). **Include the negative leads** — what you looked for and did not find.
9. **Third-Party Enrichment** — material web research or external-tool findings used to qualify a lead, one source-attributed entry per lookup/finding. For web research, cite the original URL and local `research/` memo. For ReversingLabs, use `data-source="reversinglabs"` on every entry so its RL icon is shown; preserve the vendor verdict/scope and cite the local `reversinglabs/` artifact. Separate provider reports from investigator assessment and from ExtraHop observation. Delete this section when no useful enrichment was performed.
10. **Evidence Summary** — each ExtraHop query with provenance. Keep external source artifacts in Third-Party Enrichment rather than presenting them as ExtraHop evidence.
11. **Coverage and Limits** — hunted-and-clean / could-not-determine / what ExtraHop can't see, plus the explicit coverage fraction.
12. **Recommendations** — *Escalate* (now, if findings) · *Hunt further / expand coverage* (soon) · *Operationalize* (turn the hunt into a standing detection).

## Outcome vocabulary

- **Findings Identified** — the hypothesized activity was found. · **No Evidence Found** — hunted thoroughly, nothing matched (state coverage). · **Partial / Follow-up Required** — a lead surfaced but isn't confirmed. · **Inconclusive** — coverage or data gaps prevented a verdict.

## Confidence vocabulary

- **High** — direct evidence; for a clean result, strong coverage and a specific signature. · **Moderate** — suggestive, or coverage gaps narrow the claim. · **Low** — weak signal or thin coverage.

## Done

- The outcome and coverage are clear from the top — a clean result says how much was actually hunted.
- Hypothesis, scope, and method are explicit enough to repeat the hunt.
- Negative leads are recorded, not just positive ones.
- A hunt worth running again ends with an "operationalize" recommendation. No template example content remains.
