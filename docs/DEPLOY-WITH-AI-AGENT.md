# Deploy with an AI agent

A self-contained prompt you can hand to an AI coding agent (Claude Code, Cursor,
etc.) to clone this repository and bring the whole stack up in Docker Desktop.

It builds everything from source — the app and `graphiti-mcp` images build from
committed Dockerfiles; `falkordb` and the llama.cpp `embeddings` server pull
public images; the ExtraHop CLI is extracted from the bundled archives under
`vendor/excli/` at build time.
Nothing needs to be created beforehand, and no credentials are required just to
start the containers.

For the human-oriented version of the same steps, see
**[Quickstart — Docker Desktop](../README.md#quickstart--docker-desktop)** in the
README.

---

## The prompt

Copy everything in the block below into your AI agent.

```
Deploy the ExtraHop Investigation Agent to Docker Desktop from GitHub.

REPO: https://github.com/swsloan/eh-investigator-agent

GOAL
Clone the repo, build the container images, start the full stack, and confirm
the web UI is reachable. Report back the URL and health status when done.

PREREQUISITES (check first; stop and tell me if any fail)
- Docker Desktop is installed and running (`docker version` succeeds and shows a
  Server section; `docker compose version` shows Compose v2).
- Docker Desktop has ~8 GB RAM and ~12 GB free disk available — the stack
  includes a small llama.cpp embedding server image plus a ~274 MB local
  embedding model downloaded on first run.
- Git is available. The repo is public, so `git clone` needs no authentication.
  (If a clone ever fails with an auth error because access changed, stop and tell
  me rather than guessing.)
- Build on (or for) the SAME CPU architecture you will run on. The Claude Code
  backend ships an architecture-native binary that `docker build` installs for
  the build machine only, so an image built for one arch (e.g. amd64/x86_64) will
  fail on another (e.g. arm64/Apple Silicon, Graviton). Building and running on
  the same host — the normal case — is correct automatically. Only if you build
  on one machine and deploy to a different-arch host, build with
  `docker buildx build --platform linux/<arch> .` for the target arch.

STEPS
1. Clone and enter the repo:
     git clone https://github.com/swsloan/eh-investigator-agent.git
     cd eh-investigator-agent
2. Read the "Quickstart — Docker Desktop" section of README.md and follow it. In
   short:
     docker compose build      # builds the app + graphiti-mcp images from source
     docker compose up -d       # starts app, graphiti-mcp, falkordb, embeddings
   The first build takes several minutes (npm install, image pulls, model
   download). Do not pass an .env file — every compose variable has a safe
   default, and credentials are configured in the UI afterward.
3. Wait for the app to become healthy, then verify:
     docker compose ps          # expect 4 services running (+ embeddings-init exited); app maps 127.0.0.1:3100
     curl -s http://localhost:3100/api/health   # expect JSON with "ok":true

SUCCESS CRITERIA
- `docker compose ps` shows all four services up (eh-investigator, graphiti-mcp,
  falkordb, embeddings). A fifth, `embeddings-init`, runs once to download the
  model and then exits (state "Exited (0)") — that is expected, not a failure.
- `curl http://localhost:3100/api/health` returns {"ok":true,...}.
- http://localhost:3100 loads the Investigator web UI.

REPORT BACK
- The health-check output and the list of running services.
- The URL to open (http://localhost:3100).
- A note that the app starts WITHOUT credentials: to actually run investigations,
  the user opens Settings → Connection (ExtraHop RevealX host + API key, or 360
  client credentials) and Settings → Agent (an Anthropic API key or a Claude
  Pro/Max subscription token). Do not attempt to enter or fabricate any
  credentials yourself — leave that to the user.

TROUBLESHOOTING
- Port 3100 already in use: check `docker compose ps` / `docker ps` for an
  existing instance before starting another.
- Build fails on image pulls: confirm Docker Desktop has internet access and
  enough disk; re-run `docker compose build`.
- Embedding model download is slow: the `embeddings-init` container fetches a
  ~274 MB model on first run; that's expected — let it finish. The `embeddings`
  service waits for it before starting.
- Build aborts with "Claude Agent SDK native binary for <arch> is not installed":
  the build dropped optional npm dependencies. Do not set `--omit=optional` /
  `NODE_ENV` that omits optional deps, and rebuild with `docker compose build
  --no-cache eh-investigator`.
- A session fails with "Native CLI binary for linux-<arch> not found": the image
  was built for a different CPU architecture than it is running on. Rebuild on/for
  the run host: `docker compose build --no-cache eh-investigator && docker compose
  up -d` (or `docker buildx build --platform linux/<arch> .` when cross-building).
  The container logs also print this warning at startup.
- Do not modify docker-compose.yml, the Dockerfiles, or volume definitions;
  report any error instead of working around it.
```

---

## Notes

- **Repo access.** The repository is public, so any agent can clone it with no
  authentication. (If it is ever switched back to private, the agent would need
  GitHub credentials; the prompt tells it to stop and flag an auth failure rather
  than guess.)
- **Guardrails.** The prompt deliberately tells the agent **not** to enter
  credentials or edit the Compose/Dockerfiles, so an unattended run brings up a
  clean, unconfigured stack and hands the sensitive steps back to you.
- **Data persistence.** Sessions, settings, and the memory graph persist in
  project-managed Docker volumes across restarts and rebuilds. To update after a
  `git pull`, rebuild just the app: `docker compose up -d --build eh-investigator`.
- **CPU architecture.** The Claude Code backend uses an architecture-native binary
  bundled by the Claude Agent SDK. The build fails fast if that binary is missing
  for the build arch, and the container warns at startup if the image's arch does
  not match the host — so the "Native CLI binary … not found" error is caught up
  front. Build on the same host you run on (the default), or cross-build for the
  target with `docker buildx build --platform linux/<arch>`.
