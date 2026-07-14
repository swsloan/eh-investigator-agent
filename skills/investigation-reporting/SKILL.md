---
name: investigation-reporting
description: "Writes clean, interrogatable HTML reports from ExtraHop work and routes among threat hunt, SOC/security, NOC/SRE operations, operational health, informational, and PQC TLS readiness report types. Use for threat hunts, security detection triage, detections/incidents, outages/latency/RCA/postmortems, health checks/performance/hygiene summaries, and post-quantum TLS/key-exchange readiness assessments. Trigger when the user asks for a report, writeup, findings, summary, RCA, or postmortem; when an investigation reaches a material conclusion; or when a question is better answered as a written deliverable. Reports are written into this skill's HTML templates, never as Markdown. If the user only asked a question and the answer is minor, answer in chat and offer a report instead of writing one unprompted."
---

# investigation-reporting

Turn finished ExtraHop work into a report a reader can audit: they can separate fact from inference and reproduce every number. That principle outranks every rule below.

## Pick the report type

| Type | Use when | Reference | Template |
|------|----------|-----------|----------|
| Threat hunt | Proactive, hypothesis-driven sweep. "Is *anyone* doing X?" | `references/threat-hunting.md` | `assets/threat-hunting-template.html` |
| SOC investigation | A detection, alert, or suspected security incident. "Is this malicious?" | `references/soc-investigation.md` | `assets/soc-investigation-template.html` |
| NOC/SRE investigation | Outage, latency, degradation, capacity. Incident report, RCA, postmortem. | `references/noc-sre-investigation.md` | `assets/noc-sre-template.html` |
| Operational health | Health checks, service posture, protocol fleet reviews, critical-device baselines. | `references/operational-health-assessment.md` | `assets/operational-health-template.html` |
| Informational | Freeform: performance review, hygiene/risk ranking, periodic summary. | `references/informational-report.md` | `assets/informational-template.html` |
| PQC TLS readiness | Inventory internal TLS servers and assess post-quantum key exchange adoption. | `references/PQC-Readiness-Report.md` | `assets/pqc-readiness-report-template.html` |

Open the matching reference for that type's structure, vocabulary, and done criteria. When a task spans two (a hunt that turns up a live threat), pick the type that fits the *deliverable*, and borrow sections as needed.

For `extrahop-triage` work, do not create a separate triage report type by default. Use SOC investigation for detection/alert/incident outcomes and threat hunting for proactive sweeps or hypothesis-driven searches. Quick queue triage usually stays in chat as Detection Sets unless the user asks for a report or a material case deserves durable handoff.

## Report, or just answer?

A report is the right output when the user asks for one, or when the work reaches a **material** conclusion — a real threat, a real incident, a significant risk — that deserves a durable, auditable record. Write it then, even if they only asked a question.

When the user just asked a question and the answer is minor or negative ("Any major DHCP issues right now?" → "No"), answer in chat with the supporting detail and **offer** the report: *"Want me to write this up?"* Don't generate one unprompted.

When it's unclear which the user wants, ask.

## Shared discipline (all types)

- **Separate observation from inference.** State what the data shows, then what you conclude. Tag findings `[Observed]` or `[Assessed]`.
- **Every claim is traceable.** Each finding points to an evidence item; each evidence item names its source, the exact query, the UTC collection time, and a result pointer (workspace evidence file, count, or ID) so someone else could re-run it.
- **It resolves.** End in a verdict/outcome/answer with calibrated confidence — even when that answer is *inconclusive* or *not determined*.
- **Show the evidence depth.** Fill the ladder strip under the verdict card: mark the rungs you actually reached (metrics → records → packets) with class `reached`, and — SOC reports only — the detection source. Keep it consistent with `evidence/verdict.json`; see the `evidence-ladder` skill.
- **Don't overclaim.** "Correlates with" is not "caused by."
- **Two readers, one document.** The top (verdict + summary) stands alone for the 30-second reader; reasoning and provenance sit below for the auditor.
- **Name the blind spots.** Every report says what was checked-and-clean, what's unknown, and what the tool itself can't see (e.g. *What ExtraHop can't see*).
- **Keep third-party enrichment distinct.** In threat-hunt and SOC reports, put material web research and vendor/tool findings in the **Third-Party Enrichment** section, separate from ExtraHop observations. Use the `security-research` skill for current external context. Cite the original URL and local `research/` memo for web claims; cite the local source artifact and collection UTC for every other provider. Never present an external claim as an ExtraHop observation. Keep the section only when enrichment materially informs identity, intent, severity, scope, or response; delete it otherwise. One card equals one source finding or lookup.
- **Preserve source semantics.** State what the provider reported, then label any synthesis as investigator assessment. A missing, empty, errored, or not-found response is *unknown* — not benign. Correlate external indicators back to ExtraHop before claiming they were observed in the environment.
- **Brand ReversingLabs entries consistently.** In the threat-hunt and SOC templates, every ReversingLabs item is an `<article class="enrichment" data-source="reversinglabs">` (copied from the inert `<template>` in that section); the template applies the bundled square RL icon to each item's source badge. Use `ReversingLabs reported` and `Investigator assessment` language, preserve the vendor verdict and scope, and cite the matching `reversinglabs/` artifact.

## Output

- **Format:** one HTML file at the **workspace root**, named `report-<short-slug>.html`. Inline all report CSS; no external network assets. Keep the template's app-local Source Sans 3 stylesheet link. Never Markdown.
- **Start from the template.** Copy it byte-for-byte (`cp assets/<type>-template.html <workspace>/report-<slug>.html`), then fill it in. The `<style>` block ships unmodified — never re-type or "optimize" it. Each section is marked with an HTML comment; replace the example content, and duplicate or delete repeating components to fit the case.
- **Theme support is built in.** Templates default to light, support dark previews when a host adds `data-report-theme="dark"` to `<html>`, follow `prefers-color-scheme: dark` in normal browsers unless `data-report-theme="light"` is set, and force light tokens for print/PDF. Do not remove those theme rules.
- **Drive all status color through the data-attributes** documented at the top of each template (`data-sev`, `data-conf`, etc.). Never invent colors.
- **Remove all worked-example content** — the templates' hosts, users, IDs, and domains are invented. None may ship in a real report.
- **Keep the source.** The HTML *is* the source. If asked for a PDF, render it and keep the HTML/CSS; don't delete it without asking.
- **Visuals earn their place.** Include the timeline whenever there's more than one event. Use flows, cards, metrics, and tables where they tell the story faster than prose.
- A chat answer may summarize the report; it never replaces it.

## The out

The template serves the report, not the other way around. If a section doesn't apply, delete it. If a structurally required section has no content, keep it and say why ("No alternatives survived scrutiny"). If a request genuinely doesn't fit any template — a one-number answer, a quick table — don't force one; answer directly. Skipping the template is allowed, but be ready to explain why it was the better call.
