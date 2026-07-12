import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkCitations } from './citation-check.js';

function makeWorkspace(verdict, files = []) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'cite-'));
  fs.mkdirSync(path.join(ws, 'evidence', 'records'), { recursive: true });
  if (verdict !== undefined) fs.writeFileSync(path.join(ws, 'evidence', 'verdict.json'), JSON.stringify(verdict));
  for (const f of files) fs.writeFileSync(path.join(ws, f), 'x');
  return ws;
}

test('no verdict → has_verdict false, coverage 0', () => {
  const ws = makeWorkspace(undefined);
  const r = checkCitations(ws);
  assert.equal(r.has_verdict, false);
  assert.equal(r.coverage, 0);
});

test('full coverage when every source exists', () => {
  const ws = makeWorkspace({
    evidence_chain: [
      { claim: 'a', source: 'evidence/records/http.json' },
      { claim: 'b', source: 'evidence/records/dns.json' },
    ],
  }, ['evidence/records/http.json', 'evidence/records/dns.json']);
  const r = checkCitations(ws);
  assert.equal(r.total, 2);
  assert.equal(r.present, 2);
  assert.equal(r.coverage, 1);
  assert.deepEqual(r.missing, []);
  assert.deepEqual(r.uncited, []);
});

test('missing file + uncited claim lower coverage', () => {
  const ws = makeWorkspace({
    evidence_chain: [
      { claim: 'real', source: 'evidence/records/http.json' },
      { claim: 'ghost', source: 'evidence/records/gone.json' },
      { claim: 'bare', source: '' },
    ],
  }, ['evidence/records/http.json']);
  const r = checkCitations(ws);
  assert.equal(r.total, 3);
  assert.equal(r.present, 1);
  assert.equal(r.coverage, Number((1 / 3).toFixed(4)));
  assert.deepEqual(r.missing, ['evidence/records/gone.json']);
  assert.deepEqual(r.uncited, ['bare']);
});

test('empty evidence_chain → coverage 0 (ungrounded)', () => {
  const ws = makeWorkspace({ evidence_chain: [] });
  const r = checkCitations(ws);
  assert.equal(r.total, 0);
  assert.equal(r.coverage, 0);
});

test('path traversal is rejected', () => {
  const ws = makeWorkspace({ evidence_chain: [{ claim: 'escape', source: '../../etc/passwd' }] });
  const r = checkCitations(ws);
  assert.equal(r.present, 0);
  assert.deepEqual(r.missing, ['../../etc/passwd']);
});
