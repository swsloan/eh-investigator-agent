# Design & threat model: agent activity audit trail (#30, Phase 5)

Regulated operators need a **durable, tamper-evident, exportable record of
everything the agent did** in an investigation, so an auditor can reconstruct and
trust its behavior after the fact. Today activity is live in the UI and partially
persisted (`.actions/*.json`, evidence files) but there is no single,
integrity-protected, exportable record. This doc is the threat model and design
the issue requires **before** implementation (the mechanism is HIGH-risk:
integrity crypto, key management, and retention of telemetry-derived content).

## Guarantee, stated honestly

The trail is **tamper-EVIDENT**, not tamper-*proof*. The layers and exactly what
each defeats:

| Layer | Mechanism | Defeats | Does NOT defeat |
| --- | --- | --- | --- |
| 1 Append-only hash chain | each entry stores `hash = H(prevHash ‖ canonical(entry))` | edit / reorder / delete / truncate by anyone **without** the signing key | someone with the signing key re-forging the whole chain |
| 2 Hash the redacted form | run the central redactor, then hash what is actually stored | secrets entering the digest or record; storage/verify divergence | — |
| 3 Signed session seal | sign the chain head with an app-held Ed25519 key at finalize | forgery by anyone without the private key; proves authenticity offline | an attacker who **holds** the private key |
| 4 External anchor (pluggable) | emit the signed seal digest to a place the app can't alter (SIEM/syslog, S3 Object Lock/WORM, transparency log) | wholesale re-forging by a host-compromised attacker who holds the key | destinations the operator never configured |
| 5 Offline verifier | recompute chain + check signature over an export | — (it *reports*, doesn't prevent) | — |

**Documented boundary:** layers 1–3 give tamper-evidence against anyone *without*
the signing key — sufficient for the common "prove nobody edited the record"
compliance need, on a single trusted host. Only layer 4 (external anchor / WORM)
resists a **fully compromised host** that holds the signing key. We state this
limit explicitly so compliance knows what the on-box guarantee is and isn't.
Storage-layer WORM (Docker volume → object store with object-lock retention) is a
complementary path many regimes accept and may substitute for app-level crypto.

## What is captured

One append-only trail per session at `<workspace>/audit/trail.jsonl`. Each entry
is a small, structured, **already-redacted** record. At minimum, per the scope:

- **tool call** — name, redacted argument summary, UTC timestamp, outcome;
- **ExtraHop query → evidence** — the query and the evidence artifact path it
  produced (referenced, not copied);
- **write proposal → human decision → execution outcome** — referenced from the
  `.actions/*.json` record (see convergence below), including the #23
  before/after/verification result;
- **model + reasoning level** used;
- **safety events** (#32) and **memory captures** as they occur;
- **final verdict / disposition**.

Source of truth for capture is the session **event stream** (`AgentSession`
already emits every meaningful action, redacted, via `pushEvent`), plus the
action-store transitions and `evidence/verdict.json`. The trail is a durable,
hash-chained **projection** of that stream — it does not re-run the agent or
change any behavior (capture is observe-only).

## Redaction (layer 2)

Events arrive already redacted by the session redactor; the audit layer runs the
**central redactor again** over the canonical entry immediately before hashing and
writing, so the hash covers exactly the redacted stored bytes and no secret can
enter the digest even if an upstream redaction were missed. A negative test
asserts no configured secret/credential appears in the record or its hash inputs.

## Schema convergence with #23

`.actions/*.json` remains the **source of truth** for the governed-write path
(proposal/decision/verification from #23); existing clients keep reading it
unchanged (backward compatible). The audit trail **references** action records by
id and records the same lifecycle as chained entries, rather than forking a second
write-audit store. One shared entry vocabulary: `{ seq, at, actor, type, ref?,
summary, outcome? }` where `type` ∈ {tool_call, extrahop_query, action_proposed,
action_decided, action_result, memory_capture, safety_event, verdict, seal}.

## Keys, sealing, rotation

- The **Ed25519 signing key** lives in the secret store (new secret field), 0600,
  never in the worker env (already scrubbed by the #24 infra-secret list — add it
  there). The **public key + key id** are recorded in the seal so an auditor
  verifies offline; historical public keys are retained across rotation so old
  records still verify.
- **Seal trigger.** Sessions here are long-lived with no hard "close", so the seal
  is written at an explicit **finalize/export** (`POST /api/sessions/:id/audit/seal`,
  and implicitly when the trail is exported), and optionally on session delete.
  After a seal, further activity opens a new chain segment that must be re-sealed.
  This is stated so a reviewer knows a trail is only authenticity-guaranteed up to
  its latest seal.

## Actor attribution

Per-user attribution depends on #24's authenticated multi-user deployment, which
is **out of scope** for #30. Entries record `actor: "local"` today; the field is
present so per-user identity slots in when #24's separate-worker/auth work lands.

## Retention & persistence

The JSONL trail is a plain file in the persisted workspace volume, so it survives
restarts already. A configurable **retention policy** (max age / max size, default
keep-all) governs pruning; pruning a sealed, exported, and (if configured)
externally-anchored trail is safe because the external anchor is the long-term
record. Retention never edits a trail in place — it removes whole sealed trails.

## Slices

- **0 — this doc.** ✅
- **A — core:** ✅ `lib/audit-trail.js` (append + hash chain + canonical JSON +
  `verifyTrail`), `lib/audit-coordinator.js` capture wiring, `GET
  /api/sessions/:id/audit` + `/audit/export`, `scripts/verify-audit.js`.
- **B — signed seal + key mgmt:** ✅ `lib/audit-keys.js` (Ed25519 keypair in the
  secret store; keyId = sha256(pubDER); rotation). `AuditTrail.seal()` appends a
  chained `seal` entry embedding `{root, sig, keyId, pubKey, alg}` so an export
  verifies **offline** with no external key file. `verifyTrail` reports
  `{sealed, seal:{keyId, ok}, unsealedAfterSeal}` and accepts `trustedKeyIds` to
  pin against known keys. `POST /api/sessions/:id/audit/seal` seals at finalize;
  the CLI reports authenticity. Rotation keeps old seals verifiable via their own
  embedded key (no historical registry needed).
- **C — pluggable external sink (layer 4):** ✅ `lib/audit-sink.js`. On seal, the
  non-secret seal **digest** (`{sessionId, keyId, root, alg, sealedAt}` — no
  signature, no key material) is emitted to a configured destination, best-effort
  (fire-and-forget; a down sink never blocks or fails the local seal). Built-in
  types: **`file`** (append-only JSONL — point it at a WORM mount) and **`http`**
  (POST to a SIEM/webhook, optional bearer). Config is environment-first:
  `EH_AUDIT_SINK` (`none`|`file`|`http`), `EH_AUDIT_SINK_PATH`,
  `EH_AUDIT_SINK_URL`, `EH_AUDIT_SINK_TOKEN` (put a production token in the secret
  store / a secret env). S3 Object Lock and a syslog/transparency-log sink use the
  same interface and are operator-validated against real infra. This external,
  independent record of `(keyId, root)` is what detects a host-compromise re-forge
  — comparing the anchored root to the exported trail's seal.
- **D — retention + export UI + e2e runbook.**

## Failure modes

- **Missed redaction upstream** → mitigated by the layer-2 re-redaction before
  hashing; negative test.
- **Lost/rotated signing key** → old public keys retained; a record whose key id
  is unknown fails authenticity (reported precisely), integrity still checkable.
- **Partial write / crash mid-append** → append is one line; a truncated final
  line is detected by the verifier as a broken tail, not silently accepted.
- **Compromised host with the key** → out of on-box scope; layer 4 / WORM is the
  only defense, and the boundary is documented above.
