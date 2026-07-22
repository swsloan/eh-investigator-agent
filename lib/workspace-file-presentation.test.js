import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import nodePath from 'node:path';
import { classifyWorkspaceFile, presentWorkspaceFiles } from './workspace-file-presentation.js';

// resolveFile points at a path that does not exist, so readKnownText returns ''
// and classification falls back to path/extension rules — enough to exercise the
// reveal policy without touching the filesystem.
const session = { resolveFile: (p) => `/nonexistent-workspace/${p}` };
// A real file carrying the generator's marker, for the rename case.
const planFixture = nodePath.join(fs.mkdtempSync(nodePath.join(os.tmpdir(), 'plan-present-')), 'renamed-plan.md');
fs.writeFileSync(planFixture, '<!-- artifact-kind: investigation-plan -->\n# Investigation plan\n');

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

test('the generated plan is classified as a plan, by name or by marker', () => {
  // readKnownText returns '' for the fake session, so the canonical filename is
  // the only signal available here; the marker path is covered below.
  assert.equal(classify('investigation-plan.md').kind, 'plan');
  assert.equal(classify('investigation-plan.md').tag, 'PLAN');

  const marked = { resolveFile: () => planFixture };
  const byMarker = classifyWorkspaceFile(marked, { path: 'renamed-plan.md', size: 100, mtime: Date.now() });
  assert.equal(byMarker.kind, 'plan', 'a renamed copy is still recognized as generated output');

  // A plain root note must not be swept up by the marker rule.
  assert.equal(classify('notes.md').kind, 'note');
});

test('the plan is withheld from the presented file list', () => {
  const files = [
    { path: 'investigation-plan.md', size: 100, mtime: 2 },
    { path: 'report-summary.html', size: 100, mtime: 3 },
    { path: 'notes.md', size: 100, mtime: 1 },
  ];
  const presented = presentWorkspaceFiles(session, files);
  const paths = presented.map((file) => file.path);

  assert.ok(!paths.includes('investigation-plan.md'), 'the plan has its own ribbon and is not a workspace deliverable');
  assert.deepEqual(paths.sort(), ['notes.md', 'report-summary.html']);
  assert.equal(presented.some((file) => file.kind === 'plan'), false);
});

test('withholding the plan does not disturb primary-report selection', () => {
  const presented = presentWorkspaceFiles(session, [
    { path: 'investigation-plan.md', size: 100, mtime: 99 },
    { path: 'report-final.html', size: 100, mtime: 5 },
  ]);
  const primary = presented.find((file) => file.primaryReport);
  assert.equal(primary?.path, 'report-final.html', 'the newest report is still the primary one');
});
