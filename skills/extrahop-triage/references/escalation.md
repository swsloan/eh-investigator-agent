# L1 To L2 Escalation

Treat L1 triage and L2 investigation as stages of one security workflow. L1
produces a prioritized handoff for items that are not safely closeable; L2
reuses that work and collects only the deeper evidence needed to decide them.

## Escalation Queue

Escalate malicious candidates and undetermined-but-suspicious items. Keep benign
noise that cannot be closed safely visible as an individual triage item rather
than hiding it in a malicious queue.

Each queue entry contains one item or one coherent proposed case:

- `detection_ids` — full IDs returned by the live interface;
- `escalation_reason` — the decision gap that requires L2;
- `priority` — High, Medium, or Low;
- `preliminary_verdict` and confidence;
- resolved participants — OID, discovery ID, IP, role, and criticality when
  available;
- detection-type meaning and ATT&CK techniques;
- evidence snapshot — workspace evidence paths and the key supported facts;
- strongest benign alternative;
- open questions that L2 must answer;
- proposed investigation grouping.

Keep the queue in chat by default. For a large queue, save the structured copy
as `scratch/escalation-queue.json`; never place an internal queue at the
workspace root. Track investigation progress with the workflow checklist in
scratch notes, not by turning the queue into a second transcript.

## Prioritization

Rank client-side over the population actually retrieved:

1. active or recent behavior involving a critical offender or victim;
2. higher risk supported by multiple correlated detections or adjacent attack
   stages;
3. single suspicious detections with material unresolved questions;
4. older, lower-impact, or weakly supported items.

Assign High/Medium/Low and explain the driver. Do not imply a complete ranking
when the population was sampled or truncated.

## Investigation Boundaries

Propose one investigation when detections share a participant, overlap in time,
and form a plausible sequence on the same assets. Keep unrelated true positives
separate. Do not group merely because items share a risk score or queue window.

L1 may recommend direct case creation only for a clear, high-confidence
malicious true positive whose evidence already meets L2-level confirmation.
Escalate medium-confidence, uncertain, or record-dependent candidates first.
Never create a case without the approval required by the main skill.

## L2 Consumption

Work highest priority first. Reuse participant IDs, type metadata, and evidence
paths from the handoff rather than re-fetching them unless they are incomplete,
stale, or inconsistent. Start at correlation or transaction confirmation when
the packet already establishes the starting detection and participants.

When the queue is large, investigate a bounded top set and preserve the rest as
still open. Deep investigation is expensive; an explicit residual queue is
safer than a shallow conclusion over every item.

## Chat Shape

```markdown
### Escalation Queue (<N> items)

1. **[High]** #<full-id> <title>
   - Reason: <why L2 is required>
   - Preliminary verdict: <verdict> (<confidence>)
   - Participants: <name> (device/<OID>, discovery_id <id>, critical)
   - ATT&CK: <technique IDs if supported>
   - Evidence: <workspace paths and facts>
   - Benign alternative: <best alternative>
   - Proposed investigation: <standalone or grouped IDs>
   - Open questions: <what L2 must decide>
```

Do not add console links inside this internal handoff. Add them to the final
Detection Set or case handoff after L2 reaches a decision.
