import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { streamCsvFileInWorker, summarizeEvidenceFileInWorker } from './evidence-worker.js';

// Minimal session: the worker only needs resolveFile() plus a place to record
// its in-flight counter.
function makeSession(files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eh-evidence-worker-'));
  for (const [rel, value] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, typeof value === 'string' ? value : JSON.stringify(value));
  }
  return { id: 'test-session', resolveFile: (rel) => path.join(dir, rel) };
}

const RECORDS = {
  records: [
    { timestamp: 1, ipaddr: '10.0.0.1', method: 'GET', statusCode: 200 },
    { timestamp: 2, ipaddr: '10.0.0.2', method: 'POST', statusCode: 500 },
  ],
};

test('summarizes an evidence JSON file in a worker thread', async () => {
  const session = makeSession({ 'evidence/records/http.json': RECORDS });
  const result = await summarizeEvidenceFileInWorker(session, 'evidence/records/http.json');
  assert.ok(result, 'worker returned a summary');
  assert.equal(typeof result, 'object');
  // The in-flight counter must be released even on the success path.
  assert.equal(Number(session.pendingEvidenceTasks || 0), 0);
});

test('streams a CSV export in chunks from a worker thread', async () => {
  const session = makeSession({ 'evidence/records/http.json': RECORDS });
  let filename = '';
  const chunks = [];
  await streamCsvFileInWorker(session, 'evidence/records/http.json', {
    onCsvMetadata: (meta) => { filename = meta.filename; },
    onCsvChunk: (chunk) => { chunks.push(Buffer.from(chunk)); },
  });
  const csv = Buffer.concat(chunks).toString('utf8');
  assert.match(filename, /\.csv$/, 'metadata carried a .csv filename');
  assert.ok(chunks.length > 0, 'at least one chunk was streamed');
  assert.match(csv, /ipaddr/, 'CSV contains a column from the source JSON');
  assert.match(csv, /10\.0\.0\.1/, 'CSV contains row data');
  assert.equal(Number(session.pendingEvidenceTasks || 0), 0);
});

// Validation happens in resolveEvidenceJsonFile *before* any promise is
// created, so these failures surface as synchronous throws rather than rejected
// promises. Callers must therefore use try/catch around `await` (as
// routes/files.js does) and cannot rely on `.catch()` alone.
async function captureError(fn) {
  try {
    await fn();
  } catch (err) {
    return err;
  }
  throw new Error('expected an error');
}

test('a missing file fails and never spawns a worker', async () => {
  const session = makeSession();
  const err = await captureError(() => summarizeEvidenceFileInWorker(session, 'evidence/records/absent.json'));
  assert.equal(err.statusCode, 404);
  assert.match(err.message, /not found/i);
  assert.equal(Number(session.pendingEvidenceTasks || 0), 0);
});

test('a non-summarizable path is rejected before a worker is spawned', async () => {
  const session = makeSession({ 'notes.txt': 'plain text' });
  const err = await captureError(() => summarizeEvidenceFileInWorker(session, 'notes.txt'));
  assert.match(err.message, /Summaries are available for JSON/);
  assert.equal(Number(session.pendingEvidenceTasks || 0), 0);
});
