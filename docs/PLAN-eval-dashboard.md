# Implementation plan — investigation eval dashboard

A concrete build plan for the dashboard designed in
[DESIGN-eval-harness.md](DESIGN-eval-harness.md) §"Displaying results". It turns
the eval harness's output into two artifacts: a **per-run scorecard** ("is this
build good?") and an **aggregate trend dashboard** ("are we improving, and are we
allowed to advance a Warrant phase?").

Status: plan / not yet built. Depends on the Phase 0 eval harness for real data,
but see §2 — the dashboard is built against a **data contract** and fixtures, so
it can be developed in parallel with the harness, not after it.

---

## 1. Goals and non-goals

**Goals**
- Make the go/no-go decision readable in ~5 seconds (gate badge + false-close
  rate) and the progress toward it readable on one screen.
- Self-contained, offline-viewable **static HTML** — no server, no app-UI
  surface — so it doubles as a CI artifact.
- Reuse the ExtraHop brand system already in the reporting templates.
- Deterministic, reproducible output from JSON input (same input → same HTML).

**Non-goals (for now)**
- No live/interactive web app, no database, no auth.
- Not wired into the product UI — this is a dev/CI tool.
- Does not itself run investigations or score them; it only renders what the
  harness produced.

---

## 2. The data contract (the linchpin)

The dashboard reads two file shapes the harness emits under `eval/reports/`.
Defining these first lets us build the dashboard against **fixtures** before the
harness is finished, and keeps the two decoupled.

### `eval/reports/history.jsonl` — append-only, one line per run

```json
{
  "run_id": "2026-07-09T14-02Z-v3",
  "timestamp": "2026-07-09T14:02:11Z",
  "git_sha": "abc1234",
  "skill_version": "evidence-ladder@v3",
  "label": "+source rule",
  "backend": "claude",
  "model": "claude-sonnet-5",
  "case_count": 95,
  "aggregates": {
    "false_close_rate": 0.04,
    "verdict_accuracy": 0.89,
    "ladder_adherence": 0.91,
    "attack_accuracy": 0.82,
    "groundedness": 0.94,
    "cost_per_case_usd": 0.51,
    "tokens_per_case": 41000,
    "confusion": {"malicious": {"malicious": 31, "benign": 2}, "...": {}},
    "calibration": [{"bucket": "low", "accuracy": 0.55, "n": 12}],
    "adherence": {"entered_right_rung": 0.90, "false_climb": 0.05,
                  "under_investigated": 0.03, "under_corroborated": 0.02}
  },
  "gate": {"pass": true, "false_close_target": 0.05, "reasons": []}
}
```

### `eval/reports/<run_id>.json` — per-run case detail

```json
{
  "run_id": "2026-07-09T14-02Z-v3",
  "cases": [
    {
      "id": "c2-beacon-02",
      "detection_source": "behavioral",
      "expected": {"disposition": "malicious", "attack": ["T1071.001"], "min_rung": "records"},
      "predicted": {"disposition": "malicious", "confidence": "high", "highest_rung_used": "records", "attack": ["T1071.001"]},
      "scores": {"verdict_correct": true, "attack_overlap": 1.0, "grounded": true, "false_climb": false, "cost_usd": 0.44},
      "status": "pass",
      "artifacts": {"verdict": "eval/reports/2026-07-09T14-02Z-v3/c2-beacon-02/verdict.json",
                    "ledger": "eval/reports/2026-07-09T14-02Z-v3/c2-beacon-02/ledger.md"}
    }
  ]
}
```

`predicted` mirrors the fields the agent already writes to
`evidence/verdict.json` (disposition, confidence, `highest_rung_used`,
`detection_source`, attack), so the harness scorers just diff `predicted` vs
`expected`. **Regression** = a case whose `status` went `pass → fail` vs the
previous run; computed by the dashboard when it diffs consecutive per-run JSONs
(or stamped by the harness).

---

## 3. Architecture

A **build-time static-site generator** — a small Node ESM script (matches the
repo) that reads the contract files and writes self-contained HTML.

```
eval/
  reports/
    history.jsonl              # append-only run history (input)
    <run_id>.json              # per-run case detail (input)
    <run_id>/…                 # per-case verdict.json + ledger.md (from the harness)
    index.html                 # OUTPUT: aggregate trend dashboard
    <run_id>.html              # OUTPUT: per-run scorecard
  dashboard/
    build.js                   # generator: JSON → HTML
    render.js                  # HTML section builders (tiles, table, matrix…)
    charts.js                  # build-time inline-SVG chart helpers
    theme.css                  # brand tokens, lifted from the reporting templates
    fixtures/history.jsonl     # synthetic data to develop against
    fixtures/*.json
```

Run: `node eval/dashboard/build.js` → regenerates `index.html` +
one `<run_id>.html` per run. No watch server needed; open the file.

**Charting: build-time inline SVG, not a client library.** The generator computes
the polylines/scales in `charts.js` and emits static `<svg>` — same approach as
the mockup and the reporting templates' "inline everything, no external assets"
rule. This keeps the artifact viewable offline and in CI with no CDN dependency.
(Optional later: a progressive-enhancement Chart.js layer from an allowed CDN for
hover tooltips — deferred; not required.)

---

## 4. Components (map to the mockup)

Each is a pure function `(data) → htmlString` in `render.js`:

1. **Gate badge** — `PASS`/`FAIL` from `gate.pass`; red/green; lists
   `gate.reasons` on fail.
2. **North-star tiles** — false-close (hero, with target line + accent color),
   verdict accuracy, ladder adherence, cost/case; each with delta vs previous run.
3. **Progress-over-runs chart** (the centerpiece) — SVG line chart from
   `history.jsonl`: false-close, accuracy, adherence across runs; a dashed
   **autonomy-gate threshold**; **version annotations** from `label`/`skill_version`
   on the x-axis.
4. **Confusion matrix** — heatmap from `aggregates.confusion`; the
   malicious→benign cell flagged as the false-close driver.
5. **Confidence calibration curve** — from `aggregates.calibration` vs the ideal
   diagonal.
6. **Ladder-adherence breakdown** — stacked bar from `aggregates.adherence`
   (entered-right-rung / false-climb / under-investigated / under-corroborated).
7. **Per-case table** — from `<run_id>.json`: id, source, expected vs predicted,
   rung reached, cost, status; **regression rows flagged**; links to the case's
   `verdict.json`/`ledger.md`.
8. **Run-comparison / diff** — newly-failing (regressions) vs newly-passing cases
   between two runs.

Backends render as separate series/filters (Pi vs Claude differ on adherence and
cost).

---

## 5. Milestones

| # | Milestone | Deliverable | Acceptance |
|---|-----------|-------------|-----------|
| **M0** | Data contract + fixtures | Documented schemas (§2) + `dashboard/fixtures/` with ~3 synthetic runs | Fixtures validate against the schema; harness team can target them |
| **M1** | Per-run scorecard | `build.js` renders `<run_id>.html`: gate badge, tiles, confusion matrix, calibration, per-case table | Open a fixture run's HTML; every §4 component renders correctly offline |
| **M2** | Aggregate trend dashboard | `index.html`: north-star strip + progress-over-runs chart with gate threshold + version markers | Trend chart plots N runs; gate crossing is visually obvious |
| **M3** | Regressions + diff | Regression flagging in the table; run-vs-run diff view | A pass→fail case is flagged red; diff lists newly-failing/passing |
| **M4** | CI integration | `build.js` exit code from `gate.pass`; publishes HTML as a CI artifact | A regressed false-close fails the pipeline; artifact is downloadable |
| **M5** | Backend split + polish | Pi/Claude series toggle; empty/first-run and single-run states | Both backends chart independently; a 1-run history renders without a broken trend |

M0–M2 deliver a genuinely useful dashboard; M1 works the day the harness emits
one run. M0 can start immediately — it's just JSON + fixtures.

---

## 6. Dependencies and sequencing

- **Hard dependency:** the harness must emit the §2 contract. Coordinate M0 with
  the harness's scorer/runner so both sides agree on field names (they mirror
  `evidence/verdict.json`, which already exists).
- **Parallelizable:** M1–M3 build entirely against fixtures — no live harness
  needed. The dashboard and the harness can be built at the same time.
- **No new runtime deps** for the core path (Node stdlib + inline SVG). A dev-only
  JSON-schema validator (e.g. `ajv`) is optional for M0.

---

## 7. Testing and validation

- **Schema validation** of `history.jsonl` / `<run_id>.json` on load; the build
  fails loudly on a malformed run rather than rendering a silently-wrong chart.
- **Golden-HTML snapshot** of the fixture build so unintended rendering changes
  are caught in review.
- **Gate-logic unit tests** — `false_close_rate > target → pass:false` and the
  exit code follows.
- **Manual eyeball** in light and dark mode + print (the reporting-template
  themes carry over) — as we just did for the ladder strip.
- **Number hygiene** — round every displayed rate/cost; never leak float
  artifacts into the UI.

---

## 8. Risks and open questions

1. **Contract drift.** If the harness renames a field, the dashboard breaks
   silently. Mitigation: schema validation (M0) + the golden snapshot.
2. **Sparse early history.** With 1–2 runs the trend chart is nearly empty; M5
   must render a graceful single-run state, not a broken axis.
3. **LLM-judge scores are noisy** (groundedness). Display them as advisory, not
   gating; only false-close and (later) calibration gate.
4. **Where does history live** across CI runs — a results branch, an artifact
   store, or committed under `eval/reports/`? Decide at M4; the generator doesn't
   care where the JSONL comes from.
5. **Chart interactivity** — build-time SVG has no tooltips. If reviewers want
   hover detail, add the optional Chart.js layer; otherwise keep it static.

---

## 9. Rough effort

- **M0** contract + fixtures: ~0.5 day.
- **M1** per-run scorecard: ~1.5 days (tiles, matrix, calibration, table).
- **M2** trend dashboard + SVG chart helpers: ~1.5 days.
- **M3** regressions/diff: ~1 day.
- **M4** CI gate + artifact: ~0.5 day.
- **M5** backend split + edge states: ~1 day.

~6 developer-days for the full dashboard, front-loaded so M0–M2 (the useful core)
land in the first ~3.5 days and can run against fixtures immediately.
