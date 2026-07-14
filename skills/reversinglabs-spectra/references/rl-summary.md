# RL Summary

`reversinglabs/rl-summary.html` is a deterministic, human-friendly
viewer for completed ReversingLabs enrichment. It is not an investigation
report, not a substitute for evidence, and not a place for network conclusions
or response recommendations.

## When to generate it

Generate the RL Summary once, after the ReversingLabs phase of the current turn
is complete and more than one RL lookup returned real results. Do not generate it after
every lookup: finish the planned presence, reputation, details, ticore, or
search calls first so the viewer contains the complete set for that phase.

If later work adds another successful RL response, regenerate the same summary
after that later RL phase. The deterministic renderer replaces only
`rl-summary.html`; it never changes or removes the source JSON.

Do not generate a summary for a single successful result, `status` alone, failed
calls, empty/not-found lookups, stderr, malformed JSON, or an unavailable integration.

## Invocation

From the workspace root, run:

```bash
node ./reversinglabs-summary reversinglabs
```

The renderer reads normalized `kind: "reversinglabs"` JSON files directly in
that directory, escapes all vendor-provided fields, and atomically writes:

```text
reversinglabs/rl-summary.html
```

Mention the file in the turn's chat response when it was created or refreshed.
The normal `investigation-reporting` skill remains authoritative for a later
SOC, threat-hunt, NOC/SRE, operational-health, informational, or PQC report.
