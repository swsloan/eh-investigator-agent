import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { renderGraphitiRuntimeEnv, writeGraphitiRuntimeEnv } from './embedder-env.js';
import { normalizeEmbedder } from './settings.js';

test('renderGraphitiRuntimeEnv emits the three sidecar keys with defaults', () => {
  const out = renderGraphitiRuntimeEnv({});
  assert.match(out, /^EMBEDDER_MODEL=nomic-embed-text$/m);
  assert.match(out, /^EMBEDDER_DIMENSIONS=768$/m);
  assert.match(out, /^OPENAI_API_URL=http:\/\/embeddings:8080\/v1$/m);
});

test('renderGraphitiRuntimeEnv passes through a valid custom embedder', () => {
  const out = renderGraphitiRuntimeEnv({ embedder: {
    model: 'text-embedding-3-small',
    dimensions: 1536,
    endpoint: 'https://api.openai.com/v1',
  } });
  assert.match(out, /^EMBEDDER_MODEL=text-embedding-3-small$/m);
  assert.match(out, /^EMBEDDER_DIMENSIONS=1536$/m);
  assert.match(out, /^OPENAI_API_URL=https:\/\/api\.openai\.com\/v1$/m);
});

test('normalizeEmbedder strips env-file injection from the model name', () => {
  const e = normalizeEmbedder({ model: 'bad\nEVIL=1 name', dimensions: 768, endpoint: 'http://embeddings:8080/v1' });
  assert.ok(!e.model.includes('\n'));
  assert.ok(!e.model.includes(' '));
  assert.ok(!e.model.includes('=')); // '=' would open an env-file injection
  assert.equal(e.model, 'badEVIL1name');
});

test('normalizeEmbedder rejects out-of-range dimensions and bad URLs', () => {
  assert.equal(normalizeEmbedder({ dimensions: 0 }).dimensions, 768);
  assert.equal(normalizeEmbedder({ dimensions: 99999 }).dimensions, 768);
  assert.equal(normalizeEmbedder({ dimensions: '1536' }).dimensions, 1536);
  assert.equal(normalizeEmbedder({ endpoint: 'file:///etc/passwd' }).endpoint, 'http://embeddings:8080/v1');
  assert.equal(normalizeEmbedder({ endpoint: 'not a url' }).endpoint, 'http://embeddings:8080/v1');
});

test('writeGraphitiRuntimeEnv writes a readable file and is idempotent', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'embedder-env-'));
  const file = path.join(dir, 'nested', 'embedder.env');
  assert.equal(writeGraphitiRuntimeEnv({ embedder: { model: 'nomic-embed-text', dimensions: 768 } }, file), true);
  const first = fs.readFileSync(file, 'utf8');
  assert.match(first, /^EMBEDDER_MODEL=nomic-embed-text$/m);
  assert.equal(writeGraphitiRuntimeEnv({ embedder: { model: 'nomic-embed-text', dimensions: 768 } }, file), true);
  assert.equal(fs.readFileSync(file, 'utf8'), first);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('writeGraphitiRuntimeEnv fails soft when the path is unwritable', () => {
  // A path whose parent is a file, not a directory, cannot be created.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'embedder-env-'));
  const blocker = path.join(dir, 'blocker');
  fs.writeFileSync(blocker, 'x');
  assert.equal(writeGraphitiRuntimeEnv({}, path.join(blocker, 'embedder.env')), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the memory namespace is written for the sidecar when configured', () => {
  const out = renderGraphitiRuntimeEnv({ groupId: 'pocextrahop' });
  assert.match(out, /^GRAPHITI_GROUP_ID=pocextrahop$/m);
});

test('a blank or invalid group is omitted, never written empty', () => {
  // An empty GRAPHITI_GROUP_ID would hand the sidecar a blank namespace; leaving
  // the key out lets config.yaml's ${GRAPHITI_GROUP_ID:ehdefault} apply instead.
  for (const memory of [{}, { groupId: '' }, { groupId: '!!!' }, { groupId: undefined }]) {
    assert.doesNotMatch(renderGraphitiRuntimeEnv(memory), /GRAPHITI_GROUP_ID/, JSON.stringify(memory));
  }
});

test('the group is sanitized before it reaches the env file', () => {
  const out = renderGraphitiRuntimeEnv({ groupId: 'Poc-Extra Hop\nEVIL=1' });
  assert.match(out, /^GRAPHITI_GROUP_ID=pocextrahopevil1$/m);
  assert.doesNotMatch(out, /^EVIL=1$/m, 'no env-file injection via the group');
});
