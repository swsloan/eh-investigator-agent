#!/usr/bin/env node
// Fail when the Dockerfile's Claude Code CLI pin drifts from the Claude Agent
// SDK in package.json (#157).
//
// Dependabot maintains `@anthropic-ai/claude-agent-sdk` in package.json but
// cannot see `@anthropic-ai/claude-code`, which is pinned in the Dockerfile —
// so an SDK-only bump silently breaks parity. That has now happened three
// times (#125 fixed in #149; SDK 0.3.232; SDK 0.3.260), every one caught by a
// human noticing rather than by CI. The CLI is what the container runs for
// `claude` under `claudeAuth: subscription`, so the skew lands on the auth path.
//
// The convention, per docs/DEPENDENCY-MAINTENANCE.md: the version lines track
// each other as SDK `0.3.N` <-> CLI `2.1.N`.
//
// Deliberately strict about the SHAPE as well as the number: if either package
// leaves its expected major.minor line, this fails rather than guessing at a new
// correspondence. A release that genuinely changes the scheme should be a
// conscious edit here, not a silent pass.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const SDK_PACKAGE = '@anthropic-ai/claude-agent-sdk';
export const CLI_PACKAGE = '@anthropic-ai/claude-code';
export const SDK_LINE = '0.3';
export const CLI_LINE = '2.1';

/** The exact version package.json pins for the SDK. */
export function sdkVersionFrom(packageJsonText) {
  const pkg = JSON.parse(packageJsonText);
  const version = pkg?.dependencies?.[SDK_PACKAGE];
  if (!version) throw new Error(`package.json does not depend on ${SDK_PACKAGE}`);
  // The repo pins exact versions; a range would make "parity" undecidable here.
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`${SDK_PACKAGE} is "${version}" — expected an exact version, not a range`);
  }
  return version;
}

/** The version the Dockerfile installs the CLI at. */
export function cliVersionFrom(dockerfileText) {
  const matches = [...dockerfileText.matchAll(
    new RegExp(`${CLI_PACKAGE.replace('/', '\\/')}@(\\d+\\.\\d+\\.\\d+)`, 'g'),
  )];
  if (!matches.length) throw new Error(`Dockerfile does not pin ${CLI_PACKAGE}`);
  const versions = [...new Set(matches.map((m) => m[1]))];
  // More than one pin means some install path would get a different CLI than the
  // one this check validates, which is worse than no check at all.
  if (versions.length > 1) {
    throw new Error(`Dockerfile pins ${CLI_PACKAGE} at conflicting versions: ${versions.join(', ')}`);
  }
  return versions[0];
}

/**
 * Compare the two pins. Returns `{ ok, sdk, cli, reason }` rather than throwing,
 * so the caller owns how loudly to fail.
 */
export function checkParity(sdkVersion, cliVersion) {
  const base = { sdk: sdkVersion, cli: cliVersion };
  const sdkParts = sdkVersion.split('.');
  const cliParts = cliVersion.split('.');
  const sdkLine = sdkParts.slice(0, 2).join('.');
  const cliLine = cliParts.slice(0, 2).join('.');
  if (sdkLine !== SDK_LINE || cliLine !== CLI_LINE) {
    return {
      ...base,
      ok: false,
      reason: `version scheme changed: expected ${SDK_PACKAGE} on ${SDK_LINE}.x and `
        + `${CLI_PACKAGE} on ${CLI_LINE}.x, got ${sdkLine}.x and ${cliLine}.x. `
        + 'Re-confirm the parity convention and update SDK_LINE/CLI_LINE in this script.',
    };
  }
  if (sdkParts[2] !== cliParts[2]) {
    return {
      ...base,
      ok: false,
      reason: `parity broken: SDK ${sdkVersion} but CLI ${cliVersion}. `
        + `Set the Dockerfile pin to ${CLI_PACKAGE}@${CLI_LINE}.${sdkParts[2]}.`,
    };
  }
  return { ...base, ok: true, reason: `SDK ${sdkVersion} <-> CLI ${cliVersion}` };
}

/**
 * The maintenance doc records the CLI pin in a table, and it goes stale exactly
 * when the pin moves — it was still showing 2.1.232 after the bump to 2.1.260.
 * Checked here because this is the one place that already knows the right answer.
 */
export function docMentionsCli(docText, cliVersion) {
  return docText.includes(`${CLI_PACKAGE}@${cliVersion}`);
}

function main() {
  const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
  let sdk;
  let cli;
  try {
    sdk = sdkVersionFrom(read('package.json'));
    cli = cliVersionFrom(read('Dockerfile'));
  } catch (err) {
    console.error(`✗ CLI/SDK parity: ${err.message}`);
    process.exit(1);
  }

  const result = checkParity(sdk, cli);
  if (!result.ok) {
    console.error(`✗ CLI/SDK parity: ${result.reason}`);
    process.exit(1);
  }

  const docPath = 'docs/DEPENDENCY-MAINTENANCE.md';
  if (!docMentionsCli(read(docPath), cli)) {
    console.error(
      `✗ CLI/SDK parity: ${docPath} does not record ${CLI_PACKAGE}@${cli}. `
      + 'The pinned-versions table has to move with the pin.',
    );
    process.exit(1);
  }

  console.log(`✓ CLI/SDK parity: ${result.reason} (and ${docPath} agrees)`);
}

// Only run when invoked directly, so the unit test can import the pure parts.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
