# ExtraHop CLI Maintenance

This document is for maintainers and deployment operators who need to move the
pinned ExtraHop CLI reference as new `excli` releases are produced.

## Redistribution note

The excli binaries are **not committed to this repository**. Upstream
[ExtraHop/agent-cli](https://github.com/ExtraHop/agent-cli) carries no license
granting redistribution (unlike ExtraHop/agent-skills, which is MIT), so this
project pins an upstream source and **fetches** the arch-matched release —
checksum-verified — at build/install time instead of hosting the binaries.

## Stable Contract

- Repository-root `./excli-interface` is the broker interface that the agent backend calls from session workspaces.
- `vendor/excli/` holds only the **pinned source reference**, not binaries:
  - `source.env` — the upstream `EXCLI_REPO`, immutable `EXCLI_COMMIT`, and `EXCLI_VERSION`.
  - `excli_<version>_checksums.txt` — the committed sha256 trust anchor.
- `scripts/fetch-excli.sh` downloads the arch-matched archive from the pinned commit and verifies it against the committed checksums before installing `bin/excli` (ignored by Git). The Docker build, the container entrypoint self-heal, and `scripts/bootstrap.sh` all use it.
- The broker passes argv through unchanged, injects `EXTRAHOP_*` credentials
  only into the `bin/excli` child process, and streams stdout/stderr/exit
  status back to the interface.

As long as new `excli` releases keep the same command-line and environment
credential contract, moving the pin does not require application code changes.

## Bumping the pinned release (packaging)

`dist/` in agent-cli only ever holds the latest version, and the repo has no
tags/releases, so pin an **immutable commit SHA**:

1. Find the agent-cli commit that published the new version:
   `gh api "repos/ExtraHop/agent-cli/commits?path=dist&per_page=1" --jq '.[0].sha'`
2. Update `vendor/excli/source.env` — set `EXCLI_COMMIT` to that SHA and
   `EXCLI_VERSION` to the new `<version>-<hash>` (from the `dist/` filenames).
3. Replace the checksums trust anchor with the new release's excli lines. `V`
   must be the **full `EXCLI_VERSION`** (`<version>-<hash>`, e.g.
   `0.0.111-2fdebedca0`) so the filename matches what `fetch-excli.sh` looks for.
   Fail closed — validate the download is non-empty before swapping the anchor:
   ```bash
   SHA=<new-commit-sha>; V=<version>-<hash>
   tmp="$(mktemp)"
   curl -fsSL "https://raw.githubusercontent.com/ExtraHop/agent-cli/$SHA/dist/excli_${V}_checksums.txt" \
     | grep -E '  excli-' > "$tmp"
   test -s "$tmp"   # abort if the fetch/grep produced nothing (wrong SHA/version)
   mv "$tmp" "vendor/excli/excli_${V}_checksums.txt"
   git rm vendor/excli/excli_<old-version>_checksums.txt
   ```
4. Verify the fetch end to end: `bash scripts/fetch-excli.sh /tmp/excli && /tmp/excli -version`.

Commit `source.env` + the new checksums file. Bootstrap and the Docker build
fetch and verify the right archive for each machine automatically.

## Updating This Machine

To replace the active `bin/excli`, use the updater script from the repository
root. It accepts a direct binary, a release archive, a release directory
(auto-selects this machine's archive), or a URL:

```bash
./scripts/update-excli.sh /path/to/excli
./scripts/update-excli.sh /path/to/excli-darwin-arm64-0.0.108.tar.gz
./scripts/update-excli.sh /path/to/release-drop-directory/
EXCLI_ARCHIVE=/path/to/excli-linux-amd64.tar.gz ./scripts/update-excli.sh
EXCLI_URL=https://internal.example/excli-linux-amd64.tar.gz ./scripts/update-excli.sh
```

The script:

- refuses to run if repository-root `./excli-interface` is not the broker interface;
- accepts a direct binary, a `.tar.gz` archive containing `excli`, a release directory of archives, or a URL;
- verifies archives against a sha256 checksums file when one sits next to them;
- clears macOS quarantine on the candidate when possible;
- verifies the candidate runs `-help`;
- backs up the current binary under `bin/backups/`;
- atomically replaces only `bin/excli`;
- leaves repository-root `./excli-interface` unchanged.

Use `--no-backup` only for disposable test installs.

## Manual Emergency Replacement

If the script is unavailable, keep the same boundary:

```bash
cp /path/to/new/excli ./bin/excli
chmod 0755 ./bin/excli
xattr -dr com.apple.quarantine ./bin/excli 2>/dev/null || true
./bin/excli -help
```

Then restart the web UI so preflight reports the new binary state.

## Rollback

If an update fails after replacement, restore the previous backup:

```bash
cp ./bin/backups/excli-YYYYMMDD-HHMMSS ./bin/excli
chmod 0755 ./bin/excli
```

Restart the web UI and check `/api/preflight`.

## Compatibility Checklist

Before distributing a new bundled binary, confirm:

- `./bin/excli -help` exits successfully;
- the CLI still accepts the documented `EXTRAHOP_HOST`,
  `EXTRAHOP_API_KEY`, `EXTRAHOP_CLIENT_ID`, `EXTRAHOP_CLIENT_SECRET`, and
  `EXTRAHOP_INSECURE` environment variables;
- normal commands still use stdout, stderr, and exit status conventionally;
- `./excli-interface` remains the broker interface in the package root.
