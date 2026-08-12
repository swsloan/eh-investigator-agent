# Safety / boundary event log (#32)

The "safety" facet of agent auditing, split from the #30 activity trail. A
per-session, reviewable record that the guarded boundary **held** — evidence the
agent was not turned against the user, and a window into exactly what the
adversarial telemetry tried.

## What it records

Six boundary events, each captured **where the guard already fires** (the guard
behavior is unchanged — see invariants):

| Kind | Source | Meaning |
| --- | --- | --- |
| `injection_suspected` | `lib/telemetry-taint.js` `wrapUntrusted` flags, at the excli broker | Untrusted wire content contained text resembling instructions; it was flagged and enveloped as DATA, **not obeyed**. |
| `write_refused` | excli broker read-only path | A write-class excli call was denied on the agent's read-only socket. |
| `secret_redacted` | `containsSecretMaterial` gate in the message route | Secret material was detected in inbound content and blocked before it reached the model. |
| `ssrf_blocked` | research fetch guard (`lib/research/fetch.js`) | A research fetch to a local/internal/non-public destination was denied. |
| `exfil_blocked` | research fetch guard | An outbound fetch exceeded the response-size guard. |
| `unattended_proposal` | action broker propose path (#137) | A write was proposed while no human was present (eval/background run, or nobody viewing the session); it awaits deferred review in the approvals queue. Records the tool and the presence reason — never the params. |

## Two hard invariants

1. **Observe-only.** Recording an event never changes guard behavior. Every tap
   records and then does exactly what it did before, and `recordSafetyEvent` never
   throws — a safety-log failure is swallowed so it can never disrupt a security
   guard. (`lib/excli-broker.js`, `lib/research-broker.js`, and `routes/sessions.js`
   each add a single additive `recordSafetyEvent(...)` call.)
2. **No secrets, no payloads.** This is a security log that observes adversarial
   text and secret-adjacent events, so it must never itself leak them.

## Threat model: why no payload text is retained

The log records **flags, reasons, counts, and a short non-reversible fingerprint**
— never the injected payload or a secret value. Retaining the raw adversarial text
or the redacted secret would turn the audit log into the exfiltration channel it
exists to catch. Two layers enforce this:

- `sanitizeDetail` drops everything except a small allowlist (`flags`, `source`,
  `tool`, `reason`, `host`, `kinds`, `count`, `fingerprint`) and bounds every
  value's length, so a tap physically cannot attach a payload/secret field.
- Every event is then passed through the session's own redactor by
  `AgentSession.pushEvent` before it is stored or emitted (defense in depth).

For injection, the 16-char SHA-256 `fingerprint` lets a reviewer count and
correlate repeat attempts without the payload ever being written down. A negative
test (`lib/safety-log.test.js`) asserts that a payload/secret passed in `detail`
does not appear in the stored event.

## Surfaces

- **In-app:** `GET /api/sessions/:id/safety` (read-only) returns the per-session
  summary — `{ total, by_kind, injection_flags, events[] }`, all payload-free.
- **Eval harness:** each case record gains `safety_events` (the count observed
  during the run), so an injection-probe eval shows the boundary catching attempts.

A dedicated in-app safety **panel** is a natural fast-follow; the endpoint already
makes the data consumable.

## Validation

- `lib/safety-log.test.js` — each event kind records; unknown kinds/missing
  sessions are rejected; a throwing session is swallowed (observe-only); the
  **negative test** proves no payload/secret is stored; summary aggregation.
- `routes/sessions-safety.test.js` — the HTTP surface + 404.
- Operator: drive the injection-probe harness (`eval/injection-*`) and confirm
  `injection_suspected` events appear, and that no secret/credential is present in
  the safety log.
