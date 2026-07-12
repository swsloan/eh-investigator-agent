# Decision note — agent backends: Pi vs. Claude Code

Where each backend earns its place, when to use which, and what it would take to
make a **fully on-prem, local-model** investigation a supported configuration.

Status: decision note / positioning. Reflects the code as of the 26.07.09
build. Companion to [CHANGES.md](CHANGES.md) and the Warrant harness docs.

---

## The two backends

Both implement the same descriptor contract (`lib/backends/index.js`); the
server, routes, and UI only see the descriptor, so either can run an
investigation. `DEFAULT_BACKEND_ID = 'pi'`.

| | **Pi** (`@earendil-works/pi-coding-agent`) | **Claude Code** (`@anthropic-ai/claude-agent-sdk`) |
|---|---|---|
| Model providers | **Multi-provider** — model values are `provider/id`; `pi --list-models` lists a provider column | **Anthropic only** |
| Auth | Pi's own `/login` / provider config (external to this repo) | API key **or** Pro/Max subscription (`claude setup-token`) |
| MCP | **None built in** — the Graphiti memory tools are a hand-built MCP client in `pi-extensions/graphiti-memory.ts`, loaded via `-e` | **Native** — memory wired via the SDK `mcpServers` option |
| Process model | Long-lived RPC process (idle reaping, `PI_IDLE_PROCESS_TIMEOUT_MS`) | Per-turn `query()` that resumes a session id; no resident process |
| Context compaction | Pi-managed | Claude Code-managed |
| Extensibility seam | In-process TypeScript tools (`pi.registerTool` / `defineTool`) | MCP servers |
| Runtime floor | Node ≥ 22.19 | — |

---

## Positioning

**Pi is not "a second general-purpose agent."** On Anthropic models, Claude Code
is the stronger harness — native MCP, subscription auth (no per-call cost for
Pro/Max), self-managed compaction, and the natural home for the
evidence-ladder / Warrant work.

**Pi's distinct value is provider independence.** It is the only backend that can
point the investigator at a **non-Anthropic, local, or self-hosted model**. For a
security product that is decisive, not cosmetic: many NDR/SOC buyers are
regulated, data-resident, or air-gapped and **cannot send packet, record, or
detection content to a cloud LLM**. Pi is the path that makes those deployments
possible at all — and it maps directly to the "air-gapped degradation" gap in
[DESIGN-warrant-harness.md](DESIGN-warrant-harness.md): Claude Code *is* that
gap, Pi *is* the mitigation.

Its costs are real and worth naming: no native MCP (every future MCP-shaped
capability is custom work on the Pi side), plus the maintenance surface of an RPC
process, a second one-shot path, a separate model catalog, and the Node floor.

---

## When to use which

| Situation | Backend |
|-----------|---------|
| Cloud-comfortable, Anthropic account/subscription, want the richest harness | **Claude Code** |
| Regulated / data-resident / air-gapped; data may not leave the network | **Pi** (local model) |
| Non-Anthropic model preference, or per-deployment cost control | **Pi** |
| Existing deployment with Pi login + investigations already persisted | **Pi** (continuity) |
| Needs a new MCP integration with least effort | **Claude Code** |

**Recommendation on the default:** if the target market is predominantly
cloud/Anthropic, consider flipping `DEFAULT_BACKEND_ID` to `claude` and keeping
Pi explicitly as the **local/sovereign tier**. If a meaningful slice of the
market is air-gapped/regulated, Pi stays a core capability and the local-model
path deserves to be first-class (below), not an experiment in a compose overlay.
No code change is being made here — this note records the trade-off so the
default is a deliberate choice, not an accident of history.

---

## What it would take to support "fully on-prem" (Pi on a local model)

Today the local-LLM story is **partial**. The pieces that already run locally:

- **Embeddings** — Ollama `nomic-embed-text` (in the base `docker-compose.yml`).
- **Memory extraction** — the `docker-compose.qwen.yml` overlay flips *only the
  Graphiti extraction LLM* to local Ollama `qwen2.5:14b`.

What that overlay does **not** touch: **the investigator agent itself.** Whichever
backend runs the investigation still uses Anthropic. So "fully on-prem" is not yet
achievable, because the agent doing the actual RevealX analysis is the largest
data-exposure surface, and it's still cloud-bound.

To close the gap, roughly in order:

1. **Point Pi's investigator at a local model.** Configure Pi's provider to an
   OpenAI-compatible local endpoint (Ollama) and select a local `provider/id`
   model as `mainModel`. Persist that provider config in the `pi_home` volume so
   it survives restarts. This is the core missing wiring — the investigator, not
   just extraction, must run locally.
2. **Add a first-class deployment mode, not an overlay.** Promote the local path
   to a documented configuration (e.g. `docker-compose.onprem.yml` or a Settings
   toggle) that sets Pi + local extraction + local embeddings together, with a
   sane default local model, rather than the current extraction-only POC overlay.
3. **Right-size the host.** Local investigation models are far larger than the
   embedder. Document the RAM/VRAM/model-size floor (the qwen2.5:14b comparison
   already OOM-killed a 7.7 GB Docker VM during earlier testing) and pick a
   default model that fits a realistic on-prem box.
4. **Prove quality on local models.** The [eval harness](DESIGN-eval-harness.md)
   already contemplates a `LLM_PROVIDER=openai` path and scoring backends
   separately — run the labeled cases on the local model and publish the
   false-close/adherence delta vs. Anthropic. On-prem is only a real offering if
   the local model's verdict quality is known, not assumed.
5. **Handle the accelerator loss explicitly.** Air-gapped deployments lose cloud
   ML detections, threat intel, and briefings (per the Warrant doc). The agent
   should degrade gracefully — lean on rule-based detections and records — and
   say so, rather than silently producing weaker verdicts.
6. **Confirm skills/memory are provider-agnostic.** The evidence-ladder,
   investigation-memory, and reporting skills must not assume Anthropic-specific
   behavior; verify the memory MCP bridge and the ladder discipline hold on a
   local model (weaker instruction-following is the main risk).

Only steps 1–2 are strictly required to *run* fully on-prem; 3–6 are what make it
**supportable** — i.e. something you can sell and stand behind, with known
hardware needs and known verdict quality.

---

## Bottom line

Keep both. Claude Code is the default-quality path on Anthropic models and the
home of the harness work. Pi is the strategic hedge and the only route to
sovereign/air-gapped deployments. The one concrete investment worth scheduling is
making **Pi-on-local-model a first-class, eval-validated deployment mode** —
because that converts Pi from "the older backend we still ship" into "the reason
we can sell into environments Claude Code can't reach."
