import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { claudeNativeBinaryStatus, nativePackageCandidates } from './claude-native.js';

function scopeWith(names) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-native-'));
  for (const name of names) fs.mkdirSync(path.join(dir, name), { recursive: true });
  return dir;
}

test('nativePackageCandidates offers glibc + musl on linux, single elsewhere', () => {
  assert.deepEqual(nativePackageCandidates('linux', 'arm64'), [
    'claude-agent-sdk-linux-arm64',
    'claude-agent-sdk-linux-arm64-musl',
  ]);
  assert.deepEqual(nativePackageCandidates('darwin', 'arm64'), ['claude-agent-sdk-darwin-arm64']);
});

test('ok when the arch-matched package dir exists', () => {
  const dir = scopeWith(['claude-agent-sdk-linux-arm64']);
  const s = claudeNativeBinaryStatus({ platform: 'linux', arch: 'arm64', dir });
  assert.equal(s.ok, true);
  assert.equal(s.packageName, 'claude-agent-sdk-linux-arm64');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('ok via the musl variant on linux', () => {
  const dir = scopeWith(['claude-agent-sdk-linux-x64-musl']);
  const s = claudeNativeBinaryStatus({ platform: 'linux', arch: 'x64', dir });
  assert.equal(s.ok, true);
  assert.equal(s.packageName, 'claude-agent-sdk-linux-x64-musl');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('mismatch: x64 binary present, running arm64 → not ok with actionable message', () => {
  const dir = scopeWith(['claude-agent-sdk-linux-x64']);
  const s = claudeNativeBinaryStatus({ platform: 'linux', arch: 'arm64', dir });
  assert.equal(s.ok, false);
  assert.match(s.message, /linux-arm64 is not installed/);
  assert.match(s.message, /different CPU architecture/);
  assert.match(s.message, /docker buildx build --platform linux\/arm64/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('message maps Node x64 arch to Docker amd64 platform', () => {
  const dir = scopeWith([]); // nothing installed
  const s = claudeNativeBinaryStatus({ platform: 'linux', arch: 'x64', dir });
  assert.equal(s.ok, false);
  assert.match(s.message, /docker buildx build --platform linux\/amd64/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('missing scope dir is treated as not-installed, not a crash', () => {
  const s = claudeNativeBinaryStatus({ platform: 'linux', arch: 'arm64', dir: '/no/such/dir/@anthropic-ai' });
  assert.equal(s.ok, false);
});
