# Audit-trail end-to-end validation runbook (#30)

The manual acceptance check for the Phase 5 audit trail, per the issue's validation
plan: run a real investigation on a disposable instance, export the trail, verify
it, tamper with a copy, confirm detection, and confirm it reconstructs the session.
The unit/integration suite already covers the mechanics; this is the human
sign-off. Run it on a throwaway instance, never against a live deployment.

## 1. Produce a trail

Run a real investigation (any detection triage that pulls evidence and reaches a
verdict). The trail is written to `<workspace>/audit/trail.jsonl` as the agent
works — tool calls, the write-action lifecycle, safety events, memory captures,
and the final verdict.

## 2. Seal + export (UI)

Session menu (⋮) → **Export audit trail**. This seals the trail (signs the chain
head) and downloads `audit-<session>.jsonl`. Equivalent API:

```bash
curl -X POST http://127.0.0.1:3100/api/sessions/<id>/audit/seal
curl -sO http://127.0.0.1:3100/api/sessions/<id>/audit/export   # or GET .../audit for the integrity summary
```

## 3. Verify (offline)

```bash
node scripts/verify-audit.js audit-<session>.jsonl
```

Expect:

```
OK — chain intact: N entries, head <hash>…
SEALED — signature verifies against key <keyId>.
```

Confirm you can **reconstruct the investigation** from the JSONL alone: the tool
calls, the ExtraHop queries and their evidence artifacts, each write proposal +
decision + outcome, the model, and the verdict are all present and ordered.

## 4. Tamper — confirm detection

On a **copy**, exercise each tamper and confirm the verifier localizes it:

```bash
cp audit-<session>.jsonl tampered.jsonl
# edit any entry's content (e.g. change a summary) in tampered.jsonl, then:
node scripts/verify-audit.js tampered.jsonl      # → TAMPERED — chain broke at entry index K: content was altered
# delete a middle line → TAMPERED (reorder/deletion)
# forge the seal signature bytes → OK chain / SEAL INVALID
```

Exit code is `0` only for an intact, sealed trail; `1` for tampered / unsealed.

## 5. External anchor (optional, layer 4)

If a sink is configured (`EH_AUDIT_SINK=file` with `EH_AUDIT_SINK_PATH`, or
`http` with `EH_AUDIT_SINK_URL`), confirm the seal digest lands in it and its
`root` + `keyId` match the exported trail's seal entry:

```bash
tail -1 "$EH_AUDIT_SINK_PATH"      # { "type":"audit_seal", "root":"…", "keyId":"…", … }
```

This is the record that detects a host-compromise re-forge: the anchored `root`
won't match a forged chain.

## 6. Retention (optional)

With `EH_AUDIT_RETENTION_DAYS` / `EH_AUDIT_RETENTION_MAX` set, restart and confirm
that only **sealed** trails past the policy are pruned, unsealed trails are kept,
and sessions/workspaces are untouched. Default (unset) keeps everything.

## Sign-off

Record date + who, the app/image version, and that steps 1–4 passed (5–6 if those
features are configured). The documented guarantee boundary — on-box
tamper-evidence (layers 1–3) vs. external-anchor resistance to a compromised host
(layer 4) — is in [DESIGN-audit-trail.md](DESIGN-audit-trail.md).
