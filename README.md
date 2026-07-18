# ExtraHop Investigation Agent

> **Local modifications on this copy:** this deployment adds Docker packaging, a
> Graphiti long-term temporal-memory layer, settings/secrets persistence, a
> Claude subscription-vs-API-key auth choice, and several fixes on top of the
> upstream release. See **[docs/STATUS-HANDOFF.md](docs/STATUS-HANDOFF.md)** for current status + next steps, **[docs/CHANGES.md](docs/CHANGES.md)** for the complete
> change inventory and **[docs/DESIGN-graphiti-memory.md](docs/DESIGN-graphiti-memory.md)**
> for the memory design/rationale. **To build and run in Docker Desktop, see
> [Quickstart — Docker Desktop](#quickstart--docker-desktop).**

Local web UI for an autonomous ExtraHop investigation agent. The server drives
either the [Pi coding agent](https://pi.dev/) (RPC mode) or
[Claude Code](https://claude.com/claude-code) (via the Claude Agent SDK) as its
agent backend — selectable in Settings based on what is installed — gives it a
project-local `./excli-interface` broker interface for the ExtraHop REST API
CLI, and exposes a browser chat UI with workspace file viewing, uploads,
streaming tool activity, HTML investigation reports, and inline summaries for
supported JSON evidence files.

The agent's ExtraHop access is **read-only**: write-class REST operations are
refused on the broker. To make a change it uses a **governed write path** — it
*proposes* a write (`./propose-action`), and a human approves or rejects it in
the UI, after which the server (never the agent) executes it. Pending approvals
surface in an in-chat tray and a real-time **cross-session approval dashboard**
(header badge + panel) so a proposal is never missed regardless of which session
is open. See [Governed write path](#governed-write-path) below.

This package is intended to be clean deployable scaffolding: source, skills,
templates, lockfiles, setup scripts, self-hosted Source Sans 3 webfont assets,
the pinned ExtraHop CLI source reference under `vendor/excli/` (`source.env` +
the release sha256 checksums — **not** the binaries, which are fetched from the
pinned upstream and checksum-verified at build/install time), and the
repository-root `./excli-interface` broker interface. The bootstrap script
detects the operating system and CPU, fetches the matching `excli` release,
verifies it against the committed checksums, and installs it as `bin/excli`. It
intentionally does not include installed dependencies, generated investigation
workspaces, local credentials, logs, or session state.

## Quickstart — Docker Desktop

The fastest way to run the full stack (app + Graphiti memory + FalkorDB + Ollama)
on one machine. **Everything builds from this repository** — no images or volumes
need to be created beforehand, so a fresh clone works as-is.

**Prerequisites**

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) running, with
  Compose v2 (the `docker compose` subcommand). Give it roughly **8 GB RAM** and
  **15 GB disk** — the memory stack pulls the Ollama image and a local embedding
  model on first build.

**Build and run**

```bash
git clone https://github.com/swsloan/eh-investigator-agent.git
cd eh-investigator-agent
docker compose build      # builds the app + graphiti-mcp images from source
docker compose up -d      # starts app, graphiti-mcp, falkordb, ollama
```

Then open **[http://localhost:3100](http://localhost:3100)**. The first build takes
several minutes (npm install, image pulls, embedding-model download); subsequent
`up` is fast.

**Configure credentials** — the containers start without them; add them once the
UI is up:

- **Settings → Connection**: your ExtraHop RevealX host + API key (or RevealX 360
  client ID/secret).
- **Settings → Agent**: an Anthropic API key, or a Claude Pro/Max subscription
  token (`claude setup-token` on a machine with a browser). This key also powers
  memory extraction.
- Optional: set these ahead of time in `.env` (`cp .env.example .env`). Every
  variable has a safe default, so `.env` is only needed to pre-seed credentials —
  the stack comes up without it.

**Verify**

```bash
curl -s http://localhost:3100/api/health   # -> {"ok":true, ...}
docker compose ps                          # four services; app on 127.0.0.1:3100
```

Sessions, settings, and memory persist in named Docker volumes across restarts and
rebuilds. After a `git pull`, update in place with
`docker compose up -d --build eh-investigator`. Deeper detail (backends, auth
modes, memory, excli) is in the [Docker](#docker) section below.

> **CPU architecture must match.** The Claude Code backend uses an
> architecture-native binary that the image build installs for the *build*
> machine only. Build on the same host you run on (the usual case) and this is
> automatic. If you build on one machine and deploy to a different-arch host,
> cross-build for the target: `docker buildx build --platform linux/arm64 .` (or
> `linux/amd64`). If a session ever fails with **"Native CLI binary for
> linux-\<arch\> not found"**, the image was built for the wrong architecture —
> rebuild with `docker compose build --no-cache eh-investigator`. The build now
> fails fast and the container warns at startup so this is caught before you hit
> it in a session.

Deploying with an AI coding agent? Hand it the ready-made prompt in
**[docs/DEPLOY-WITH-AI-AGENT.md](docs/DEPLOY-WITH-AI-AGENT.md)**.

## Quick Start (local, without Docker)

Prerequisites:

- macOS or Linux.
- Node.js 22.19+ with npm (required by current Pi releases; enforced by `engines`).
- Network access for npm packages and agent-backend install.
- At least one agent backend: Pi (with a provider configuration or provider
  API keys) or Claude Code (signed in via `claude` `/login`). If both are
  installed, pick one in Settings; sessions remember the backend that
  created them.
- Network access to fetch the pinned `excli` release (checksum-verified, not bundled) — or, offline, provide it via `EXCLI_PATH`/`EXCLI_ARCHIVE`/a `vendor/excli-<os>-<arch>-*.tar.gz` drop-in, or point `EXCLI_URL` at an internal mirror.
- Optional but recommended: `tshark` for packet/PCAP analysis.
- ExtraHop API credentials for RevealX Enterprise or RevealX 360.

On macOS or Linux, deployment is one command from the package root:

```bash
./start.sh
```

Do not use `sudo`; Pi and Claude Code authentication is per-user, and Claude
Code rejects bypass-permissions mode when launched as root. `./start.sh` starts
the web service in the background by default and prints the PID/log path. Use
`./start.sh --foreground` if you want logs attached to the current terminal.

Bootstrap repairs execute bits that zip round-trips can strip, detects the
OS/CPU, and fetches + checksum-verifies the matching ExtraHop CLI release,
installing it as `bin/excli`. If even `start.sh` lost
its execute bit in transit, run `bash ./start.sh` once; setup restores the
permissions from there.

If you have an `excli` archive file:

```bash
EXCLI_ARCHIVE=/path/to/excli-darwin-arm64-0.0.111-2fdebedca0.tar.gz ./start.sh
```

If `excli` is hosted at an internal URL:

```bash
EXCLI_URL=https://internal.example.com/excli-darwin-arm64.tar.gz ./start.sh
```

If you put a matching archive under `vendor/`, for example
`vendor/excli-linux-amd64-0.0.111-2fdebedca0.tar.gz`, the bootstrap script can discover it:

```bash
./start.sh
```

Then open [http://localhost:3100](http://localhost:3100). If port 3100 is
taken, the server steps up in increments of 100 (3200, 3300, …) and logs the
port it bound.

`./start.sh` is the operator-facing launcher. It stays bound to localhost, runs
`scripts/bootstrap.sh` for first-run setup and later checks, then starts
`node server.js` with `nohup` in the background. To stop the service, kill the PID
printed by `start.sh` or saved in `app.pid`. For a traditional attached process,
run `./start.sh --foreground`.

## Alpha Tester Notes

- Run the app on localhost only. It has no built-in user authentication.
- Use dedicated, least-privilege ExtraHop API credentials for testing.
- Backend model/provider authentication is separate from ExtraHop credentials; complete Pi login/provider setup or Claude Code `/login` outside this repo as the same non-root user that runs `./start.sh`.
- The ExtraHop CLI is **not committed here** (its upstream repo grants no redistribution rights); setup fetches the platform-matched release from the pinned upstream source, checksum-verifies it, and installs `bin/excli` automatically.

## What Bootstrap Does

`scripts/bootstrap.sh`:

- restores execute bits on `start.sh`, `scripts/*.sh`, `./excli-interface`, and `bin/excli`, and tightens `.env` to 0600;
- verifies Node.js 22.19+ and npm are available;
- runs `npm ci --omit=dev`;
- installs Pi if neither `pi` nor `claude` is already on PATH;
- verifies the repository-root `./excli-interface` broker interface;
- verifies `bin/excli`, or installs it from `EXCLI_PATH`, `EXCLI_ARCHIVE`, `EXCLI_URL`, a loose `vendor/` drop-in archive, or by fetching the pinned upstream release matching the detected OS/CPU;
- verifies fetched/provided archives against the committed sha256 checksums;
- replaces a `bin/excli` that cannot run on this machine (for example a macOS binary on Linux) by re-fetching for the detected platform;
- clears macOS quarantine from `bin/excli` when possible;
- checks for `tshark` and can install it with `--with-tshark`;
- optionally prompts for ExtraHop credentials and writes a local `.env`;
- runs syntax checks;
- starts the web UI when passed `--start`.

Most operators should use `./start.sh`, including with setup flags such as
`--with-tshark` or `--with-pdf`. Use `scripts/bootstrap.sh` directly only when
you want setup without starting the server.

By default, PDF export support is skipped because WeasyPrint native
dependencies vary by OS. Add `--with-pdf` to create `.venv` and install the
Python dependency:

```bash
EXCLI_ARCHIVE=/path/to/excli-linux-amd64.tar.gz ./start.sh --with-pdf
```

On macOS, Homebrew's `weasyprint` package is often the most reliable PDF path.
HTML report previews follow the selected app theme when the bundled
investigation-reporting templates support it. PDF exports intentionally render
with the templates' light print theme.

### ExtraHop CLI Platform Selection

The ExtraHop CLI is **not redistributed in this repository**. Its upstream repo
[ExtraHop/agent-cli](https://github.com/ExtraHop/agent-cli) carries no license
granting redistribution, so instead of committing the binaries, this project
**fetches** the architecture-matched release from a pinned upstream commit and
verifies it against the committed sha256 checksums at build/install time. The
pin (repo, commit, version) lives in `vendor/excli/source.env`. Only the pin
metadata is tracked — `source.env`, `excli_<version>_checksums.txt`, and this
directory's `README.md` — never the binaries. Bootstrap detects the OS/CPU,
fetches the matching archive, verifies it, and installs `bin/excli`; a
wrong-platform `bin/excli` left over from another machine is re-fetched. To move
to a newer excli, bump the pin in `source.env` and replace the checksums file
(see [docs/EXCLI_MAINTENANCE.md](docs/EXCLI_MAINTENANCE.md)).

For **offline / air-gapped** installs, provide the binary or archive yourself via
`EXCLI_PATH`, `EXCLI_ARCHIVE`, or a loose `vendor/excli-<os>-<arch>-*.tar.gz`
drop-in. `EXCLI_URL` is a separate option for pulling excli from a reachable
**internal mirror** instead of the pinned GitHub source.

### macOS Gatekeeper

If macOS blocks the fetched CLI, run:

```bash
chmod +x ./bin/excli
xattr -dr com.apple.quarantine ./bin/excli
./bin/excli -help
```

If needed, allow it in System Settings → Privacy & Security and retry.

### Optional tshark Support

`tshark` is strongly recommended for packet captures downloaded from ExtraHop:

```bash
brew install wireshark              # macOS
sudo apt-get install tshark         # Debian/Ubuntu
sudo dnf install wireshark-cli      # Fedora/RHEL-like
```

Or ask bootstrap to try:

```bash
./start.sh --with-tshark
```

## Configuration

ExtraHop credentials can be configured in either place:

- the in-app Settings gear;
- a local `.env` file copied from `.env.example`.

RevealX Enterprise:

```bash
EXTRAHOP_HOST=eda.example.com
EXTRAHOP_API_KEY=...
EXTRAHOP_INSECURE=false
```

RevealX 360:

```bash
EXTRAHOP_HOST=tenant.api.cloud.extrahop.com
EXTRAHOP_CLIENT_ID=...
EXTRAHOP_CLIENT_SECRET=...
```

Copy the template and fill in only what you need:

```bash
cp .env.example .env      # then edit; keep it 0600, never commit it
```

`.env.example` documents every supported variable, grouped into sections:

- **RevealX connection** — `EXTRAHOP_HOST` plus either `EXTRAHOP_API_KEY`
  (Enterprise) or `EXTRAHOP_CLIENT_ID`/`EXTRAHOP_CLIENT_SECRET` (360), and
  `EXTRAHOP_INSECURE` for self-signed certs. This block is the only one required
  to start.
- **Claude / Anthropic** — `ANTHROPIC_API_KEY`, used by the Claude Code agent
  (apiKey sign-in) and by Graphiti memory extraction via the in-app proxy. Leave
  it blank to set it in Settings, or to run on a Claude Pro/Max subscription
  token instead (Settings → Agent — see the [Docker](#docker-local-added-by-operator)
  section).
- **Long-term memory (Graphiti)** — `EH_MEMORY_GROUP_ID` (per-environment graph
  namespace; blank = derived from the RevealX host) and `EH_MEMORY_PROXY_TOKEN`
  (guards the app's internal memory-LLM proxy). `MEMORY_ENABLED` and
  `MEMORY_MCP_URL` are already set for you in `docker-compose.yml`.
- **Graphiti stack tuning** and **local (non-Docker) overrides** — advanced,
  with sensible defaults; usually left untouched.

Every variable in the template is one the app or `docker-compose.yml` actually
reads. Blank secret lines are fine — set them in Settings instead if you'd
rather not keep them on disk.

In-app settings take precedence over `.env` for new sessions. Nonsecret
ExtraHop settings such as host, family, and TLS mode are saved in
`config.json` with owner-only file permissions. Secrets — the ExtraHop
credentials plus the Anthropic API key and any Claude subscription (OAuth) token
— are never written to `config.json`. They live in a secret store selected in
this order: an explicit **file backend** when `EH_SECRETS_PATH` is set (a 0600
JSON file, used by the Docker deployment so keys persist in the `config_data`
volume); otherwise macOS Keychain or Linux Secret Service when available;
otherwise memory-only for the current server process. The file backend is
plaintext at rest — the same posture as `.env` — acceptable for this
localhost-only, no-auth tool, but the file must be protected like any other
secret. Legacy `config.json` secrets are migrated once into the active store and
then rewritten out of `config.json`.

`.env` remains supported for headless installs. The server parses ExtraHop
values from `.env` into its local secret layer and then removes all
`EXTRAHOP_*` values from `process.env` before spawning Pi. None of
`config.json`, `secrets.json`, or `.env` should be committed.

Pi model/provider authentication lives in Pi's own configuration, outside this
repo. The launcher can install or find the Pi CLI, but it does not create Pi
provider accounts or invent provider API keys. If model calls fail, run `pi`
once in a terminal, complete Pi's `/login` flow or provider setup, then restart
the web UI.

The lower-left status light checks local readiness at startup and after settings
changes. It uses `/api/preflight` to verify Pi models, the `./excli-interface`
broker interface, the local broker socket, `bin/excli`, optional `tshark`,
optional Wireshark, and ExtraHop credential configuration without exposing
secrets.

Settings also include an optional Challenger Agent. When enabled, completed
investigations that produced non-upload workspace evidence show a
**Challenge these findings** button in chat. The challenger runs as a separate
one-shot `pi -p` review, reads the investigator's final answer plus selected
workspace reports/evidence, and either accepts the findings or returns a
constructive counter-prompt. Counter-prompts are injected back into the same
session as a tagged **Challenger Agent** user message for the investigator to
consider. If automatic challenger reviews are enabled, at most one automatic
review runs per session, and only after a successful investigator turn produces
a root HTML report. Challenger-driven revision turns do not trigger another
automatic review. Otherwise the user starts reviews manually.

When viewing JSON evidence under `evidence/records`, `evidence/metrics`,
`evidence/detections`, or `evidence/entities`, the file viewer automatically
renders an inline summary. Settings can choose the default evidence view:
source code, a 50/50 split, or rendered summary. Rendered summary is the
default, with source preview fallback for files that cannot render. Header
controls can switch between source-only, split, and summary-only viewing.
Records render as tables, metrics render four compact stat cards plus an inline
SVG chart with bucket-aware dynamic time-axis ticks when bucket data is present,
single detections render a
risk/detail card with threshold-colored risk when a score is present, friendly
security/performance category chips, MITRE ATT&CK details when present,
markdown-rendered descriptions, compact offender and victim participant cards,
and best-effort device-name enrichment from `evidence/entities`. Missing device
metadata is looked up in the background and saved as
`evidence/entities/device-{id}.json` for later views. Entities render property
or entity tables.
Packet captures open in a packet-specific viewer with download support and an
Open in Wireshark action when Wireshark is detected locally.
JSON files can be downloaded as JSON or exported as CSV from the viewer. Python
workspace files use the same local Highlight.js styling as JSON source previews.

## Docker (local, added by operator)

An alternative to `./start.sh` for running on one machine inside a container.
This isolates the agent's shell access from the host OS. These files
(`Dockerfile`, `docker-compose.yml`, `docker-compose.qwen.yml`, `.dockerignore`,
`scripts/docker-entrypoint.sh`, and the `graphiti/` stack) are local additions,
not part of the upstream release. `docker compose up` starts a four-service
stack: the app, a Graphiti memory server, FalkorDB, and Ollama (local
embeddings). Deep detail lives in [docs/CHANGES.md](docs/CHANGES.md).

```bash
docker compose build
docker compose up -d
```

Then open [http://localhost:3100](http://localhost:3100).

How it maps to this release:

- **Backends:** both Pi and Claude Code are installed in the image; pick one in
  Settings → Agent. For Pi, complete provider auth once (persisted in the
  `pi_home` volume): `docker compose run --rm -it eh-investigator pi` then run
  `/login`.
- **Claude Code backend:** installed and runnable as root — the image sets
  `IS_SANDBOX=1`, which lets Claude Code use `bypassPermissions`. Two sign-in
  modes (Settings → Agent): an **API key** (`ANTHROPIC_API_KEY`), or a **Claude
  Pro/Max subscription**. In-container `/login` cannot complete (its OAuth
  callback can't reach the container), so for a subscription run
  `claude setup-token` on a machine with a browser and paste the token into
  Settings → Agent, then switch sign-in to Subscription.
- **Memory (Graphiti):** enabled by default. The `graphiti-mcp`, `falkordb`, and
  `ollama` services provide a long-term temporal knowledge graph with local
  embeddings, wired into both backends so investigations recall prior context.
  Namespaced per monitored environment via `EH_MEMORY_GROUP_ID`. Memory
  extraction always uses the Anthropic API key through the app's `/memory-llm`
  proxy. See [docs/DESIGN-graphiti-memory.md](docs/DESIGN-graphiti-memory.md).
- **Embedder (swappable):** the embedding model, its vector size, and the
  endpoint are configurable in **Settings → Memory → Embedder** (model /
  dimensions / OpenAI-compatible URL). The app writes them to
  `graphiti/runtime/embedder.env`, which `graphiti-mcp` reads via `env_file`;
  when that file (or a value) is absent, `graphiti/config.yaml`'s
  `${EMBEDDER_MODEL:…}` / `${EMBEDDER_DIMENSIONS:768}` / `${OPENAI_API_URL:…}`
  defaults apply. This is a **startup**, not live, setting: after saving, run
  `docker compose up -d graphiti-mcp` to apply. Point `OPENAI_API_URL` at any
  OpenAI-compatible embedding server to move off local Ollama. Dimensions must
  match the model (`nomic-embed-text`=768, OpenAI `text-embedding-3-*`=1536), and
  changing them requires re-embedding existing memory (use a fresh namespace or
  reset the graph).
- **excli:** fetched at build time from the pinned upstream source and
  checksum-verified (arch auto-detected) — not committed to this repo, since
  ExtraHop/agent-cli grants no redistribution rights.
- **PDF export:** the Debian `weasyprint` package is installed, so HTML report
  PDF export works out of the box. `jq` is also installed for the agent's
  evidence-summarizing workflow.
- **tshark:** installed for PCAP parsing. The "Open in Wireshark" feature
  launches a desktop GUI and is intentionally unavailable in this headless
  container (its preflight check is optional).
- **Networking:** upstream `server.js` binds `127.0.0.1`; a one-line local
  patch honors a `HOST` env var so the container can bind `0.0.0.0`, and Compose
  publishes only to the host loopback (`127.0.0.1:3100`), preserving the
  no-auth, localhost-only model.
- **Persistence:** named volumes survive restarts and container recreates —
  `workspaces` and `pi_home` (declared `external`, reused from the prior
  deployment) keep investigations and Pi auth; `config_data` persists in-app
  Settings (`config.json`) and secrets (`secrets.json`, 0600) at `/app/data`;
  `falkordb_data` and `ollama_models` keep the memory graph and the downloaded
  embedding model.
- **Credentials / `.env`:** `docker compose` reads a sibling `.env` for
  `${VAR}` interpolation. Copy `.env.example` to `.env` and set at least
  `EXTRAHOP_HOST` + credentials; add `ANTHROPIC_API_KEY` and the memory vars
  (`EH_MEMORY_GROUP_ID`, `EH_MEMORY_PROXY_TOKEN`) as needed. See
  [Configuration](#configuration) for the full breakdown. Anything left blank
  can be set in the in-app Settings gear, which takes precedence.

## Governed write path

The agent can investigate freely but cannot change your ExtraHop environment on
its own. Writes follow a **propose → approve → execute** flow:

1. **Propose.** Write-class excli tools are refused on the read-only broker. To
   request a change the agent calls `./propose-action` with a `capabilityId`,
   `params`, and a plain-language `label`. The proposal is validated against the
   live capability catalog (unknown or read-only tools are rejected) and
   persisted as a per-session record under `<workspace>/.actions/`. It does **not**
   execute.
2. **Approve.** A human approves or rejects it in the UI — an in-chat tray for
   the active session, and a **cross-session dashboard** (header badge + panel)
   that lists pending approvals across every session in real time, so a proposal
   from a background or unattended run is never missed. Approvals show each
   action's age (stale ones are flagged), a "session busy" state while that
   session's agent is mid-turn, and optional desktop notifications.
3. **Execute.** Only `POST /api/actions/:id/decide` (behind the local-origin
   guard) can approve an action, and only the server-side executor
   (`ExcliBroker.executeApproved`) runs the write — re-validating that it is a
   write capability and that the session isn't read-only. The agent's own socket
   stays read-only always; it can never execute a write directly.

Read/write classification is annotation-driven: excli is an MCP server under the
hood, so each tool self-describes via `readOnlyHint`/`destructiveHint`
(`excli -jsonschema`), with a denylist + verb-prefix heuristic as a fail-safe
fallback. Every action's live status is fed back into the agent's context
(`<pending-actions>`), so it never reports a change as done unless it actually
executed.

## Repository Layout

```text
server.js                  Express boot, middleware, route composition
VERSION                    Release marker (26.07.10)

lib/agent-session.js       Backend-agnostic session base class + shared system prompt
lib/backends/index.js      Backend registry (Pi + Claude Code)
lib/backends/pi/           Pi RPC backend: session, models, one-shot, recovery
lib/backends/claude/       Claude Code (Agent SDK) backend: session, models, one-shot
lib/challenger-agent.js    One-shot challenger prompt/context/parser helpers
lib/challenger-coordinator.js Challenger lifecycle, manual/automatic review orchestration
lib/memory-coordinator.js  Auto-capture of investigation findings into Graphiti memory
lib/eval-cases.js          Merge analyst label overrides (edit/sign-off) over baked eval cases
lib/eval-runner.js         In-app eval runner: run cases through the session machinery, capture cost, score
lib/evidence-summary.js    JSON evidence summary classification, inline HTML, CSV export
lib/evidence-backfill.js   Background device-metadata enrichment for evidence views
lib/excli-broker.js        Local socket broker: injects creds for excli; privileged executeApproved() for approved writes
lib/excli-readonly.js      Annotation-driven read/write classifier (readOnlyHint) + denylist fallback + read-only guard
lib/action-store.js        File-based proposed-action records + one-shot state machine + <pending-actions> render
lib/action-broker.js       Agent-facing ./propose-action socket (validates + persists a proposed write; never executes)
lib/action-index.js        In-memory open-action index for the real-time cross-session approval dashboard
lib/excli-cassette.js      excli record/replay store (cassettes) for offline eval runs
lib/falkor-client.js       Dependency-free read-only FalkorDB (RESP) client (GRAPH.RO_QUERY)
lib/memory-graph.js        Memory-graph queries (overview/search/neighbors/quality) + untyped-drift watch
lib/local-origin.js        Local-origin checks for mutating API requests
lib/security-headers.js    HTTP security response headers
lib/pdf-export.js          WeasyPrint PDF rendering/download helper
lib/redaction.js           Exact-value and EXTRAHOP_* redaction helpers
lib/route-utils.js         Shared route/session lookup helpers
lib/secrets.js             Memory/keychain/Secret Service/file secret abstraction
lib/session-store.js       Session summaries, workspace recovery, JSONL backfill
lib/settings.js            Local settings, memory config, safe session env construction
lib/system-preflight.js    Local readiness checks for Pi, excli broker, packet tools, credentials
lib/uploads.js             Upload naming and attachment validation helpers
lib/wireshark.js           Wireshark detection for the "Open in Wireshark" action
routes/                    Express route modules (settings, models, sessions, files, health, eval, memory-graph, actions)
routes/actions.js          Approval API: GET /pending + /stream (cross-session), POST /:id/decide (approve/reject → execute)
propose-action             Agent interface (repo root): propose a write-class action for human approval
public/                    Browser UI (incl. eval tab, memory-graph overlay, self-hosted Source Sans 3)
public/js/actions.js       In-chat approval tray + shared action-card/decide (per-session pending writes)
public/js/approvals.js     Cross-session approval dashboard: header badge + panel, live SSE stream, staleness/notify
public/js/memory.js        Memory-graph overlay: SVG ego-network + inspector ("What do we know?")
skills/                    Project-local skills (excli, architecture, reporting, workspace, investigation-memory, evidence-ladder)
pi-extensions/graphiti-memory.ts  Pi memory tools (memory_search/memory_add) over the Graphiti MCP endpoint
eval/cases/                Real curated ground-truth eval cases (schema + README; environment-derived)
eval/harness/              Phase 0 eval runner + scorers (score.js + tests, cases.js, run-eval.js CLI, runner.js live scaffold, example-cases/ + example-results/ demo set)
eval/dashboard/            Eval results dashboard — schemas + fixtures + validator (M0), generator build.js (M1 scorecards/trend, M3 diff, M5 backend split), ci.sh (M4)
.github/workflows/         Sample CI: eval-dashboard.yml (M4 — gate check + HTML artifact)

# Docker + memory stack (operator additions)
Dockerfile                 App image (Node 22; Pi + Claude CLIs, excli, weasyprint, jq, tshark)
docker-compose.yml         Four-service stack: app, graphiti-mcp, falkordb, ollama
docker-compose.qwen.yml    Overlay for the local-LLM (qwen) memory comparison
docker-compose.eval.yml    Overlay for a read-only eval instance (eh-eval project, port 3101)
.dockerignore              Build-context excludes (host state, secrets)
scripts/docker-entrypoint.sh  Self-heals bin/excli on container start
graphiti/config.yaml       Graphiti LLM/embedder/store config + ExtraHop ontology
graphiti/runtime/embedder.env  App-managed embedder overrides (gitignored; from Settings → Memory)
graphiti/Dockerfile        Graphiti image patches (anthropic pkg, host check, temperature)

scripts/bootstrap.sh       One-command setup/start helper
scripts/run-eval-live.sh   One command: rebuild + read-only eval instance + live harness run + dashboard
scripts/fetch-excli.sh      Fetch + checksum-verify excli from the pinned upstream source
scripts/update-excli.sh    Refresh the pinned excli release (local override)
scripts/check-syntax.sh    Syntax check helper
start.sh                   Operator launcher that runs bootstrap with --start
vendor/excli/              Pinned excli source ref (source.env + checksums); binaries are fetched, not committed
bin/excli                  Active ExtraHop CLI binary installed by bootstrap; used only by the broker
excli-interface            Agent-facing broker interface for excli
requirements.txt           Optional WeasyPrint dependency for PDF export
.env.example               Environment template (RevealX, Anthropic, memory, tuning)

docs/AGENT_SETUP_GUIDE.md  Deployment runbook for coding agents
docs/ALPHA_TESTER_NOTES.md Alpha-tester notes
docs/EXCLI_MAINTENANCE.md  Maintenance guide for the pinned excli release
docs/CHANGES.md            Complete change inventory for the local (26.07.10) build
docs/DESIGN-graphiti-memory.md       Memory-layer design and rationale
docs/DESIGN-memory-visualization.md  Memory-graph viz design (v1 built: contextual recall; v2 = sigma real-time)
docs/DESIGN-warrant-harness.md       Investigation-harness proposal (future)
docs/warrant-harness.html            Visual reference for the harness proposal
docs/DESIGN-evidence-ladder.md       Phase 1: evidence-ladder skill rationale + migration gaps
docs/DESIGN-eval-harness.md          Phase 0: investigation evaluation-harness design
docs/PLAN-eval-dashboard.md          Implementation plan for the eval results dashboard
docs/DECISION-backends.md            Pi vs. Claude Code positioning + on-prem local-model path
```

Generated or machine-specific content is ignored:

- `node_modules/`
- `.venv/`
- `workspaces/`
- `.env`
- `config.json`, `secrets.json` (persisted in the `config_data` volume under Docker; never committed)
- `bin/excli`, the active CLI binary that bootstrap installs from the `vendor/excli/` release for the detected OS/CPU
- logs, PID files, and OS metadata
- `dist/` package outputs
- `vendor/excli-*` release artifacts

## For Codex, Claude, or Another Coding Agent

Goal: deploy this repo on a new machine without importing playground state.

1. Work only in this repository root.
2. Do not copy `workspaces/`, `.venv/`, `node_modules/`, `.git`, `config.json`,
   `.env`, logs, PID files, or `.DS_Store` from a playground directory.
3. If `bin/excli` is included, use it with the packaged repository-root `./excli-interface`
   interface. On macOS, clear quarantine if Gatekeeper blocks it:
   `xattr -dr com.apple.quarantine ./bin/excli`. If it is missing or for
   the wrong platform, obtain the platform-appropriate ExtraHop CLI release
   asset from the operator. It is available at customer.extrahop.com in the
   ExtraHop User Forums, Agentic Ops group. Use one of these forms:
   - `EXCLI_ARCHIVE=/absolute/path/to/excli-<os>-<arch>-*.tar.gz`
   - `EXCLI_URL=https://.../excli-<os>-<arch>-*.tar.gz`
   - `EXCLI_PATH=/absolute/path/to/excli`
4. Run `./start.sh`.
5. If prompted, enter ExtraHop credentials, or configure them later in the UI.
6. Verify [http://localhost:3100/api/health](http://localhost:3100/api/health)
   returns JSON and [http://localhost:3100](http://localhost:3100) loads.
7. Start a new session and ask the agent to run `./excli-interface -listtools` if you need
   to confirm the ExtraHop CLI is reachable.

If Pi is installed but not authenticated, pause and ask the operator to complete
Pi provider auth. Do not invent or store provider credentials in the repo.

## Development

### Developer commands

Every supported command in one place. All run from a clean clone after
`npm ci` (or `./start.sh` / `npm run bootstrap` for first-run setup).

| Command | Purpose |
| --- | --- |
| `npm run bootstrap` | First-run setup + repair: verifies Node 22.19+/npm, fetches + installs excli for this platform, restores execute bits. |
| `npm ci` | Install locked dependencies. |
| `npm run check` | Syntax check (`node --check`) across `server.js`, `lib/`, `routes/`, `public/`, `smoke/`. |
| `npm run lint` | Static analysis: ShellCheck over the shell scripts + Hadolint over the Dockerfiles (both must be installed). |
| `npm test` | Unit and module tests (`node --test`). |
| `npm run smoke` | Minimal browser smoke: boots the app, loads the SPA, asserts `/api/health` is 200 and there are no console errors. Run `npx playwright install chromium` once first. |
| `npm run check:claude-sdk` | Verify the Claude Agent SDK is importable and its arch-native CLI binary is present. |
| `npm start` | Start the server (binds `127.0.0.1:3100`; override with `PORT=…`). |
| `npm run setup:python` | Create the Python venv used by memory-extraction tooling. |
| `npm run setup:weasyprint` | Install WeasyPrint (HTML→PDF export) plus the Python venv. |
| `./start.sh` | Operator launcher: runs bootstrap, then starts the server in the background (`--foreground` to attach). |
| `docker compose up -d --build` | Build and run the full stack (see [Quickstart — Docker Desktop](#quickstart--docker-desktop)). |

Override the port for `npm start`:

```bash
PORT=3200 npm start
```

### Application version

The repo-root **`VERSION`** file is the single canonical application (bundle)
version — it drives `docs/CHANGES.md`, the release/packaging convention, and the
`version` field of `GET /api/health`. `package.json`'s `version` is not
authoritative (it can't mirror the date-based value as valid semver).

## Contributing

Changes are planned in GitHub issues and merged to `main` through pull requests.
See [CONTRIBUTING.md](CONTRIBUTING.md) for the contributor entry point and
[docs/GIT-WORKFLOW.md](docs/GIT-WORKFLOW.md) for the complete branch, commit,
validation, review, merge, and release process.

## Security Notes

This is a localhost tool. The web UI has no authentication, and the agent gets
shell access inside per-session workspaces. ExtraHop credentials are not passed
to the Pi process. Instead, Pi calls the project-local `./excli-interface`;
that interface sends argv/cwd to a Unix-domain-socket broker in the Express server;
the broker validates that cwd belongs to a known session workspace, injects
credentials only into the `bin/excli` child process, and streams output
back without logging secrets.

This reduces accidental leakage into LLM context, normal shell environment,
tool logs, transcripts, SSE, and browser-visible errors. It is not a hard
security boundary against a malicious same-user process with unrestricted local
shell access. For that threat model, run Pi under a separate OS user,
container, or sandbox while the server/broker keeps secret access. Do not
expose the port beyond the local machine without adding authentication and
sandboxing appropriate to your environment. Mutating API requests are
restricted to local same-origin browser requests using host, origin/referrer,
and fetch metadata checks.

**Governed writes.** The agent cannot mutate ExtraHop: write-class excli tools
are refused on its broker socket, so a write only ever happens server-side in
`ExcliBroker.executeApproved()`, reached exclusively by a human approving a
proposal via `POST /api/actions/:id/decide` (behind the local-origin guard) and
re-validated as write-class before it runs. The agent proposes; a separate,
human-gated path disposes. This keeps investigation read-only by default while
still allowing remediation, and the classification is annotation-driven so a new
write tool is gated correctly by default. Note the approval UI, like the rest of
the app, has no authentication — reachability of the localhost port equals the
ability to approve, so keep the port local (see above) until you add auth.

**Secrets at rest.** With the file secret backend (the Docker deployment sets
`EH_SECRETS_PATH`), credentials and API keys are stored as plaintext in a 0600
`secrets.json` inside the `config_data` volume — the same posture as `.env`,
not encryption. This is acceptable for a single-host, localhost-only tool, but
protect the volume accordingly. The memory-extraction path proxies Anthropic
calls through the app (`/memory-llm`) so the graph containers never hold the raw
key. Rotate any key that has passed through a shared channel (pasted into a
chat, a ticket, or shell history).

## License

This project's own source is released under the [MIT License](LICENSE).

The MIT grant covers **this repository's code only**. Third-party components
that the build fetches or installs separately are **not** relicensed by it and
retain their own terms — most notably the ExtraHop CLI (`excli`), which is
fetched at build/install time and carries no redistribution grant of its own
(see [docs/EXCLI_MAINTENANCE.md](docs/EXCLI_MAINTENANCE.md)), plus the base
container images and the globally installed agent CLIs.
