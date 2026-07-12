# eval/dashboard — M0: data contract + fixtures

This is **milestone M0** of [PLAN-eval-dashboard.md](../../docs/PLAN-eval-dashboard.md):
the JSON contract the eval harness emits and the dashboard reads, plus synthetic
fixtures so the dashboard (M1+) can be built before the harness exists.

## Contract

- **`schema/history.schema.json`** — one record per eval run. The dashboard's
  trend view reads all of `history.jsonl`.
- **`schema/run.schema.json`** — the per-case detail for one run
  (`<run_id>.json`). `predicted` mirrors the fields the agent writes to
  `evidence/verdict.json`, so the harness scorers just diff `predicted` vs
  `expected`.

At runtime these live under `eval/reports/`:

```
eval/reports/
  history.jsonl          # append-only; one line per run (history.schema.json)
  <run_id>.json          # per-run case detail (run.schema.json)
  <run_id>/<case>/…      # the agent's verdict.json + ledger.md per case
  index.html             # generated: aggregate trend dashboard
  <run_id>.html          # generated: per-run scorecard
```

## Fixtures

A **consistent 20-case world** across four runs showing the intended arc — the
false-close rate falls `0.375 → 0.25 → 0.125 → 0.00` and the autonomy gate
(false-close < 5%) flips to PASS at v3:

- `fixtures/history.jsonl` — runs v0–v3 (aggregates + confusion + calibration).
- `fixtures/2026-07-07T16-05Z-v2.json` — v2 case detail (gate FAIL).
- `fixtures/2026-07-09T14-02Z-v3.json` — v3 case detail (gate PASS).

They exercise the dashboard's harder cases:
- **Regression:** `web-crawler-14` passes in v2, fails in v3 (`regressed_from`
  set) — must render red in the per-case table and in the v2→v3 diff.
- **Newly-passing:** `rdp-bruteforce-12`, `ldap-enum-27`, `beacon-fp-77` fail in
  v2 and pass in v3 — the other side of the diff.
- **Ladder signals:** `exfil-dns-23` over-climbs to packets (`false_climb`);
  `saas-sync-61` (v3) stops at metrics below its `records` min-rung
  (under-investigation, derived from `highest_rung_used` < `expected.min_rung`).
- **Detection source:** IDS cases (`ids-*`) vs behavioral, per the verified
  source rule.

## Invariants (what the harness must also honor)

For any run that has a `<run_id>.json`, the `history.jsonl` aggregates must be
**derivable** from the case array:

- `verdict_accuracy` = count(`status == pass`) / `case_count`.
- `false_close_rate` = count(expected malicious, predicted non-malicious) /
  count(expected malicious).
- `confusion[expected][predicted]` = case counts.
- `case_count` = length of `cases`.

The included `validate.py` checks these for v2 and v3.

## Validate

```bash
python3 eval/dashboard/validate.py         # checks fixtures against the invariants
# optional JSON-Schema check if you have ajv/check-jsonschema installed
```
