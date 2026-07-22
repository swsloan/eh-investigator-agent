# L2 Security Investigation Workflow

Use this workflow for a single detection, host, IP, IOC, suspected compromise,
or any L1 escalation that needs transaction evidence. L2 tests hypotheses,
reconstructs attack chains, and decides whether action is warranted.

## Plan Shape

Represent the investigation in the structured `./investigation-plan`. Use
outcome tasks for hypothesis framing, participant/timeline scope, the cheapest
deciding corroboration, and final disposition. Do not turn the plan into a list
of tool calls. Record a pivot before widening to a materially new participant,
attack stage, or hypothesis.

## Step 0: Consume The L1 Escalation Packet

When L1 escalated the item, load `escalation.md` and reuse what it already
resolved:

- detection IDs and grouping;
- preliminary verdict and confidence;
- participant OIDs, discovery IDs, IPs, roles, and criticality;
- ATT&CK technique(s) and detection type meaning;
- evidence snapshot and timeline highlights;
- open questions.

Do not re-fetch participant metadata unless it is stale, incomplete, or needed
for a different pivot. Work the highest-priority queue item first. If the queue
is large, investigate the top items by risk and summarize the rest as still
open rather than chasing every edge.

## Step 1: Establish Starting Point And Hypothesis

Start from the user's target:

- Detection ID: get the full detection, detection activity/timeline, and type
  metadata when the CLI exposes those tools.
- Device or hostname: resolve to a device OID and discovery ID, then search
  recent security detections and match participants client-side.
- IP-only target: search devices by IP when possible; otherwise use the IP as a
  record pivot with `.ipaddr` and as a participant-matching value in detections.
- IOC such as domain, URI, or hash: search records over a narrow recent window,
  then pivot back to involved devices and detections.

State a working hypothesis and the strongest benign alternative. Examples:

- possible lateral movement versus authorized admin tooling;
- possible exfiltration versus scheduled backup or replication;
- possible C2 beaconing versus monitoring or update traffic;
- possible credential attack versus normal lockout or service-account behavior.

The investigation tests both the malicious hypothesis and the benign
alternative.

## Step 2: Resolve Participants And Pivot IDs

Detection participants may be devices, IPs, users, or external entities. Resolve
important device participants:

- device OID for metrics and device lookup;
- discovery ID or ExtraHop ID for record fields;
- current IPs and display name;
- role and criticality;
- tags or group membership if relevant.

Use the shared pivot rules from `extrahop-excli`:

- metrics on devices use OIDs;
- records use discovery IDs across `client`, `server`, `sender`, and `receiver`
  fields, or `.ipaddr` for IP-only pivots;
- packets pivot from specific records using the record's first/last times and a
  BPF for one conversation.

## Step 3: Correlate Detections And Timeline

Look for related detections involving the same participants or adjacent attack
stages. Detection search may not support participant filtering, so pull by time,
category, type, status, or resolution first, then match participants
client-side.

Bound expansion:

- start with the detection's own window and participants;
- widen only when evidence shows a pivot to a new host or stage;
- prioritize critical assets, active recent behavior, and repeated indicators;
- stop when correlation becomes speculative.

Build an ordered timeline in UTC. Each step must point to a detection, metric,
record, packet, or user-provided artifact. Do not invent missing attack stages.

## Step 4: Corroborate With Metrics When Useful

For hypotheses about volume or shape, metrics are cheaper and safer than broad
record searches:

- exfiltration: outbound bytes, peer volume, unusual destinations;
- scanning: peer fan-out, connection counts, port/protocol spread;
- beaconing: periodic connection counts or repeated peer contact;
- brute force: authentication request/error rates and affected accounts;
- lateral movement: new internal peers or service usage by a device.

Search the metric catalog for valid category/stat/object combinations before
querying. Use totals or total-by-object first to prove data exists, then
timeseries only when shape matters. Save raw output under `evidence/metrics/`.

## Step 5: Pull Narrow Supporting Records

Records answer what exactly happened. They are expensive and usually short-lived,
so keep windows tight and within available retention.

Build record searches that test the hypothesis:

- combine participant and suspicious attribute with a compound `and`;
- use a specific record type or a small type set;
- sort by time and keep limits small;
- paginate only when the first page proves the query is useful;
- capture exact fields that identify the behavior: usernames, hostnames, URIs,
  filenames, status codes, user agents, TLS versions, DNS names, JA fingerprints,
  bytes, ports, and flow times.

Common filters:

```json
{
  "operator": "or",
  "rules": [
    { "field": "client", "operator": "=", "operand": "<discovery_id>" },
    { "field": "server", "operator": "=", "operand": "<discovery_id>" },
    { "field": "sender", "operator": "=", "operand": "<discovery_id>" },
    { "field": "receiver", "operator": "=", "operand": "<discovery_id>" }
  ]
}
```

Use `.ipaddr` for IP-only pivots. Numeric operands may still need to be strings;
follow the current tool help and examples.

Discover fields once per record type by querying a single result and inspecting
its shape. For multi-page searches that begin with relative time, reuse the
absolute `from` and `until` echoed by the first response when available so later
pages do not drift into a changing population. Sort by the event time field and
start with a small limit; paginate only after the first page proves that the
query tests the hypothesis.

Do not dump all records for a host over days. If a broad search is tempting,
return to metrics or tighten the hypothesis.

## Step 6: Pull Packets Only For Proof

Use packet capture only when:

- payload, protocol details, or exact bytes are required;
- record fields are insufficient to confirm content;
- the time window is recent enough for packet retention.

Scope the initial PCAP to one conversation and a small time window. When
pivoting from a record, use the record's `_source.first` and `_source.last` with
a small cushion, not just the display timestamp. Follow the mandatory bounded
expand-and-refine rule in `extrahop-excli`: unless the response proves a
structural failure, widen an empty initial packet query at least once before
making any availability claim. Save outputs under `evidence/packets/` and use
`tshark` when available for analysis.

## Step 7: Confirm, Refute, And Conclude

Before concluding malicious, actively test the most plausible benign
explanation:

- authorized scanner, backup, replication, vulnerability management, monitoring,
  EDR, patching, or admin tooling;
- service account or scheduled task behavior;
- expected maintenance window or migration;
- misconfiguration causing real but non-malicious traffic.

Outcomes:

- `Malicious True Positive` - evidence supports unauthorized or compromise
  activity over benign alternatives.
- `Benign True Positive` - behavior was real and detection was valid, but
  expected or authorized.
- `False Positive` - detection was wrong or misattributed.
- `Inconclusive` - evidence cannot decide; name what would decide it.

Benign downgrade is a complete result. If L1 escalated a detection as suspicious
but L2 shows scheduled backup traffic, conclude benign and recommend close
instead of forcing an investigation.

Before recommending a new RevealX investigation, check for existing coverage:
search related detections and note any already linked to an open investigation
or ticket when that field is available. Do not create duplicates. If action is
warranted, present the Detection Set and wait for approval before calling any
state-changing tool.

When the approved create-investigation tool supports it, set the case
`assessment` to `malicious_true_positive`, `benign_true_positive`,
`false_positive`, or `undecided`. Keep that case-level assessment distinct from
each detection's `ai_disposition`; set both only when supported and approved,
and never overwrite a human assessment or disposition silently. Use `undecided`
for an active case whose conclusion is not yet established, not as a euphemism
for benign.

For durable output, use the SOC investigation report type unless the user's work
is a proactive hunt, in which case use threat hunting.
