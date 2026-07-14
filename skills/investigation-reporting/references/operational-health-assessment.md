# Operational health assessment report

For ExtraHop health checks, service-performance posture reviews, protocol fleet
summaries, and periodic operational assessments. Template:
`assets/operational-health-template.html`.

## How this differs from NOC/SRE

Use this report when the deliverable is a health assessment, not an incident
write-up. It answers "how healthy is this environment/device/fleet right now or
over this period?" NOC/SRE is for outages, RCAs, postmortems, and incident
reports where duration, root cause, blast radius, and ownered follow-up actions
drive the document.

Operational health reports lead with posture and evidence sufficiency:

- what is healthy, degraded, warning, or not measurable;
- whether the telemetry is fresh and representative;
- what changed versus a valid baseline;
- whether problems are new, chronic, recovered, fleet-wide, localized, or a
  silent outage;
- what to do next.

## Structure

1. **Title / subtitle.** Scope and time window in one line.
2. **Status strip.** Overall health, telemetry confidence, and scope.
3. **Executive Health Summary.** The answer first: what is healthy, what needs
   attention, and what is inconclusive.
4. **Key Indicators.** Freshness, checked categories, affected objects, request
   volume, error/latency headline, or HSI if explicitly useful.
5. **Health Domains.** Table or cards showing each assessed protocol/tier with
   status, current value, baseline, and evidence.
6. **Findings.** Observed/assessed finding blocks. Each starts with a
   verdict-oriented answer and cites evidence.
7. **Baseline and Change.** New/chronic/recovered/steady distinctions, temporal
   pattern, and peer comparison when available.
8. **Recommendations.** Stabilize, investigate, tune, or monitor. Owner/due
   dates are optional unless the user provided them.
9. **Scope, Method, and Limits.** Freshness gates, activity gates, baseline
   method, and what ExtraHop cannot see.
10. **Evidence Index.** Exact `./excli-interface` commands or request-body
    files, UTC collection times, raw evidence paths, and concise results.

Delete sections that do not serve the assessment. Do not leave empty scaffolding
or worked-example data.

## Status Vocabulary

Use these health statuses:

- **Normal** - evidence meets gates and health indicators are within range.
- **Warning** - meaningful anomaly or degradation merits attention.
- **Degraded** - material service impact, severe degradation, or silent outage.
- **Insufficient Evidence** - stale, missing, low-volume, or unreliable data.

Optional modifiers:

- **new** - worse than baseline;
- **chronic** - unchanged from baseline and represents performance debt;
- **recovered** - improved from baseline but still relevant.

Map status to template severity tokens:

| Status | `data-sev` |
| --- | --- |
| Degraded | `high` or `critical` when impact is severe |
| Warning | `medium` |
| Normal | `low` |
| Insufficient Evidence | `info` unless blind spot is operationally severe |

## Done

- The top summary is enough for a 30-second reader.
- Every claim cites evidence and preserves the raw data path.
- Freshness, activity gates, baseline validity, and visibility limits are stated.
- Benign protocol errors were separated from actionable errors before verdicts.
- Silent outage / volume-drop checks were considered.
- Warning/Degraded findings include a concrete next step or explain why the next
  step is out of band.
