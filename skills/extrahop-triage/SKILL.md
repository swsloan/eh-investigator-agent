---
name: extrahop-triage
description: "Use for ExtraHop RevealX security detection triage, SOC alert review, NDR investigation, detection queue noise reduction, suspected compromise analysis, attack-chain reconstruction, and deciding whether detections are false positives, benign true positives, malicious true positives, or need escalation through the brokered ./excli-interface workflow."
---

# ExtraHop Security Triage

Run security detection triage and investigation with ExtraHop evidence. This is
the project-local, CLI-aligned version of the triage methodology: use
`./excli-interface`, save raw evidence in the workspace, and avoid assumptions
from MCP-only workflows, scheduling systems, or interactive detection cards.

Use this skill when the user asks:

- to triage, clear, close, prioritize, investigate, or explain security
  detections;
- whether an alert is malicious, benign, a false positive, or worth escalation;
- what happened around a detection, host, IP, user, domain, or IOC;
- to reduce SOC queue noise, identify safe closes, or reconstruct an attack
  chain.

If the work is about network/service health, latency, protocol errors,
retransmissions, outages, or operational posture rather than security, use the
`extrahop-health-check` skill instead. If triage shows a performance root cause,
say so and pivot to health check. If a health check surfaces suspicious
behavior, pivot back to this triage workflow.

## References

- `references/triage-workflow.md` - load for multi-detection queues, bulk
  triage, safe-close recommendations, prior benign history, and AI accuracy
  review.
- `references/investigation-workflow.md` - load for a single detection,
  suspected compromise, device/IP investigation, record pivots, packet proof,
  and attack-chain reconstruction.
- `references/escalation.md` - load when L1 findings must pass into L2. Contains
  the queue, handoff packet, prioritization, and investigation-grouping contract.
- `references/detection-set-output.md` - load before presenting actionable
  detection conclusions in chat.
- `references/console-links.md` - load when appliance metadata or a user-supplied
  RevealX URL makes exact detection, participant, or investigation links possible.
- `references/reporting.md` - load when deciding whether triage should stay in
  chat, become Detection Sets, or hand off to the authoritative
  `investigation-reporting` skill for a durable report.

## Execution Contract

This project uses `./excli-interface`, not an ExtraHop MCP server.

1. Use `workspace-organization` before writing files.
2. Use `extrahop-excli` for command syntax, evidence selection, pivot
   IDs, metric empty-result handling, and PCAP behavior.
3. Run `./excli-interface -listtools` if tool availability is uncertain.
4. Run `./excli-interface TOOL -help` before first use of a tool in a session.
5. Save every raw response under `evidence/` before analysis.
6. Use detections and metadata for triage, metrics for broad corroboration,
   records for narrow transaction confirmation, and packets only when byte-level
   proof matters.
7. Use `investigation-reporting` for durable HTML reports.
8. Use `security-research` when an unfamiliar IOC, filename, product,
   CVE, campaign, or current vendor fact could change the disposition. External
   research corroborates context; it does not replace ExtraHop evidence.

Tool names can vary with CLI release. Prefer the available `excli-interface`
tool help over examples in this skill. Expected tool families are:

- detections: search/list detections, get one detection, detection type
  metadata, detection activity or timeline;
- entities: device search, device details, device groups, tags, users or
  localities when available;
- metrics: metric catalog search and metric query execution;
- records: record search for narrow L2 transaction confirmation;
- packets: PCAP download for recent single-conversation proof;
- state change: detection update and investigation creation only if exposed by
  the CLI and explicitly approved by the user.

Do not preserve MCP tool names as project guidance. Translate any older
`extrahop_*` or `exmcp:*` examples into the actual `./excli-interface` tools
available in the current session.

Work pivots sequentially. Paginate until the retrieved population is sufficient
for the claim, or state the exact sample/limit. When a result is unexpectedly
empty, verify filters and identifiers, widen the time range within retention,
and relax one constraint at a time. After three or four defensible attempts,
report what was tried and stop rather than fabricating a result.

If a wrapped read operation is unavailable, continue at the strongest available
evidence layer and state the limitation once. Missing records or packets
narrows the conclusion; it never licenses invented transaction or payload
evidence.

## Mode Router

- "Triage the queue", "what can I close", "reduce noise", "prioritize alerts"
  -> L1 triage with `references/triage-workflow.md`.
- "What happened with this detection/device/IP?", "investigate this",
  "is this compromised?", "reconstruct the attack chain" -> L2 investigation
  with `references/investigation-workflow.md`.
- "Triage these and dig into the bad ones" -> start in L1, produce an
  escalation queue, then switch to L2 for the prioritized escalations.
- "How accurate were AI triage verdicts?" -> read-only accuracy review from the
  L1 workflow; do not close detections or open investigations.

Default windows:

- Queue triage: last 24 hours unless the user gives a window.
- Current urgent review: last 1 hour when the request says "right now" or
  "latest".
- Broader campaign or recurrence review: up to 7 days for records-backed work;
  use metrics/detection history for longer lookbacks.

## State Changes

Closing detections, changing status/resolution, and creating investigations are
RevealX state changes. In this app, present the planned action and exact IDs in
chat, then wait for explicit user approval before calling any state-changing
`./excli-interface` tool. If the CLI does not expose the needed state-change
tool, recommend the action for the operator to perform in RevealX instead.

Non-destructive labels or AI dispositions may still alter RevealX state when
the CLI supports them. Treat them as lower risk but still preview and approve
the exact writes in this interactive app. Do not overwrite human ground truth.
If a person already closed, resolved, or assessed a detection, surface any
agreement or disagreement instead of clobbering it.

Keep these fields distinct when the live tool exposes them:

- `status` is queue workflow state; `closed` removes an item from the open queue.
- `ai_disposition` is the agent's verdict: `false_positive`,
  `benign_true_positive`, `malicious_true_positive`, or `indeterminate`.
- `resolution` describes whether a real response occurred and is valid only on
  a closed detection: `action_taken` or `no_action_taken`.
- investigation `assessment` is the case-level conclusion:
  `malicious_true_positive`, `benign_true_positive`, `false_positive`, or
  `undecided`.

Use `action_taken` only when the user or evidence identifies the completed
response. Use `no_action_taken` for a benign/false-positive close. Use
`indeterminate` or `undecided` for unresolved work, and never translate those
values into a benign conclusion.

Recurring schedules and autonomous unattended closes are not part of this
project-local skill. If the user asks for automation, describe the safe triage
criteria and ask how they want scheduling handled outside this workflow.

## Core Rules
- If results are truncated, sampled, paginated, or scoped, state that clearly.
- A scary detection is a hypothesis, not a verdict. Confirm it with correlated
  evidence and consider the strongest benign explanation.
- Narrow detection searches with live server-side filters, then rank by risk,
  participant criticality, correlation, and recency client-side unless the live
  schema proves those server-side capabilities exist.
- Cache detection-type metadata once per type. Reserve full-detail calls for
  outliers, homogeneity breakers, and escalation candidates.
- Records and packets are L2 tools. Do not use them for broad L1 queue sweeps.
- Search detections by the filters the CLI actually supports, then rank and
  match participants client-side when needed.
- Recommend tuning rules only as operator/UI actions. Do not claim to create or
  apply tuning or suppression rules unless the current CLI help proves that tool
  exists and the user approved its use.
- Before creating an investigation, check whether an open case or ticket already
  covers the same detections, participants, and time window.
- Never claim a detection was closed, classified, assigned, or added to an
  investigation unless the corresponding interface call succeeded.
