import fs from 'node:fs';
import path from 'node:path';

// The repo-root VERSION file is the single canonical source for the application
// (bundle) version — the release/packaging convention and docs/CHANGES.md use it,
// and package.json's `version` is not authoritative (it can't mirror the
// date-based, zero-padded value as valid semver). Read it once and cache.
const VERSION_FILE = path.resolve(import.meta.dirname, '..', 'VERSION');

/** Read + normalize a VERSION file; 'unknown' if missing/empty/unreadable. Pure, injectable for tests. */
export function readVersion(file = VERSION_FILE) {
  try {
    return fs.readFileSync(file, 'utf8').trim() || 'unknown';
  } catch {
    return 'unknown';
  }
}

let cached;

/** The canonical application version from the VERSION file, read once and cached. */
export function getAppVersion() {
  if (cached === undefined) cached = readVersion();
  return cached;
}
