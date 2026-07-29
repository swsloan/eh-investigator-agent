// Conclusion-quality auditor (#31). Run: node --test lib/conclusion-quality.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assessConclusionQuality, extractIps, requiredRung } from './conclusion-quality.js';

// Build a workspace: verdict.json + a set of evidence files with given contents.
function makeWorkspace(verdict, files = {}) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'cq-'));
  fs.mkdirSync(path.join(ws, 'evidence', 'records'), { recursive: true });
  fs.mkdirSync(path.join(ws, 'evidence', 'metrics'), { recursive: true });
  if (verdict !== undefined) fs.writeFileSync(path.join(ws, 'evidence', 'verdict.json'), JSON.stringify(verdict));
  for (const [rel, content] of Object.entries(files)) fs.writeFileSync(path.join(ws, rel), content);
  return ws;
}
const cleanup = (ws) => fs.rmSync(ws, { recursive: true, force: true });
const codes = (r) => r.flags.map((f) => f.code);

test('extractIps validates octets and dedupes', () => {
  assert.deepEqual(extractIps('beacon to 203.0.113.10 and 203.0.113.10 again'), ['203.0.113.10']);
  assert.deepEqual(extractIps('999.1.1.1 is not an IP'), []);
  assert.deepEqual(extractIps('two: 10.0.0.1, 172.16.5.4').sort(), ['10.0.0.1', '172.16.5.4']);
});

test('requiredRung: definitive+high needs records; inconclusive/low may stop at metrics', () => {
  assert.equal(requiredRung({ disposition: 'malicious', confidence: 'high' }), 1);
  assert.equal(requiredRung({ disposition: 'benign', confidence: 'medium' }), 1);
  assert.equal(requiredRung({ disposition: 'malicious', confidence: 'low' }), 0);
  assert.equal(requiredRung({ disposition: 'inconclusive', confidence: 'high' }), 0);
});

test('a sound investigation scores high with no flags', () => {
  const ws = makeWorkspace(
    {
      disposition: 'malicious', confidence: 'high', highest_rung_used: 'records',
      evidence_chain: [
        { claim: '60s periodic beacon to 203.0.113.10', source: 'evidence/metrics/beacon.json' },
        { claim: 'TLS SNI resolves to attacker CDN', source: 'evidence/records/ssl.json' },
      ],
      timeline: [{ time: 't', event: 'beacon starts', detail: '203.0.113.10 contacted', evidence: 'evidence/records/ssl.json' }],
      residual_uncertainty: '',
    },
    {
      'evidence/metrics/beacon.json': '{"peer":"203.0.113.10","interval":60}',
      'evidence/records/ssl.json': '{"sni":"cdn.evil.example","dst":"203.0.113.10"}',
    },
  );
  const r = assessConclusionQuality(ws);
  assert.equal(r.has_verdict, true);
  assert.deepEqual(r.flags, [], 'no quality flags on a grounded, calibrated, ladder-adherent verdict');
  assert.equal(r.hallucinated_entities.length, 0);
  assert.equal(r.ladder.shortfall, false);
  assert.equal(r.calibration.signal, 'calibrated');
  assert.ok(r.score >= 0.9, `expected A-grade, got ${r.score}`);
  cleanup(ws);
});

test('a weak investigation flags uncited, missing, hallucinated, ladder shortfall, over-confidence', () => {
  const ws = makeWorkspace(
    {
      disposition: 'malicious', confidence: 'high', highest_rung_used: 'metrics', // ladder shortfall
      evidence_chain: [
        { claim: 'lateral move to 10.9.9.9', source: 'evidence/records/smb.json' }, // 10.9.9.9 not in evidence → hallucinated
        { claim: 'exfil observed', source: 'evidence/records/gone.json' },           // missing file
        { claim: 'suspicious login', source: '' },                                   // uncited
      ],
      residual_uncertainty: 'packetstore did not cover the first hour', // over-confidence w/ high
    },
    { 'evidence/records/smb.json': '{"note":"some smb traffic, no such host"}' },
  );
  const r = assessConclusionQuality(ws);
  const c = codes(r);
  assert.ok(c.includes('uncited_claim'), 'uncited claim flagged');
  assert.ok(c.includes('missing_evidence'), 'missing evidence file flagged');
  assert.ok(c.includes('hallucinated_entity'), 'unsupported IP flagged');
  assert.ok(c.includes('ladder_shortfall'), 'ladder shortfall flagged');
  assert.ok(c.includes('over_confident'), 'over-confidence flagged');
  assert.equal(r.hallucinated_entities[0].entity, '10.9.9.9');
  assert.equal(r.calibration.signal, 'over-confident');
  assert.ok(r.score < 0.6, `expected failing score, got ${r.score}`);
  // High-severity flags sort first.
  assert.equal(r.flags[0].severity, 'high');
  cleanup(ws);
});

test('an IP present in a non-cited evidence file is NOT a hallucination', () => {
  const ws = makeWorkspace(
    {
      disposition: 'inconclusive', confidence: 'low', highest_rung_used: 'metrics',
      evidence_chain: [{ claim: 'host 172.16.5.4 seen', source: 'evidence/metrics/beacon.json' }],
    },
    {
      'evidence/metrics/beacon.json': '{"x":1}',
      'evidence/records/arp.json': '{"ip":"172.16.5.4"}', // grounds the entity, though not the cited source
    },
  );
  const r = assessConclusionQuality(ws);
  assert.equal(r.hallucinated_entities.length, 0, 'entity grounded by any evidence file counts');
  cleanup(ws);
});

test('no verdict.json → F, ungrounded', () => {
  const ws = makeWorkspace(undefined);
  const r = assessConclusionQuality(ws);
  assert.equal(r.has_verdict, false);
  assert.equal(r.score, 0);
  assert.equal(r.grade, 'F');
  assert.equal(r.flags[0].code, 'no_verdict');
  cleanup(ws);
});

test('under-confidence is flagged softly for a fully-grounded definitive verdict', () => {
  const ws = makeWorkspace(
    {
      disposition: 'benign', confidence: 'low', highest_rung_used: 'records',
      evidence_chain: [{ claim: 'authorized scanner 10.0.0.5', source: 'evidence/records/scan.json' }],
      residual_uncertainty: '',
    },
    { 'evidence/records/scan.json': '{"src":"10.0.0.5","auth":true}' },
  );
  const r = assessConclusionQuality(ws);
  assert.equal(r.calibration.signal, 'under-confident');
  assert.equal(codes(r).includes('over_confident'), false);
  cleanup(ws);
});
