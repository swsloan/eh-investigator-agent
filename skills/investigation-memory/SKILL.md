---
name: investigation-memory
description: "Persistent cross-investigation memory (Graphiti temporal knowledge graph). Use at the START of every investigation to recall what is already known about the devices, identities, endpoints, and detection types in scope; and at the END to record durable conclusions. Only active when the graphiti MCP tools are available."
---

# investigation-memory

You have a long-term, cross-session memory backed by a temporal knowledge graph
(Graphiti). The tool names depend on which backend you are running on:

- **Claude Code:** `mcp__graphiti__search_memory_facts`,
  `mcp__graphiti__search_nodes`, `mcp__graphiti__add_memory`.
- **Pi:** `memory_search` (recall) and `memory_add` (save).

This memory persists across investigations and analysts. It is a **complement
to**, not a replacement for, live ExtraHop data: RevealX (via `excli-interface`)
is always the source of truth for current state. Memory holds durable
*conclusions* from past work.

If none of these memory tools are present, this skill does not apply — skip it
silently and investigate normally.

## READ at the start of every investigation

Before you start pulling live evidence, query memory for the entities in scope
so you begin with institutional context instead of a blank slate. Search for:

- the **offender / victim devices** (by IP and hostname),
- any **identities / accounts** involved (usernames, service accounts),
- external **endpoints / IPs / domains**,
- the **detection type**.

Use your recall tool (`mcp__graphiti__search_memory_facts` /
`mcp__graphiti__search_nodes` on Claude, or `memory_search` on Pi). Fold what
you learn into your triage, and **say so explicitly** in your findings, e.g.:

- "Memory: `10.0.20.5` was concluded *benign-authorized* (authorized Tenable
  scanner) in 3 prior investigations — treating this recurrence as likely FP
  pending confirmation."
- "Memory: `DC01` is a domain controller in the PCI segment — weighting this
  detection's severity accordingly."
- "Memory: service account `svc_backup` normally authenticates only to
  `10.0.10.4`; this new source host is anomalous."

Prior memory is a **prior, not a verdict** — always confirm against current
evidence. Facts are timestamped; if a stored belief conflicts with what you now
observe, trust current evidence and note the change (it will be recorded).

## WRITE at the close of an investigation

When you reach a conclusion, record it with your save tool
(`mcp__graphiti__add_memory` on Claude, or `memory_add` on Pi) so future
investigations benefit. Write a compact, factual summary (not raw evidence)
capturing:

- the **devices** (IP + hostname) and their **roles/classifications**,
- the **identities** involved and how they behaved,
- the **detection type** and **MITRE technique** if known,
- the **disposition/verdict** (malicious / benign / false-positive /
  benign-authorized) — this is the single most valuable fact to store,
- any durable **analyst preference** the user expressed.

Keep identities/usernames as-is (they are the correlation key). Never write
secrets, credentials, or raw packet/record dumps into memory.

**Record environment entities, not artifacts or metadata.** The entities are
devices, identities, endpoints (incl. the CDN/cloud infra fronting them),
network segments, detections, detection types, dispositions, MITRE techniques,
IOCs (incl. an abused external model/API used for C2), services, and groups.
Do **not** turn these into entities: the investigation's own report filenames
(`report-*.html`), record/protocol type tokens (`flow`, `http`, `ssl_open`,
`~dns`…), detection-category codes (`sec.exfil`, `sec.action`…), or bare
URIs/paths. Mention such things as attributes of a real entity if useful, but
they are not nodes — leaving them as entities pollutes the graph with untyped
noise.

## Scope

Memory is namespaced per monitored environment. Do not assume facts from one
environment apply to another.
