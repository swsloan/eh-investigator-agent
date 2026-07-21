# Detection Set Chat Output

A Detection Set is a compact chat block for one verdict over one detection or a
related group. Use it for actionable triage conclusions. It is not an
interactive app card; it is structured prose the user can audit and approve.

## Template

```markdown
### Detection Set: <short title>

<One or two sentences describing what the detections represent.>

- **Verdict:** <False Positive | Benign True Positive | Malicious True Positive | Inconclusive>
- **Confidence:** <Low | Medium | High>
- **AI disposition:** <false_positive | benign_true_positive | malicious_true_positive | indeterminate | not recorded>
- **Recommended action:** <Close | Leave open | Escalate to L2 | Create Investigation | Operator action in RevealX>
- **Detections:** #<full-id> <type>, #<full-id> <type>
- **Participants:**
  - Offender: <name or IP> (device/<OID> or ipaddr)
  - Victim: <name or IP> (device/<OID> or ipaddr)
- **Human outcome:** <existing human resolution or investigation assessment; show agreement/disagreement with the AI read; omit when none>
- **Similar past detections:** #<full-id>, #<full-id> <omit when none>
- **Evidence:** <workspace evidence paths and the key fact each supports>
- **Open questions:** <omit if none>

**If Close:**
- Resolution: <no_action_taken | action_taken>
- Notes: <why close is justified; if action_taken, name the response action>

**If Create Investigation:**
- Suggested name: <concise investigation name>
- Risk / focus: <what to investigate first>
- Blast radius notes: <affected assets and scope>
```

Use full detection IDs returned by the API/CLI. Do not abbreviate to a console
display short ID when the full ID is available.

Load `console-links.md` when a verified console FQDN is available. Link final
Detection Set IDs to `/extrahop/#/detections/detail/<full-id>`, device
participants only when a valid appliance UUID and discovery ID are also
available, and a created investigation only after the successful call returns
its ID. Keep bulk close lists and internal escalation queues unlinked. Never
fabricate a hostname, UUID, ID, or URL.

## Batch Close Summary

For a homogeneous safe-close group, present one batch summary and wait for
approval:

```markdown
### Close Batch: <short title>

<One or two sentences explaining why the batch is homogeneous.>

- **Verdict:** <False Positive | Benign True Positive>
- **Confidence:** High
- **AI disposition:** <false_positive | benign_true_positive>
- **Resolution:** no_action_taken
- **Homogeneity:** <same type/shared participant/same benign explanation>
- **Closing (<N>):** #<id>, #<id>, #<id>
- **Excluded (<N>):** #<id> - <why excluded>; #<id> - <why excluded>
- **Evidence:** <workspace evidence paths>
```

The `Closing (N)` list must enumerate every ID the user is approving. Do not use
ranges or ellipses. If the list is too large for a comfortable chat response,
write a reviewed candidate list to `scratch/`, summarize it, and ask the user
how they want to proceed before changing state.

## Escalation Queue

When L1 cannot safely close an item and it merits deeper work, present an
escalation queue:

```markdown
### Escalation Queue (<N> items)

1. **[High]** #<id> <title>
   - Reason: <malicious true positive | undetermined but suspicious>
   - Participants: <name> (device/<OID>, discovery_id <id>, criticality)
   - ATT&CK: <techniques if known>
   - Proposed investigation: <standalone or grouped with IDs>
   - Evidence snapshot: <paths and key facts>
   - Open questions: <what L2 must resolve>
```

Keep the queue in chat by default. Write `scratch/escalation-queue.json` only
when it is large enough that context loss is a real risk. Follow
`escalation.md` for the complete handoff and investigation-grouping contract.

## Console Links

Follow `console-links.md` for exact sources, path forms, and placement. If the
FQDN is unknown, leave identifiers as plain text. A correct unlinked Detection
Set is better than a fabricated link.

## Tuning Recommendations

When recurring benign history supports it, add a short tuning recommendation:

```markdown
**Tuning recommendation:** In RevealX, consider a tuning rule for
<detection type> scoped to <participant/scope>. Rationale: <why this is
recurring benign noise>. Supporting detections: #<id>, #<id>.
```

Frame tuning as an operator action unless current CLI help proves a tuning tool
exists and the user explicitly approved using it.
