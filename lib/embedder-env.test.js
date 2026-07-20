import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { renderEmbedderEnv, writeEmbedderEnv } from './embedder-env.js';
import { normalizeEmbedder } from './settings.js';

test('renderEmbedderEnv emits the three sidecar keys with defaults', () => {
  const out = renderEmbedderEnv({});
  assert.match(out, /^EMBEDDER_MODEL=nomic-embed-text$/m);
  assert.match(out, /^EMBEDDER_DIMENSIONS=768$/m);
  assert.match(out, /^OPENAI_API_URL=http:\/\/embeddings:8080\/v1$/m);
});

test('renderEmbedderEnv passes through a valid custom embedder', () => {
  const out = renderEmbedderEnv({
    model: 'text-embedding-3-small',
    dimensions: 1536,
    endpoint: 'https://api.openai.com/v1',
  });
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

test('writeEmbedderEnv writes a readable file and is idempotent', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'embedder-env-'));
  const file = path.join(dir, 'nested', 'embedder.env');
  assert.equal(writeEmbedderEnv({ model: 'nomic-embed-text', dimensions: 768 }, file), true);
  const first = fs.readFileSync(file, 'utf8');
  assert.match(first, /^EMBEDDER_MODEL=nomic-embed-text$/m);
  assert.equal(writeEmbedderEnv({ model: 'nomic-embed-text', dimensions: 768 }, file), true);
  assert.equal(fs.readFileSync(file, 'utf8'), first);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('writeEmbedderEnv fails soft when the path is unwritable', () => {
  // A path whose parent is a file, not a directory, cannot be created.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'embedder-env-'));
  const blocker = path.join(dir, 'blocker');
  fs.writeFileSync(blocker, 'x');
  assert.equal(writeEmbedderEnv({}, path.join(blocker, 'embedder.env')), false);
  fs.rmSync(dir, { recursive: true, force: true });
});
