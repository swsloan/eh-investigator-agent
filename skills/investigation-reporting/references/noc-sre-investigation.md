# NOC/SRE investigation report

For an operations investigation: outage, degradation, latency, capacity, reliability. Serves two readers — the engineer who audits the diagnosis and the leader who reports impact upward. Template: `assets/noc-sre-template.html`.

## Two rules specific to this type

- **Lead with impact.** Duration, blast radius, user and business effect — quantified, at the top. Leadership reads only there: *how bad, how long, is it over, will it recur.*
- **Trigger ≠ root cause ≠ contributing factor.** Name all three. A report that stops at the trigger ("the disk failed") without the systemic cause ("the health check couldn't detect a slow member") produces the same incident again.

## Structure

1. **Title / subtitle.**
2. **Status banner** — three cells: *Status* · *Root Cause* (state + confidence) · *Severity*.
3. **Executive Summary** — what broke, who felt it and for how long, why, what was done, what remains. Stands alone.
4. **Impact and Key Numbers** — duration, % requests/users affected, latency vs. baseline, error counts, MTTD/MTTR, SLO budget burned.
5. **Affected Systems** — each with role (`culprit|affected|dependency|infra|external`) and criticality (revenue path, single point of failure).
6. **Timeline** — first symptom → detection → escalation → diagnosis → mitigation → recovery, UTC. Include the failure-chain flow (Trigger → Fault → Propagation → Impact → Recovery) when the path is known.
7. **Diagnostic Questions and Findings** — Q&A; one-line answer, why it mattered, `[Observed]`/`[Assessed]`, evidence refs, confidence.
8. **Root Cause and Contributing Factors** — the causal chain, each factor tagged `[Trigger]`, `[Root Cause]`, or `[Contributing]`. Leadership will quote this; make every sentence defensible.
9. **Hypotheses Considered** — the differential diagnosis; what else fit the symptoms and why it was ruled out.
10. **Evidence Summary** — metrics, records, logs, tickets, each with provenance.
11. **Limits and Open Questions** — checked-and-clean / could-not-determine / what ExtraHop can't see.
12. **Follow-up Actions** — *Stabilize* (now) · *Verify/Investigate* (soon) · *Prevent*. **Every action names an owner**, and a due date when one exists.

## Status vocabulary

- **Ongoing** — impact still occurring. · **Mitigated** — stopped by a workaround; permanent fix pending. · **Monitoring** — fix applied, watching. · **Resolved** — permanent fix verified. · **False Alarm** — alert fired, no real impact; say why.

## Severity vocabulary

- **SEV1** full outage / critical function down. · **SEV2** major degradation, significant or revenue-path impact. · **SEV3** minor / limited. · **SEV4** negligible / cosmetic. · **INFO** no impact.

## Root-cause state

- **Identified** — causal chain established and evidenced. · **Suspected** — leading hypothesis fits but unconfirmed; name what would confirm it. · **Not determined** — insufficient evidence; pair with open questions.

## Done

- A leader gets status, severity, duration, and blast radius from the top alone, and impact is in numbers not adjectives.
- Trigger, root cause, and contributing factors are explicitly distinguished.
- At least one competing hypothesis is addressed, or its absence justified.
- Every follow-up action has an owner. No template example content remains.
