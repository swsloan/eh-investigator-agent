# Vendor

## excli/ — bundled ExtraHop CLI release

`excli/` is the CLI release drop shipped with the package, tracked in Git
exactly as ExtraHop provides it:

```text
excli-darwin-amd64-<version>.tar.gz
excli-darwin-arm64-<version>.tar.gz
excli-linux-amd64-<version>.tar.gz
excli-linux-arm64-<version>.tar.gz
excli-windows-amd64-<version>.exe
excli_<version>_checksums.txt
```

Bootstrap selects the archive matching the host OS/CPU, verifies it against
the checksums file, and installs its binary as `bin/excli`. Updating the
bundled CLI means replacing this directory with the new release drop (see
`../docs/EXCLI_MAINTENANCE.md`). The Windows binary is not used by the web
app; it ships for operators who need the CLI on Windows.

## Loose drop-in archives

Archives placed directly in `vendor/`, for example
`vendor/excli-linux-amd64-0.0.108.tar.gz`, are local, uncommitted drop-ins.
They take precedence over the bundled `excli/` release, so this is the
easiest way to test a newer excli build without touching the packaged
release. `vendor/excli-*.tar.gz` is ignored by Git.
