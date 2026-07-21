---
name: extrahop-health-check
description: "Use for ExtraHop operational health checks, service-performance assessment, network-health review, protocol fleet checks, device health, silent outage checks, and root-cause-oriented IT operations triage through the brokered ./excli-interface workflow."
---

# ExtraHop Health Check

Run repeatable operational health checks with ExtraHop evidence. This skill is
the project-local, CLI-aligned version of the health-check methodology: use
`./excli-interface`, keep raw evidence in the workspace, and avoid assumptions
from MCP-only workflows.

Use this skill when the user asks:

- "Run a health check", "is the network healthy?", "what is wrong with the network?"
- DNS, HTTP, Kerberos, LDAP, SMB/CIFS, database, TLS, TCP, latency, timeout,
  retransmission, packet loss, account lockout, service slowness, or outage questions.
- General operational posture for an environment, device, protocol fleet, or
  critical service.

If the work becomes a security detection triage or incident-response question,
use the security/triage workflow instead. If a health check surfaces a likely
security issue, such as a broad password-spray pattern, say so and pivot to
security triage.

## References

- `references/methodology.md` - load for every health check. Contains scopes,
  evidence gates, metric categories, two-pass error classification, thresholds,
  baselines, and role weighting.
- `references/playbooks.md` - load when any category is Warning or Degraded.
  Contains root-cause drill-down recipes.
- `references/reporting.md` - load before answering or writing a report.
  Contains chat-answer and HTML-report guidance.
- `references/console-links.md` - load when appliance metadata or a pasted
  RevealX URL makes device or device-group deep links possible.

## Execution Contract

This project uses `./excli-interface`, not an ExtraHop MCP server.

1. Use `workspace-organization` before writing files.
2. Use `extrahop-excli` for command syntax and empty-result handling.
3. Run `./excli-interface -listtools` if tool availability is uncertain.
4. Run `./excli-interface TOOL -help` before first use of a tool in a session.
5. Save every raw response under `evidence/` before analysis.
6. Use metric evidence first for broad health and trends. Use records only after
   metrics identify the device, protocol, and narrow time range that matter.
7. Use `investigation-reporting` for durable HTML reports.

Tool names can vary with CLI release. Prefer the available `excli-interface`
tool help over examples in this skill. Expected tool families are:

- entity discovery: device search, device-group search/list, device details,
  appliance metadata when available;
- metrics: metric catalog search and metric query execution;
- records: record search for narrow transaction examples after metrics;
- tags: only if the CLI exposes tag assignment tools and the user explicitly
  asks to mark or persist results.

If a required read operation is not wrapped, state the missing wrapped
capability once, continue with the strongest available evidence, and never
substitute invented telemetry.

## Scope Selection

Infer the scope from the request:

| Scope | User signal | Approach |
| --- | --- | --- |
| Environment | no target, "overall", "the network" | capture-level screening across sensors, then device drill-down only where signals appear |
| Device | hostname, IP address, application/server named | resolve device, assess role-relevant protocols plus TCP and volume |
| Protocol fleet | protocol named without a device | capture screening, discover relevant fleet, sample/rank devices |

If scope is ambiguous, default to environment and offer a follow-up drill-down.

Default windows:

- Quick current-state check: last 1 hour.
- General daily posture: last 24 hours.
- Fleet, chronic/performance-debt, or weekly hygiene: last 7 days.
- Use the user's explicit window when given.

## Core Method

1. **Freshness gate.** Query recent capture-level `net:bytes`. If newest data is
   more than 10 minutes stale, return Insufficient Evidence instead of a health
   verdict.
2. **Discover real objects.** Resolve sensors, devices, groups, roles, OIDs,
   discovery IDs, and peer sets with entity tools. Do not guess IDs.
3. **Screen broadly with metrics.** Start at capture or group level. Use totals
   and `total_by_object` before time series.
4. **Classify errors in two passes.** Never classify protocol health from raw
   `rsp_error` alone. Query the breakdown metric and remove benign responses.
5. **Check silent outages.** Compare request/response volume to a valid
   baseline; a service with no traffic can have no errors.
6. **Apply activity and routing gates.** Avoid percentage verdicts on tiny
   samples. Avoid TCP verdicts when asymmetric routing makes telemetry suspect.
7. **Compare to a baseline.** Use prior equivalent window for short checks and
   same-day-last-week for windows of 24 hours or longer when history exists.
8. **Assess temporal pattern.** Distinguish sustained, transient, intermittent,
   and step-change behavior with time-series buckets.
9. **Correlate downstream.** Before finalizing Warning or Degraded, check whether
   the apparent symptom is caused by a downstream service, dependency, or sensor
   deployment issue.
10. **Answer with verdict and evidence.** Keep chat concise; create a durable
    operational health report when requested or when the findings are material.

## Assessment Procedures

### Environment

1. Discover capture/sensor groups and run the freshness gate per sensor.
2. Screen capture-level protocol volume, actionable error candidates,
   `tcp:desync`, and `tcp:unidirectional_flows`.
3. Compare current volume to a valid baseline and identify silent drops, load
   shifts, or sensor-wide collapse.
4. Drill into devices only for protocols flagged by error, latency, volume, or
   visibility signals. Rank a bounded top set rather than enriching the fleet.
5. Apply two-pass error classification, role weighting, and downstream
   correlation before assigning the environment verdict.

### Device

1. Resolve the device, role, OID, discovery ID, peers, and relevant protocol
   perspectives. Do not guess identifiers.
2. Infer workload class before applying HTTP or database latency thresholds.
3. Query role-primary protocols, TCP transport, latency percentiles, and
   request/response volume; keep secondary categories visible but weighted.
4. Compare with a prior equivalent window and same-role peers when valid.
5. Classify errors in two passes, inspect temporal shape, and apply activity and
   routing gates.
6. Run the matching root-cause playbook for every Warning or Degraded category.

### Protocol fleet

1. Screen the protocol at capture level, then discover devices by a verified
   role or observed protocol activity.
2. Assess a bounded, representative set of devices and say when the population
   was sampled or truncated.
3. Compare each device with the fleet median and median absolute deviation as
   well as its own baseline.
4. Rank worst first and report a bimodal fleet as "mostly healthy with N
   outliers" rather than hiding the outliers behind an average.

## Status Vocabulary

Use these statuses consistently:

- `Normal` - evidence meets gates and primary categories are within expected
  ranges.
- `Warning` - evidence shows meaningful degradation or anomaly that merits
  operator attention.
- `Degraded` - evidence shows material service impact, outage, or severe
  degradation.
- `Insufficient Evidence` - data is stale, missing, below activity gates, or
  unreliable for the requested verdict.

When baseline data supports it, append:

- `(new)` - worse than the baseline verdict.
- `(chronic)` - same issue persisted from baseline.
- `(recovered)` - better than baseline but still worth noting.

## Evidence Discipline

For every figure in the answer or report, preserve:

- exact collection time;
- exact `./excli-interface ... -json ...` invocation or request body file;
- raw output path under `evidence/`;
- any derived calculation in `scratch/`;
- what was checked and found clean.

Do not report "no issue" from an empty metric response until you have followed
the empty-response checks in `extrahop-excli`: verify the metric catalog,
object type, active object IDs, time range, limit, bucket type, and
client/server category.

## State Changes

Run health checks read-only by default. Assign or clear health tags only when
the user explicitly asks to persist results and the live CLI exposes the
required tools. Before changing tags in this interactive app, present the exact
devices and tag changes and obtain approval. Do not create assumed tag names;
verify that the tags exist, report per-device failures, and leave unassessed
devices untouched.
