# Design — Phase 1: the evidence-ladder discipline

Phase 1 of the [Warrant harness](DESIGN-warrant-harness.md) proposal: teach the
*current, single agent* to investigate with the evidence-ladder discipline, via
a new skill and **no architectural change**. This doc records how the agent
investigates today, what the ladder changes, and the gaps in moving from one to
the other.

The skill itself is [`skills/evidence-ladder/SKILL.md`](../skills/evidence-ladder/SKILL.md).
Skills are auto-symlinked into every session workspace
(`lib/agent-session.js` → `linkWorkspaceResources`) and discovered by their
`description`, so the skill takes effect the moment it lands in `skills/` — no
change to `server.js`, the backends, or the tool surface.

---

## 1. How the current agent investigates

Pieced together from the system prompt (`lib/agent-session.js` `SYSTEM_PROMPT`)
and the shipped skills:

- **Freeform but methodical.** The system prompt says "state what you're
  checking and why, then check it," quantify findings, and convert timestamps.
  There is no prescribed sequence of evidence tiers.
- **Evidence chosen by question-shape.** The `extrahop-excli` skill's *Evidence
  Choice* section is the closest thing to a ladder today: metrics for
  how-much/how-often, records for exact-transaction, packets for byte-level,
  detections for alert context, entities for IDs. It's framed as *"start broad …
  then narrow"* — good instinct, but it's **guidance, not a rule**: nothing
  says the agent must exhaust metrics before pulling records, or justify a
  packet pull.
- **Memory-first when available.** The `investigation-memory` skill has the
  agent recall priors for the in-scope entities at kickoff and record durable
  conclusions at close.
- **Metrics sub-workflow exists.** `extrahop-excli` prescribes catalog → object
  IDs → `total_by_object` → `timeseries` → records. This is real discipline, but
  only *within* the metrics tier.
- **Workspace hygiene + reports.** `workspace-organization` (raw output under
  `evidence/*`, deliverables at root) and `investigation-reporting` (HTML
  templates for the four report types) govern outputs.
- **Challenger is post-hoc.** The adversarial review runs *after* an
  investigation produces a report, as a separate one-shot, and injects a
  counter-prompt back into the session.

Net: the agent is competent and hygienic, but the *depth decision* is implicit,
the reasoning lives only in the transcript, and the conclusion is prose — there
is no explicit hypothesis, no source-aware trust model, and no structured
verdict.

## 2. What the ladder discipline adds

| Dimension | Current process | Ladder discipline |
|-----------|-----------------|-------------------|
| **Framing** | Detection-centric; entity mentioned in passing | Entity-centric case object (device / peer group) |
| **Depth decision** | Question-shape guidance; any tier reachable at will | Mandatory cheap-first escalation; climb only when the rung below leaves the deciding question open, and justify it |
| **Hypothesis** | Implicit | Explicit hypothesis **+ disconfirming (benign) test stated before deep queries** |
| **Trigger trust** | Detection is context; no source rule | Source-aware: rule / ML / ARD / IDS enter at different rungs; ML and IDS must be corroborated before entering a verdict |
| **Reasoning record** | Transcript + evidence files | Explicit `evidence/ledger.md` decision chain (hypothesis, each climb + why, sources) |
| **Conclusion** | Markdown answer / HTML report | Structured `evidence/verdict.json`: disposition + confidence + highest rung + ATT&CK + evidence chain + residual uncertainty |
| **Confidence** | Not expressed | Expressed, and tied to *evidence completeness* (did we reach the required rung? corroborate the opaque trigger?), degrading gracefully when proof is unavailable |
| **Writes** | Governed by app permissions | Skill reinforces: read/escalate freely, gate write-class actions behind deciding evidence + human confirmation |

The ladder doesn't replace the existing skills; it sits above `extrahop-excli`
(which stays the "how to call tools" reference) and feeds `investigation-memory`
(verdict → durable conclusion) and `investigation-reporting` (verdict → report).

## 3. Gaps moving from the old process to the ladder

Honest list of what does *not* cleanly carry over, and how Phase 1 handles it.

1. **No machine-readable verdict exists today.** The agent answers in Markdown /
   HTML; there is no disposition object. The ladder introduces
   `evidence/verdict.json`. *Handled in-skill* (the schema is defined), but it's
   a new artifact the reporting templates and the eval harness must learn to
   read. → Template slot is a small future tweak; the eval harness (Phase 0)
   consumes `verdict.json` directly.
2. **The ledger is advisory, not enforced.** Like every skill instruction, the
   agent *can* skip writing `evidence/ledger.md`. Nothing in Phase 1 guarantees
   it. Adherence is only *measurable* via the eval harness (ladder-adherence
   score), and only *enforceable* by later phases. → Accept as a soft control in
   Phase 1; measure it in Phase 0.
3. **Detection-source signal is only partially exposed (verified against the
   live API).** There is **no single `source` field** on a detection. **IDS is
   cleanly identifiable** — `categories` includes `sec.ids`, `type` is prefixed
   `ids_`, and `properties.sid` is present (with a SID/provider in the
   description). But **rule vs. ML vs. ARD are not distinguishable by any
   field** — all return as ordinary detection objects; there is no
   `source`/`is_ml`/origin flag, and `risk_score`/`categories` are context only.
   The skill's §4 was rewritten to match: `sec.ids` → IDS; everything else →
   *behavioral, corroborate with records*. → Resolved to a grounded rule; a clean
   4-way classification is simply not possible from the API.
4. **Cost discipline is unenforced.** Nothing stops a packet pull on turn one.
   The skill discourages it; only the eval's *false-climb rate* can detect
   over-escalation. → Deferred to a later phase for any hard guardrail.
5. **Ledger vs. memory overlap.** Two "durable record" concepts now coexist. The
   skill draws the line (ledger = this case; memory = cross-case), but the
   boundary needs to stay clear as both grow. → Documented; revisit if they
   drift.
6. **Reporting templates and the verdict (verified).** Correcting an earlier
   assumption: the four HTML templates *already* carry a confidence meter
   (`data-conf`), an evidence chain (the SOC template's "Evidence Summary" table
   maps each claim → exact `excli-interface` query → evidence file), and residual
   uncertainty (the "Limits and Open Questions" buckets). What they lacked were
   the two ladder-native dimensions: **evidence depth (rung reached)** and
   **detection source**. Both were added as a compact "ladder strip" beneath the
   verdict card — evidence depth on all four templates, detection source on the
   SOC template only (hunts and ops/health reports aren't detection-triggered).
   → Resolved; the templates now mirror `evidence/verdict.json`.
7. **Packet availability breaks the bottom rung.** Tier 3 depends on a
   packetstore feed and retention window; for older activity the bytes may be
   gone. The skill instructs graceful confidence degradation, but this is *new
   behavior* the agent must actually perform. → Instruction-only in Phase 1;
   measured by the eval's handling of proof-unavailable cases.
8. **Challenger stays post-hoc.** The ladder wants the disconfirming test up
   front; the skill has the agent self-state it, but the challenger mechanism
   still runs after the fact. → No wiring change in Phase 1; a later phase could
   move an early challenger check inline.

None of these block Phase 1. Items 3 and 6 are the only concrete follow-ups; the
rest are inherent soft-control limits that Phase 0's measurement exists to
surface.

## 4. Why this is the right first step

- **Zero architectural risk.** A skill file, discovered automatically, backed by
  the tools that already exist. Nothing new can break at runtime.
- **~80% of the harness value.** Laddered depth, hypothesis-first reasoning,
  glass-box ledger, and a structured verdict are the substance of "Warrant"
  without the multi-agent lift.
- **It makes the rest measurable.** The `verdict.json` schema and the ledger are
  exactly what the Phase 0 eval harness scores. Ship the skill, then measure
  whether it helps — see [DESIGN-eval-harness.md](DESIGN-eval-harness.md).
