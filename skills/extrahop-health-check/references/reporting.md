# Health Check Reporting

The user may want a quick chat answer, a detailed answer, or a durable HTML
report. Keep all three evidence-led and reproducible.

## Chat Answer Shape

Default interactive answer:

```markdown
## Health Check: <target>

**<Verdict>** | <time window> | <scope qualifier>

<One sentence plain-English problem statement.>

**Findings**

- **<Verdict>** - *<Category>.* <one-sentence finding with one or two numbers that matter.>
- **<Verdict>** - *<Category>.* <one-sentence finding.>

**Key insight.** <Short paragraph: what is happening, what was ruled out, what remains healthy, and any important caveat.>

**What to do**

- <operator action outside the chat>

**Drill in further**

- <follow-up the user can paste back into chat>
```

Use the exact visible verdict words: `Normal`, `Warning`, `Degraded`,
`Insufficient Evidence`. Add `(new)`, `(chronic)`, or `(recovered)` only when
baseline evidence supports it.

For quick-look prompts such as "TL;DR" or "is everything okay?", return only the
title, verdict line, and one sentence.

For stale data, the answer is the freshness warning. Do not bury it as a caveat:

```markdown
## Health Check: <target>

**Insufficient Evidence** | Data stale

ExtraHop telemetry for this target is <X minutes> stale. A health verdict on stale data would be misleading.

**What to do**

- Investigate sensor or appliance connectivity.
- Rerun the health check after data freshness recovers.
```

## Console Links

Only create RevealX console links when you have real metadata:

- FQDN from appliance metadata or a user-provided console URL.
- Device URL appliance UUID from appliance metadata or a parsed device URL.
- Device discovery ID from `get_device`.
- Group ID from device-group discovery.

Never fabricate hostnames, UUIDs, or discovery IDs. An unlinked but correct
report is better than a wrong link. If links are available, match the console
time window to the assessment window and link the first occurrence of important
devices/groups in chat or report prose.

## Durable HTML Report

Use the `investigation-reporting` skill and the operational health report type:

- reference: `skills/investigation-reporting/references/operational-health-assessment.md`
- template: `skills/investigation-reporting/assets/operational-health-template.html`
- output path: workspace root as `report-<short-slug>.html`

Use this report for:

- environment health assessments;
- periodic service health summaries;
- protocol fleet reviews;
- critical-device health baselines;
- health checks with material Warning/Degraded findings;
- user-requested health-check reports.

Do not use the NOC/SRE incident template unless the health check has become an
incident/RCA/postmortem with duration, impact, root cause, and follow-up owners.

## Report Content Requirements

The operational health report should include:

1. Title, scope, window, prepared time, and data sources.
2. Status strip: overall health, telemetry confidence, scope.
3. Executive health summary: answer first.
4. Key indicators: healthy/degraded categories, freshness, request volume, error
   or latency headline.
5. Health domains or fleet breakdown: Normal/Warning/Degraded/Insufficient
   Evidence per domain.
6. Findings: each tagged Observed or Assessed and tied to evidence IDs.
7. Baseline and change: what is new, chronic, recovered, or steady.
8. Recommendations: stabilize, investigate, tune, or monitor as appropriate.
9. Scope, method, and limits, including what ExtraHop cannot see.
10. Evidence index with exact query/tool-call pointers and raw evidence paths.

If a section has no evidence-backed content, remove it or say why it is
inapplicable. Do not leave worked example content.

## Evidence References

Every figure in a durable report should point to an evidence row:

- source type: metrics, records, devices, appliance metadata, packet analysis,
  or external artifact supplied by the user;
- exact command or request body file;
- collection time in UTC;
- workspace output path;
- concise result.

Preserve raw JSON. Calculations, grouping, and chart/table preparation belong in
`scratch/`.
