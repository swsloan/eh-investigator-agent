# Implementation Plan — Investigator UI Redesign (Map + Live Agent Activity)

**Target:** `eh-investigator-agent` (`main`, currently at b73f524) · vanilla-JS SPA under `public/`, no bundler, strict CSP
**Sources:** design handoff bundle (`design_handoff_investigator_redesign/` — README, 3 mockups, UX Review) + a full code audit of the current frontend/backend (file:line references below are verified against the working tree as of 2026-08-05).
**Status:** v2 — reviewed and signed off 2026-08-05; all four open decisions resolved (see "Resolved decisions") and five review adjustments folded in.

---

## Executive summary

Eight phases, ~24 PRs. The design's own priority order is preserved: two "days"-sized quick-win phases first, then the three medium rebuilds, then consolidation. A small Phase 0 lands the shared design tokens so every later PR speaks one visual language.

```
Phase 0 (tokens/foundations)
   ├─→ Phase 1 (map quick wins)      ─┐
   └─→ Phase 2 (chat transparency)   ─┤   (1 & 2 are independent; can run in parallel)
                                      │
Phase 3 (zone topology)  ←────────────┘
   └─→ Phase 4 (incident overlay)
          └─→ Phase 5 (matrix + changes views)
Phase 6 (live agent activity)   — independent of 3–5; depends only on 0 + 2's refactor seam
Phase 7 (type scale, settings IA, right-panel rules) — anytime after 0; best last
```

**Total effort:** roughly 7–9 weeks of focused solo work, consistent with the designer's estimates.

**The three findings that change the plan vs. the handoff README** (details in "Design-doc corrections"):

1. **The activity-view composer cannot "post into the running session" today.** The server returns 409 while a turn runs (`routes/sessions.js:165-167`) and the client blocks sending (`composer.js:32`). Real backend work (a mid-turn message queue) is required — the README's "no new backend state" claim is wrong here.
2. **Animated dashed attack paths and zone rects can't be drawn by stock Sigma.** Sigma renders WebGL/canvas nodes+edges only; there is no SVG layer today. The plan introduces a camera-synced SVG overlay/underlay pair — which conveniently also delivers zones, step badges, halos, and the mini-map.
3. **The inspector's 7-day sparkline + BYTES 7D tile need a small new endpoint.** Per-device byte history isn't served; it can be computed from the ~12 retained snapshots without new collection.

---

## Phase 0 — Foundations (tokens, motion, assets)

**Goal:** merge the mockups' `--m-*`/`--a-*` palettes into the existing semantic token system so later phases don't hardcode colors; establish the motion policy.

**Ground truth:** the app's token system is color-only and disciplined — 55 tokens at `styles.css:8-104`, dark swap at `:106-173` — but has **no type/spacing/radius tokens** (`--radius: 12px` is the only geometry token). Magenta `#EC0889` appears exactly once, hardcoded (`styles.css:2436`, threat-hunt plan accent). The dark brand gradient is a one-off literal at `styles.css:494-497`. CSP (`lib/security-headers.js`) allows `style-src 'unsafe-inline'` — inline styles and CSS `@keyframes` are unrestricted; inline `<script>` is blocked (all JS must be served files, as today).

### PR 0.1 — Token merge (~1 day)
- `public/styles.css`: add the incident/accent tokens the mockups introduce, both themes:
  - `--magenta: #EC0889` (theme-invariant, like `--cyan`) + `--magenta-text/-border/-tint` (dark `#ff7ec4`/`#5a2444`/`rgba(236,8,137,.10)`, light `#b8106b`/`#efb2d5`/`rgba(236,8,137,.07)`)
  - cyan tint/border pair, red/amber tint-border-text sets, `--green-text` pair, float/frosted surfaces (`--float`), zone stroke colors, skeleton ramp (3 steps + gradient), matrix `--cell0`
  - Reconcile the 3 conflicting pairs between the two mockup namespaces (`--a-card` `#12141c` vs `--m-card` `#14161f`; `--a-cyan-tint` .05 vs `--m-cyan-tint` .08 — keep both as `--cyan-tint`/`--cyan-tint-2`).
- Re-point the one existing magenta literal (`styles.css:2436`) at the new token.
- Fix the dark-gradient one-off: promote `[data-theme="dark"]` gradient override (`:494-497`) into a `--gradient` dark swap so all 10 gradient consumers get it.
- Add type-scale tokens (`--fs-9/10/11/12/13/15/18/22/34` or similar 7-step scale) — **declared only**, adopted incrementally (mass-replacing 286 font-size declarations in one PR is unreviewable; see Phase 7).

### PR 0.2 — Motion policy (~½ day)
- Current `prefers-reduced-motion` handling is an allowlist covering only the memory graph (`styles.css:2412-2417`) and plan ribbon (`:2662-2668`). Existing pulses (`.tool-status`, `.conn-status.working .dot`, `report-pulse`) are unguarded.
- Add the mockups' shared keyframes (`attack-flow`, `flow-dash`, `soft-pulse`/`glow-pulse`, `slide-up`) once, centrally, with a single consolidated `@media (prefers-reduced-motion: reduce)` block that also covers the currently-missed legacy animations.
- **Convention going forward:** every new `animation:` must appear in that block.

**Acceptance:** visual no-op in both themes except dark-mode gradients (now correctly light-on-dark everywhere); tokens available for later phases.

---

## Phase 1 — Map quick wins (design item #1 · "Small, days")

**Ground truth:** labels hidden below rendered size 7 at device tier (`topology.js:544` — `labelRenderedSizeThreshold: data.zoom === 3 ? 7 : 4`; workstations are size 5, hence anonymous dots). **No** search-on-map, fit-to-view, zoom buttons, or mini-map exist. Snapshot picker is a raw `<select>` (`index.html:588-590`). Hover today only traces edges via reducers (`topology.js:569-578`).

### PR 1.1 — Labels + hover cards (~1 day)
- `topology.js:544`: scale threshold with node count — `data.nodes.length < 60 ? 0 : (zoom === 3 ? 7 : 4)`.
- HTML hover card (name · IP · role · segment) positioned via `sigma.graphToViewport()` on `enterNode`; pure DOM, no Sigma program work. Keep the existing edge-emphasis reducers.

### PR 1.2 — Zoom stack + fit-to-view (~½ day)
- Floating `+/−` stack and fit button (mockup: top-left, 34px buttons on `--float`). Fit = compute graph bbox → `camera.animate()`. Wire `Escape`-safe; add to `topology.js` chrome, CSS in the `topo-` block (`styles.css:3723+`).

### PR 1.3 — Search-on-map (~1–1.5 days)
- Header search field (240px, `/` shortcut, mockup styling). Index = current tier's nodes + a lazily-fetched device tier (`/api/topology/map?zoom=3&limit=5000` — the same call the overlay route already makes server-side). Match on name/IP; on pick: if device visible → fly-to + `showDevice()`; if aggregated → drill to its segment (`state.parent = tierMap.segment`) then fly-to.
- No server change needed.

### PR 1.4 — Snapshot timeline + header regroup (~1 day)
- Replace the `<select>` with the mockup's square-timeline strip (≤12 snapshots retained by default — `EH_TOPOLOGY_KEEP` — so squares always fit). Active square cyan + glow; label "Aug 3, 22:52 · 114 devices" from the existing `/snapshots` payload.
- Split the single crowded `.topology-head` row into the mockup's two rows: row 1 = brand + view-switch shell (Topology only for now, Matrix/Changes segments hidden until Phase 5) + search + incident button placeholder; row 2 = breadcrumbs (already exist — `renderCrumbs()`, `topology.js:235-255`) + role-count chips (derive counts client-side from painted nodes) + snapshot timeline.

**Risk:** low. All client-side. **Test:** extend the currently-nonexistent map e2e coverage — add a first Playwright smoke (open map, search, fit) here; the map has zero e2e tests today and Phase 3 will need a safety net.

---

## Phase 2 — Investigation transparency quick wins (design item #2 · "Small, days")

**Ground truth:** `toolSummary()` is `JSON.stringify(args).slice(0,160)` for everything but bash/read/write (`chat.js:334-339`). Tool output text **is** available client-side at `tool_execution_end` (`ev.result.content`, ≤64KB server cap, 4000-char display cap — `chat.js:392-411`). The integration-badge system already parses `excli-interface` verbs into 23 actions (`integration-badges.js:29-55`) — reuse it. An unused `tool_execution_update {toolCallId, status}` event is already slimmed for the wire with **no client handler** (`lib/session-history.js:190-197`) — a free live-progress hook.

### PR 2.1 — Tool-call phrase map (~1 day)
- New `public/js/tool-phrases.js`: `phraseFor(toolName, args)` → "Querying 7 days of traffic per device", built on the existing verb parsing. Replace the `.tool-summary` content; keep raw args in the expandable detail (unchanged).

### PR 2.2 — Humanized result sentences (~1–1.5 days)
- On `finishToolCard`, run per-kind result summarizers (client-side, pure): detections → "0 detections against this device in the window"; metric queries → top-N + value; device searches → counts. Key fact wrapped in `<strong>` per the mockup. Fallback: first meaningful line of output.
- This is the mockup's core tool-stream UX and is shared verbatim with Phase 6's left rail — build it as a standalone module (`tool-phrases.js`) so the activity view imports it.

### PR 2.3 — Finding chips + plan strip (~1 day)
- (b-tier from the review): system-prompt addition in the Claude backend so the agent emits one-line `FINDING:` notes after significant results; render as highlighted chips in the stream. Prompt change only — no schema.
- **`FINDING:` contract — defined here, once, for Phase 6 reuse** (the activity view's CURRENT FINDING card consumes the same notes; fixing the format now avoids a second prompt change + re-eval in Phase 6):
  - One line: `FINDING: <sentence>` with an optional trailing leaning tag `[leaning: expected-behavior|suspicious|malicious|inconclusive]`.
  - Client parser lives in the shared module (with `tool-phrases.js`); chat renders it as a chip, activity view renders the newest as the CURRENT FINDING card (leaning tag → the verdict emphasis color).
- Slim current-task + progress strip attached above the streaming message while running (data already in `state.investigationPlan.progress.currentTask` / `percent`); the plan ribbon stays as the detail view.

**Risk:** low; PR 2.3's prompt change needs eval-gate attention (repo has an eval harness — run it before/after).

---

## Phase 3 — Zone-based topology (design item #3 · "Medium, 1–2 wks") — the architectural one

**Ground truth:** segments are *nodes*, never containers — no SVG layer, hull, or rect exists. Every paint kills and rebuilds Sigma (`topology.js:532-535`). Camera-ratio LOD refetches a whole single-tier payload on band crossing (`topology.js:582-586`, `TIER_BANDS` `:29`); "segment A expanded, B collapsed" has **no representation** in the API (`readTier` takes one `zoom` — `lib/topology-store.js:276-333`) or renderer (`colorFor`/`sizeFor`/label rules all branch on the single `data.zoom`). Mitigating good news: aggregate positions are true member centroids (`lib/topology-layout.js:230-246`), so in-place expansion is geometrically sane, and a breadcrumb drill already exists (`drillInto`, `topology.js:449-469`).

### PR 3.1 — Server: mixed-resolution map (~2–3 days)
- `routes/topology.js` + `lib/topology-store.js`: accept `expanded=<segment-key,segment-key,…>` on `/map`. Server merges: device-tier read scoped to expanded segments + segment-tier read for the rest, each node stamped with `tier: 'device'|'segment'`. Edges: aggregate at the coarsest common grouping per endpoint pair (extend the tier query's `groupBy` to a per-endpoint CASE, or run two queries and merge — the second is simpler and the payloads are small).
- Keep full back-compat with the existing single-`zoom` params (the enrichment/overlay flows use them).
- Unit tests alongside the existing `lib/topology-*.test.js`.

### PR 3.2 — Client: zone containers + explicit expand/collapse (~4–5 days)
- **New rendering layer:** one SVG element positioned under Sigma's canvases (zones, dot-grid `<pattern>`) and one above (later: attack paths/badges — Phase 4), both re-projected on Sigma's `afterRender` via `graphToViewport()`. This is the load-bearing architectural piece for Phases 3–4; isolate it in a new `public/js/topo-layers.js`.
- Zones: rounded rects (rx 18, ~4–5% accent fill, 1.2px stroke, UPPERCASE label + sub-label) computed from member-node bboxes + padding; zone accent = the dominant-role color PR #119 already ships on segment aggregates.
- Interaction: double-click zone (or its collapsed cluster node) → add to `expandedZones` set → refetch with `expanded=`; nodes fan out from the centroid (free, given layout). Collapse via zone-label click or breadcrumb. Collapsed zones render as the mockup's cluster circle (dot-triad + "82 workstations").
- **Camera LOD (decided):** delete the camera→tier listener (`topology.js:582-586`); zoom becomes purely visual. Keep `TIER_BANDS`/`autoTier` code paths **one release** as a `?lod=camera` escape hatch — insurance for degenerate estates (single-segment networks, all-unknown roles) and an A/B story — then hard-delete the following release; two interaction models is worse than either.
- Per-node styling: `colorFor`/`sizeFor`/label threshold keyed off `node.tier` instead of `data.zoom`; overlay/drift tier-lift (`FIELD[data.zoom]` at `topology.js:686,784`) becomes per-node.
- **Light theme is a first-class acceptance gate for this PR, not a follow-up.** The mockup's 4–5% zone fills read on dark but nearly vanish on white — which is exactly why its light palette ships *darker explicit zone strokes* (the `--m-zone-*` light values, e.g. `#a8cbe2`/`#e5b4cf`/`#d5d2e2`). Use the mockup's explicit per-theme zone tokens; never derive light zones by alpha alone.

### PR 3.3 — Mini-map + canvas dressing (~1–2 days)
- Mini-map (150×96, bottom-right): zone bboxes as tinted rects + viewport rect; click-to-pan. Trivial once zones exist.
- Canvas radial-gradient background + 26px dot grid per mockup tokens.

**Risks:**
- *SVG↔WebGL sync jitter on pan/zoom* — update transforms in the same rAF as Sigma's `afterRender`; at these node counts (≤ a few hundred visible) this is well within budget.
- *Edge aggregation semantics in mixed resolution* (device↔collapsed-segment edges) — decide representation early in PR 3.1 review: recommend device→segment aggregate edges, matching what the eye expects.
- *Drift/overlay lift correctness* — both mutate node attrs by lifted key; per-node tier makes the lift ambiguous only if a device's segment is expanded *and* the change targets the segment. Rule: lift to the most-resolved visible node.
- **Do not start Phase 3 without the Phase 1 Playwright smoke in place.**

---

## Phase 4 — Incident overlay promotion (design item #4 · "Medium, ~1 wk")

**Ground truth:** `applyOverlay()` (`topology.js:777-867`) already does the hard logic — pair-collapsing, stage colors (the real `STAGE_COLOR` is a 14-entry MITRE-tactic array at `topology.js:116-124`, not the README's 3-color sketch; mockup steps simply index into it), external-actor injection with deterministic placement, kill-chain data in `renderOverlayPanel()`. What's missing is presentation: the overlay hides behind a combobox whose `placeholder="No overlay"` (`index.html:591-596`), attack edges are static Sigma edges, and **no patient-zero concept exists anywhere** (derive client-side: `events[0]`'s src, i.e. `seq === 0`).

### PR 4.1 — Overlay chrome (~1.5 days)
- Incident button in header row 1 (magenta tint, pulse dot, current incident title), replacing the bare combobox as the entry point; the incident list keeps the existing combobox internals behind the button (`renderIncidentList` etc. — `topology.js:978-1002`).
- Kill-chain strip, bottom-center floating chip row (numbered stage dots joined by →) — data already computed for the inspector panel's `.topo-stage` chips; reuse.

### PR 4.2 — Attack-path layer (~2–3 days)
- On the Phase 3 top SVG layer: attack edges as dashed animated paths (`stroke-dasharray 10 6`, `attack-flow` keyframes, arrowhead `<marker>`), numbered step badges (r=11 circles at path midpoints), patient-zero pulsing halo (r≈32 `soft-pulse`), external actor as dashed red circle + ✕ in the dashed EXTERNAL strip. Remove the Sigma-edge-mutation styling for attack pairs (keep the dim-everything-else node treatment).
- **Step-badge hit targets ≥ 20px** even though the mockup draws r=11 — badges are hover/click anchors for the inspector sync; use an invisible larger hit circle (`r≥10` transparent overlay, `pointer-events: all`) behind the visual one.
- Inspector "IN THIS INCIDENT" card (numbered step rows; hover row → emphasize the matching path — both live client-side, trivial wiring).
- **Reduced motion: freeze, don't hide.** Static dashed colored paths still carry the kill-chain story; the reduced-motion block stops only the `attack-flow` dash-offset animation (and pulses), never removes the paths, badges, or dashes.

### PR 4.3 — Inspector traffic card (~1.5 days, **small backend addition**)
- Sparkline + BYTES 7D/PEERS tiles need per-device byte history that isn't served today. Add `GET /api/topology/node/:key/history?group=` → per-retained-snapshot `{snapshot_id, collected_at, bytes_total, peer_count}` (one aggregate Cypher over `TALKS_TO` per snapshot; ≤12 snapshots retained). Sparkline = per-snapshot totals — label it honestly ("last N snapshots", not strictly 7d).
- Gradient CTA "Investigate this device" — **decided: structured composer prefill for v1** (spawning seeded sessions raises workspace/approval lifecycle questions that shouldn't block Phase 4). The prefill is structured, not a name drop: `Investigate nas-backup-02 (10.42.0.117, key vlan:20/…) — context: snapshot Aug 3 22:52, incident "Lateral movement from nas-backup-02" step 2`, built from the inspector's current device + active snapshot + overlay state; close the map overlay and **auto-focus the composer**. A seeded-session backend (following the enrichment-session plumbing at `routes/topology.js:150-186`) is the later upgrade if analysts ask.

**Risk:** low-medium; everything hangs off Phase 3's SVG layer.

---

## Phase 5 — Traffic matrix + Changes views (from `Redesign – Map Views`)

**Ground truth:** segment×segment byte totals are *exactly* the existing zoom-1 edge query (`topology-store.js:317-330` — `sum(bytes_total)` grouped by segment, direction preserved); the diagonal is excluded only by `WHERE src <> dst`. The `/map` `keys=` param (≤500) already supports "show these pairs on the topology". Drift output (`lib/topology-drift.js:207-219`) maps 1:1 onto the mockup's severity-grouped cards (9 change kinds, severity + label + detail on every record); `/drift` even supports `from`/`to` params the UI never uses.

### PR 5.1 — View switch + matrix view (~3–4 days)
- Activate the Matrix segment in the Phase 1 header shell. New `public/js/topo-matrix.js` rendering the mockup grid (`150px + repeat(n, minmax(64px,92px))`, 56px cells, cyan alpha ramp, magenta + 2px outline for incident cells when an overlay is active — incident pair known from `overlay.events`).
- **Diagonal (decided): include intra-segment totals in v1** — east-west traffic inside a segment is precisely what lateral-movement hunting looks at; an empty diagonal reads as a bug. Server: `matrix=1` flag on the zoom-1 query that drops `WHERE src <> dst` (`topology-store.js:317-330`). Two rendering rules:
  - Diagonal cells get a **visually distinct treatment** (muted/hatched) so self-traffic isn't misread as pair traffic.
  - Diagonal cells are **excluded from the alpha-ramp normalization** — intra-segment volume otherwise dominates the max and washes out every off-diagonal cell. Normalize the ramp over off-diagonal cells only; diagonal alpha scales within its own range.
- Add `groupBy` param (segment|locality|role_key) for the "Group by" dropdown; "Weight" v1 = bytes only (links later).
- Cell click → right rail: pair list needs device-level edges filtered to that segment pair — serve via `/map?zoom=3&…` filtered client-side, or a dedicated `pairs` query (recommend dedicated: `WHERE a.segment=$s AND b.segment=$d ORDER BY bytes DESC LIMIT 20`). "Show these pairs on the topology" → switch to Topology with `keys=<device keys>` — existing param.

### PR 5.2 — Changes view (~2–3 days)
- Activate the Changes segment; render `/drift` output as the mockup's severity-grouped cards (severity chips summary, 40px icon + body + "Show on map →", high-severity red border, info collapsed). Absorb and remove the current `#topo-drift` button + inspector drift panel (`toggleDrift`/`renderDriftPanel`, `topology.js:739-766, 704-736`).
- "Show on map" → topology view scoped via `tierMap` lift + `keys=`.
- Optional polish: expose `/drift?from=&to=` via a snapshot-pair picker (the header "Comparing A → B" affordance in the mockup).

**Risk:** low. Matrix is a plain DOM grid; no Sigma involvement.

---

## Phase 6 — Live agent activity view (design item #5 · "Medium, 1–2 wks")

**Ground truth:** every needed signal already reaches the client — full SSE catalog verified (tool start/end with args + result text, plan updates, message deltas, agent start/end); files are polled on each `tool_execution_end` (`sse.js:184`); plan state has `progress.percent` + `currentTask`. Two hard facts the design missed: **(a)** `addToolCard` hard-appends into the chat's `agentBody()` (`chat.js:362`) — the refactor seam; **(b)** mid-turn composer posts are rejected (409, `routes/sessions.js:165-167`).

### PR 6.1 — Tool-event store refactor (~2 days)
- Decouple events from DOM: a small store (`toolCallId → {name, args, phrase, result, status, progress, t0, t1}`) that both renderers subscribe to — chat cards (existing look) and the activity stream (Phase 2's phrases/result sentences reused directly). No visual change beyond the progress line below; it's the seam.
- **Wire the free `tool_execution_update` event** (`{toolCallId, status}` — already slimmed for the wire with no client handler, `lib/session-history.js:190-197`): handler in `sse.js` → store `progress` field → **surface in the existing chat tool cards too** (progress text on long-running calls), not just the future activity stream. Note: emission is backend-dependent (Pi backend passes it through; verify what the Claude backend emits and extend if trivial).

### PR 6.2 — Activity layout + center column (~3–4 days)
- New `public/js/activity.js` + markup: header (context chip, pulsing status, elapsed timer, Transcript button), `1fr 360px 1fr` grid, docked composer (mockup's exact flex/overflow rules: root `100vh overflow:hidden`, columns `min-height:0`, cards `flex-shrink:0`, center `overflow-x:hidden`).
- Center: gradient orb (88px, two desynced pulse rings), status line, PLAN card mirroring `state.investigationPlan` (cyan→magenta progress fill, ✓/current/pending rows), CURRENT FINDING card fed by the Phase 2 `FINDING:` notes via the shared parser (leaning tag → verdict emphasis; fallback: latest streamed text block).
- Connector SVG confined to the 290px top band, active paths dashed/animated only while a matching tool call/artifact write is live.
- Toggle: activity view replaces the chat column while `state.running` (or manual toggle); "Transcript" returns to full chat. Entry/exit must not disturb `#chat` DOM (both surfaces stay mounted; CSS visibility swap).
- **Composer v1 (decided): client-side queue.** While running, the composer *accepts* the message, holds it client-side, and auto-sends at the turn boundary (`agent_end` already tells the client — `sse.js:87-92`); hint copy: "Queued — joins the investigation when this step completes." Queued message shown as a pending bubble with a cancel affordance. Loss on reload is accepted for v1. Zero backend risk; the 409 path never fires because the client sends only when idle.

### PR 6.3 — Tool stream + artifacts rail (~2–3 days)
- Left rail: newest-on-top stream from the store — running card (cyan tint, pulse, mono args + "→ doing" line), done cards (green dot + humanized sentence), opacity fade for older, "N earlier calls" collapse.
- Right rail: artifact cards from the files store. **DRAFTING state:** infer from `tool_execution_start` where `toolName ∈ {write, edit}` and `args.path`/`file_path` matches a report/artifact path; resolve on the matching `tool_execution_end` + `refreshFiles()`. Per-kind cards reuse the server's classification tags (METRICS/RECORDS/DEVICE — already served per file). **Fix needed:** `evidence/verdict.json` is currently *unclassified* (outside the approved artifact dirs — `lib/workspace-artifacts.js:44-73`) and hidden; add a `verdict` kind so the dashed placeholder card can resolve.

### PR 6.4 — Server-side message queue (backend, ~2–3 days) — **v2, decided; does NOT block 6.2/6.3**
- The durable upgrade over 6.2's client-side queue: `POST /message` while running returns 202 + enqueues server-side; the backend session injects queued user messages at the next turn boundary (the Claude SDK session's `prompt()` loop in `lib/backends/claude/session.js` is the insertion point); SSE `history_notice` confirms "message will join the investigation". Queued messages survive reload/reconnect — the v1 gap this closes.
- Gated on the eval harness (it touches the agent loop). Ship 6.2/6.3 with the client-side queue first; land this when it passes.

**Risks:** the dual-surface rendering must not regress replay (`state.replaying` suppresses animations/autoscroll — respect it); reduced-motion coverage for five new animations; PR 6.4 touches the agent loop — gate behind the eval harness.

---

## Phase 7 — Consolidation (design item #6 · "Small, ongoing")

### PR 7.1 — Type scale (~2 days)
- Verified sprawl: 27 distinct sizes, 286 declarations, 12 fractional values; the sub-10px cluster is concentrated in the plan ribbon (`8.5/9.8/10.8px` at `styles.css:2505-2655`). Map onto the Phase 0 scale tokens; bump the plan ribbon's sub-10px text to the 10/11 steps (review's legibility complaint). Mechanical, but review in 2–3 slices by component group.

### PR 7.2 — Settings IA (~1 day)
- Merge Challenger's 4 controls into Agent & models (`index.html:332-362` → `:278-331`); nav button removal at `:249`. Save path is ID-based and panel-agnostic (`settings.js:772-775`) — no JS logic changes. Add a Developer section wrapping Eval. **Watch:** `eval.js:183,245` queries `.settings-nav-btn[data-panel="eval"]` (silently `?.`-guarded) — keep that `data-panel` value or update both call sites.

### PR 7.3 — Right-panel consistency (~2 days)
- Today: Files = grid column; Memory = docks (440px) *or* full-screen with two implicit escalations (`memory.js:1123,1132`); Map = always full-screen (`styles.css:3729-3734`). Rule per the review: **docked panel = glanceable state; full-screen = explicit expand.** Give the topology overlay a docked variant mirroring `.memory-overlay.docked`, default Map to docked with an expand control; unify the tab strip (currently duplicated verbatim 3× — `index.html:155-159, 535-539, 583-587` — with each panel wiring its own listeners on *all* tabs) into one shared component so a future 4th tab has one wiring point.

---

## Design-doc corrections (handoff ≠ code reality)

| # | Handoff claim | Reality | Consequence |
|---|---|---|---|
| 1 | Composer "posts into the running session (existing message path)" | 409 while running (`routes/sessions.js:165-167`; client-blocked at `composer.js:32`) | Resolved: client-side queue v1 (PR 6.2), server queue v2 (PR 6.4) |
| 2 | "No new backend state… nothing requires new collection" | True for *collection*; false for *serving*: mixed-resolution `/map` (PR 3.1), device history (PR 4.3), matrix diagonal/pairs (PR 5.1), verdict classification (PR 6.3), message queue (PR 6.4) are all new server code over existing data | Backend PRs are small but real; plan reviews accordingly |
| 3 | "Stage colors follow the existing STAGE_COLOR array (amber → red → purple etc.)" | `STAGE_COLOR` is a 14-entry MITRE-tactic-indexed array (`topology.js:116-124`); mockup's 3 colors are just 3 sampled stages | No change needed — mockup steps index into the real array |
| 4 | Patient-zero halo, numbered steps | No patient-zero concept exists anywhere; steps exist only as text labels | Derive patient zero client-side (`seq 0` src); badges/halo are new Phase 4 rendering |
| 5 | Mockup zone/attack visuals implicitly assume a drawable vector layer | Sigma is WebGL/canvas; no SVG layer exists; animated dashes impossible in stock edge programs | `topo-layers.js` SVG under/over-lay pair (Phase 3) — the plan's key architectural addition |
| 6 | Snapshot timeline of small squares | Fits: ≤12 snapshots retained (`EH_TOPOLOGY_KEEP`) | None — design works as-is |
| 7 | "Data comes from the existing lib/topology-drift.js output" (Changes view) | Correct, verified 1:1 mapping | None |
| 8 | Artifact cards incl. verdict.json placeholder | `evidence/verdict.json` is unclassified & hidden today (`lib/workspace-artifacts.js:44-73`) | One-line-ish server fix in PR 6.3 |

Also inherited (pre-existing, surfaced by the audit — fix opportunistically): dead `topo-overlay-pick` reference (`topology.js:1117`); duplicate close branch (`app.js:51-52`); `localityRules` config read but never writable (non-RFC1918 estates misclassified External — documented limitation, relevant to zone labels).

---

## Testing strategy

- **Before Phase 3:** first Playwright map smoke (Phase 1) — the map currently has zero e2e coverage; the tier/zone rewrite must not land blind.
- Unit tests continue alongside `lib/topology-*.test.js` for PR 3.1/5.1 query changes.
- Phases 2 & 6 prompt/backend changes go through the existing eval harness (record/replay modes already in Settings → Eval).
- Every phase: light/dark + reduced-motion screenshots on the changed surfaces (tokens make theme regressions cheap to spot).

## Resolved decisions (2026-08-05 review)

1. **Mid-turn composer:** client-side queue v1 (accept + hold + auto-send on `agent_end`, "Queued — joins the investigation when this step completes", reload loss accepted) in PR 6.2; server-side queue + turn-boundary injection as durable v2 in PR 6.4, eval-gated, **not blocking 6.2/6.3**.
2. **Camera LOD:** keep `?lod=camera` escape hatch one release (insurance for degenerate estates + A/B story), hard-delete the next.
3. **Matrix diagonal:** in v1, with distinct (muted/hatched) diagonal treatment and diagonal excluded from the ramp normalization so intra-segment volume doesn't wash out off-diagonal cells.
4. **"Investigate this device" CTA:** structured composer prefill (device name + IP + key + snapshot + incident/step context) with auto-focus; seeded-session backend later if analysts ask.

Review adjustments also folded in: `FINDING:` contract fixed in PR 2.3 for Phase 6 reuse; `tool_execution_update` wired in PR 6.1 including progress text in existing chat cards; light-theme zone tokens an explicit acceptance gate in PR 3.2; reduced motion freezes (never hides) attack paths; step-badge hit targets ≥ 20px.
