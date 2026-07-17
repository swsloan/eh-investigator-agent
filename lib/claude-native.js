import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The Claude Agent SDK ships its Claude Code CLI as per-architecture *optional*
// npm packages (@anthropic-ai/claude-agent-sdk-<platform>-<arch>[-musl]). At
// runtime the SDK resolves the one matching process.platform/process.arch; if
// it is absent, query() throws:
//   "Native CLI binary for <platform>-<arch> not found. Reinstall
//    @anthropic-ai/claude-agent-sdk without --omit=optional, or set
//    options.pathToClaudeCodeExecutable."
// The usual cause is an image built for one architecture (e.g. linux-x64) run on
// another (e.g. linux-arm64), because `npm ci` only installs the optional binary
// matching the *build* machine. This module detects that mismatch so it can be
// caught at build time, at container start, and in the backend's availability
// probe — instead of surfacing as a failed agent turn.

const DEFAULT_SCOPE_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'node_modules',
  '@anthropic-ai',
);

/** Docker `--platform` uses `amd64`; Node reports the same CPU as `x64`. */
function dockerArch(arch) {
  return arch === 'x64' ? 'amd64' : arch;
}

/** Candidate optional-package names for a platform/arch (glibc + musl on linux). */
export function nativePackageCandidates(platform = process.platform, arch = process.arch) {
  const base = `claude-agent-sdk-${platform}-${arch}`;
  return platform === 'linux' ? [base, `${base}-musl`] : [base];
}

/**
 * Is the Claude Agent SDK's arch-native CLI binary installed for this machine?
 * Returns { ok, platform, arch, packageName? , message? }. Pure and injectable
 * (platform/arch/dir) so it can be unit-tested for any target.
 */
export function claudeNativeBinaryStatus({
  platform = process.platform,
  arch = process.arch,
  dir = DEFAULT_SCOPE_DIR,
} = {}) {
  const candidates = nativePackageCandidates(platform, arch);
  const found = candidates.find((name) => {
    try {
      return fs.existsSync(path.join(dir, name));
    } catch {
      return false;
    }
  });
  if (found) return { ok: true, platform, arch, packageName: found };
  return {
    ok: false,
    platform,
    arch,
    message: `Claude Agent SDK native binary for ${platform}-${arch} is not installed `
      + `(expected @anthropic-ai/${candidates[0]}). The container was almost certainly built `
      + `for a different CPU architecture than it is running on. Rebuild the image for this host: `
      + `\`docker compose build --no-cache eh-investigator && docker compose up -d\`, or cross-build `
      + `with \`docker buildx build --platform ${platform}/${dockerArch(arch)} .\`. Do not build with `
      + `\`--omit=optional\`.`,
  };
}
