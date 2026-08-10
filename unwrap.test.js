import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { wrapUntrusted } from './lib/telemetry-taint.js';

const UNWRAP = path.join(import.meta.dirname, 'unwrap');

const run = (args = [], input = undefined) => execFileSync(UNWRAP, args, {
  input,
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
});

// A payload big enough that stdout cannot be flushed in one synchronous write.
// Evidence files reach this size routinely (the run that motivated ./unwrap
// saved a 113 KB detection sweep).
function bigPayload() {
  const detections = Array.from({ length: 4000 }, (_, i) => ({
    id: 4294968000 + i,
    title: `Detection ${i}`,
    categories: ['sec', 'sec.hardening'],
    description: 'x'.repeat(120),
  }));
  return JSON.stringify({ detections, has_more: false }, null, 2);
}

test('large enveloped output survives the pipe intact (no truncation on exit)', () => {
  const payload = bigPayload();
  const { text } = wrapUntrusted(payload, 'excli search_detections');
  assert.ok(text.length > 512 * 1024, 'precondition: payload exceeds one pipe buffer');

  const out = run([], text);
  assert.deepEqual(JSON.parse(out).detections.length, 4000, 'stdin: full payload parses');

  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'unwrap-')), 'sweep.json');
  fs.writeFileSync(file, text);
  assert.deepEqual(JSON.parse(run([file])).detections.length, 4000, 'file arg: full payload parses');
});

test('unwraps a saved evidence file for jq/json.load', () => {
  const payload = JSON.stringify({ records: [{ _source: { method: 'GET' } }] });
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'unwrap-')), 'http.json');
  fs.writeFileSync(file, wrapUntrusted(payload, 'excli search_records').text);
  assert.deepEqual(JSON.parse(run([file])), JSON.parse(payload));
});

test('concatenates multiple files and passes non-enveloped content through', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unwrap-'));
  const a = path.join(dir, 'a.json');
  const b = path.join(dir, 'b.json');
  fs.writeFileSync(a, wrapUntrusted('{"n":1}', 'excli a').text);
  fs.writeFileSync(b, '{"n":2}\n'); // already stripped by an earlier step
  assert.equal(run([a, b]), '{"n":1}\n{"n":2}\n');
});

test('a missing file is reported but does not discard the others', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unwrap-'));
  const good = path.join(dir, 'good.json');
  fs.writeFileSync(good, wrapUntrusted('{"n":1}', 'excli a').text);

  let err;
  try {
    execFileSync(UNWRAP, [path.join(dir, 'missing.json'), good], { encoding: 'utf8' });
  } catch (e) {
    err = e;
  }
  assert.ok(err, 'exits non-zero when a file is unreadable');
  assert.equal(err.status, 1);
  assert.match(err.stderr, /missing\.json: no such file/);
  assert.equal(err.stdout, '{"n":1}', 'the readable file is still emitted');
});

test('output is byte-exact — no trailing newline is invented', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unwrap-'));
  // Raw (non-enveloped) input must survive untouched, as --help promises.
  const raw = path.join(dir, 'raw.json');
  fs.writeFileSync(raw, '{"a":1}');
  assert.equal(run([raw]), '{"a":1}');
  // An enveloped payload with no trailing newline keeps none.
  const wrapped = path.join(dir, 'wrapped.json');
  fs.writeFileSync(wrapped, wrapUntrusted('{"a":1}', 'excli x').text);
  assert.equal(run([wrapped]), '{"a":1}');
  assert.equal(run([], wrapUntrusted('{"a":1}', 'excli x').text), '{"a":1}');

  // But concatenated files still get a separator, so payloads never fuse.
  const second = path.join(dir, 'second.json');
  fs.writeFileSync(second, wrapUntrusted('{"b":2}', 'excli y').text);
  assert.equal(run([wrapped, second]), '{"a":1}\n{"b":2}');
  // ...and no extra separator when one already ends with a newline.
  const nl = path.join(dir, 'nl.json');
  fs.writeFileSync(nl, '{"c":3}\n');
  assert.equal(run([nl, second]), '{"c":3}\n{"b":2}');
});

test('--help explains the tool without reading stdin', () => {
  assert.match(run(['--help']), /Strips the <untrusted-telemetry> envelope/);
});
