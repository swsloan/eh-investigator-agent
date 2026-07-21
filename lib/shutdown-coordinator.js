const DEFAULT_SHUTDOWN_DEADLINE_MS = 12_000;
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function drainingGuard(isDraining) {
  return (req, res, next) => {
    if (isDraining() && !SAFE_METHODS.has(req.method)) {
      return res.status(503).json({ error: 'The application is shutting down; wait for it to restart.' });
    }
    return next();
  };
}

function loadedSessions(sessions) {
  if (typeof sessions?.loadedValues === 'function') return sessions.loadedValues();
  return [...(sessions?.values?.() || [])].filter((session) => !session?.__lazySession);
}

export function closeHttpServer(server) {
  if (!server?.close || server.listening === false) return Promise.resolve(true);
  return new Promise((resolve, reject) => {
    try {
      server.close((err) => (err ? reject(err) : resolve(true)));
      server.closeIdleConnections?.();
      server.closeAllConnections?.();
    } catch (err) {
      if (err?.code === 'ERR_SERVER_NOT_RUNNING') resolve(true);
      else reject(err);
    }
  });
}

function closeSseClients(sseClients) {
  for (const clients of sseClients?.values?.() || []) {
    for (const response of clients) {
      try { response.end(); } catch { /* already closed */ }
    }
  }
  sseClients?.clear?.();
}

async function stopLoadedSessions(sessions) {
  const active = loadedSessions(sessions);
  for (const session of active) {
    try { session.abort?.(); } catch { /* disposal still follows */ }
  }
  const stopped = await Promise.all(active.map(async (session) => {
    try {
      if (typeof session.disposeAsync === 'function') return await session.disposeAsync();
      await session.dispose?.();
      return true;
    } catch {
      return false;
    }
  }));
  return stopped.every(Boolean);
}

async function settleStep(name, fn) {
  try {
    const value = await fn();
    return { name, ok: value !== false };
  } catch (error) {
    return { name, ok: false, error };
  }
}

/**
 * Coordinate one closed-loop application shutdown. Repeated calls share the
 * same promise, so a second signal cannot interleave a second cleanup pass.
 */
export function createShutdownCoordinator({
  getServer = () => null,
  sessions,
  sseClients,
  brokers = [],
  stopAuxiliary = async () => true,
  flushIndex = () => sessions?.flushIndex?.(),
  removePortState = () => {},
  setDraining = () => {},
  deadlineMs = DEFAULT_SHUTDOWN_DEADLINE_MS,
  logger = console,
} = {}) {
  let shutdownPromise = null;
  let draining = false;
  let deadlineReached = false;

  async function perform(reason) {
    closeSseClients(sseClients);
    const sessionStep = settleStep('sessions', () => stopLoadedSessions(sessions));
    const steps = [
      settleStep('listener', () => closeHttpServer(getServer())),
      settleStep('auxiliary', stopAuxiliary),
      sessionStep,
      settleStep('session-index', flushIndex),
      ...brokers.map((broker, index) => settleStep(
        broker?.constructor?.name || `broker-${index + 1}`,
        () => broker?.stop?.(),
      )),
    ];
    const results = await Promise.all(steps);
    const failures = results.filter((result) => !result.ok);
    if (!failures.length && !deadlineReached) {
      await removePortState();
    } else {
      for (const failure of failures) {
        logger?.error?.(`[shutdown] ${failure.name} did not settle cleanly${failure.error?.message ? `: ${failure.error.message}` : '.'}`);
      }
    }
    return {
      reason,
      completed: failures.length === 0,
      timedOut: false,
      failures: failures.map((failure) => failure.name),
    };
  }

  function shutdown(reason = 'shutdown') {
    if (shutdownPromise) return shutdownPromise;
    draining = true;
    setDraining(true);
    const timeoutMs = Math.max(1, Number(deadlineMs) || DEFAULT_SHUTDOWN_DEADLINE_MS);
    shutdownPromise = new Promise((resolve) => {
      const timer = setTimeout(() => {
        deadlineReached = true;
        logger?.error?.(`[shutdown] deadline reached after ${timeoutMs}ms.`);
        resolve({ reason, completed: false, timedOut: true, failures: ['deadline'] });
      }, timeoutMs);
      perform(reason).then((result) => {
        clearTimeout(timer);
        resolve(result);
      }, (error) => {
        clearTimeout(timer);
        logger?.error?.(`[shutdown] failed: ${error.message}`);
        resolve({ reason, completed: false, timedOut: false, failures: ['shutdown'] });
      });
    });
    return shutdownPromise;
  }

  return {
    shutdown,
    isDraining: () => draining,
  };
}
