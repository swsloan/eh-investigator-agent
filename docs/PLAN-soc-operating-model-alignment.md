# Implementation plan — alignment to the open-architecture agentic SOC operating model

Closes the gaps found measuring this app against the reference operating model
(Human Oversight / Agents / Models / Harness / Context / Continuous Adversarial
Validation), scoped to the **Agents → Context** band.

Status: plan / not yet built. No dependency on PR #179, though §4 builds on the
skill rules it shipped.

---

## 1. What the measurement found

Layer-by-layer, read from the code rather than the architecture docs:

| Layer | Verdict | Basis |
|---|---|---|
| Agents | Partial *by design* | Occupies the model's BUILD box only. One investigator + subagent delegation. No interop with a BUY-side agent beyond writing RevealX investigations. |
| Models | Aligned | Backend-agnostic (`routes/models.js`, Claude Code + Pi), catalog browsing, per-session pinning, cheaper model for extraction, delegation cost attributed per case (#120). |
| Harness | Aligned, all six boxes | Context Retrieval = skills + `evidence-ladder`. Tools+Orchestration = `excli-interface` / `exmcp` / REST, matching the model's "API \| MCP \| CLI". Memory = Graphiti. Governance + Bounded Action = the governed write path, read-back verification, audit sealing, secret redaction, `<untrusted-telemetry>`. Optimization = ladder + model routing. |
| **Context** | **Gap** | Below. |

Three findings carry work:

**F1 — the context graph has no agent read path.** `lib/topology-store.js`
maintains a real semantic map in a sibling FalkorDB graph (`<group>topology`):
snapshots, node history, identities, tiers, matrices, diffs. But `routes/topology.js`
serves it **to the UI**. No skill outside `network-topology` references it, and no
broker or MCP tool reaches it. The graph is a product surface for humans, not a
context layer for agents.

Consequence: the model's annotation **"pre-computed = token-efficient"** is
unrealized. The investigator re-derives the environment live on every run — in the
audited NeedyMantis case, 124 tool calls and three packet captures over ~20 minutes.
Worse, correctness depends on the agent *choosing the right query*: it pulled
`~dns_request` without `~dns_response` and so never saw the answer, TTL or authority
flags. A standing graph holding "corp.tripswithengine.com → 31.192.237.207,
answered locally, TTL 3600, ≠ public resolution" is a property of the environment
with no query-selection decision to get wrong.

**F2 — federation is thin in practice, not in build.** Endpoint (Falcon) is
genuinely implemented: an MCP sidecar under the `falcon` compose profile, `--read-only`,
bounded tool surface, advertised only when toggle **and** credentials are present.
ReversingLabs likewise has a broker and interface. Neither was provisioned in the
deployment that ran the audited investigation. Identity is *derived from network
observation* (Kerberos/LDAP/NTLM/networkusers), not federated from an IdP. No SIEM.

Consequence: the exercise question "what would Falcon have seen versus the wire"
could only be answered as argument — and that analysis concluded the campaign's best
detection point was the `libcurl.dll` module load ~2 seconds *before* any network
activity. The most valuable moment in the intrusion was structurally out of reach.

**F3 — no BUY-side interop.** Lower priority; see non-goals.

---

## 2. Goals and non-goals

**Goals**
- Give the agent a cheap, read-only path into the context graph, and make
  consulting it the first rung of the evidence ladder.
- Make source availability a *stated capability* the agent knows at turn start,
  not something it discovers from a tool error mid-investigation.
- Prove or refute the token-efficiency claim with the eval harness rather than
  asserting it.

**Non-goals**
- **Do not merge the topology graph into the memory graph.** `lib/topology-store.js`
  documents why they are siblings: thousands of device nodes would swamp
  `overview()` counts, the untyped-drift detector, and the ego-network panel in
  `lib/memory-graph.js`. That separation stands.
- No write path into the context graph from the agent. Reads only, consistent with
  Bounded Action.
- The context graph never becomes authoritative. RevealX stays source of truth for
  current state, exactly as `investigation-memory` already rules for memory.
- IdP federation and SIEM ingest are out of scope for this plan. Named in §6.
- No BUY-side agent interop (F3). Revisit when a second agent actually exists.

---

## 3. Phase 1 — `topology-interface`: the context rung

The highest-leverage, smallest build. It wires an asset that already exists and is
already maintained to the consumer that needs it most.

### 3.1 The broker

Mirror the established pattern exactly: a thin Node client over a unix socket,
inert when the socket is absent from the session env.

- `topology-interface` at the repo root, modeled on `excli-interface`
  (`EH_TOPOLOGY_BROKER_SOCKET`).
- Symlinked in `AgentSession.linkWorkspaceResources()` alongside the others.
- Server side next to the existing brokers; read-only by construction — it imports
  only the `read*` / `list*` exports of `lib/topology-store.js`, never `write*`
  or `deleteSnapshot`.

### 3.2 Verbs → existing store reads

No new query code. Every verb is a thin shell over a function that already ships:

| Verb | Store function | Answers |
|---|---|---|
| `lookup <ip\|key>` | `readNode` | What is this device, what role, what does it talk to |
| `identities` | `readIdentities` | Which accounts are bound to which hosts |
| `neighbors <key>` | `readTier` / `readMixedTier` | Scoped ego network |
| `history <key>` | `readNodeHistory` | How this node changed across snapshots |
| `pairs <a> <b>` | `readMatrixPairs` | Whether these two ever talk, and on what |
| `segments` | `readSegmentNames` | Zone/segment naming |
| `enrichments <key>` | `readEnrichments` | Prior analyst annotations |
| `snapshots` | `listSnapshots` / `latestSnapshotId` | What is available and how old |

### 3.3 Skill wiring — a rung below metrics

This is the conceptual payoff. The ladder is currently metrics → records → packets,
"cheap breadth first." The context graph is **cheaper than metrics** and already
computed, so it belongs at rung zero.

- `evidence-ladder` §1 ("Frame the case") gains: consult the context graph for the
  entities in scope *before* the first live query, the same way
  `investigation-memory` is consulted for priors.
- The two are complementary and must be described as such: memory holds durable
  *conclusions from past investigations*; the context graph holds the *current
  shape of the environment*. Neither is evidence on its own.
- New `context-graph` skill carrying the verbs, the staleness contract, and the
  explicit rule that a graph answer is a **lead, not a citation** — anything that
  reaches `evidence_chain` still needs a live query behind it.

### 3.4 The staleness contract

A stale context graph the agent trusts is worse than no context graph. Non-optional:

- Every response carries `snapshot_id` and `snapshot_age_hours`.
- The skill states a hard rule: above a configured age, treat graph output as a
  hint for *where to look* and never as a statement about current state.
- Reports cite the live query, never the graph.

### 3.5 Done when

The agent opens an investigation by resolving its entities against the graph; a
report's evidence chain still contains only live queries; and `topology-interface`
has no reachable write path (asserted in a test).

---

## 4. Phase 2 — keep the graph fresh

The graph is produced today by an agent run of the `network-topology` skill, then
ingested (`POST /api/topology/ingest/:sessionId`). That is on-demand, which is fine
for a visualization and not fine for a context layer.

- Scheduled refresh on a configurable interval, reusing the existing re-ingest route.
- Surface last-refresh prominently in the UI, so a human sees staleness too.
- Decide and document the retention/compaction policy for snapshots — `readNodeHistory`
  gets more useful with depth, and the graph gets more expensive.

---

## 5. Phase 3 — capability inventory

`falconMcpServers()` in `server.js` already states the principle this phase
generalizes: *"an agent that reads 'endpoint telemetry unavailable' from a tool
error is one step from reporting it as a finding about the estate."* Absent
credentials, the capability is simply not present.

The gap is that absence is currently **silent**. The agent learns what it lacks by
reaching for it.

- Inject a short, structured **sources-available** statement into the session
  preamble: which of network / endpoint / threat-intel / web / context-graph are
  live, and which are not provisioned.
- Pair it with the rule shipped in #179 — a missing source blocks a *data pull*,
  not an analytic question. Knowing up front is what makes that rule usable: the
  agent can plan the analytic answer instead of discovering the gap at the point of
  needing it.
- Reports render the inventory in *What ExtraHop can't see*, as a configuration
  fact rather than a discovery.
- Provisioning Falcon and ReversingLabs in the lab deployment is a deployment task,
  not a build task, and should be tracked separately. The audited investigation
  would have answered a different and better question with endpoint telemetry present.

---

## 6. Deferred, with reasons

- **IdP federation for Identity.** Today identity is inferred from the wire. Real
  federation (Entra/AD as a source) is a larger build with its own auth and privacy
  surface. The model shows IDENTITY as a first-class federated source; this app
  derives it. Worth a design doc, not a phase here.
- **SIEM.** The model's `+ SIEM` box. No current demand; revisit if a customer
  context requires correlation the wire and endpoint cannot carry.
- **BUY-side interop (F3).** Nothing to integrate with yet.

---

## 7. Phase 4 — measure it, carefully

The entire justification for pre-computed context is token efficiency. Assert
nothing; score it.

- Add `context_graph_reads` per case to the eval result shape, alongside the
  existing cost/token/delegation fields.
- Compare tokens-per-case and cache-reads-per-case with the context rung on and off.

**Design constraint, learned the hard way:** #120 refuted a delegation cost claim
after measuring it, and established an eval noise floor around 19%. A token saving
smaller than that is not detectable with the current case count. Either design a
paired comparison on identical cases, or expect to need more cases — do not report
a single-run delta as a result. This is precisely the trap the premise-injection
work in #179 was written to catch in investigations; it applies to our own claims.

---

## 8. Risks

| Risk | Mitigation |
|---|---|
| Stale graph treated as current state | §3.4 staleness contract; graph is never a citation |
| Context graph becomes a second source of truth | Skill rule: leads only; `evidence_chain` requires live queries |
| Topology nodes swamp the memory graph | Keep the graphs siblings (§2 non-goal); import only `read*` |
| Agent stops verifying because the graph "already said" | Covered by the existing ladder discipline and the premise rules in #179; worth a dedicated eval case |
| Token-efficiency win is smaller than eval noise | §7 — paired design, or do not claim it |

---

## 9. Sequencing

Phase 1 first and alone — it is the smallest change with the largest alignment
gain, and it is reversible (an unused broker is inert). Phase 3 is nearly free and
can land in parallel; it is mostly prompt plumbing over a principle the code already
holds. Phase 2 only matters once Phase 1 is in use. Phase 4 last, and only with a
design that clears the noise floor.
