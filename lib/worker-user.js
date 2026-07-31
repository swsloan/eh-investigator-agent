// Non-root worker runtime (#97). Single source of the dedicated worker UID/GID
// that the root control plane drops to when it spawns the agent (Claude/Pi CLI)
// as a child process. A non-root child cannot read the root control plane's
// `/proc/1/environ` or a 0600 root-owned `secrets.json`, which closes the two
// isolation vectors env-scrubbing alone could not (see docs/DESIGN-worker-isolation.md).
//
// Gated: the boundary only applies when a worker UID is configured AND the
// control plane is root (the hardened container). The default local (loopback)
// deployment runs the control plane unprivileged, so these helpers return null
// and the agent runs in-process exactly as before.

import fs from 'node:fs';

const DEFAULT_WORKER_HOME = '/home/worker';

function selfUid(getuid) {
  if (typeof getuid !== 'function') return null;
  try { return getuid.call(process); } catch { return null; }
}

/**
 * Resolve the configured non-root worker identity from the environment. Pure and
 * side-effect free: returns `{ uid, gid, home }` when `EH_WORKER_UID` is a
 * non-negative integer, else `null`. `EH_WORKER_GID` defaults to the uid;
 * `EH_WORKER_HOME` defaults to /home/worker (where the re-homed Pi/Claude auth
 * volumes live in the hardened profile). Exported for unit testing.
 */
export function resolveWorkerUser({ env = process.env } = {}) {
  const uidRaw = env.EH_WORKER_UID;
  if (uidRaw === undefined || uidRaw === null || String(uidRaw).trim() === '') return null;
  const uid = Number(uidRaw);
  if (!Number.isInteger(uid) || uid < 0) return null;

  const gidRaw = env.EH_WORKER_GID;
  const gidNum = Number(gidRaw);
  const gid = gidRaw !== undefined && String(gidRaw).trim() !== '' && Number.isInteger(gidNum) && gidNum >= 0
    ? gidNum
    : uid;

  const homeRaw = env.EH_WORKER_HOME;
  const home = homeRaw && String(homeRaw).trim() !== '' ? String(homeRaw) : DEFAULT_WORKER_HOME;

  return { uid, gid, home };
}

/**
 * Spawn credentials to lower an agent child process to the non-root worker, or
 * `null` to spawn unchanged. Returns `{ uid, gid, home }` only when a worker UID
 * is configured AND this process is root (root is required to set a child's
 * uid/gid; a non-root process attempting it would get EPERM).
 *
 * Fail closed: if a worker UID is configured and the hardened profile is active
 * but this process is NOT root, throw. Running the agent worker as root when
 * isolation was explicitly requested would silently drop the boundary, so refuse
 * instead. Outside the hardened profile a misconfiguration is a dev convenience:
 * warn and fall back to the in-process path.
 */
export function workerSpawnUser({ env = process.env, getuid = process.getuid, logger = console } = {}) {
  const wu = resolveWorkerUser({ env });
  if (!wu) return null;
  if (selfUid(getuid) === 0) return wu;
  if (env.EH_DEPLOYMENT_PROFILE === 'hardened') {
    throw new Error(
      `Worker isolation is enabled (EH_WORKER_UID=${wu.uid}) but the control plane is not running as root; `
      + 'refusing to run the agent worker without the non-root boundary.',
    );
  }
  logger?.warn?.(
    '[worker-user] EH_WORKER_UID is set but this process is not root; running the agent in-process (dev fallback).',
  );
  return null;
}

/**
 * When worker isolation is active (configured + root), make a broker's
 * Unix-socket directory and socket file reachable by the non-root worker: chown
 * both to the worker so it can traverse the 0700 dir and connect the socket
 * (0660). The root control plane keeps serving regardless — it owns the listening
 * fd and bypasses DAC. No-op when isolation is off or this process is not root.
 * Best-effort: never throws (a failed chown must not take down the broker).
 *
 * The socket file is created asynchronously by `server.listen()`, so the chmod/
 * chown is applied on the server's 'listening' event when it is not yet up.
 *
 * @param {object}   args
 * @param {import('node:net').Server} [args.server] the broker's net.Server
 * @param {string}   args.dir        the socket directory (already created, 0700)
 * @param {string}   args.socketPath the socket path inside `dir`
 */
/**
 * Give the non-root worker ownership of paths the root control plane created that
 * the worker must write into — chiefly a session's workspace directory, since the
 * control plane (root) creates it but the lowered worker runs its turn there (#97).
 * Shallow by design: the agent's own files inside the workspace are created by the
 * worker and are already worker-owned, so a recursive chown on every construct is
 * unnecessary. No-op when isolation is off or this process is not root. Best-effort.
 */
export function chownPathsForWorker(paths = [], { env = process.env, getuid = process.getuid } = {}) {
  const wu = resolveWorkerUser({ env });
  if (!wu) return;
  if (selfUid(getuid) !== 0) return;
  for (const p of paths) {
    if (!p) continue;
    try { fs.chownSync(p, wu.uid, wu.gid); } catch { /* best effort */ }
  }
}

export function secureBrokerForWorker({ server, dir, socketPath, env = process.env, getuid = process.getuid } = {}) {
  const wu = resolveWorkerUser({ env });
  if (!wu) return;
  if (selfUid(getuid) !== 0) return;

  if (dir) { try { fs.chownSync(dir, wu.uid, wu.gid); } catch { /* best effort */ } }

  const secureSocket = () => {
    if (!socketPath) return;
    try {
      fs.chownSync(socketPath, wu.uid, wu.gid);
      fs.chmodSync(socketPath, 0o660);
    } catch { /* best effort */ }
  };

  if (!server) { secureSocket(); return; }
  if (server.listening) secureSocket();
  else server.once('listening', secureSocket);
}
