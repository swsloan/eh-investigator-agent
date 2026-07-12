// Cassette record/replay store. Run: node --test lib/excli-cassette.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cassetteKey, loadCassette, appendCassette } from './excli-cassette.js';

test('record -> load -> replay round-trip', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cass-')), 'c.jsonl');
  const argv = ['search_records', '-json', '{"types":["~http"]}'];
  const stdout = Buffer.from('{"records":[]}').toString('base64');
  appendCassette(file, { key: cassetteKey(argv), argv, stdout, stderr: '', exitCode: 0 });
  const hit = loadCassette(file).get(cassetteKey(argv));
  assert.ok(hit, 'found recorded call');
  assert.equal(Buffer.from(hit.stdout, 'base64').toString(), '{"records":[]}');
  assert.equal(hit.exitCode, 0);
  assert.equal(loadCassette('/no/such/file').size, 0, 'missing file -> empty map');
});

test('key is stable and distinguishes different argv', () => {
  assert.equal(cassetteKey(['get_detection', '-json', '{"id":1}']), cassetteKey(['get_detection', '-json', '{"id":1}']));
  assert.notEqual(cassetteKey(['get_detection', '-json', '{"id":1}']), cassetteKey(['get_detection', '-json', '{"id":2}']));
});
