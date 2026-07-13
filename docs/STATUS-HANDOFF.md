# Status & handoff — v26.07.10 work

Self-contained handoff for the operator-added work on this copy. Written because
the working session hit context limits. Read this first; deep detail is in
[CHANGES.md](CHANGES.md) and the `DESIGN-*` / `DECISION-*` / `PLAN-*` docs.

---

## 1. Deployment snapshot (what's running now)

- Docker stack, project **`eh-investigator`**, launched from
  `~/Downloads/v26.07.07/eh-investigator-agent-cd9fae2e6d14/` (the live source
  dir; the `.env` with creds lives here). 4 services: **eh-investigator** (app,
  `127.0.0.1:3100`), **graphiti-mcp**, **falkordb**, **ollama**.
- Production is running the **latest image** (rebuilt + recreated this session).
  Volumes persist across recreates: `workspaces`, `pi_home` (external),
  `config_data` (`/app/data` — config.json, secrets.json, **and the eval store
  at `/app/data/eval`**), `falkordb_data`, `ollama_models`.
- Distributable bundle: `~/git-repo/ExtraHop Investigation Agent/v26.07.09/`
  (`eh-investigator-agent/` folder + `.tar.gz`). Kept in sync with source; every
  rebuild verified **secret-free** (no `.env`/`config.json`/`secrets.json`).

### Redeploy / operate (commands)
This directory **is the git checkout** (origin → `github.com/swsloan/eh-investigator-agent`,
branch `main`) **and** the deploy source — edit, commit, and deploy all act on one
tree, so the running app and the repo never drift. Secrets (`.env`, `config.json`,
`secrets.json`) are gitignored and stay local; runtime secrets also live in the
`config_data` volume.
```bash
cd ~/Downloads/v26.07.07/eh-investigator-agent-cd9fae2e6d14
./scripts/deploy.sh                                                                     # deploy app (build + recreate app only; warns on uncommitted drift)
git add -A && git commit -m "…" && git push                                             # keep repo == prod
docker compose -p eh-investigator -f docker-compose.yml restart graphiti-mcp            # after a graphiti/config.yaml edit (config is volume-mounted, no rebuild)
```
`deploy.sh` is self-locating and runs the same `docker compose … up -d --build
eh-investigator`. Recreating the app **interrupts any in-flight investigation**;
volumes/other services are untouched. Hard-refresh the browser (Cmd-Shift-R) after
a UI deploy.

---

## 2. Completed this session

**Deployment & platform** (all live, in bundle)
- Docker packaging (Dockerfile, compose, entrypoint), loopback-only, `IS_SANDBOX=1`.
- Both backends installed (Pi + Claude Code); Claude subscription/API-key auth.
- Settings/secrets persistence (`config_data`), file secret backend.
- Graphiti temporal-memory layer (FalkorDB + Ollama embeddings), wired into both backends.

**Investigation quality (Warrant Phase 1)**
- `skills/evidence-ladder/SKILL.md` — metrics→records→packets discipline,
  hypothesis-first, detection-source-aware trust, case ledger, structured
  `evidence/verdict.json`. Auto-discovered.
- Detection-source verified against the live API: **only IDS is
  field-identifiable** (`sec.ids` category / `ids_*` type / `properties.sid`);
  rule/ML/ARD are not distinguishable → skill collapses them to "behavioral,
  corroborate."
- Reporting templates: added an "evidence depth" ladder strip (+ detection-source
  pill on SOC). Dark-mode input-readability bug fixed.
- Validated live on a real detection: caught a **LameHug LLM-as-C2** true positive
  that naive IDS triage would have closed as a huggingface FP.

**Eval harness (Warrant Phase 0) — built, tested, deployed**
- Data contract: `eval/dashboard/schema/*.json`; scorer `eval/harness/score.js`
  (unit-tested) → `history.jsonl` + `<run>.json`.
- Dashboard `eval/dashboard/build.js` (M1 scorecards, M2 trend, M3 diff, M4 CI
  `--check`/`ci.sh`/sample GH workflow, M5 backend split). Importable
  (`buildDashboard()`), served in-app at `/eval-dashboard`.
- **In-app eval**: `POST /api/eval/run` runs the labeled cases through the app's
  own session machinery (`lib/eval-runner.js`), read-only + memory-off,
  **captures cost natively** from the transcript. `GET /api/eval/status|runs|cases`.
- **Read-only broker**: per-session guard + `EH_BROKER_READONLY` (`lib/excli-readonly.js`).
- **Parallel** runs (`mapPool`, default 3, capped 8) + Max-parallel knob.
- **Record/replay** (`lib/excli-cassette.js`): record captures excli calls per
  case; replay serves them offline. Live-verified (7 calls recorded, replayed 0
  misses, same verdict). Note: replay is offline/deterministic-telemetry, **not
  free** (model still runs); PCAP files aren't reproduced.
- **Eval UI** (Settings → Eval tab): Run button, live progress, result card,
  recent-runs table, **labels editor** (edit disposition/min_rung/attack/notes +
  sign-off, persisted via `lib/eval-cases.js` overrides), **knobs** (gate target,
  cost ceiling, max parallel, Mode=Live/Record/Replay).
- **Real curated case set** `eval/cases/*.json` (6: 1 adjudicated malicious,
  2 FP, 3 benign) + `eval/harness/example-cases` (synthetic demo).

**Memory-extraction quality**
- Audited + fixed the 12 untyped `[Entity]` nodes (relabeled 5, deleted 7 noise);
  **0 untyped remain**. Broadened `graphiti/config.yaml` ontology + added
  capture-hygiene to `skills/investigation-memory/SKILL.md`. Deployed.

**Memory-graph visualization v1 (contextual recall) — built, verified, DEPLOYED (26.07.10)**
- Read-only neighborhood API: `lib/falkor-client.js` (dependency-free RESP client,
  `GRAPH.RO_QUERY` only — read-only by construction), `lib/memory-graph.js`
  (overview/search/neighbors/quality queries + drift watch), `routes/memory-graph.js`
  (`GET /api/memory/graph/{groups,overview,search,neighbors,quality}`). Bounded
  neighborhoods/aggregates only — never ships the whole graph.
- **Contextual panel** (`public/js/memory.js` + overlay in `index.html` + styles):
  header **Memory** button → full-screen overlay; namespace selector, entity
  search, radial **SVG ego-network** (focus + neighbors + facts + episode nodes),
  click-to-recenter, node inspector (summary/facts/investigations + "Ask the agent
  about this" composer prefill). Themed from CSS vars (verified light+dark).
  v1 uses a dependency-free SVG renderer; sigma.js is the v2 (scale/real-time)
  renderer — the server contract is renderer-agnostic. See DESIGN §9 note.
- **Investigation view (v2 core):** a **This investigation** mode alongside
  Browse — entities the current run touches, pulled live from the tool-call stream
  and tagged **known** (click → memory ego-network) or **new this run**. Real-time,
  client-side, over the existing read-only API; SSE hook is try/catch-guarded.
- **Drift-alert** (memory-quality backstop): `startDriftWatch` warns in logs when
  untyped `[Entity]` nodes reappear; the overview endpoint returns the untyped
  count; the panel shows a ⚠ badge linking to the offending nodes.
- Verified against the live graph in an isolated container (all endpoints + real
  ego-network render + theming + empty-namespace + error paths; 0 JS errors).
  Compose gains `FALKORDB_URI`/`FALKORDB_PASSWORD` for the app service.
- **Deployed** via `docker compose -p eh-investigator up -d --build eh-investigator`
  (image rebuild — server/client/UI baked in). Prod is on image version 26.07.10.

**Design/decision docs** (in `docs/`)
- `DESIGN-warrant-harness.md` + `warrant-harness.html`, `DESIGN-evidence-ladder.md`,
  `DESIGN-eval-harness.md`, `PLAN-eval-dashboard.md`, `DECISION-backends.md`,
  `DESIGN-memory-visualization.md` (revised: contextual-recall-first, real-time,
  sigma.js+graphology), `DESIGN-graphiti-memory.md`.

---

## 3. Next steps (prioritized)

### A. The analyst loop — labels + baseline + first A/B DONE; now grow the set
Done so far (2026-07-10):
1. **6 case labels signed off** (Eval tab) — dispositions + `min_rung` confirmed.
2. **Baseline run** `eval-2026-07-10T00-20-32` — false-close 0, accuracy 0.83
   (5/6), adherence 0.67, false-climb 0.33, cost/case $2.41. Gate PASS.
3. **First A/B** (isolated `eh-eval`, run `eval-2026-07-10T20-50-27`), two
   evidence-ladder edits:
   - **Taxonomy fix — validated + shipped.** `plaintext-http-creds` `true-positive`
     → `benign`; **accuracy 0.83 → 1.00, false-close held 0.** (§6 now enumerates
     the five dispositions; a true-positive-that-isn't-a-threat is `benign`.)
   - **Over-climb stop-rule — shipped but did NOT bite.** `ssdp-dlink-fp` still
     climbed to packets; false-climb unchanged 0.33. Kept (sound, harmless), but
     it's not the fix. The cost drop ($2.41→$2.05) was run-to-run variance, not
     the edit.
Next:
4. **Grow the case set (now the top eval task).** 6 → **7**: `adcs-web-enrollment-abuse`
   added (malicious ADCS ESC-abuse hunt; `min_rung: records`; T1649+T1187+T1078.002)
   — **seeded, awaiting sign-off in the Eval tab.** Growth is now self-serve: any
   session's ⋯ menu → **Promote to eval case** pre-fills a case from that run's
   `verdict.json` and persists it (no rebuild); sign it off in the Eval tab.
   Keep going (more malicious, a
   confirmed authorized-scanner, the ambiguous WinRM lateral-movement `4294967935`)
   so over-climb is measured across a *distribution* before any more ladder tuning.
   **Don't** tune the Tier-3 gate against one case — the same depth caught the
   LameHug true positive; raising false-close is the failure to avoid.
5. Re-baseline on the grown set; that low, stable false-close across more cases is
   the gate for **Warrant Phases 2–5** (§D).

### B. Memory-graph visualization — v1 + v2 (docked + timeline) BUILT & DEPLOYED (26.07.10)
Live in prod: **Browse** (ego-network) and **This investigation** — the latter now
**docks as a right rail beside the chat** (expand button → full screen) with a
**Timeline / Graph** toggle. Timeline shows discovery order live and **upgrades to
the forensic timeline** from `verdict.json` `timeline[]` at close (skill emits it).
Entity extraction was tightened (real-TLD only; drops network IPs + code tokens).
Analyst-feedback round (26.07.10) — DONE: browse type drill-down + search picker;
forensic-timeline loads on opening a completed run; untyped-entity **curation**
(assign type / delete — first guarded write path); promote button in the
investigation panel; session **Save for review** flag (★, pinned top);
**#6 merged right panel** (Files/Memory tabs — selecting Memory collapses the
Files column and the docked panel becomes the sole right side); **mis-typed fix**
(entity-inspector "Fix classification" → re-type or delete any node). **⚠ #6's
layout + all the new memory UI were NOT pixel-QA'd** — the browser bridge was
unreachable this whole session; verify visually and report tweaks.
Round 2 (26.07.10) — DONE: **entity merge/dedup** (inspector "Merge into…" →
`mergeNodes` rewires edges+episodes onto the canonical, deletes the dup);
**live-view detection + `DOMAIN\user` identity nodes**; **back-to-investigation
crumb**. So untyped + mis-typed + duplicate entities are all fixable in-app.
Remaining:
- **v2 polish (minor):** identities from arbitrary record fields (only `DOMAIN\user`
  is extracted now); edge bundling; sigma/WebGL scale explorer (future).
- **still unverified visually:** everything from both feedback rounds — the browser
  bridge never reached me this session. Eyeball the memory panel + curation/merge.
- **v2 full (later):** a single merged two-source canvas with memory-backdrop
  edges, and the **sigma.js + graphology** renderer (SVG suffices at current scale;
  server contract is renderer-agnostic).
- **future:** standalone large-scale explorer + curation (merge dupes / invalidate
  facts).
- **verify the live UI:** the browser scripting bridge was down at build time, so
  the docked layout + timeline *appearance* weren't pixel-checked (every data-path
  component was verified independently — extraction unit-tested, resolution
  confirmed against real memory, render path is the proven `renderGraph`). Eyeball
  at localhost:3100 → **Memory** → **This investigation**.

### C. Memory-quality backstop
- **Drift detection: DONE** — `startDriftWatch` (in `lib/memory-graph.js`) warns
  when untyped `[Entity]` nodes reappear; surfaced in the viz overview + a badge.
- **Still to do:** dedup (`DC01` vs `10.0.10.4 (DC01)`) + eventual curation UI
  (pairs with B-future). The ontology/capture fixes remain steering, not a guarantee.

### D. Warrant harness
- **Phase 2 core — SHIPPED (26.07.10).** Hypothesis-first (`evidence/hypothesis.json`
  written before deep evidence, hard gate) + citations enforceable
  (`lib/citation-check.js`; scorer `framing_present` + `citation_coverage`; late
  challenger surfaces uncited claims). A/B vs the signed 7-case baseline: false-close
  0, accuracy 1.00, framing 1.0, citation 0.97, cost $1.90→$2.67. See
  [PLAN-warrant-phase2.md](PLAN-warrant-phase2.md).
- **Phase 2 deferred piece:** the *early challenger as a separate coordinator pass*
  — the eval runs each case as one autonomous turn, so it can't be A/B-measured;
  needs an eval-runner extension (drive the interactive challenger loop) or
  interactive validation. Not shipped.
- **Eval limitation surfaced:** 7 cases × 1 run can't reliably tune skill *wording*
  (a 1-case flip = 14 accuracy pts). **Grow the case set** + consider multi-run
  averaging before fine tuning. Also: **the gate should get an accuracy floor** —
  today it only gates false-close + cost, so "PASS" can hide an accuracy dip.
- **Phase 3 (injection boundary) — first slice SHIPPED (26.07.11).** Structural
  system-prompt separation + `<untrusted-telemetry>` envelope on the excli broker
  (live+replay) + pure `lib/telemetry-taint.js` (envelope + injection detector,
  annotate-not-strip). A/B: false-close 0, accuracy 1.00, cost $2.02 (no regression).
  **exmcp hook (§C): wired, confirmed-firing, GATED OFF** (`EH_EXMCP_TAINT=1`).
  Live-verify finding: the agent does *all* ExtraHop access (incl. packets) via
  `./excli-interface` (Bash → broker) — **exmcp is unused, so §B is the effective
  boundary**; the hook is dormant insurance, wrap-format unverified until exmcp is
  used. **Injection measurement framework: BUILT + shipped (inert until cassettes
  exist).** Scorer `injection_resist_rate`/`injection_flag_rate` + **gate
  hard-fails on any verdict flip**; runner captures `injection_detected`; skill
  sets it; tamper tool `lib/inject-cassette.js`; 6 specs in `eval/injection-cases/`
  + workflow README. **Remaining (the actual proof):** record base → tamper →
  replay + score per case (curation, ~1 live run each) + a small replay-run path
  (runner uses a fixed `casesDir`; a PoC drops one spec + tampered cassette into
  `eval/cases/`+`eval/cassettes/` and runs `mode:replay`). Boundary is hardened +
  measurement is wired; only recorded cassettes remain to make resistance a number.
  See `eval/injection-cases/README.md`.
  **PoC finding (26.07.11): record→tamper→replay is the WRONG vehicle.** Injecting
  into a recorded `lamehug` records response diverged the replay — the agent
  concluded false-positive at the *metrics* tier (LameHug's naive-triage trap),
  never reaching the records where the injection lived. So `injection_resist_rate`
  was an artifact, not a real failure; injection resistance is **still unmeasured.**
  Right vehicle: **lab-crafted detections** (plant the payload in a real record,
  run live) or a **dedicated injection-probe harness**. The scorer/gate/tool stay
  valid; only the content-delivery vehicle changes.
- **Phases 4–5** (evidence-completeness-gated write-back; multi-agent
  orchestration) — still gated on the eval + Phase 3 completion. Phase 4 needs the
  full injection boundary (incl. exmcp) first.
- **Activate CI** — `.github/workflows/eval-dashboard.yml` is a sample; wire it if
  the repo goes to GitHub.
- **On-prem Pi-local-model mode** — per `DECISION-backends.md`: point Pi's
  investigator at a local model, promote from POC overlay to a supported mode,
  eval it. (Note: current `docker-compose.qwen.yml` only localizes *extraction*,
  not the investigator.)
- **Grow the case set** — 6 is thin for reliable precision/recall; add more real
  cases (more malicious, a confirmed benign-authorized/scanner, the ambiguous
  WinRM lateral-movement detection `4294967935`).

---

## 4. Standing operational items
- **Rotate the Anthropic API key** that passed through the setup chat — still
  outstanding.
- `secrets.json` is plaintext (0600) in the `config_data` volume — same posture
  as `.env`; protect the volume.

---

## 5. Verified facts worth not re-deriving
- **Memory writes at investigation *close***, not continuously (via
  `lib/memory-coordinator.js`) — shapes the real-time viz data model.
- **Eval cost is authoritative; tokens are approximate** (tokens over-count cache
  reads). Gate on cost, not tokens.
- **`graphiti/config.yaml` is volume-mounted** (`:ro`) → edit + `restart
  graphiti-mcp`, no rebuild. Skills are **baked** in the app image → edit +
  rebuild app.
- Graphiti stores entity type as **both a graph label and an `n.labels`
  property** — any manual relabel must set both.
- FalkorDB graphs: `pocextrahop` (real, `EH_MEMORY_GROUP_ID`), `pocqwen` (local
  POC), `extrahop` (empty default). Inspect with
  `docker exec eh-investigator-falkordb-1 redis-cli GRAPH.QUERY <g> "<cypher>"`.
- Eval store lives at `/app/data/eval` (persisted): `history.jsonl`,
  `<run>.json`, `cassettes/`, `label-overrides.json`, `dashboard/`.
- `runOneShot()` is **tool-less** — cannot run an investigation; the eval runner
  drives full sessions instead.

---

## 6. Key file map
```
server.js                          app entry; mounts /api/eval, serves /eval-dashboard
lib/eval-runner.js                 in-app eval (parallel, cost capture, mode live/record/replay)
lib/eval-cases.js                  merge label overrides over baked cases (sign-off)
lib/excli-readonly.js              read-only broker classifier (+ guard in excli-broker.js)
lib/excli-cassette.js              record/replay store for offline eval
routes/eval.js                     /api/eval/{run,status,runs,cases,cases/:id,dashboard}
eval/harness/score.js (+ .test)    deterministic scorer (contract)
eval/harness/run-eval.js           offline/live CLI (scores recorded verdicts)
eval/dashboard/build.js            static dashboard generator (importable)
eval/dashboard/{schema,fixtures}   contract + synthetic fixtures + validate.py
eval/cases/*.json                  real curated ground-truth cases (+ README)
lib/falkor-client.js               dependency-free read-only FalkorDB (RESP) client
lib/memory-graph.js                memory-graph queries + untyped-drift watch
routes/memory-graph.js             /api/memory/graph/{groups,overview,search,neighbors,quality}
public/js/memory.js                memory-graph overlay (SVG ego-network + inspector)
public/js/eval.js, index.html      Eval tab + Memory overlay UI; styles in public/styles.css
skills/evidence-ladder/SKILL.md    the ladder discipline
skills/investigation-memory/SKILL.md  memory read/write + capture hygiene
graphiti/config.yaml               ontology (entity/edge types) — volume-mounted
docs/DESIGN-*, DECISION-*, PLAN-*  design record
```

---

## 7. One-liners
```bash
# run the eval from the UI: Settings -> Eval -> Run eval   (or:)
curl -s -XPOST localhost:3100/api/eval/run -H 'content-type: application/json' -d '{"backend":"claude"}'
curl -s localhost:3100/api/eval/status
open http://localhost:3100/api/eval/dashboard   # builds + opens the full dashboard
# inspect memory graph
docker exec eh-investigator-falkordb-1 redis-cli GRAPH.QUERY pocextrahop "MATCH (n:Entity) RETURN DISTINCT labels(n), count(n)"
# memory-graph viz: click the "Memory" button (sidebar footer), or hit the API:
curl -s localhost:3100/api/memory/graph/overview
curl -s "localhost:3100/api/memory/graph/search?q=dc01"
```
