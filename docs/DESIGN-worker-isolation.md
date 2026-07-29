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

## Target architecture: close vectors 2 and 3 (non-root worker)

Deferred to a follow-up because it changes container topology and **must be
validated under a real hardened bring-up** (this cannot be done in the current
working environment without recreating the running `eh-investigator` project and
its live memory/sessions; landing it unvalidated would risk breaking the agent).

1. **Dedicated non-root worker UID.** Add an unprivileged `worker` user in the
   image. Spawn the agent CLI with that `uid`/`gid` (Node `child_process` spawn
   options). A worker UID that differs from the control-plane UID cannot read
   `/proc/<control-plane>/environ` (vector 2) and cannot read a root-owned
   `secrets.json` (vector 3).
2. **Only the workspace writable by the worker.** The worker needs its session
   workspace (`/app/workspaces/<id>`) and its agent-home (Pi/Claude login) volumes.
   Everything else — the secrets file, config, the app source — is root-owned and
   not writable (ideally not readable) by the worker UID. Requires making
   `/app/data` root-only (`0700`) and chowning the workspace + agent-home volumes
   to the worker UID at container init.
3. **Preserve Pi/Claude auth volumes without exposing app secrets.** `/root/.pi`
   and `/root/.claude` hold the backends' provider logins; re-home them to the
   worker UID (`/home/worker/.pi`, `/home/worker/.claude`) so the CLI can read/write
   its own login while the app's `secrets.json` stays root-only.
4. **Restrict worker egress.** The worker should reach only the broker sockets
   (local) and the model/MCP endpoints it needs (Anthropic API or the in-cluster
   Graphiti MCP), not arbitrary hosts. Enforce with a dedicated compose network
   whose egress is limited, or an egress proxy the worker is pinned to. (The
   research/browse tools already route through the research broker.)
5. **Optional PID-namespace separation.** Even same-UID leakage via `/proc` can be
   removed by giving the worker its own PID namespace, but a distinct UID already
   closes the `/proc/<control-plane>/environ` read, and `unshare` needs
   `CAP_SYS_ADMIN` which slice 2 drops — so the non-root UID is the primary control.

### Migration and rollback

- Ships behind the **experimental hardened profile** only; the default local alpha
  is unchanged.
- **Migration:** a container-init step chowns the workspace and agent-home volumes
  to the worker UID on first hardened start; existing sessions/reports are
  preserved (same volume, new owner). No data moves between volumes.
- **Rollback:** revert to the previous image tag / drop the overlay; the volumes
  remain readable by root, so a rollback to the root-worker deployment keeps all
  sessions, settings, and memory. Because the change is UID/permissions only (no
  schema or path changes), rollback loses nothing.
- **Recovery:** if the chown init fails, the container fails closed (worker cannot
  write its workspace) rather than silently falling back to root.

## Status against the #24 scope

| #24 scope item | Status |
| --- | --- |
| Separate brokers/secret store from the worker runtime | env vector **done** (scrub); filesystem/`/proc` vectors specified, pending non-root worker |
| Non-root worker UID, only the workspace mounted | **specified**, pending (needs validated bring-up) |
| Restrict worker egress to required endpoints | **specified**, pending |
| Preserve Pi/Claude auth volumes without exposing app secrets | **specified**, pending (re-home to worker UID) |
| A worker shell cannot read ExtraHop/RL/Brave/memory-proxy secrets | env path **enforced + tested**; fully met once the worker is non-root |

Slice 4 (the functional validation matrix + threat-model sign-off) is where the
non-root implementation is brought up on a throwaway project name and validated
against Graphiti memory, governed writes, uploads, PDF export, PCAP, session
restore, upgrade, and shutdown before the hardened profile can become the default.
