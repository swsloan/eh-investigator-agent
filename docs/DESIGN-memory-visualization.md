# Design — Memory graph visualization

A UX + implementation plan for letting an analyst **see and navigate** the
entities and relationships in the app's long-term memory (the Graphiti temporal
knowledge graph, backed by FalkorDB). Companion to
[DESIGN-graphiti-memory.md](DESIGN-graphiti-memory.md) (how memory is written);
this covers how a human reads it.

> **Revised (this version supersedes an earlier "browse-the-whole-graph-first"
> draft).** After inspecting the live graph and a design discussion, the plan is
> now **contextual-recall-first**, **real-time**, **timeline-aware**, built on
> **sigma.js + graphology**, and staged so v1 is small. The rationale and
> decisions are recorded below.

---

## 1. Why — primary job: situational awareness

The memory is a black box today; the agent reads/writes it but a human can't see
it. The goal is **situational awareness**: let an analyst see what's already
known about the entities in play, and watch what's being learned during an
investigation. Driving questions:

- *"What do we already know about `DC01` / this detection type / the PCI segment?"*
- *"What other investigations has this device been involved in?"*
- *"As this investigation runs, what's being discovered — and how does it sit
  against what we knew?"*

## 2. Decisions (from the design discussion)

- **Primary model = contextual recall (option B), not a standalone browser.**
  Memory surfaced *at the moment of an investigation* changes decisions; an
  idle graph browser is secondary. The standalone explorer (option A) is planned
  for later.
- **Real-time.** Show the investigation graph updating live so the analyst
  watches the agent's progress against the backdrop of prior knowledge.
- **Entity + episode.** Show past investigations (episodes) as nodes, so the
  analyst sees what else an entity has been involved in (provenance).
- **Timeline layout.** Lay the graph on a time axis so event progression is
  legible.
- **Renderer: sigma.js + graphology**, chosen as the *single* renderer because
  scale (large graphs) and real-time growth are stated priorities. graphology is
  the renderer-agnostic data model.
- **Plan for scale** — server-side neighborhood queries; never ship the whole
  graph to the browser.
- **Memory quality must be fixed** — a separate workstream (extraction
  classification + dedup), which the viz will surface.

## 3. Grounding — the graph is real and small (today)

Inspected on the live stack: three namespaces (`pocextrahop` — real, `pocqwen` —
local-LLM POC, `extrahop` — empty). `pocextrahop` holds ~77 entity nodes across
~12 ontology types (Device, Identity, Detection, Endpoint, MitreTechnique,
Service, IOC, NetworkSegment, Disposition, Analyst, DetectionType, …), **85
entity↔entity facts** (`RELATES_TO`) and **88 `MENTIONS`** edges from **5
episodes**. Facts are rich and human-readable (offender/victim, member-of,
classified-as, disposition, and even analyst preferences). Two quality issues are
already visible: **12 untyped `[Entity]` nodes** (extraction didn't classify
them) and likely name duplicates (`DC01` vs `10.0.10.4 (DC01)`).

Implication: at this size the *contextual ego-network is trivially legible*, and
the whole-graph explorer is premature — validating the contextual-first staging.

## 4. Contextual recall — the v1 surface

A **"What do we know?"** ego-network panel keyed to the entities in scope:

- Reachable **from an investigation** (a button / auto-panel on the session)
  and **standalone** (pick an entity via search).
- Renders the focus entity + its neighbors + the facts between them (like the
  worked render of the Lateral Movement case), color-coded by ontology type.
- Click a node → inspector: its summary, its facts (with the other entity), the
  **episodes** that mention it, and **"Start investigation about this."**
- Bounded by construction (a neighborhood, not the whole graph), so it's safe at
  any total scale.

## 5. Real-time investigation graph — and the key subtlety

**Graphiti memory is written at investigation *close*, not continuously** — so
during a run the memory graph is static. A real-time view therefore merges **two
sources**, visually distinguished:

1. **Memory priors (static backdrop).** Query Graphiti once at kickoff for the
   in-scope entities → "what we already knew" (one visual style, e.g. muted).
2. **Live investigation (updates in real-time).** Build nodes/edges from the
   agent's unfolding activity — detection participants, devices/identities/
   endpoints it queries, evidence files as they're written — streamed over the
   existing SSE channel. Rendered as "discovered this run" (highlighted/new).

As the agent works, discovered nodes appear (sigma + continuous ForceAtlas2
animates them in), sitting against the memory backdrop. This is the distinctive
"watch the investigation unfold, in context" feature. Note the live source is the
**evidence/event stream**, not Graphiti; memory is the overlay.

## 6. Entity + episode model

Graphiti stores investigations as `Episodic` nodes linked to entities by
`MENTIONS`. The viz shows episodes as a distinct node type, so:

- focusing an entity reveals the episodes that touched it, and from an episode,
  the other entities it involved (multi-hop provenance);
- episodes carry timestamps → they anchor the timeline (§7).

## 7. Timeline layout

Episodes have timestamps and `RELATES_TO` facts carry `valid_at`/`invalid_at`,
so time-as-x is straightforward: with sigma we control node coordinates directly,
so `node.x = scale(timestamp)` and `node.y = lane/cluster`, ForceAtlas2 disabled
on x (or a constrained layout). This yields:

- **event progression** along the axis (great for the real-time view — new
  findings stream in temporally),
- a later **scrubber/animation** to replay how knowledge evolved (uses the
  bi-temporal validity to show "as of" any time; expired facts dashed).

## 8. Data access

- **Read-only FalkorDB Cypher**, exposed via a new `routes/memory-graph.js`
  (loopback, no-auth like the rest). Proven: this design's renders were pulled
  with `GRAPH.QUERY` against FalkorDB directly.
- **Neighborhood queries only** — `GET /api/memory/graph/node/:id/neighbors`,
  `.../search`, `.../overview` (counts). **Never** ship the whole graph;
  everything is a bounded neighborhood or an aggregate. This is what keeps it
  safe at large scale (§10).
- Namespaced by `group_id` (the environment selector) — 3 namespaces exist today.
- Dependency: a `falkordb`/redis client on the server.

> **v1 implementation note (built 2026-07-10).** v1 ships with a **small,
> dependency-free SVG renderer** for the bounded ego-network, not sigma.js. The
> ego-network is tiny (< ~40 nodes), so SVG is crisp, themeable straight from the
> app's CSS variables, and gets click/hover/inspector for free — with zero
> bundle/WebGL risk and no new npm dependency. **sigma.js + graphology enters at
> v2**, which is where scale and real-time growth (continuous ForceAtlas2)
> actually need WebGL. The server contract below is renderer-agnostic by design,
> so that swap touches only the client render layer. The rest of §9 describes the
> v2 target.

## 9. Rendering — sigma.js + graphology (v2 target)

- **graphology** — in-memory graph model (nodes/edges + attributes), supports
  incremental mutation (add nodes/edges live) and is renderer-agnostic.
- **sigma.js (WebGL)** — the sole renderer. Scales to tens of thousands of nodes
  (option A), and continuous **ForceAtlas2** (`graphology-layout-forceatlas2`,
  web worker) animates real-time growth.
- **Honest trade-offs vs a higher-level lib:** interactions (click/hover,
  tooltips, inspector, highlight-neighbors) are built on sigma's event API, not
  free; node **shapes/icons** need sigma node programs (e.g. node-image for the
  per-type glyphs). Budget for that interaction/rendering code.
- Vendored like the app's other browser libs (both are on the allowed CDNs).

## 10. Scale plan

- Server-side neighborhoods + aggregates only; pagination/expansion on demand.
- The contextual ego-network is inherently bounded, so it's unaffected by total
  graph size — which is why it's the safe first build.
- The standalone explorer (option A) uses the same server contract + sigma WebGL;
  add level-of-detail (hide labels/edges when zoomed out) as needed.

## 11. Memory-quality workstream (separate from the viz)

The viz *surfaces* quality problems; fixing them is memory-layer work:

1. **Audit** the 12 untyped `[Entity]` nodes — what are they, why did extraction
   miss the subtype?
2. **Tighten the ontology/extraction** in `graphiti/config.yaml` (crisper
   `entity_types` descriptions + naming/normalization guidance).
3. **Extraction model** — a weaker local model (qwen) classifies worse than
   Claude; the extraction LLM choice matters here.
4. **Dedup / reconciliation**, then eventually **curation** (merge duplicates,
   invalidate bad facts) — a write-to-memory capability that pairs with option A.

## 12. Visual encoding

- **Node color = ontology type** (13-type palette), **shape/icon reinforces
  category** (via sigma node programs), **size = degree**.
- **Known-vs-discovered** — memory priors muted, live-discovered highlighted
  (the real-time signal).
- **Edges** — labeled by relationship type; **dashed = expired/invalidated**
  fact (temporal validity); thickness = corroboration (episode count).
- **Episodes** — a distinct node style; anchor the timeline.

## 13. Phasing

| Phase | Scope | Renderer |
|-------|-------|----------|
| **v1 — contextual recall** ✅ built | "What do we know?" ego-network from memory priors, standalone (header button + entity search); click-to-recenter; node inspector (summary/facts/episodes); namespace selector; untyped-drift badge; read-only `GRAPH.RO_QUERY` neighborhood API | **SVG (dependency-free)** |
| **v2 — real-time investigation view** ✅ core built | *This-investigation* mode: entities the current run touches, derived live from the tool-call stream (`tool_execution_*` args/results → IPs/hostnames), each resolved against memory as **known** (canonical type/name + click-to-open its ego-network = entity+episode drill-down) or **new this run** (dashed). Updates live; mode toggle vs Browse. **Still deferred to a later v2/future pass:** the time-axis (timeline) layout, a single merged two-source canvas with memory-backdrop edges, and the sigma/WebGL renderer (SVG still suffices at this scale). | SVG (dependency-free) |
| **future — option A explorer at scale** | browse-everything, level-of-detail, + **curation** to fix memory quality | sigma WebGL |
| **parallel — extraction quality** | ontology/prompt/model tuning + dedup (§11) | — |

Each stage is independently useful and earns the next; v1 is bounded and small.

## 14. Open items

1. **Live-extraction fidelity** — how richly to derive entities from the live
   evidence stream (structured tool output vs evidence files vs a lightweight
   inline extractor). Start from evidence artifacts + detection participants.
2. **Episode density** — with many investigations, episode nodes could dominate;
   may need to collapse/aggregate them.
3. **Curation safety** — writing to memory from the UI (merge/invalidate) is
   higher-risk; humans adjudicate, never auto-change from a run.
4. **Sequencing vs the eval work** — this is a separate track from the
   analyst/eval loop; prioritize accordingly.
