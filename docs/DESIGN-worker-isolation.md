# Design: isolating the agent worker from the control plane's secrets (#24, slice 3)

## Problem

The app is a single Node process (the **control plane**) that spawns the coding
agent (Claude Code or Pi CLI) as a **child process** — the **worker** — inside the
same container. The worker routinely runs shell commands on the operator's behalf,
so "what can a worker shell read?" is the security question that matters.

The control plane legitimately holds every integration secret: ExtraHop
credentials, the ReversingLabs token, the Brave key, the memory-proxy token, the
UI/API auth token (`EH_AUTH_TOKEN`), the FalkorDB password, and the embedder key.
The design intent has always been that the worker reaches those integrations only
through **brokers** (unix-socket servers in the control plane that inject the
secret server-side) and never holds the raw secret itself.

Acceptance criterion for #24: **a worker shell cannot read the ExtraHop,
ReversingLabs, Brave, or memory-proxy secrets.**

## The three exposure vectors

A worker running as **root in the same container** as the control plane can reach
a secret three ways:

1. **Its own environment.** If a secret env var is inherited by the spawned CLI,
   `echo $EH_AUTH_TOKEN` reads it.
2. **`/proc/<control-plane-pid>/environ`.** A process can read another process's
   environment **only if it owns it or is root**. A root worker in the same PID
   namespace can `cat /proc/1/environ` and read every secret the control plane was
   started with — regardless of how clean the worker's own env is.
3. **The secrets file.** Persisted secrets live at `/app/data/secrets.json`
   (mode `0600`, owned by root). A root worker can read it directly.

**Vector 1 is closed in this slice. Vectors 2 and 3 are only closed by running the
worker as a non-root UID distinct from the control plane** — that is the remaining
build, specified below and deferred to a validated follow-up (see "Status").

## What this slice ships: close vector 1 (env scrub)

`lib/secrets.js#buildScrubbedEnv` is the single env every agent CLI is spawned
with (Claude session/oneshot/models, Pi session/oneshot). It already stripped
`EXTRAHOP_*`, the ReversingLabs keys, the Brave/research keys, and stale broker
sockets. This slice adds `INFRA_SECRET_ENV_KEYS` — the app/infra secrets that live
in the control plane's own environment but that the worker never needs:

| Variable | Why the worker must not hold it | Why the worker doesn't need it |
| --- | --- | --- |
| `EH_MEMORY_PROXY_TOKEN` | authenticates to the `/memory-llm` proxy | only the Graphiti **sidecar** uses it |
| `EH_AUTH_TOKEN` | a worker with it could authenticate to the app **as the operator** | it is the UI/API gate, unrelated to agent work |
| `FALKORDB_PASSWORD`, `FALKORDB_URI` | direct read/write of the memory graph store | memory writes go through the Graphiti MCP tool, not raw FalkorDB |
| `OPENAI_API_KEY` | the embedder credential | only the Graphiti sidecar embeds |

The **Anthropic** model key (`ANTHROPIC_API_KEY` / OAuth token) is intentionally
**not** scrubbed here: it is the agent's own model credential, and the Claude
backend already manages it per auth-mode (subscription mode deletes it and uses
the OAuth token instead). It is not one of the criterion's integration secrets. A
future refinement could broker even the model key the way `/memory-llm` brokers it
for Graphiti, so the worker holds no model credential either; that is out of scope
here.

Tested in `lib/secrets-scrub.test.js`: a control-plane env carrying every secret
class yields a worker env with none of them, while benign/needed vars (`PATH`,
`HOME`, the MCP URL) and the agent-owned Anthropic key pass through.

## Architectural constraint: the worker's UID is coupled to the control plane's

The obvious fix for vectors 2 and 3 is "spawn the agent CLI with a non-root
`uid`/`gid`." **That is not available in-process for the Claude backend.** The
Claude worker is launched through the Claude Agent SDK's `query()`
(`lib/backends/claude/session.js`), and the SDK's `Options` surface exposes only
`cwd`, `env`, `executable`, and `executableArgs` — **no `uid`/`gid`/`user`**. The
SDK spawns the `claude` CLI itself, so the app cannot lower that subprocess's
privileges. (The Pi backend does spawn directly and *could* take a `uid`, but a
non-root boundary that protects only one of the two backends is not a boundary.)

A parent and child process with the **same UID** have no privilege boundary
between them: the worker can always read whatever the control plane can —
including `/proc/<control-plane>/environ` (vector 2) and a root-owned
`secrets.json` (vector 3). So **while the worker runs in-process, env scrubbing
(slice 3) is the ceiling; vectors 2 and 3 cannot be closed without giving the
worker a distinct UID, which requires taking it out of the control-plane
process.** This is an architecture change, not a config tweak.

### Current effective ceiling (what is enforced today)

- **slice 2** — container confinement: `cap_drop: [ALL]`, `no-new-privileges`,
  resource/PID limits, internal services unpublished from the host.
- **slice 3** — env scrub: no integration/app secret is in the worker's
  environment.

Residual (accepted, documented) risk under this ceiling: a worker shell *can*
still reach secrets via `/proc/1/environ` and `secrets.json` because it shares the
control plane's UID. Closing that requires the target architecture below.

## Target architecture: a separate worker runtime (closes vectors 2 and 3)

Give the worker a distinct, unprivileged UID by moving it out of the control-plane
process. Because the SDK cannot lower the in-process subprocess, the worker must
run in a **separate runtime** that holds no secrets and is reachable from the
control plane over the existing broker sockets. Two viable shapes:

- **Separate worker container** (recommended): a sibling service running as a
  non-root UID with only the session workspace and the backend auth volume mounted,
  no secret env, and the broker sockets bind-mounted in. The control plane
  dispatches turns to it. This is the clean, durable boundary but a substantial
  re-architecture (turn dispatch, lifecycle, and the SDK/CLI now run in the worker
  container, not the app).
- **`setuid` launcher shim**: keep the SDK in-process but have it invoke a
  `claude`-named wrapper on `PATH` that re-execs the real CLI under a non-root UID
  (via a small `setuid`-root helper or `runuser`). Lighter, but fights the SDK's
  process model and needs a privileged helper — a worse trade than a clean
  container split.

### Delivered mechanism (#97): same-container non-root subprocess

The mechanism actually built is a **third shape** that reaches the same UID
boundary far more cheaply than the sibling container while keeping the SDK's own
process model: the root control plane spawns the agent as a **child process
lowered to a dedicated non-root UID** via Node's `spawn({ uid, gid })`
(`lib/worker-user.js`). The `setuid`-shim's objection (needs a privileged helper)
does not apply here — the control plane is *already* root, so it drops privileges
for the child directly, no `setuid` binary. A non-root child in the same PID
namespace still cannot read root's `/proc/1/environ` (vector 2) or the 0600
root-owned `secrets.json` (vector 3), and every Bash command the agent runs
inherits the non-root UID. Concretely:

- **Claude**: the interactive turn's `query()` moves into
  `lib/backends/claude/worker-entry.js`, spawned lowered; its newline-delimited SDK
  messages are bridged back into the same `handleSdkMessage` translation, so the UI
  stream is unchanged. The tool-less `oneshot`/`models` helpers stay in-process
  (they never grant a shell).
- **Pi** already spawns its CLI directly, so it just gains `uid`/`gid` + `HOME`.
- **Brokers** chown their Unix-socket dir + file to the worker so the non-root
  worker can still connect (root keeps serving; it bypasses DAC).
- The control plane becomes a **privilege-dropping supervisor**, so the hardened
  overlay cannot `cap_drop: ALL`; it re-adds the minimal set CHOWN, DAC_OVERRIDE,
  SETUID, SETGID, KILL. `no-new-privileges` still blocks the child from
  re-escalating.

Gated: the boundary applies only when `EH_WORKER_UID` is set **and** the control
plane is root (the hardened profile). The default local (loopback) deployment runs
in-process exactly as before. `workerSpawnUser()` fails closed (throws) if the
hardened profile is set but the process is not root.

**Residual not covered by this mechanism:** per-worker-process **egress**
restriction (scope item below). A same-container subprocess shares the container's
network namespace, so restricting only the worker's egress would need
`CAP_NET_ADMIN` (dropped) or the sibling-container topology. The container-level
egress posture from slice 2 still applies; this is a documented limitation, not a
regression of vectors 2 & 3.

Whichever shape, the supporting changes are the same and were captured in the
original plan:

1. **Dedicated non-root worker UID** (`worker`, e.g. 10001) with **only the
   workspace writable**; `/app/data` (secrets, config) stays root-only (`0700`),
   so the worker UID cannot read `secrets.json` (vector 3) and cannot read the
   root control plane's `/proc/1/environ` (vector 2).
2. **Preserve Pi/Claude auth volumes without exposing app secrets** by re-homing
   them to the worker UID (`/home/worker/.pi`, `/home/worker/.claude`,
   `CLAUDE_CONFIG_DIR` pointed there) so the CLI keeps its own login while
   `secrets.json` stays root-only. Login becomes
   `docker compose run --user worker ... claude`.
3. **Restrict worker egress** to the broker sockets and the model/MCP endpoints it
   needs (Anthropic API or the in-cluster Graphiti MCP) via a dedicated compose
   network or an egress proxy.
4. **Optional PID-namespace separation** for defense in depth; a distinct UID is
   the primary control, and `unshare` would need `CAP_SYS_ADMIN`, which slice 2
   drops.

This was carved out as its own tracked effort (**#97**) and is now **delivered**
via the same-container non-root subprocess above. Because it changes runtime
privileges and volume ownership, it **must be validated under a real hardened
bring-up** — which cannot be done in the current working environment without
recreating the running `eh-investigator` project and its live memory/sessions.
The validation procedure (including the worker-shell `/proc` + `secrets.json`
probes) is in [HARDENED-VALIDATION.md](HARDENED-VALIDATION.md).

### Migration and rollback

- Ships behind the **experimental hardened profile** only; the default local alpha
  is unchanged.
- **Migration:** the entrypoint chowns the session workspaces and the re-homed
  agent-auth volumes to the worker UID on first hardened start; existing
  sessions/reports are preserved (same named volumes, new owner). The Pi/Claude
  auth volumes remount from `/root/.{pi,claude}` to `/home/worker/.{pi,claude}` — a
  mount-path change only, same volume and same login. No data moves between volumes.
- **Rollback:** revert to the previous image tag / drop the overlay; the volumes
  remain readable by root, so a rollback to the root-worker deployment keeps all
  sessions, settings, and memory. The change is UID/permissions + auth-volume
  mount-path only (no schema change), so rollback loses nothing.
- **Recovery:** if the entrypoint chown fails (or the entrypoint is not root), the
  container fails closed — it refuses to start rather than silently running the
  agent as root without the boundary.

## Status against the #24 scope

| #24 scope item | Status |
| --- | --- |
| Add an experimental hardened profile (not default) | **done** (slices 1–2) |
| Drop caps / no-new-privileges / limits / restrict host ports | **done** (slice 2) |
| Add auth for browser/API/SSE + fail-closed non-loopback | **done** (slice 1) |
| Separate brokers/secret store from the worker runtime | env vector **done** (slice 3 scrub); `/proc` + `secrets.json` vectors **done (#97)** — the worker runs under a distinct non-root UID (same-container subprocess) |
| Non-root worker UID, only the workspace mounted | **done (#97)** — spawned via `spawn({uid,gid})`; workspace + re-homed auth volumes chowned to the worker, `/app/data` stays root-only |
| Restrict worker egress to required endpoints | **residual** — a same-container subprocess shares the network namespace; per-worker egress needs `CAP_NET_ADMIN` or the sibling-container topology (documented above) |
| Preserve Pi/Claude auth volumes without exposing app secrets | **done (#97)** — re-homed to `/home/worker/.{pi,claude}` (hardened overlay), chowned to the worker; `secrets.json` stays root-only |
| A worker shell cannot read ExtraHop/RL/Brave/memory-proxy secrets | **env path enforced + tested; `/proc`/file path closed (#97)** — verify with the §3 probes in [HARDENED-VALIDATION.md](HARDENED-VALIDATION.md) on a real host |
| Validate functional suite; document threat model / migration / rollback / recovery | validation runbook + threat model **done** ([HARDENED-VALIDATION.md](HARDENED-VALIDATION.md)); the run itself is an operator step on a real host |
| Hardened profile becomes default only after explicit sign-off | gated by the runbook's sign-off checklist |

**Net:** slices 1–3 delivered the auth boundary, container confinement, and the
worker env-secret scrub. **#97** closes the last isolation step — a distinct
non-root worker UID for the `/proc`/`secrets.json` vectors — via a same-container
subprocess the root control plane spawns lowered (no SDK `uid` needed, because the
worker is a child process, not the in-process `query()`). The one remaining item,
per-worker egress restriction, is a documented residual of the same-container
shape. All of it must be validated per
[HARDENED-VALIDATION.md](HARDENED-VALIDATION.md) on a real host before the hardened
profile can become the default.
