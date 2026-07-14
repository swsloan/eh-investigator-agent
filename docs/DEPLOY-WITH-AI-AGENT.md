# Deploy with an AI agent

A self-contained prompt you can hand to an AI coding agent (Claude Code, Cursor,
etc.) to clone this repository and bring the whole stack up in Docker Desktop.

It builds everything from source — the app and `graphiti-mcp` images build from
committed Dockerfiles; `falkordb` and `ollama` pull public images; the ExtraHop
CLI is extracted from the bundled archives under `vendor/excli/` at build time.
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
- Docker Desktop has ~8 GB RAM and ~15 GB free disk available — the stack
  includes an Ollama service that pulls a large image plus a local embedding
  model on first build.
- Git is available, and you have read access to the repo (it may be private; if
  `git clone` fails with an auth error, stop and tell me — you'll need a GitHub
  token or `gh auth login`).

STEPS
1. Clone and enter the repo:
     git clone https://github.com/swsloan/eh-investigator-agent.git
     cd eh-investigator-agent
2. Read the "Quickstart — Docker Desktop" section of README.md and follow it. In
   short:
     docker compose build      # builds the app + graphiti-mcp images from source
     docker compose up -d       # starts app, graphiti-mcp, falkordb, ollama
   The first build takes several minutes (npm install, image pulls, model
   download). Do not pass an .env file — every compose variable has a safe
   default, and credentials are configured in the UI afterward.
3. Wait for the app to become healthy, then verify:
     docker compose ps          # expect 4 services running; app maps 127.0.0.1:3100
     curl -s http://localhost:3100/api/health   # expect JSON with "ok":true

SUCCESS CRITERIA
- `docker compose ps` shows all four services up (eh-investigator, graphiti-mcp,
  falkordb, ollama).
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
- Ollama model download is slow: that's expected on first run; let it finish.
- Do not modify docker-compose.yml, the Dockerfiles, or volume definitions;
  report any error instead of working around it.
```

---

## Notes

- **Private repo access.** If the repository is private, the agent needs GitHub
  credentials to clone it — the prompt tells it to stop and flag that rather than
  guess. If the repo is public, any agent can clone it with no auth.
- **Guardrails.** The prompt deliberately tells the agent **not** to enter
  credentials or edit the Compose/Dockerfiles, so an unattended run brings up a
  clean, unconfigured stack and hands the sensitive steps back to you.
- **Data persistence.** Sessions, settings, and the memory graph persist in
  project-managed Docker volumes across restarts and rebuilds. To update after a
  `git pull`, rebuild just the app: `docker compose up -d --build eh-investigator`.
