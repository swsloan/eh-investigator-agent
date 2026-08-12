// The live eval runner's result capture. Run: node --test eval/harness/runner.test.js
//
// The bug this covers: the runner only ever fetched verdict.json, so every live
// run scored cost=0 — a cost comparison that silently reported "free". It is
// driven here against a stub app (a real HTTP server speaking the same four
// endpoints) so the capture is exercised without an appliance or a model.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { runCases } from './runner.js';

/** A stand-in app: one session, one turn, then a verdict and its usage. */
function stubApp({ usageStatus = 200, verdictStatus = 200, usage } = {}) {
  const seen = { messages: 0 };
  let polls = 0;
  const server = http.createServer((req, res) => {
    const send = (code, body) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(typeof body === 'string' ? body : JSON.stringify(body));
    };
    if (req.method === 'POST' && req.url === '/api/sessions') return send(200, { id: 'S1' });
    if (req.method === 'POST' && req.url === '/api/sessions/S1/message') { seen.messages++; return send(200, { ok: true }); }
    // Report running once, then idle — so the runner's wait loop is exercised.
    if (req.url === '/api/sessions') return send(200, [{ id: 'S1', running: ++polls < 2 }]);
    if (req.url === '/api/sessions/S1/files/evidence/verdict.json') {
      return verdictStatus === 200
        ? send(200, { disposition: 'malicious', confidence: 'high', highest_rung_used: 'records' })
        : send(verdictStatus, { error: 'nope' });
    }
    if (req.url === '/api/sessions/S1/usage') {
      return usageStatus === 200
        ? send(200, usage ?? { cost: 7.25, tokens: 1400, cacheRead: 1280, delegatedTokens: 400, delegatedCacheRead: 380, delegations: 1 })
        : send(usageStatus, { error: 'nope' });
    }
    return send(404, { error: 'unknown' });
  });
  return server;
}

async function withStub(opts, fn) {
  const server = stubApp(opts);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eh-runner-'));
  try { await fn(url, outDir); } finally {
    await new Promise((r) => server.close(r));
    fs.rmSync(outDir, { recursive: true, force: true });
  }
}

const CASES = [{ id: 'case-a', prompt: 'investigate 10.0.0.9' }];

test('a live case captures both its verdict and what it cost', async () => {
  await withStub({}, async (url, outDir) => {
    await runCases({ appUrl: url, cases: CASES, outDir, timeoutMs: 20_000, pollMs: 20 });

    const verdict = JSON.parse(fs.readFileSync(path.join(outDir, 'case-a', 'verdict.json'), 'utf8'));
    assert.equal(verdict.disposition, 'malicious');

    // The fix: meta.json exists and carries the scorer's field names, so a live
    // run no longer scores as $0.
    const meta = JSON.parse(fs.readFileSync(path.join(outDir, 'case-a', 'meta.json'), 'utf8'));
    assert.equal(meta.cost_usd, 7.25);
    assert.equal(meta.tokens, 1400);
    assert.equal(meta.cache_read, 1280);
    assert.equal(meta.delegated_tokens, 400);
    assert.equal(meta.delegated_cache_read, 380);
    assert.equal(meta.delegations, 1);
  });
});

test('meta.json uses exactly the keys run-eval.js merges into a result', async () => {
  // readResult() Object.assigns meta.json over the verdict, and score.js reads
  // these names. A rename on either side silently reverts this fix to cost=0.
  await withStub({}, async (url, outDir) => {
    await runCases({ appUrl: url, cases: CASES, outDir, timeoutMs: 20_000, pollMs: 20 });
    const meta = JSON.parse(fs.readFileSync(path.join(outDir, 'case-a', 'meta.json'), 'utf8'));
    assert.deepEqual(Object.keys(meta).sort(), [
      'cache_read', 'cost_usd', 'delegated_cache_read', 'delegated_tokens', 'delegations', 'tokens',
    ]);
  });
});

test('an unreadable usage endpoint loses the cost but not the case', async () => {
  await withStub({ usageStatus: 500 }, async (url, outDir) => {
    await runCases({ appUrl: url, cases: CASES, outDir, timeoutMs: 20_000, pollMs: 20 });
    assert.ok(fs.existsSync(path.join(outDir, 'case-a', 'verdict.json')), 'the verdict is still scored');
    assert.ok(!fs.existsSync(path.join(outDir, 'case-a', 'meta.json')), 'no fabricated zero-cost meta');
  });
});

test('a case with no verdict still records what it spent', async () => {
  // An expensive run that produced nothing is exactly the case whose cost you
  // want to see, so usage capture must not be gated on a verdict existing.
  await withStub({ verdictStatus: 404 }, async (url, outDir) => {
    await runCases({ appUrl: url, cases: CASES, outDir, timeoutMs: 20_000, pollMs: 20 });
    assert.ok(!fs.existsSync(path.join(outDir, 'case-a', 'verdict.json')));
    const meta = JSON.parse(fs.readFileSync(path.join(outDir, 'case-a', 'meta.json'), 'utf8'));
    assert.equal(meta.cost_usd, 7.25);
  });
});
