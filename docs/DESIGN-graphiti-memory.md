# Design: Graphiti Temporal-Memory Integration

Status: **Draft / pre-implementation**
Owner: scottsl@extrahop.com
Last updated: 2026-07-08

Adds a persistent, temporal knowledge-graph memory layer (Graphiti) to the
ExtraHop Investigation Agent so the agent remembers, across sessions and
analysts: prior investigations and their verdicts, the network environment
(device roles, segments, known-good talkers), **identities** (any
authenticating actor), and analyst preferences — and can reason about how
those facts change over time.

---

## 1. Goals / non-goals

**Goals**
- Cross-session, cross-analyst recall of durable conclusions.
- Temporal reasoning: "what did we believe about X, and when did it change?"
- Native plug-in to both agent backends (Pi, Claude Code) via MCP.
- Local-first by default; nothing leaves the host unless deliberately configured.

**Non-goals**
- Not a source of truth — RevealX (live records/metrics) remains authoritative.
- Not a per-turn conversational cache. Memory stores *derived conclusions*, not raw evidence.
- Not a cloud memory service.

---

## 2. Decisions log

| # | Decision | Choice |
|---|----------|--------|
| D1 | Graph store | **FalkorDB** (Redis-based, single sidecar; on-disk in a named volume). *Revised from Kuzu, which Graphiti has deprecated (0.11.2).* Neo4j is the heavier alternative. |
| D2 | Extraction LLM + embedder | **Configurable/pluggable, chosen independently in app Settings.** Local Ollama is the default; OpenAI / Azure OpenAI / Anthropic / Gemini / any OpenAI-compatible endpoint are opt-in. Non-local selections show a "content leaves the host" warning. **Note:** Anthropic provides no embeddings API, so choosing Anthropic as the extraction LLM requires a separate embedder (OpenAI / Voyage / Gemini / local Sentence-Transformers). Graphiti's Anthropic client also needs a real `ANTHROPIC_API_KEY` — distinct from the Claude Code backend's subscription OAuth login. |
| D3 | Isolation | **`group_id` per monitored environment** (keyed on the RevealX host). **Must be sanitized to alphanumeric** — FalkorDB's RediSearch rejects hyphens/dots in the group_id (breaks fulltext dedup). Hash or strip the host. |
| D4 | Delivery to agent | Graphiti **MCP server** registered to both backends + a new `investigation-memory` skill governing read/write protocol. |
| D5 | Identity scope | **Any authenticating actor** — on-prem principals (AD/Kerberos users, service & admin accounts), cloud/federated (Entra ID, Okta, IAM roles), local machine accounts, and non-human credentials (API keys/tokens, certs). Distinct from `Analyst`. |
| D6 | Identity value storage | **Cleartext** (usernames/principals stored as-is for correlation value). |
| D7 | Capture cadence | At investigation close + explicit disposition change; hooked to the existing Challenger completion trigger. Not per-turn. |
| D8 | Read cadence | Once at investigation start / triage, seeded with in-scope entities. |

---

## 3. Architecture

```
                            Host (localhost only)
┌──────────────────────────────────────────────────────────────────────┐
│  Browser  ──►  Express app (eh-investigator)                           │
│                 │  backends/: Pi (RPC)  |  Claude Code (Agent SDK)      │
│                 │                                                       │
│                 │  (A) excli broker ──► bin/excli ──► RevealX API       │  creds isolated (unchanged)
│                 │                                                       │
│                 │  (B) MCP client ────────────────┐                    │
│                 └──────────── redaction (secrets) ─┼────────────────┐  │
│                                                    ▼                │  │
│                                        Graphiti MCP server (sidecar)│  │
│                                          add_memory / search_nodes  │  │
│                                          / search_memory_facts      │  │
│                                            │            │           │  │
│                                            ▼            ▼           │  │
│                                     FalkorDB (Redis)  Extraction    │  │
│                                     graph volume      provider ─────┘  │
│                                     (per-env group_id)  (Ollama local  │
│                                                          default, or   │
│                                                          configured    │
│                                                          cloud LLM +   │
│                                                          embedder)     │
└──────────────────────────────────────────────────────────────────────┘
```

The excli/credential boundary is untouched. Graphiti never receives ExtraHop
API credentials — only derived facts. All state persists in Docker volumes.

New Compose services: `graphiti` (MCP server), `falkordb` (graph store, its own
volume), and `embeddings` (local llama.cpp embedding server; see §12b — was
`ollama` until 2026-07-20). Extraction defaults to cloud Anthropic; local
extraction is opt-in via `LLM_PROVIDER=openai`.

---

## 4. Ontology (prescribed schema)

### Entities
- `Device` — role, criticality, MAC, segment membership.
- `Identity` — **any authenticating actor** (D5). Sub-typed:
  - `user` (AD/Kerberos), `service_account`, `admin`/privileged,
  - `cloud`/`federated` (Entra ID, Okta, IAM role/user, SSO principal),
  - `local` (machine/local accounts),
  - `machine_credential` (API keys, tokens, client certs, service principals).
  Attributes: principal/username (**cleartext**, D6), domain/tenant, privilege
  level, account type, source (AD / cloud IdP / local / observed).
- `Endpoint` / `ExternalIP`, `NetworkSegment` (VLAN/subnet, zone: PCI/DMZ/…),
  `DetectionType`, `Detection`, `Investigation`, `Analyst`, `Disposition`
  (malicious / benign / false-positive / benign-authorized), `MitreTechnique`,
  `IOC` (domain/hash/IP), `Service`, `Group` (AD/IdP group).

### Temporal edges (validity-tracked: `t_valid`/`t_invalid`)
- `Detection —INVOLVES→ Device` (offender/victim), `—OF_TYPE→ DetectionType`, `—MAPS_TO→ MitreTechnique`
- `Device —HAS_ROLE→ Role`, `—MEMBER_OF→ NetworkSegment`, `—COMMUNICATES_WITH→ Endpoint`, `—CLASSIFIED_AS→ authorized-scanner / DC / backup / …`
- **`Identity —AUTHENTICATED_TO / LOGGED_IN_ON→ Device`** ← identity↔device affinity over time; lateral-movement / credential-abuse signal
- `Identity —INVOLVED_IN→ Detection`, `—MEMBER_OF→ Group`, `—HAS_PRIVILEGE→ …`, `—USED_FROM→ Endpoint`
- `Investigation —CONCLUDED→ Disposition` (about a Device / Detection / Identity) ← primary temporal edge
- `Analyst —PERFORMED→ Investigation`, `Analyst —PREFERS→ …`
- `Endpoint —FLAGGED_AS→ IOC`

---

## 5. Extraction provider (D2)

Extraction (entity/edge extraction from episodes) and embeddings are a
**pluggable provider**, configured in the app Settings UI, mirroring the
existing agent backend/model selection pattern. LLM and embedder are selectable
**independently**.

Proposed `config.json` addition:

```jsonc
"memory": {
  "enabled": false,
  "groupIdSource": "extrahop-host",   // isolation key (D3)
  "extraction": {
    "llm":      { "provider": "ollama", "model": "", "baseUrl": "http://ollama:11434" },
    "embedder": { "provider": "ollama", "model": "nomic-embed-text", "baseUrl": "http://ollama:11434" }
  }
}
```

- Providers: `ollama` / OpenAI-compatible (local, default), `openai`,
  `azure-openai`, `anthropic`, `gemini`. Exact Graphiti support matrix to be
  confirmed in Phase 0.
- Provider API keys follow the app's existing secret-store pattern (Keychain /
  Secret Service / memory), **not** `config.json`.
- Any non-local provider surfaces a UI warning that investigation-derived
  content will be sent to that provider for extraction/embeddings.
- The app passes the resolved provider config to the `graphiti` sidecar via env.

---

## 6. Investigation lifecycle

**Read (kickoff / triage, D8):** before digging in, the agent calls
`search_memory_facts` / `search_nodes` seeded with in-scope entities (offender IP,
victim device, detection type, **any identities involved**) and receives prior
dispositions, known device/identity roles, recurring history, and the current
analyst's preferences. One call at start; run async so it doesn't block.

**Write (close / disposition, D7):** triggered by the existing Challenger
"completed investigation with non-upload evidence" hook. The agent emits a
compact structured episode (JSON) derived from the report's `[Observed]` /
`[Assessed]` sections plus the disposition, then calls `add_memory`.

**Redaction on write:** episode text passes through `redaction.js`, which
scrubs `EXTRAHOP_*` secrets and secret-store values **but deliberately
preserves identity principals/usernames** (cleartext per D6). Consequence: the
graph volume contains sensitive identity data — treat it as sensitive at rest
(§8).

**What is written:** conclusions/characterizations only — never raw packets,
secrets, or full evidence blobs.

---

## 7. Use cases

1. **Repeat false-positive suppression** — recurring detection on a host the
   agent recalls was concluded benign (authorized scanner) 3× in 90 days.
2. **Environment baseline / role awareness** — recalls a host is a domain
   controller in the PCI segment and weights severity accordingly.
3. **Temporal reclassification** — a previously-benign host now contradicted by
   new beaconing; surfaced via `t_invalid` transition.
4. **Identity-centric lateral movement** — a service account normally seen on
   host A now authenticating from host B; the agent flags the affinity change
   using `AUTHENTICATED_TO` history.
5. **Compromised-credential recall** — an identity flagged in a prior
   credential-access detection reappears; agent pivots to its known
   device/endpoint footprint.
6. **Cross-investigation IOC correlation** — an external IP flagged as C2 in a
   different investigation last month reappears.
7. **Analyst persona** — report tailored to the analyst's stated preferences
   (e.g., always pull PCAP for C2-class detections).
8. **Threat-hunt seeding** — "devices historically classified as scanners" /
   "detection types most often concluded FP here."

---

## 8. Security & governance

- **Credential boundary intact** — Graphiti never receives ExtraHop API creds;
  the excli broker path is unchanged.
- **Secret redaction on write**; identity usernames intentionally preserved (D6).
- **Sensitive graph at rest** — because identities are cleartext, the Kuzu
  volume holds sensitive data; restrict volume perms (same class as
  `workspaces/`), consider encryption-at-rest.
- **Local extraction default** (Ollama) — no content leaves the host unless a
  cloud provider is explicitly configured (D2), which warns the user.
- **Per-environment isolation** via `group_id` (D3); one console monitoring
  multiple sites keeps separate graphs.
- **Retention / decay** — dispositions and identity↔device affinities carry a
  TTL; stale beliefs are bi-temporally invalidated to force re-validation
  rather than silently misleading.
- **Auditability** — Graphiti provenance links each fact to its source episode;
  surface later in a "Memory" UI panel (what the agent recalled and why).

---

## 9. Rollout (phased)

- **Phase 0 — PoC:** stand up `graphiti` + `falkordb` (+ `ollama` for the local
  comparison) sidecars; validate extraction quality on 10–20 sample reports.
  Cloud-first: Anthropic extraction LLM + an embedder (local Sentence-Transformers
  or OpenAI), then re-run the same samples on local Ollama to measure the
  quality gap. Requires a real `ANTHROPIC_API_KEY`.
- **Phase 1 — Read path:** MCP server + `investigation-memory` skill; agent
  queries memory at kickoff; graph seeded manually. Zero write risk.
- **Phase 2 — Write path:** Challenger completion hook + redaction → `add_episode`; lock ontology.
- **Phase 3 — Persona/baseline + governance:** seed environment baseline (DCs,
  segments, authorized scanners, key identities), analyst prefs, retention/decay, "Memory" UI panel.
- **Phase 4 — Correlation & hardening:** cross-investigation IOC/identity
  correlation, per-tenant isolation productionization, metrics.

---

## 10. Metrics
Time-to-verdict on recurring detections; % of investigations where memory
surfaced a relevant prior fact; false-positive re-investigation rate;
identity-affinity change detections; analyst-rated recall usefulness; kickoff
token reduction.

---

## 11. Open risks / questions
- Extraction quality with a *local* model (biggest technical risk; may push
  toward a cloud provider or larger local model — mitigated by D2 flexibility).
- Graph noise/contradiction management as it grows (mitigated: conclusions-only + decay).
- Kickoff latency from the read step (mitigate: scoped queries, async).
- `group_id` derivation when one console monitors many environments.
- Agent discipline (read-at-start / write-at-close) — skill-driven; may need a
  light server-side nudge rather than pure prompt reliance.
- Cleartext-identity data-at-rest posture — confirm acceptable for target
  deployments or add optional volume encryption.

---

## 12. Phase 0 results (2026-07-08) — cloud (Anthropic) path validated

Stood up `falkordb` + `ollama` + a custom `graphiti-mcp` as Compose sidecars
(loopback-published, internal network). Anthropic (`claude-sonnet-5`) for
extraction, local Ollama `nomic-embed-text` for embeddings, FalkorDB store.
Validated end-to-end: `add_memory` → extraction → `search_memory_facts`.

A single sample investigation episode extracted cleanly into the ExtraHop
ontology: Devices `10.0.20.5 (WIN-BACKUP01)` / `10.0.10.4 (DC01)`, Identity
`svc_backup`, Analyst `scottsl` (correctly distinguished from Identity),
DetectionType `Lateral Movement`, NetworkSegment `PCI`, Service `SMB`,
Disposition `benign-authorized false positive` — with edges incl.
`svc_backup AUTHENTICATED_TO DC01`, `DC01 LOCATED_IN PCI`,
`Lateral Movement HAS_DISPOSITION benign-authorized FP`, and the analyst
`PREFERS_ACTION_FOR C2` preference. A kickoff-style fact search returned all the
relevant priors. Extraction quality on the cloud path is strong.

### Fixes required (captured in `graphiti/Dockerfile` and `graphiti/config.yaml`)
1. **Anthropic package missing** — `zepai/knowledge-graph-mcp:standalone` ships
   without the anthropic extra; Graphiti fell back to "No LLM client." Fix: layer
   `anthropic` into the app venv.
2. **DNS-rebinding Host check** — MCP SDK's FastMCP auto-allows only
   localhost/127.0.0.1, returning HTTP 421 for the `graphiti-mcp` service name.
   Fix: disable rebinding protection on this internal, loopback-only service.
3. **`temperature` rejected** — newest Anthropic models (claude-sonnet-5)
   deprecate `temperature`; graphiti-core always sends it (null → "must be a
   number"; number → "deprecated for this model"). Fix: patch the client to omit it.
4. **group_id with hyphen** — FalkorDB RediSearch syntax error on `poc-extrahop`.
   Fix: alphanumeric group_id (see D3).

### Embedder note
The MCP server exposes only cloud embedders (openai/azure/gemini/voyage), not the
core library's in-process sentence-transformers. To keep embeddings local
(Option A intent) we point the "openai" embedder at Ollama's OpenAI-compatible
endpoint (`nomic-embed-text`, 768-dim). Only extraction text reaches Anthropic.

### Still open
- Model-id currency: `claude-sonnet-5` worked; confirm the best/cheapest
  extraction model (haiku-class) for cost.
- App-side MCP wiring (Phase 1) — not started; validated via the `claude` CLI
  with an API key, since the Claude Code backend login was not completed.

### Phase 0 part 2 — local (qwen2.5:14b via Ollama) vs cloud comparison
Ran the identical episode through local qwen2.5:14b (Ollama, CPU) into group
`pocqwen` and diffed against the Anthropic graph.

| Metric | Anthropic claude-sonnet-5 | qwen2.5:14b (local, CPU) |
|---|---|---|
| Latency (add_episode) | ~19 s | ~855 s (~45× slower) |
| Entities / edges | 10 / 10 | 5 / 4 |
| Disposition (verdict) | captured | **missed** |
| Analyst preference | captured | **missed** |
| DetectionType, Service | captured | missed |
| Device nodes | IP + hostname | hostname only (lost IP pivot) |
| Identity→device auth edge | captured | captured |
| Edge modeling | detection-centric | crude ad-hoc edge types |

Findings:
- Docker Desktop on macOS runs Ollama CPU-only (no Apple GPU passthrough);
  14B extraction needed a Docker VM memory bump to 16 GB to avoid OOM
  (`llama-server ... signal: killed`) and is still ~45× slower than cloud.
- The MCP factory does not pass `base_url` into the OpenAI **LLM** client;
  redirect to Ollama via the `OPENAI_BASE_URL` env var (embedder is fine).
- Local qwen-14B got the skeleton but dropped the highest-value facts
  (disposition, analyst preference) and used ad-hoc edge types.

Conclusion: default to **cloud extraction (Anthropic)** for fidelity + latency;
local extraction is a data-residency fallback that realistically needs GPU + a
larger model (32B+) to approach parity. Confirms the value of pluggable
extraction (D2).

**Retired (2026-07-20):** with the comparison concluded, the `docker-compose.qwen.yml`
overlay and the 9 GB `qwen2.5:14b` model were removed. The findings above and the
`pocqwen` graph in FalkorDB are the durable record. Local extraction is still
reachable ad hoc via `LLM_PROVIDER=openai` + `OPENAI_LLM_API_URL`/`MODEL_NAME`
against any OpenAI-compatible endpoint.

---

## 12b. Embedder: Ollama → llama.cpp (2026-07-20)

Replaced the Ollama service with `ghcr.io/ggml-org/llama.cpp:server` running the
same `nomic-embed-text-v1.5` weights over the same OpenAI-compatible
`/v1/embeddings` contract. Motivation: the Ollama image is 7.03 GB, of which
~3.5 GB is CUDA/JetPack GPU runtimes that cannot execute on this project's
CPU-only Docker paths (Docker on macOS/Linux here has no GPU passthrough).
llama.cpp's server image is 1.17 GB. There is no CPU-only Ollama build, so
slimming Ollama in place was not an option.

**Equivalence validation (the gate).** graphiti_core's OpenAI embedder sends raw
text with no task prefixing (`embedder/openai.py`), so the swap reduced to "does
llama.cpp produce the same vectors as Ollama on identical weights?" To isolate
server behaviour from weight differences, the A/B reused Ollama's own GGUF blob:

- **Short domain probes (10):** cosine **1.000000** on every probe; identical
  neighbour ordering; both L2-normalised. Max elementwise delta **8.8e-08**
  (float serialization noise) — i.e. bit-identical.
- **Cross-server retrieval:** query vectors from llama.cpp retrieved correctly
  against the 137 entity vectors *already written by Ollama* in `pocextrahop`
  (e.g. "lateral movement" → *Lateral Movement* 0.84). **No re-embedding was
  required**; existing memory stayed valid.
- **HuggingFace-sourced GGUF** (what a fresh clone downloads) produced vectors
  identical to Ollama's blob (max delta 8.8e-08), so the shipped file is safe.

**Behaviour change worth noting.** nomic-bert trains at 2048 tokens. Ollama ran
it at `num_ctx 8192` and *silently truncated* longer inputs — embedding long
episodes from a fraction of their text. llama.cpp instead returns a clear 500
above its batch/context size. We set `-c/-b/-ub 2048` to match the training
context. Practical ceiling ~6000 chars; the largest real episode observed is
~2465, giving ~2.4× headroom. This is arguably a correctness improvement, but if
very long episodes appear they must be chunked upstream rather than silently
clipped.

**Topology.** A run-once `embeddings-init` container downloads the ~274 MB GGUF
into the `embed_models` volume (replacing `ollama_models`), pinned to an
immutable HuggingFace commit revision and sha256-verified before install; the
`embeddings` service serves it and is a healthcheck dependency of `graphiti-mcp`.
The
app-managed endpoint default moved to `http://embeddings:8080/v1` in
`lib/settings.js`, `graphiti/config.yaml`, and `graphiti/runtime/embedder.env`.

---

## 13. Phase 1 (app integration — read path) — DONE (2026-07-08)

Wired the Graphiti MCP server into the app itself (no more manual CLI driving):

- **Config:** new `memory` section in `lib/settings.js` (`enabled`, `url`),
  normalized + surfaced in `publicSettings`/`resolveConfig`. Toggleable via
  `MEMORY_ENABLED` / `MEMORY_MCP_URL` env for headless/container installs
  (`server.js`), set in `docker-compose.yml`.
- **Claude Code backend:** `server.js` computes `mcpServers` from config and
  passes it into session options; `lib/backends/claude/session.js`
  `buildQueryOptions()` injects `mcpServers: { graphiti: { type:'http', url } }`
  into the SDK `query()`. (Note: the app uses `settingSources:['project']`, so a
  user-scope `claude mcp add` is NOT seen — programmatic injection is required.)
- **Skill:** `skills/investigation-memory/SKILL.md` teaches read-at-kickoff
  (search memory for in-scope devices/identities/detections) and write-at-close.
  Auto-symlinked into every workspace for both backends.

**Validation:** switched active backend to Claude, created a session via the
app API, sent "search memory for 10.0.20.5". The agent loaded the
investigation-memory Skill, called `mcp__graphiti__search_memory_facts` /
`search_nodes` (visible as inbound `POST /mcp 200` on graphiti-mcp), and its
answer recalled the prior `benign-authorized` disposition. End-to-end read path
confirmed.

### Current state / notes
- App is running with active backend = **claude** and `memory.enabled=true`.
- The container's Claude Code isn't interactively logged in; the app's Claude
  backend authenticates via `ANTHROPIC_API_KEY` (compose env). Alternative:
  in-container `claude` /login persisted in the `claude_home` volume.

### Remaining
- **Pi backend MCP wiring** — Pi uses a different MCP mechanism than the SDK;
  deferred as a follow-up (Claude path validated first).
- **Settings UI toggle** for memory (config + env work today; no UI control yet).
- **Phase 2 (write path):** hook the Challenger completion event → `add_memory`
  with redaction, so investigations record their own conclusions automatically.
- **Per-environment group_id** (D3) threading from the RevealX host (sanitized).

---

## 14. Phase 2 (write path — automatic capture) — DONE (2026-07-08)

Investigations now record their own conclusions with no manual step.

- **`lib/memory-coordinator.js`** — mirrors the challenger pattern: listens to
  `session.on('agent_end')`. On a **user** turn that produced non-upload
  evidence AND a root HTML report (the "investigation concluded" proxy the
  automatic challenger also uses), and whose evidence signature is new, it
  injects a capture prompt (`source: 'memory-capture'`). Dedups via
  `session.lastMemoryCaptureSignature`; queues via `pendingMemoryCapture` if the
  session is busy; skips capture turns themselves to avoid loops. Gated on
  `memory.enabled` and the Claude backend (has the tools).
- **Agent-driven write** reuses the Phase 1 MCP wiring (no separate MCP client
  in the server) and the `investigation-memory` skill, so the agent writes the
  episode with full context via `add_memory`.
- Attached in `server.js` `createSession` alongside the challenger; emits a
  `memory_status` event for future UI surfacing.

**Validation:** seeded a Claude session with a simulated concluded investigation
(evidence + report for a distinct scenario: WEB-APP02 / Data Exfiltration / jdoe
/ malicious), then completed a user turn. The coordinator emitted
`memory_status: capturing`, the agent called `mcp__graphiti__add_memory`, and
the episode extracted into FalkorDB as Device `WEB-APP02`, Endpoint
`203.0.113.55`, Identity `jdoe`, DetectionType `Data Exfiltration`, and a
`Detection` node. Full write→extract loop confirmed.

### Notes / tradeoffs
- Capture costs one extra agent turn per concluded investigation (visible in
  chat). Acceptable/transparent for the PoC; could be made a silent background
  step later (server-side one-shot + direct MCP write).
- "Concluded" = root HTML report present. Quick triages that produce no report
  won't auto-capture (by design); a manual "save to memory" affordance could
  cover that.

### The loop is now closed
Phase 1 (read at kickoff) + Phase 2 (write at close) = investigations recall
prior verdicts/roles/identities and record new ones automatically, per
monitored environment.

### Remaining (future phases)
- Pi-backend MCP wiring (read + write).
- Settings UI: memory toggle + a "save to memory" / "what do we know" control;
  render `memory_status` and recalled facts.
- Per-environment `group_id` from the RevealX host (sanitized, D3).
- Optional: silent background capture; retention/decay policy (§8).

---

## 15. Follow-ups delivered (2026-07-08): Pi wiring, per-env group_id, Settings UI, Anthropic key

**Pi backend wiring.** Pi has no built-in MCP, so `pi-extensions/graphiti-memory.ts`
registers `memory_search` / `memory_add` tools that proxy to the Graphiti MCP
HTTP endpoint (minimal streamable-HTTP client). Loaded via `-e` in
`lib/backends/pi/session.js` only when `EH_MEMORY_MCP_URL` is set; gated/no-op
otherwise. `memory-coordinator.js` now allows Pi for auto-capture; the skill and
capture prompt name both backends' tools. Validated: a Pi session called
`memory_search` and recalled the prior `authorized scanner` disposition
(inbound `POST /mcp 200` + Ollama embed on graphiti-mcp).

**Per-environment group_id.** `deriveGroupId(host)` in `lib/settings.js` →
sanitized `eh<alphanumeric-host>` (or `ehdefault`), overridable by
`EH_MEMORY_GROUP_ID`. `buildAgentEnv` passes `EH_MEMORY_MCP_URL` +
`EH_MEMORY_GROUP_ID` to sessions (Pi extension scopes every call by it). One
`EH_MEMORY_GROUP_ID` var is shared by the app and the graphiti sidecar
(compose) so Pi and Claude stay on the same graph. Changing environments =
set that var + restart the memory stack.

**Settings UI + Anthropic key.** New "Memory" tab (`public/index.html` +
`public/js/settings.js`): enable toggle, MCP URL, and an Anthropic API key
field (masked; blank = keep, `-` = clear). The key lives in the app secret
store (`secrets.js` `SECRET_FIELDS` adds `anthropicApiKey`, kept out of the
ExtraHop-specific fields); `applyUpdate` handles it and `publicSettings`
exposes `anthropicKeySet`. `server.js` injects the stored key as
`ANTHROPIC_API_KEY` into new sessions (Claude backend), overriding the compose
env — so the key can be rotated in-app without editing files. Verified
set/clear + memory toggle round-trips via the API and served assets.

### Caveat
Changing the Anthropic key in-app updates the app's Claude backend immediately
(new sessions). The **memory extraction sidecar** is a separate container that
reads its key from compose env — update `.env` and restart the memory stack to
rotate the key Graphiti uses for extraction.

---

## 16. UI-managed Anthropic key for Graphiti — app LLM proxy (2026-07-09)

Goal: let the operator set/rotate the Anthropic key Graphiti uses for extraction
in Settings → Memory, without editing `.env` or restarting the sidecar.

Constraint: the graphiti sidecar reads `ANTHROPIC_API_KEY` once at startup; the
app can't push a new key into a running sibling container.

Solution — an Anthropic proxy in the app (`server.js`, `/memory-llm`):
- The graphiti sidecar points its Anthropic base URL at the proxy
  (`ANTHROPIC_BASE_URL=http://eh-investigator:3100/memory-llm`) and authenticates
  with a shared token (`EH_MEMORY_PROXY_TOKEN`) as its `x-api-key`, NOT the real
  key. (Set `ANTHROPIC_BASE_URL`, not just the config `api_url` — the MCP
  factory drops the config value for the Anthropic client, same as it does for
  the OpenAI LLM client.)
- The proxy validates the token, swaps in the real key from the app secret
  store (fallback: `ANTHROPIC_API_KEY` env), forwards to `api.anthropic.com`,
  and streams the response back. It allows only the observed
  `POST /v1/messages` operation, uses constant-time token comparison, and
  enforces configurable request-size, timeout, rate, and concurrency bounds.
  Mounted before `express.json`; outside the `/api` origin guard.
- Result: the real Anthropic key lives only in the app. Setting it in the UI
  takes effect for Graphiti extraction immediately — no `.env`, no restart. One
  key powers both the Claude backend (injected into sessions) and extraction.

Validated: token gate (correct → 200, wrong → 403); a real episode extracted
with graphiti's LLM calls hitting `POST /memory-llm/v1/messages 200` (confirmed
via httpx logs) and landing in FalkorDB.

The known `eh-memory-proxy-local` value remains intentional for the loopback-only
Compose profile. It is a routing guard, not protection from malicious local
processes. `docker-compose.hardened.yml`, launched through
`scripts/compose-hardened.sh`, generates and synchronizes a strong token and the
server fails closed if a hardened/remote/shared profile receives the local
default or a token shorter than 32 characters.

### Caveat
In the Linux container the secret store is memory-only (no Keychain/Secret
Service), so a UI-set key does not survive an app-container restart — the
`.env` `ANTHROPIC_API_KEY` is the persistent fallback, and the UI is the live
override / rotation path. A persistent secret backend would remove this caveat.

---

## 17. Future enhancements (backlog)

- **Persistent secret backend for the container.** Today the Linux container's
  secret store is memory-only, so UI-set secrets (Anthropic key, ExtraHop creds)
  don't survive an app-container restart — the `.env` fallback does. Add a
  persistent backend (e.g. an encrypted file in a mounted volume, `secret-tool`
  + a keyring in the image, or a mounted host keyring) so UI-set keys persist
  across restarts without `.env`. Requested 2026-07-09; deferred.
- Silent/background auto-capture (avoid the extra visible capture turn).
- Retention/decay policy for stale dispositions (see §8).

---

## 18. Settings persistence across restarts — DONE (2026-07-09)

Previously the container lost all settings on restart: `config.json` wasn't
mounted (reset to defaults → backend fell back to `pi`), and the secret store
was memory-only (Anthropic key / ExtraHop creds reset, falling back to `.env`).
This resolves the §16 caveat and the §17 backlog item.

- **Non-secret settings** (`lib/settings.js`): `CONFIG_PATH` is now env-overridable
  (`EH_CONFIG_PATH`); `saveConfig` ensures the parent dir. Compose sets
  `EH_CONFIG_PATH=/app/data/config.json` on a `config_data` named volume, so
  backend, per-backend model prefs, challenger, evidence view, memory
  enable/URL, and ExtraHop host/family/TLS all persist.
- **Secrets** (`lib/secrets.js`): new `FileSecretBackend` (0600 JSON), selected
  when `EH_SECRETS_PATH` is set (or `EH_AGENT_SECRET_STORE=file`); explicit path
  wins over OS keyrings. Compose sets `EH_SECRETS_PATH=/app/data/secrets.json`
  in the same volume, so the Anthropic key and ExtraHop creds persist. Local
  (non-container) runs still use macOS Keychain / Linux Secret Service.

Verified: set backend=claude + Anthropic key + memory on → full
`docker compose up -d --force-recreate` → all survived; startup logged
"Agent backend: Claude Code"; the memory proxy still authenticates with the
persisted key.

**Security:** `secrets.json` is plaintext at rest (0600) in the Docker volume —
the same posture as `.env`. Acceptable for the localhost tool; for stronger
at-rest protection use an encrypted volume or an OS keyring on the host.

---

## 19. jq in the image + Claude sign-in choice (2026-07-09)

- **jq** added to the Dockerfile apt install (the agent reached for it and fell
  back to Python; `python3` was only present as a weasyprint dep). extrahop-excli
  skill now documents the "redirect → jq/python summarize → report summary"
  pattern to keep raw JSON out of context.

- **Claude Code sign-in choice** (`claudeAuth`: `apiKey` | `subscription`),
  Settings → Agent. Root cause of "it uses my API key": the app injected
  `ANTHROPIC_API_KEY` into the Claude session, and Claude Code prefers an API
  key over the subscription OAuth when the env var is present. Now:
  - `apiKey` (default): inject the key (metered).
  - `subscription`: the session **strips** `ANTHROPIC_API_KEY` (and
    `ANTHROPIC_AUTH_TOKEN`) so Claude Code uses the in-container `claude /login`
    (Pro/Max), stored in the `claude_home` volume.
  Verified: subscription mode → "Not logged in" (key correctly hidden; no
  container login yet); apiKey mode → turn succeeds.

  **Note:** the container has its own credential store — a host `/login` does
  NOT apply. To use the subscription: `docker compose run --rm -it eh-investigator claude`
  → `/login`, then switch Settings → Claude sign-in → Subscription. Graphiti
  extraction still uses the API key via the proxy (subscription can't drive it),
  so keep an Anthropic key set even in subscription mode.

### 19a. Headless subscription auth — correction (2026-07-09)

In-container `claude /login` does NOT work: the OAuth localhost callback can't
reach a process inside the container, so no credential is written (confirmed:
no `/root/.claude/.credentials.json`, "Not logged in"). The supported headless
path is a long-lived token:

1. On a machine with a browser (e.g. the host, which has Claude Code): run
   `claude setup-token` (requires Claude Pro/Max) → copy the token.
2. Settings → Agent → **Claude OAuth token** → paste, Save (stored in the
   secret store, `claudeOauthToken`, persisted in the config volume).
3. Set **Claude Code sign-in → Subscription**, Save.

In subscription mode the app injects `CLAUDE_CODE_OAUTH_TOKEN` into the Claude
session and strips `ANTHROPIC_API_KEY`, so the agent runs on the Pro/Max plan.
Graphiti extraction still uses the API key via the proxy. Verified: token
set/clear round-trips and the UI field is served; API-key mode remains the safe
default.

### 19b. Subscription auth bug — env built in 3 places (2026-07-09)

Even with a valid `CLAUDE_CODE_OAUTH_TOKEN`, subscription turns failed "Not
logged in." Cause: the session env was constructed in THREE places, and only
`createSession` injected the Claude auth. `onConfigChanged` (settings save) and
the `/message` route's first-prompt `applyDefaults` both rebuilt env with the
bare `buildAgentEnv` (broker + memory only), clobbering the API key / OAuth
token. Since `POST /sessions` reuses an empty session and the first message
triggers that `applyDefaults`, the token was dropped right before the turn.

Fix: centralized all session-env construction in `buildSessionEnv(settings,
backendId)` (broker + memory + Claude auth) and used it in all three places
(`createSession`, `onConfigChanged`, and the sessions router's first-prompt
path), also syncing `subscriptionAuth`. Verified end-to-end: subscription turn
succeeds (key stripped, OAuth token used) and apiKey turn still succeeds.
