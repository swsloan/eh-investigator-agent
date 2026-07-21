import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyWorkspaceFile } from './workspace-file-presentation.js';

// resolveFile points at a path that does not exist, so readKnownText returns ''
// and classification falls back to path/extension rules — enough to exercise the
// reveal policy without touching the filesystem.
const session = { resolveFile: (p) => `/nonexistent-workspace/${p}` };
const classify = (path, size = 100) =>
  classifyWorkspaceFile(session, { path, size, mtime: Date.now() });

test('root-level outputs are revealed even when unrecognized', () => {
  const file = classify('investigation-output.xyz');
  assert.equal(file.parsed, false, 'unknown extension is not a parsed artifact');
  // Previously these were hidden behind "Show N more…"; root-level files are the
  // agent's investigation outputs and must be visible.
  assert.equal(file.reveal, true);
});

test('the same unrecognized file nested in a directory stays hidden', () => {
  assert.equal(classify('scratch/investigation-output.xyz').reveal, false);
});

test('empty files are never revealed, even at the root', () => {
  assert.equal(classify('empty-output.xyz', 0).reveal, false);
  assert.equal(classify('empty-output.xyz', 0).empty, true);
});

test('recognized artifacts are revealed at any depth (unchanged behavior)', () => {
  assert.equal(classify('notes.md').reveal, true);
  assert.equal(classify('scratch/notes.md').reveal, true);
});

test('nested reveal still depends on the artifact being parsed', () => {
  const nestedParsed = classify('evidence/notes.md');
  assert.equal(nestedParsed.parsed, true);
  assert.equal(nestedParsed.reveal, true);

  const nestedUnparsed = classify('evidence/blob.bin');
  assert.equal(nestedUnparsed.parsed, false);
  assert.equal(nestedUnparsed.reveal, false);
});
