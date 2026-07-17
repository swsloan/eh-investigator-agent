import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { getAppVersion, readVersion } from './app-version.js';

test('readVersion returns the trimmed VERSION contents', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-version-'));
  const file = path.join(dir, 'VERSION');
  fs.writeFileSync(file, '26.07.10\n');
  assert.equal(readVersion(file), '26.07.10');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('readVersion falls back to "unknown" for missing or empty files', () => {
  assert.equal(readVersion('/no/such/VERSION'), 'unknown');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-version-'));
  const empty = path.join(dir, 'VERSION');
  fs.writeFileSync(empty, '   \n');
  assert.equal(readVersion(empty), 'unknown');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('getAppVersion reads the real repo VERSION file', () => {
  const expected = fs.readFileSync(path.resolve(import.meta.dirname, '..', 'VERSION'), 'utf8').trim();
  assert.equal(getAppVersion(), expected);
  assert.equal(getAppVersion(), expected); // cached second call
});
