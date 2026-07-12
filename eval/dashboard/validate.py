#!/usr/bin/env python3
"""Validate the eval-dashboard fixtures against the data-contract invariants.

Checks, for every run that has a <run_id>.json detail file, that the aggregates
in history.jsonl are actually derivable from the per-case array. Exits non-zero
on any mismatch so this can run in CI. Pure stdlib; no dependencies.
"""
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
FIX = HERE / "fixtures"
DISPOSITIONS = ["malicious", "benign", "false-positive", "benign-authorized"]


def load_history():
    runs = {}
    for line in (FIX / "history.jsonl").read_text().splitlines():
        line = line.strip()
        if not line:
            continue
        rec = json.loads(line)
        runs[rec["run_id"]] = rec
    return runs


def check_run(run_id, agg, detail):
    errs = []
    cases = detail["cases"]
    n = len(cases)

    if agg["case_count"] != n:
        errs.append(f"case_count {agg['case_count']} != {n} cases in detail")

    passed = sum(1 for c in cases if c["status"] == "pass")
    acc = round(passed / n, 4)
    if abs(acc - agg["aggregates"]["verdict_accuracy"]) > 0.011:
        errs.append(f"verdict_accuracy {agg['aggregates']['verdict_accuracy']} != derived {acc}")

    mal = [c for c in cases if c["expected"]["disposition"] == "malicious"]
    false_close = sum(1 for c in mal if c["predicted"]["disposition"] != "malicious")
    fc_rate = round(false_close / len(mal), 4) if mal else 0.0
    if abs(fc_rate - agg["aggregates"]["false_close_rate"]) > 0.011:
        errs.append(f"false_close_rate {agg['aggregates']['false_close_rate']} != derived {fc_rate}")

    # confusion matrix
    conf = {e: {p: 0 for p in DISPOSITIONS} for e in DISPOSITIONS}
    for c in cases:
        e, p = c["expected"]["disposition"], c["predicted"]["disposition"]
        conf[e][p] += 1
    agg_conf = agg["aggregates"].get("confusion", {})
    for e in DISPOSITIONS:
        for p in DISPOSITIONS:
            got = agg_conf.get(e, {}).get(p, 0)
            if got != conf[e][p]:
                errs.append(f"confusion[{e}][{p}] {got} != derived {conf[e][p]}")

    # status vs verdict_correct consistency
    for c in cases:
        want = "pass" if c["scores"]["verdict_correct"] else "fail"
        if c["status"] != want:
            errs.append(f"case {c['id']}: status {c['status']} != verdict_correct {c['scores']['verdict_correct']}")

    # gate consistency
    tgt = agg["gate"]["false_close_target"]
    if agg["gate"]["pass"] != (fc_rate <= tgt):
        errs.append(f"gate.pass {agg['gate']['pass']} inconsistent with fc_rate {fc_rate} vs target {tgt}")

    return errs


def main():
    runs = load_history()
    total_errs = 0
    checked = 0
    for run_id, agg in runs.items():
        detail_path = FIX / f"{run_id}.json"
        if not detail_path.exists():
            print(f"skip  {run_id}  (history-only, no detail file)")
            continue
        detail = json.loads(detail_path.read_text())
        if detail["run_id"] != run_id:
            print(f"FAIL  {run_id}  detail run_id mismatch: {detail['run_id']}")
            total_errs += 1
            continue
        errs = check_run(run_id, agg, detail)
        checked += 1
        if errs:
            total_errs += len(errs)
            print(f"FAIL  {run_id}")
            for e in errs:
                print(f"        - {e}")
        else:
            print(f"ok    {run_id}  ({agg['case_count']} cases, "
                  f"acc={agg['aggregates']['verdict_accuracy']}, "
                  f"false_close={agg['aggregates']['false_close_rate']}, "
                  f"gate={'PASS' if agg['gate']['pass'] else 'FAIL'})")

    print(f"\n{checked} run(s) with detail checked; {total_errs} error(s).")
    sys.exit(1 if total_errs else 0)


if __name__ == "__main__":
    main()
