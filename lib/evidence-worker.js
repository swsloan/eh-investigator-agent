import { Worker } from 'node:worker_threads';
import { resolveEvidenceJsonFile } from './evidence-summary.js';

export const EVIDENCE_WORKER_CONCURRENCY = Object.freeze({
  active: 2,
  queued: 8,
});

function abortError() {
  const error = new Error('Evidence processing was cancelled.');
  error.name = 'AbortError';
  error.statusCode = 499;
  return error;
}

function workerError(payload, fallback) {
  const error = new Error(payload?.message || fallback);
  error.statusCode = payload?.statusCode || 400;
  return error;
}

export function createEvidenceWorkerScheduler({
  maxActive = EVIDENCE_WORKER_CONCURRENCY.active,
  maxQueued = EVIDENCE_WORKER_CONCURRENCY.queued,
} = {}) {
  let active = 0;
  const queue = [];

  const diagnostics = () => ({ active, queued: queue.length, maxActive, maxQueued });
  const drain = () => {
    while (active < maxActive && queue.length) {
      const entry = queue.shift();
      entry.signal?.removeEventListener('abort', entry.onAbort);
      if (entry.signal?.aborted) {
        entry.reject(abortError());
        continue;
      }
      active += 1;
      Promise.resolve()
        .then(() => {
          if (entry.signal?.aborted) throw abortError();
          return entry.start();
        })
        .then(entry.resolve, entry.reject)
        .finally(() => {
          active -= 1;
          drain();
        });
    }
  };

  const run = (start, { signal } = {}) => {
    if (signal?.aborted) return Promise.reject(abortError());
    if (active >= maxActive && queue.length >= maxQueued) {
      const error = new Error(`Evidence processing is busy (${active} active, ${queue.length} queued). Try again shortly.`);
      error.statusCode = 503;
      error.retryAfter = 1;
      return Promise.reject(error);
    }
    return new Promise((resolve, reject) => {
      const entry = {
        start,
        signal,
        resolve,
        reject,
        onAbort: null,
      };
      entry.onAbort = () => {
        const index = queue.indexOf(entry);
        if (index < 0) return;
        queue.splice(index, 1);
        reject(abortError());
      };
      if (active < maxActive) {
        queue.unshift(entry);
      } else {
        queue.push(entry);
        signal?.addEventListener('abort', entry.onAbort, { once: true });
      }
      drain();
    });
  };

  return { run, diagnostics };
}

const evidenceWorkerScheduler = createEvidenceWorkerScheduler();

export function getEvidenceWorkerDiagnostics() {
  return evidenceWorkerScheduler.diagnostics();
}

function runEvidenceWorker(session, relPath, operation, {
  createContext = () => ({}),
  signal,
  onCsvMetadata = () => {},
  onCsvChunk = () => {},
} = {}) {
  const source = resolveEvidenceJsonFile(session, relPath, {
    requireSummarizable: operation === 'summary',
  });
  if (signal?.aborted) return Promise.reject(abortError());

  session.pendingEvidenceTasks = Number(session.pendingEvidenceTasks || 0) + 1;
  return evidenceWorkerScheduler.run(() => startEvidenceWorker(session, source, operation, {
    createContext,
    signal,
    onCsvMetadata,
    onCsvChunk,
  }), { signal }).finally(() => {
    session.pendingEvidenceTasks = Math.max(0, Number(session.pendingEvidenceTasks || 0) - 1);
  });
}

function startEvidenceWorker(session, source, operation, {
  createContext,
  signal,
  onCsvMetadata,
  onCsvChunk,
}) {
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./evidence-worker-thread.js', import.meta.url), {
      workerData: {
        abs: source.abs,
        sourcePath: source.sourcePath,
        operation,
      },
    });
    let settled = false;
    let metadata = null;
    const cleanup = () => signal?.removeEventListener('abort', onAbort);
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      void worker.terminate();
      callback(value);
    };
    const fail = (error) => finish(reject, error);
    const succeed = (value) => finish(resolve, value);
    const onAbort = () => fail(abortError());
    signal?.addEventListener('abort', onAbort, { once: true });

    worker.on('message', async (message) => {
      if (settled) return;
      try {
        if (message?.type === 'needs_context') {
          worker.postMessage({ type: 'context', context: createContext(session, message.kind) });
        } else if (message?.type === 'result') {
          succeed(message.result);
        } else if (message?.type === 'csv_metadata') {
          metadata = message.metadata;
          await onCsvMetadata({ filename: message.filename, metadata });
          if (!settled) worker.postMessage({ type: 'continue' });
        } else if (message?.type === 'csv_chunk') {
          await onCsvChunk(Buffer.from(message.chunk));
          if (!settled) worker.postMessage({ type: 'continue' });
        } else if (message?.type === 'csv_end') {
          succeed(metadata);
        } else if (message?.type === 'error') {
          fail(workerError(message.error, 'Could not process evidence.'));
        }
      } catch (error) {
        fail(error);
      }
    });
    worker.on('error', (error) => fail(error));
    worker.on('exit', (code) => {
      if (!settled) fail(new Error(`Evidence worker exited before completing (status ${code}).`));
    });
  });
}

export function summarizeEvidenceFileInWorker(session, relPath, options = {}) {
  return runEvidenceWorker(session, relPath, 'summary', options);
}

export function streamCsvFileInWorker(session, relPath, options = {}) {
  return runEvidenceWorker(session, relPath, 'csv', options);
}
