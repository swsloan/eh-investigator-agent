# SOC investigation report

For a security investigation: a detection, alert, or suspected incident. The question is *"is this malicious, and how bad?"* Template: `assets/soc-investigation-template.html`.

## Structure

1. **Title / subtitle** — what was investigated, in one line.
2. **Verdict** — three cells: *Disposition* · *Confidence* · *Severity*.
3. **Analyst Summary** — what happened, what it means, what to do. Stands alone.
4. **Entities Involved** — hosts, users, IPs, domains, processes; each with role (`offender|target|infra|identity|external`) and criticality (domain controller, crown jewel, external).
5. **Scope and Timeline** — what was examined and the event sequence, UTC. Include the attack-chain flow when stages map to a kill chain.
6. **Key Questions and Findings** — Q&A. Each: one-line answer, why it mattered, findings tagged `[Observed]`/`[Assessed]`, evidence refs, confidence, MITRE ATT&CK ID(s) where applicable.
7. **Third-Party Enrichment** — material web research or external-tool findings, one source-attributed entry per lookup/finding. For web research, cite the original URL and local `research/` memo. For ReversingLabs, use `data-source="reversinglabs"` on every entry so its RL icon is shown; preserve the vendor verdict/scope and cite the local `reversinglabs/` artifact. Separate provider reports from investigator assessment and from ExtraHop observation. Delete this section when no useful enrichment was performed.
8. **Alternatives Considered** — other explanations that fit the evidence and why each was kept or ruled out. Narrative, not a scored matrix.
9. **Evidence Summary** — every supporting metric, record, packet with its provenance. Keep external source artifacts in Third-Party Enrichment rather than presenting them as ExtraHop evidence.
10. **Limits and Open Questions** — checked-and-clean / could-not-determine / what ExtraHop can't see.
11. **Recommended Next Steps** — *Contain/Respond* (now) · *Investigate further* (soon) · *Tune detection*.

## Disposition vocabulary

- **True Positive** — real malicious or unauthorized activity.
- **Benign True Positive** — fired correctly on real but authorized/expected activity.
- **False Positive** — the detection was wrong; no such activity occurred.
- **Inconclusive** — evidence insufficient to decide. Pair with specific open questions.

## Confidence vocabulary

- **High** — direct evidence; alternatives ruled out.
- **Moderate** — strong evidence with a small gap or unconfirmed assumption.
- **Low** — suggestive evidence; plausible alternatives remain.

## Done

- A reader gets disposition, confidence, and severity from the top alone.
- Every finding opens with a one-line answer, is tagged Observed/Assessed, and points to evidence.
- At least one alternative is addressed, or its absence justified.
- Limits name what's clean, unknown, and unseeable.
- No template example content remains.
