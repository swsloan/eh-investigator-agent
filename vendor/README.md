# Vendor

## excli/ — pinned ExtraHop CLI source (fetched, not bundled)

The `excli` binaries are **not** committed to this repository. Upstream
[ExtraHop/agent-cli](https://github.com/ExtraHop/agent-cli) grants no
redistribution rights, so `excli/` holds only the pinned upstream **source
reference** — not the binaries:

```text
excli/source.env                     # pinned EXCLI_REPO / EXCLI_COMMIT / EXCLI_VERSION
excli/excli_<version>_checksums.txt  # sha256 trust anchor for the fetch
```

Bootstrap, the Docker build, and the container entrypoint fetch the
architecture-matched release from the pinned commit, verify it against the
committed checksums, and install the binary as `bin/excli`. See
[`excli/README.md`](excli/README.md) for the mechanism and
`../docs/EXCLI_MAINTENANCE.md` for moving the pin.

Run `npm run verify:vendor` to re-fetch each pinned archive and confirm it
matches the committed checksums. Integrity is not the same as provenance: the
upstream source and redistribution status are recorded in
`../docs/THIRD-PARTY-PROVENANCE.md`.

## Loose drop-in archives

Archives placed directly in `vendor/`, for example
`vendor/excli-linux-amd64-0.0.111-2fdebedca0.tar.gz`, are local, uncommitted
drop-ins for offline/air-gapped installs: bootstrap installs the matching one
instead of fetching from upstream. `vendor/excli-*.tar.gz` is ignored by Git.
