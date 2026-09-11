// Run: node --test scripts/check-cli-parity.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CLI_PACKAGE, SDK_PACKAGE, checkParity, cliVersionFrom, docMentionsCli, sdkVersionFrom,
} from './check-cli-parity.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('catches the drift this gate exists for: an SDK-only dependabot bump', () => {
  // The exact shape of #165 before it was fixed by hand.
  const r = checkParity('0.3.260', '2.1.232');
  assert.equal(r.ok, false);
  assert.match(r.reason, /parity broken/);
  // The message has to say what to do, or the next person re-derives the
  // convention from commit archaeology like this one did.
  assert.match(r.reason, /2\.1\.260/, 'names the version the Dockerfile should use');
});

test('passes at parity', () => {
  const r = checkParity('0.3.260', '2.1.260');
  assert.equal(r.ok, true);
});

test('refuses to guess when either package leaves its version line', () => {
  // A major bump on either side means the N-to-N correspondence may no longer
  // hold. Passing silently would be worse than failing: the gate would look
  // green while checking nothing meaningful.
  for (const [sdk, cli] of [['1.0.5', '2.1.5'], ['0.3.5', '3.0.5'], ['0.4.5', '2.1.5']]) {
    const r = checkParity(sdk, cli);
    assert.equal(r.ok, false, `${sdk} / ${cli} should not pass`);
    assert.match(r.reason, /version scheme changed/);
  }
});

test('reads the real pins out of the real files', () => {
  const sdk = sdkVersionFrom(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const cli = cliVersionFrom(fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8'));
  assert.match(sdk, /^\d+\.\d+\.\d+$/);
  assert.match(cli, /^\d+\.\d+\.\d+$/);
  assert.equal(checkParity(sdk, cli).ok, true, `repo is at parity (SDK ${sdk}, CLI ${cli})`);
});

test('the maintenance doc records the pin that actually ships', () => {
  // This assertion is the one that fired on a real staleness: the table still
  // said 2.1.232 after the bump to 2.1.260.
  const cli = cliVersionFrom(fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8'));
  const doc = fs.readFileSync(path.join(ROOT, 'docs/DEPENDENCY-MAINTENANCE.md'), 'utf8');
  assert.equal(docMentionsCli(doc, cli), true, `DEPENDENCY-MAINTENANCE.md should name ${CLI_PACKAGE}@${cli}`);
  assert.equal(docMentionsCli(doc, '2.1.1'), false, 'and not match an arbitrary version');
});

test('a range instead of an exact pin is an error, not a silent pass', () => {
  assert.throws(
    () => sdkVersionFrom(JSON.stringify({ dependencies: { [SDK_PACKAGE]: '^0.3.260' } })),
    /exact version/,
  );
  assert.throws(() => sdkVersionFrom(JSON.stringify({ dependencies: {} })), /does not depend on/);
});

test('conflicting Dockerfile pins fail rather than picking one', () => {
  const two = `RUN npm install -g ${CLI_PACKAGE}@2.1.260\nRUN npm install -g ${CLI_PACKAGE}@2.1.232\n`;
  assert.throws(() => cliVersionFrom(two), /conflicting versions/);
  // The same version named twice is fine — one install path, stated twice.
  assert.equal(cliVersionFrom(`${CLI_PACKAGE}@2.1.260 and ${CLI_PACKAGE}@2.1.260`), '2.1.260');
  assert.throws(() => cliVersionFrom('FROM node:22\n'), /does not pin/);
});
