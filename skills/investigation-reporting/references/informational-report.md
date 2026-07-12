# Informational report

For freeform deliverables that aren't incident write-ups: health checks, performance reviews, hygiene/risk rankings, periodic summaries. Examples: *"DNS health check," "database performance last week," "top 10 hygiene risks."* Template: `assets/informational-template.html`.

## How this type differs

It's a **flexible scaffold**, not a fixed structure. The template's sections are a menu — keep the ones that answer the question, delete the rest. A generic report should never carry empty scaffolding. Lead with the answer; let the question shape the body.

## Suggested sections (use what fits)

1. **Title / subtitle** — what this reports on, in one line.
2. **At a glance** — an optional summary strip. Relabel the three cells to fit (e.g. Assessment · Period · Scope).
3. **Summary** — the answer up top, in a few sentences.
4. **Key Numbers** — the headline figures as metric cards.
5. **Observations** — finding blocks, tagged `[Observed]`/`[Assessed]` with evidence refs. Use as many as the report needs.
6. **Detail** — a table for a ranked "top N" list, top talkers, or a breakdown.
7. **Recommendations** — only if the report calls for action; tag urgency.
8. **Scope, Method and Limits** — what was examined, how, the window, and what it doesn't cover.
9. **Data Sources** — the queries behind the figures, so they're reproducible.

## Still defensible

Even a casual report keeps the discipline that makes it trustworthy: figures trace to a source, observation is separated from inference, and the report says what it does *not* cover. Drop the sections you don't need — not the provenance.

## Assessment vocabulary (optional)

When a headline judgment helps: **Healthy** · **Needs Attention** · **At Risk**. Match the `data-sev` accent to it (low/medium/high).

## Done

- The answer is readable from the summary and key numbers alone.
- Every figure traces to a data source.
- The report states its own scope and blind spots.
- Sections that didn't serve the question were removed, not left empty.
