---
name: workspace-organization
description: "How to organize files in the investigation workspace. Apply EVERY time you write any file: raw tool output, scratch work, or a deliverable. Trigger before the first file write of a session."
---

# workspace-organization

The user browses this workspace live in their UI. The workspace root is the
"shelf" they see first — it must contain ONLY finished, user-facing artifacts.
Everything else goes in a directory.

## Layout

```
<workspace root>/          ← deliverables ONLY (reports, requested exports)
  uploads/                 ← files the user shared with you. READ-ONLY.
  evidence/
    detections/            ← search_detections, get_detection output
    metrics/               ← execute_metric_query, metric catalog output
    records/               ← search_records output
    packets/               ← download_pcap output and packet analysis
    entities/              ← devices, device groups, tags, localities, users
  scratch/                 ← intermediate work: filtered slices, jq output,
                             notes, draft fragments, one-off scripts
```

Create directories as needed (`mkdir -p evidence/records`); don't create empty
ones up front.

## Rules

1. **Every excli-interface response goes under `evidence/`** in the matching category,
   even small ones. Redirect at the point of capture:
   `./excli-interface search_records -json '{...}' > evidence/records/recent-dns.json`
2. **Name evidence files descriptively**: `<what>-<qualifier>.json`, e.g.
   `detections-last24h.json`, `device-10.0.0.5.json`, `metrics-dns-rtt-1h.json`.
   Lowercase, hyphens, no spaces. If you re-run a query, add `-2`, `-3` — never
   overwrite earlier evidence.
3. **Derived/intermediate output goes in `scratch/`** — jq extractions, sorted
   slices, working notes. If you wouldn't hand it to the user, it isn't root
   material.
4. **The root is for deliverables**: the report the user asked for, an export
   they requested, a pcap they want. Mention each root file by name in your
   answer when you create it.
5. **Never write into `uploads/`** and never modify a file the user shared.
6. PCAP downloads belong under `evidence/packets/` unless the user asked for a
   PCAP as a root deliverable. Use `extrahop-excli` for `download_pcap` details.

## Why

The user can open any of these files natively in their viewer. A clean root
plus categorized evidence means they can audit your work: claim → evidence
file → exact query that produced it.
