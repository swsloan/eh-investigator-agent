# Hardened-profile validation runbook (#24, slice 4)

The hardened profile is **experimental**. Per #24 it becomes the default only
after an operator runs this suite on a real host and signs off. This runbook is
the sign-off procedure: how to bring the hardened stack up **without disturbing a
running deployment**, the checks to perform (auth, isolation, and the full
functional matrix), and the migration / rollback / recovery steps.

Nothing here can be executed in the project's CI or a shared dev sandbox: it needs
a real host with Docker, a reachable RevealX appliance (or 360 tenant) for the
write-path and PCAP checks, and model credentials. The steps are written so they
can be copy-pasted on that host.

## 0. Bring it up on a throwaway project name (no collision)

The base compose pins `name: eh-investigator`. Validate under a **different
project name** so the throwaway stack has its own containers, networks, and
volumes and cannot touch a running deployment or its memory/sessions:

```bash
# Separate project + separate volumes; -p overrides the compose `name:`.
export COMPOSE_PROJECT=eh-hardened-validate
npm run compose:hardened -- -p "$COMPOSE_PROJECT" up -d --build
```

`compose:hardened` generates `EH_MEMORY_PROXY_TOKEN` and `EH_AUTH_TOKEN` under
`.runtime/hardened.env` (0600) and fails closed if either is missing. Tear down at
the end with `-p "$COMPOSE_PROJECT" down -v` to delete the throwaway volumes.

## 1. Authentication (slice 1)

```bash
BASE=http://127.0.0.1:3100
# API without a credential is rejected:
curl -s -o /dev/null -w '%{http_code}\n' $BASE/api/health            # expect 401
# Bearer token works:
curl -s -o /dev/null -w '%{http_code}\n' \
  -H "Authorization: Bearer $EH_AUTH_TOKEN" $BASE/api/health         # expect 200
# Browser nav without a cookie is redirected to /login:
curl -s -o /dev/null -w '%{redirect_url}\n' -H 'Accept: text/html' $BASE/  # /login
```

- [ ] Fail-closed proven: with `EH_DEPLOYMENT_PROFILE=hardened` and no
      `EH_AUTH_TOKEN`, the app **exits non-zero and never listens**.
- [ ] The internal FalkorDB browser (`:3001`) and Graphiti MCP (`:8000`) are **not**
      reachable from the host (slice 2 port tightening):
      `curl -sS -m2 http://127.0.0.1:3001` fails to connect.

## 2. Container confinement (slice 2)

```bash
docker inspect "${COMPOSE_PROJECT}-eh-investigator-1" \
  --format 'CapDrop={{.HostConfig.CapDrop}} SecOpt={{.HostConfig.SecurityOpt}} Mem={{.HostConfig.Memory}} Pids={{.HostConfig.PidsLimit}}'
```

- [ ] `CapDrop=[ALL]`, `SecOpt` contains `no-new-privileges`, memory and PID
      limits are set — on each long-running service.

## 3. Worker secret isolation (slice 3 + the worker-runtime follow-up)

Run these **from inside a worker shell** — i.e. have the agent run the command, or
`docker compose ... exec` the container the agent runs in.

Env scrub (must pass now, in-process):

```bash
# From the agent's own shell: none of these may print a value.
for v in EXTRAHOP_API_KEY EH_MEMORY_PROXY_TOKEN EH_AUTH_TOKEN \
         FALKORDB_PASSWORD OPENAI_API_KEY RL_API_TOKEN BRAVE_SEARCH_API_KEY; do
  printf '%s=%s\n' "$v" "$(printenv "$v")"
done
```

- [ ] Every line prints an empty value (the worker env is scrubbed).

`/proc` and file vectors (pass **only** once the worker runs under a distinct,
non-root UID — the separate worker-runtime effort; see
[DESIGN-worker-isolation.md](DESIGN-worker-isolation.md)):

```bash
cat /proc/1/environ | tr '\0' '\n' | grep -E 'EXTRAHOP_API_KEY|EH_AUTH_TOKEN' && echo LEAK || echo ok
cat /app/data/secrets.json 2>&1 | head -c 1 && echo ' (readable = LEAK)' || echo 'ok (not readable)'
```

- [ ] With the in-process worker (current ceiling): these are expected to **LEAK**
      — record it as the known residual.
- [ ] With the worker-runtime follow-up: both must report `ok` (permission denied)
      before that item can be checked off.

## 4. Functional matrix (must match the current deployment)

Exercise each capability end to end and confirm parity with the non-hardened
deployment:

- [ ] **Graphiti memory** — run an investigation; confirm an episode is written
      (memory panel shows it; `search` returns it) and recalled next session.
- [ ] **Governed writes** — propose an `update_detection` (e.g. `status`), approve
      it, confirm it reaches **verified** via read-back (#23), then revert.
- [ ] **Uploads** — attach a file; the agent can read it from the workspace.
- [ ] **PDF export** — generate a report and export it; the PDF renders.
- [ ] **PCAP** — download a PCAP for a detection; tshark parsing works.
- [ ] **Session restore** — restart the stack; existing sessions, evidence, and
      settings are intact.
- [ ] **Upgrade** — pull a new image tag and recreate; sessions/settings/memory
      survive.
- [ ] **Shutdown** — `down` drains cleanly with no lost in-flight action state.

## 5. Migration, rollback, recovery

- **Migration** (to the worker-runtime follow-up): a container-init step chowns the
  workspace and backend auth volumes to the worker UID on first hardened start;
  existing sessions/reports persist (same volume, new owner). No data moves between
  volumes.
- **Rollback**: drop the overlay / revert the image tag. Volumes remain
  root-readable, so returning to the in-process deployment keeps all sessions,
  settings, and memory — the change is UID/permissions only, no schema or path
  change.
- **Recovery**: if the chown init fails, the container **fails closed** (the worker
  cannot write its workspace) rather than silently running as root.

## 6. Sign-off checklist (gates the default flip)

The hardened profile may become the default only when **all** of these hold:

- [ ] §1 auth + fail-closed pass.
- [ ] §2 confinement pass on every service.
- [ ] §3 env scrub passes; and (post worker-runtime) the `/proc` + `secrets.json`
      vectors report `ok`.
- [ ] §4 functional matrix matches the current deployment with no regressions.
- [ ] §5 rollback rehearsed once, losing nothing.
- [ ] Owner sign-off recorded (date + who) in this file or the release notes.

Until then, the base `docker compose up` (local, loopback-only) remains the
default and is unaffected by any of the above.
