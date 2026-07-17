#!/usr/bin/env node
// Guard against the "Native CLI binary for <platform>-<arch> not found" failure
// (see lib/claude-native.js). Two modes:
//   --build   : run during `docker build` after `npm ci`. Fails the build if the
//               build machine's arch-native SDK binary is missing (e.g. optional
//               deps were dropped). This only validates the *build* arch.
//   (default) : run at container start. Warns loudly if the *run* arch binary is
//               missing — the common build-arch != run-arch mismatch — but exits
//               0 so the Pi backend, which doesn't need it, still starts.
import { claudeNativeBinaryStatus } from '../lib/claude-native.js';

const build = process.argv.includes('--build');
const status = claudeNativeBinaryStatus();

if (status.ok) {
  if (build) console.log(`[check-claude-native] ok: @anthropic-ai/${status.packageName} present for ${status.platform}-${status.arch}`);
  process.exit(0);
}

const banner = '='.repeat(72);
console.error(`\n${banner}\n${status.message}\n${banner}\n`);

if (build) {
  console.error('[check-claude-native] Build aborted: the Claude Code backend would not work in this image.');
  process.exit(1);
}

// Runtime: do not block startup — only the Claude Code backend is affected; the
// Pi backend runs fine without this binary.
console.error('[check-claude-native] The Pi backend is unaffected; only the Claude Code backend needs the arch-native binary. Continuing.');
process.exit(0);
