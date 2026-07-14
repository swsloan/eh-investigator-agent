# Triage Reporting Nuance

Use this file only to decide how triage findings should be handed off. The
`investigation-reporting` skill remains authoritative for report mechanics,
template selection, required sections, evidence provenance rules, styling, and
HTML output.

## Authority Boundary

This triage skill decides:

- whether the result should stay in chat, become a Detection Set, or become a
  durable report;
- whether a durable report should route to SOC investigation or threat hunting;
- which triage-specific context should be carried into that report.

The `investigation-reporting` skill decides:

- the report type's structure and vocabulary;
- the HTML template and filename rules;
- how evidence, limits, alternatives, recommendations, and visuals are rendered;
- when to remove or keep template sections.

If this file and `investigation-reporting` appear to conflict,
`investigation-reporting` wins for all durable report content and formatting.

## Output Decision

Use chat only when the user asked for quick triage, the answer is minor, or the
result is "nothing material found." Lead with what can safely close, what should
stay open, and what needs investigation.

Use `detection-set-output.md` when the answer carries an action-bearing triage
decision: close, leave open, escalate to L2, create an investigation, or ask the
operator to perform a RevealX action. Detection Sets are chat handoff blocks,
not report templates.

Use a durable HTML report when the user asks for one or when triage reaches a
material security conclusion: confirmed or strongly suspected malicious
activity, meaningful blast radius, incident handoff, or a proactive hunt result
worth auditing later.

Do not create a triage-specific HTML template. Existing report types cover the
deliverables.

## Report Routing

When a durable report is needed, load `investigation-reporting` and then the
chosen report-type reference:

| Triage result | Use |
| --- | --- |
| Single detection, alert, suspected incident, confirmed compromise, or benign/false-positive disposition that needs durable handoff | SOC investigation |
| Proactive sweep across a hypothesis, IOC set, population, or environment | Threat hunt |
| Queue triage without a material case | Chat Detection Sets and escalation queue, not an HTML report by default |
| Operational root cause, outage, latency, or service health | Pivot to `extrahop-health-check` / NOC or operational health reporting |

## Triage Context To Carry Into A Report

Pass these triage-specific facts into the selected report type when they exist:

- the final disposition: malicious true positive, benign true positive, false
  positive, or inconclusive;
- confidence and why it is calibrated that way;
- detection IDs, types, categories, risk scores, and MITRE ATT&CK mappings;
- offender/victim roles, device criticality, and any identity or external
  participants;
- the L1/L2 path: what was safely closed, what was escalated, and why;
- prior benign or prior malicious history that affected confidence;
- safe-close or tuning recommendation rationale;
- alternatives considered, especially the strongest benign explanation;
- open questions and visibility limits from ExtraHop's passive network view.

Let `investigation-reporting` decide where these facts belong in the SOC or
threat-hunt structure.

## Triage-Specific Caveats

- A queue-triage summary is not automatically an incident report. Report only
  the material case or hunt result, and keep routine queue-clearing in chat.
- A Detection Set can summarize an action, but it does not replace a SOC report
  when the activity is malicious or materially risky.
- A clean proactive hunt can be worth a threat-hunting report when coverage is
  strong and the result is useful for audit.
- Do not claim a detection was closed, tuned, tagged, or escalated unless the
  `./excli-interface` call succeeded or the user performed the action outside
  the agent.
- Do not infer absence of compromise from empty records alone. Preserve the
  retention, scope, and query-shape limits for the selected report type to
  render.
