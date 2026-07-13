# Implementation plan — Memory-viz visual hierarchy (P0/P1/P2)

Source: `Graphiti_Memory_Visualization_Recommendations.docx` (UI-team design guidance),
reviewed against the shipped renderer. This plan turns that doc's P0/P1/P2 bands into
concrete, sequenced work items with file seams, code sketches, and acceptance checks.

**Two deviations from the doc's banding (agreed in review):**
- **Semantic lanes** (doc §3.2, doc-ranked P2) → promoted into **P0**. Swapping the
  placement function is ~15 lines and is the single biggest "tells a story" gain per unit
  effort. Radial scatter is the main reason the graph doesn't read.
- **"Changed/contradicted this run"** (doc §3.1, listed as one of three co-equal states) →
  elevated to the *headline* state. It's the signal that answers the doc's own primary goal
  ("why that changes the analyst's decision"). Known/new is table stakes; **changed** is the money.
- **Inspector "Why this matters"** (doc §3.5, listed as a UI task) → re-scoped: it has a
  **backend dependency** (fields we don't currently compute) and is planned as such.

Renderer constraint (unchanged): dependency-free SVG, bounded < ~40 nodes. No sigma.js.

---

## Current-state seams (where each change lands)

| Concern | File / lines | Today |
|---|---|---|
| Type→color map (13) | `public/js/memory.js:28-36` `TYPE_COLOR` / `colorFor` | 13 similar hues |
| Ontology list | `public/js/memory.js:22` `ONTOLOGY` | 13 types |
| Graph render | `public/js/memory.js:284-347` `renderGraph` | radial |
| **Placement loop** | `public/js/memory.js:306-309` | `angle = i/peers.length·2π` |
| Node build | `public/js/memory.js:355-390` `nodeEl` | flat `<g>` (position+visual mixed) |
| known/new class | `public/js/memory.js:370-371` | only `.new` |
| Inspector | `public/js/memory.js:399-432` `renderFocusInspector` | facts-first, curation inline |
| Node/edge CSS | `public/styles.css:2237-2274` | `.mem-node-shape.new` = opacity .5 + dash |
| Backend neighbors | `lib/memory-graph.js` `neighbors()` | returns nodes/edges/episodes |
| API | `routes/memory-graph.js` `GET /neighbors` | passthrough |

Verify no regression against the isolated `eh-eval` stack (port 3101) only; never touch prod
(`eh-investigator`, 3100). Visual QA is still blocked on the Chrome bridge — every item below
lists a **computed-value / DOM assertion** that can be checked without pixels, plus the pixel
check to run once the bridge is back.

---

# P0 — Readability foundation (highest info value, low/moderate effort)

### P0.1 — known / new / **changed** encoding + in-canvas legend
**Goal:** within 2 s a first-time user sees what was known, what this run discovered, and
what this run *changed*. (doc §3.1, Acceptance #1)

**Data model.** Node already carries `known: true|false|null` (`memory.js` resolve, ~L561-579).
Add a third: `changed: true` for a *known* entity whose disposition/summary flipped this run.
- Honest MVP scoping — `changed` is only trustworthy at investigation **close** (memory is
  written on close; mid-run we lack the prior/after diff). So:
  - **Now:** wire the 3-state *encoding + legend* + the `changed` plumbing.
  - **Source of `changed`:** the forensic pass that already reads `verdict.json` on completion
    (the same path that swaps discovery→forensic timeline). Compare each known entity's prior
    memory summary/disposition to the run's verdict; set `changed` when they differ. If the diff
    is unavailable, node stays `known` (never fabricate a change).

**CSS** (`public/styles.css`, replace L2274 `.mem-node-shape.new`):
```css
/* prior memory: quiet backdrop */
.mem-node.known  .mem-node-visual { opacity: 0.6; }
/* discovered this run: full saturation + halo */
.mem-node.isnew  .mem-node-shape { filter: drop-shadow(0 0 4px var(--cyan)); }
/* changed/contradicted this run: amber ring (state, not color-only — also gets a ! badge) */
.mem-node.changed .mem-node-shape { stroke: var(--amber); stroke-width: 3.5; }
```
Drop the dashed/opacity-only `.new` treatment (too subtle per the doc).

**Legend** — persistent HTML overlay inside `.mem-canvas` (position:absolute, bottom-left),
three rows: ● Known previously / ● New this run / ◐ Changed this run. HTML (not SVG) so it
survives `svg.innerHTML=''` reflows.

**Acceptance:** (a) DOM: nodes carry exactly one of `.known/.isnew/.changed`; a run with a
flipped disposition yields ≥1 `.changed`. (b) Legend present and non-empty. (c) getComputedStyle
opacity on `.known` ≈ 0.6, on `.isnew` = 1. **Pixel:** amber ring visibly dominates.
**Effort:** S (CSS + class wiring) + M (the `changed` diff in the forensic pass).

### P0.2 — selected-neighborhood spotlight + edge inspection
**Goal:** selecting a node isolates its one-hop neighborhood; edge facts are readable without
hover-only tooltips. (doc §3.4, Acceptance #2)

**Spotlight.** On node select, add `.mem-dim` to every node/edge not in {selected ∪ adjacent ∪
connecting edges}. Build an adjacency set from `data.edges` once in `renderGraph`. Selection is
already single-click (`nodeEl` handler, L381). Add:
```css
.mem-svg.has-selection .mem-dim { opacity: 0.15; transition: opacity .16s; }
```
Recentering stays an **explicit** action (don't auto-recenter on inspect) — preserves spatial
memory. Keep the existing `focusEntity` call behind a distinct control/dblclick, not single-click.

**Edge inspection.** Edges currently only have a `<title>` (L322). Add `pointer-events` + click →
pinned callout in the inspector showing the full relationship fact (`e.rel` + `e.fact`),
not a transient tooltip.

**Acceptance:** DOM: after selecting a node, `.mem-svg.has-selection` present and non-adjacent
nodes carry `.mem-dim`; adjacent do not. Edge click populates a `#mem-edge-callout` with the fact
string. **Effort:** M.

### P0.3 — semantic lanes (promoted from doc P2 §3.2)
**Goal:** replace radial scatter with a layout that reads as a security story.

Replace the placement loop (`memory.js:306-309`) with lane assignment by **macro-category**:
```
left   : Identity, Analyst, Group            (originators / access)
center : focus entity                         (already cx,cy)
right  : Detection, IOC, MitreTechnique, Service, Endpoint, DetectionType  (threat)
bottom : Episode / Investigation              (prior episodes)
top    : Disposition                          (conclusions)
```
Map type→macro via a small `MACRO = {Identity:'left', ...}` table; nodes without a mapping fall to
right/neutral. Within a lane, distribute along the cross-axis (`y` for L/R lanes, `x` for T/B) evenly,
collision-nudge if two share a slot. Keep edges/nodes/episodes otherwise identical — this is purely
the `pos` Map. For investigation mode, bias lanes toward a **left→right time axis** (originator →
focus → threat) as a natural next step (still SVG).

**Acceptance:** DOM/geometry: all Identity nodes have `x < cx`, all Detection/IOC have `x > cx`,
episodes `y > cy`. No node overlaps another by > shape radius. **Effort:** S–M.

---

# P1 — Meaningful motion + decision framing (polish, semantic)

### P1.1 — node-entry + edge-draw animation (nested position/visual groups)
**Goal:** discovery arrives with brief emphasis; recentering an existing graph does **not** replay
the bloom. (doc §4.2, §4.6)

**Refactor `nodeEl` (L355)** to emit two nested groups so layout transform ≠ visual transform:
```
<g class="mem-node-position" transform="translate(x,y)">
  <g class="mem-node-visual"> shape + glyph + label </g>
</g>
```
Only nodes newly added since the last render get `.entering` (diff by uuid against a
`prevUuids` Set held in module scope). Edge draw-on: set `--edge-length` via `getTotalLength()`
substitute (line length = hypot) and run the one-time `mem-edge-draw`.
**Caveat:** episode nodes are `rotate(45)` rects (`memory.js:363`) — `transform-box: fill-box`
scale must be tested against that rotate or the diamond wobbles. Test explicitly.

CSS: the doc's §4.2/§4.6 keyframes verbatim + `prefers-reduced-motion` guard.

**Acceptance:** DOM: on re-render with unchanged node set, zero `.entering`; on a new node, exactly
that node gets `.entering`. Reduced-motion: animation-name computes to `none`. **Effort:** M.

### P1.2 — static focus halo + live-only edge animation
**Goal:** stable selection halo; motion only on edges being created/resolved *now*, then stops.
(doc §4.1, §4.4, §4.5)

- Focus node: static cyan halo (extend existing `.mem-node.focus` L2246), pulse **only** when
  `.active` (just updated), capped `2` iterations — never infinite.
- Edges: `.mem-edge.live` marching-ants for ~a few s after creation, then class removed by timer;
  `.mem-edge.mentions`/`.expired` stay **static** (fix: today `.mentions` is dashed but not moving —
  keep it static, good). Gradients only on `.live`/selected edges, never default.
- All motion under `prefers-reduced-motion` guard.

**Acceptance:** DOM: `.mem-edge.live` count → 0 within N ms of creation (timer clears it); focus
pulse `animation-iteration-count` = 2, not infinite. **Effort:** S–M.

### P1.3 — inspector "Why this matters" (BACKEND-FIRST)
**Goal:** inspector leads with why the memory matters, not raw facts + curation. (doc §3.5, Acc. #5)

**This is not a CSS task — the fields don't exist yet.** Two parts:

1. **Backend** (`lib/memory-graph.js` `neighbors()`, surfaced via `routes/memory-graph.js`):
   compute and return, per focus entity —
   - `last_observed` (max episode/edge timestamp),
   - `prior_investigations` (episode count — already have `episodes.length`),
   - `highest_risk_rel` (pick the edge whose target type ∈ {IOC, MitreTechnique, Detection} or
     rel matches a risk lexicon),
   - `corroboration` (count of distinct episodes mentioning this entity),
   - `changed_since_prior` (ties to P0.1's diff).
   Add unit coverage in the `lib/*.test.js` style already used.

2. **UI** (`renderFocusInspector`, L399): reorder to
   **Summary (why it matters) → Relationships → History → Data quality**, and move retype/merge/
   delete (L418-431) out of the primary reading flow into the last "Data quality" section
   (already a `<details>` — keep collapsed, place last). Lead paragraph composed from the backend
   fields.

**Acceptance:** API returns the 5 fields for a known entity; inspector's first block is the
"why" summary, curation controls are last. **Effort:** M (backend) + S (UI reorder).

---

# P2 — Scale + polish (reduce color reliance, discovery, robustness)

### P2.1 — type badges (in place of full glyph set) + color-blind fallback
**Goal:** stop requiring users to memorize 13 colors; satisfy "not color alone" (doc §3.3, §5, Acc. #4).

Rather than hand-authoring 5 crisp macro-glyphs (lowest info-value P2, real effort at 18px), add a
short **type badge** inside each node (`D`, `ID`, `IOC`, `ATT&CK`, `SVC`, `EP`…) as an SVG `<text>`
in the `.mem-node-visual` group. Doubles as the color-blind fallback §5 requires. Keep ontology
color as secondary encoding. (Full glyph system remains a "later" if badges prove insufficient.)

**Acceptance:** every node renders a legible badge ≥ the §5 label-size floor; graph is
distinguishable in greyscale (badge + shape carry type). **Effort:** S.

### P2.2 — overview dashboard + compact right-rail summary
**Goal:** full graph is a drill-down; overview/right-rail summarize operational significance.
(doc §3.6)

- **Overview** (`renderOverview`, currently counts + type legend, `memory.js` ~L685 region & CSS
  L2227): add "recently learned entities", "most-investigated assets", "unclassified count",
  "recent investigations", "memory freshness". Most are cheap aggregates over the `overview()`
  backend result; add any missing counts there.
- **Right rail** (docked panel): "memory matches / new entities / prior investigations / top
  relevant memories / **Open investigation map**" action. Reuse the existing docked tab.

**Acceptance:** overview shows the 5 summary blocks from real backend data; right rail has an
"Open investigation map" affordance. **Effort:** M.

### P2.3 — density cap + empty / cold-start states (NOT in the doc — added in review)
**Goal:** the bounded-SVG assumption (< ~40 nodes) must degrade gracefully; browse view already
hits 111 entities. And the most common early state (empty memory) needs a first-class design.

- **Density cap:** in `renderGraph`, if `peers.length > CAP` (e.g. 40), keep top-N by relevance
  (known first, then most-connected / most-recent) and render a **"+N more"** affordance
  (opens a list / raises CAP). **Never silently truncate** — `log`/label the drop, mirroring the
  "no silent caps" rule used elsewhere in this project.
- **Empty state:** first-ever investigation = zero prior nodes. `.mem-empty` exists (CSS L2221) —
  give it real copy: "No prior memory yet — this investigation will be the first episode written
  on close." Distinguish *empty memory* from *empty selection*.

**Acceptance:** a 100+ entity group renders ≤ CAP nodes + a visible "+N more"; empty memory shows
the cold-start message, not a blank canvas. **Effort:** M.

---

## Sequencing & dependencies
```
P0.1 (state+legend) ─┬─> P1.3 (inspector "changed_since_prior" reuses P0.1 diff)
P0.2 (spotlight)      │
P0.3 (lanes) ────────>┘   P1.1 (entry anim) depends on P0.3 (position/visual split lands cleanly)
                          P1.2 (motion) independent
P2.* independent; P2.1 pairs naturally with P0.1 legend work
```
Ship P0 as one deployable increment (biggest readability jump), then P1, then P2. Each increment:
build → deploy to **eh-eval (3101)** → DOM/computed-value assertions → (pixel QA when Chrome bridge
returns) → fold into the next version bump. Prod (3100) untouched until an increment is signed off.

## Acceptance criteria roll-up (from doc §7, mapped)
1. 2-second known/new/changed read → **P0.1**
2. selection isolates one-hop + full edge facts → **P0.2**
3. motion stops after a transition; history static → **P1.1 / P1.2**
4. understandable without color → **P0.1 legend + P2.1 badges**
5. inspector leads with "why this matters" → **P1.3**
6. smooth at bounded size, both themes → **P2.3 cap + theme check every increment**
7. reduced-motion preserves info → **P1.1 / P1.2 guards**
