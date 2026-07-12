# eval/harness — Phase 0 runner + scorers

Turns labeled cases + agent results into the dashboard data contract
(`history.jsonl` + `<run_id>.json`). Design: [../../docs/DESIGN-eval-harness.md](../../docs/DESIGN-eval-harness.md).

```
cases  ──►  agent run  ──►  verdict.json per case  ──►  score.js  ──►  history.jsonl + <run>.json  ──►  build.js  ──►  dashboard
(eval/cases)   (runner.js /        (results dir)         (deterministic)      (eval/reports)          (eval/dashboard)
                offline recorded)
```

## Pieces

- **`score.js`** — pure, deterministic scorer. `(cases, results, meta, prevDetail) → { record, detail }`.
  Computes verdict accuracy, **false-close rate**, confusion matrix, ladder
  adherence (from the rung actually reached vs. the case's `min_rung`), calibration
  by stated confidence, attack overlap, cost, per-case regression flags, and the
  gate verdict. Unit-tested in **`score.test.js`** (`node --test eval/harness/score.test.js`).
- **`cases.js`** — loads + validates ground-truth cases from `eval/cases/*.json`.
- **`run-eval.js`** — CLI that ties it together and writes the contract.
- **`runner.js`** — SCAFFOLD live driver (see below).

## Run it (offline — reproducible, no live app)

Score a set of already-captured per-case verdicts:

```bash
node eval/harness/run-eval.js \
  --cases eval/harness/example-cases \
  --results eval/harness/example-results \
  --reports eval/reports \
  --run-id 2026-07-09-a --skill-version evidence-ladder@a --backend claude --check
node eval/dashboard/build.js --data eval/reports --out eval/dashboard/out
```

`<results>/<caseId>/verdict.json` is the agent's `evidence/verdict.json`;
optional `<results>/<caseId>/meta.json` adds `{ cost_usd, tokens, grounded }`.
`--check` exits non-zero if the run's gate fails (CI). Regressions are detected
automatically against the previous same-backend run in `history.jsonl`.

`eval/harness/example-cases/` + `example-results/` are a synthetic worked set for
demos and tests. The **real** ground-truth cases live in `eval/cases/` (default
`--cases`); run those against captured verdicts or a live app (`--live`).

## Run it in the app (preferred) — one API call, no script

The running app can run the whole set itself. Eval sessions run **read-only**
(per-session broker guard) with memory off, so this is safe alongside real work,
and cost is captured natively from each session (no meta.json needed):

```bash
curl -s -XPOST localhost:3100/api/eval/run -H 'content-type: application/json' -d '{"backend":"claude"}'
curl -s localhost:3100/api/eval/status      # progress + gate + aggregates
curl -s localhost:3100/api/eval/runs        # history.jsonl records
```

`POST /api/eval/run` scores `eval/cases` in the background (reuses
`lib/eval-runner.js` → `score.js`) and appends to `eval/reports/`. For a fully
isolated, separate read-only instance instead (leaving production untouched),
use `scripts/run-eval-live.sh` / `docker-compose.eval.yml`.

## Run it (external, isolated instance) — the docker eval profile

To run against a **separate** read-only instance so production is never touched,
use `scripts/run-eval-live.sh` (one command): it rebuilds the image, starts an
`eh-eval` project on port 3101 with `EH_BROKER_READONLY=1` and memory off, runs
the harness, builds the dashboard, and tears down. `run-eval.js --live --url`
drives that instance through the app HTTP API via `runner.js` (a full,
tool-enabled session — **not** the tool-less `runOneShot()`).

Safety is in place: the broker rejects write-class tools both process-wide
(`EH_BROKER_READONLY=1`) and per read-only session (see `lib/excli-readonly.js`).
The in-app path above is preferred for routine use; this isolated profile is for
when you want production completely out of the picture. Note: the HTTP `runner.js`
path does not capture cost/tokens (the in-app path does) — see the `TODO(cost)`
in `runner.js`.
