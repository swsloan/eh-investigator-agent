import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { safeUploadName, validateAttachments } from './uploads.js';

test('safeUploadName confines path-traversal filenames to a basename', () => {
  assert.equal(safeUploadName('../../etc/passwd'), 'passwd');
  assert.equal(safeUploadName('/abs/olute/secret.txt'), 'secret.txt');
  assert.equal(safeUploadName('foo/bar.txt'), 'bar.txt');
  assert.equal(safeUploadName('..'), 'upload');
  assert.equal(safeUploadName('.'), 'upload');
  assert.equal(safeUploadName(''), 'upload');
});

test('safeUploadName neutralizes dotfiles and unsafe characters', () => {
  assert.equal(safeUploadName('.env'), '_env');
  // Word chars, dot, dash, parens and spaces survive; everything else -> '_'.
  assert.equal(safeUploadName('a b*c?.txt'), 'a b_c_.txt');
  assert.match(safeUploadName('rm -rf $(evil).sh'), /^rm -rf _\(evil\)\.sh$/);
});

test('validateAttachments rejects names containing a path', () => {
  const session = { resolveFile: () => '/never/reached' };
  for (const bad of ['../x', 'a/b', '/etc/passwd']) {
    assert.throws(() => validateAttachments(session, [{ name: bad }]), (err) => {
      assert.equal(err.statusCode, 400);
      return true;
    }, bad);
  }
});

test('validateAttachments accepts a real in-workspace file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uploads-'));
  fs.mkdirSync(path.join(dir, 'uploads'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'uploads', 'good.txt'), 'hello');
  const session = { resolveFile: (p) => path.join(dir, p) };
  const result = validateAttachments(session, [{ name: 'good.txt' }]);
  assert.deepEqual(result, [{ name: 'good.txt', size: 5 }]);
  fs.rmSync(dir, { recursive: true, force: true });
});
