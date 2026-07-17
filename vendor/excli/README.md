# vendor/excli

The ExtraHop CLI (`excli`) binaries are **not committed here**. The upstream
repository [ExtraHop/agent-cli](https://github.com/ExtraHop/agent-cli) grants no
redistribution rights (it carries no license), so this project fetches the
architecture-matched release from the pinned upstream commit and verifies it
against the committed checksums at build/install time.

Tracked in this directory:

- `source.env` — the pinned upstream repo, commit, and version.
- `excli_<version>_checksums.txt` — the sha256 trust anchor for the fetch.

The fetch is performed by [`scripts/fetch-excli.sh`](../../scripts/fetch-excli.sh),
used by the Dockerfile build, the container entrypoint self-heal, and
`scripts/bootstrap.sh`. For offline/air-gapped installs, provide a local archive
or binary via `EXCLI_ARCHIVE`, `EXCLI_PATH`, or `EXCLI_URL` (see bootstrap help).
