# bin

`excli` is the active ExtraHop CLI binary for this machine and the only binary
the local broker runs. It is generated at setup and ignored by Git: the
bootstrap script selects the matching archive from the bundled release in
`../vendor/excli/`, verifies it against the release checksums, and installs
its binary here.

Repository-root `../excli-interface` is the stable broker interface and
should not be replaced during normal CLI updates.

Replace the active binary on this machine:

```bash
../scripts/update-excli.sh /path/to/new/excli-or-archive-or-release-dir
```

To update the release bundled with the package, replace `../vendor/excli/`
with the new release drop (see `../docs/EXCLI_MAINTENANCE.md`).

Backups created by the updater live in `bin/backups/` and are ignored by Git.
