# ExtraHop CLI Maintenance

This document is for maintainers and deployment operators who need to replace
the bundled ExtraHop CLI as new `excli` releases are produced.

## Stable Contract

- Repository-root `./excli-interface` is the broker interface that the agent backend calls from session workspaces.
- `vendor/excli/` is the bundled ExtraHop CLI release directory shipped with the package, exactly as the release drop provides it: `excli-<os>-<arch>-<version>.tar.gz` archives for macOS/Linux on AMD64/ARM64, the Windows AMD64 `.exe`, and the release's sha256 checksums file.
- `bin/excli` is the active binary for this machine. Bootstrap selects the `vendor/excli/` archive for the detected OS/CPU, verifies it against the checksums file, and installs its binary; `bin/excli` is ignored by Git.
- Replace the `vendor/excli/` directory (and `bin/excli` for the running machine); do not replace repository-root `./excli-interface`.
- The broker passes argv through unchanged, injects `EXTRAHOP_*` credentials
  only into the `bin/excli` child process, and streams stdout/stderr/exit
  status back to the interface.

As long as new `excli` releases keep the same command-line and environment
credential contract, replacing the binary does not require application code
changes.

## Updating the Bundled Release (packaging)

Before accepting or redistributing a release, record its official source,
retrieval date, trusted checksum/signature source, and redistribution terms in
`THIRD-PARTY-PROVENANCE.md`. A checksum bundled beside a binary detects later
changes but does not independently authenticate the publisher.

New CLI releases arrive as a directory of per-platform archives plus a
checksums file. Updating the package is a directory swap:

```bash
rm -rf vendor/excli
cp -R /path/to/new/release/excli vendor/excli
rm -f vendor/excli/*Zone.Identifier   # Windows download metadata, if present
./scripts/update-excli.sh vendor/excli   # refresh bin/excli on this machine too
```

Commit the new `vendor/excli/` contents. Bootstrap and the updater select the
right archive for each machine from that directory and verify it against the
bundled checksums file, so no per-platform steps are needed.

Run `npm run verify:vendor` before committing to verify every platform artifact,
not only the archive selected for the maintainer's machine.

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
