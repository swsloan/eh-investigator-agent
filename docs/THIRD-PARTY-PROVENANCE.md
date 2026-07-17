# Third-party provenance and redistribution decisions

## ExtraHop CLI (excli) — fetched, not redistributed

**Redistribution rights: none granted.** The upstream repo
[ExtraHop/agent-cli](https://github.com/ExtraHop/agent-cli) is published with no
license — GitHub detects none, there is no `LICENSE`/`NOTICE`, and the
README/CHANGELOG carry no redistribution grant (a sibling repo, `agent-skills`,
*is* MIT, so the gap is deliberate). Under default copyright that is
all-rights-reserved, so this repository does **not** commit or redistribute the
binaries.

- **Official source:** `ExtraHop/agent-cli`, `dist/`, pinned to an immutable
  commit in `vendor/excli/source.env` (`EXCLI_REPO` / `EXCLI_COMMIT` /
  `EXCLI_VERSION`).
- **Retrieval:** `scripts/fetch-excli.sh` downloads the arch-matched archive
  from the pinned commit at build/install time and verifies it against the
  committed `excli_<version>_checksums.txt` (the sha256 trust anchor). The Docker
  build, the container entrypoint self-heal, and `scripts/bootstrap.sh` all use
  it; offline installs can supply the binary via `EXCLI_PATH`/`EXCLI_ARCHIVE`/a
  `vendor/` drop-in, or `EXCLI_URL` for an internal mirror.
- **Integrity check:** `npm run verify:vendor` fetches every release archive from
  the pinned source and confirms it matches the committed checksums, so a bad pin
  or a tampered anchor fails CI. This detects change/corruption but does not
  independently authenticate the publisher (the checksums come from the same
  source), which is an accepted limitation absent an upstream signature.

Not established by repository evidence (and not required for the fetch model,
but noted): an independent signature/attestation, and a formal redistribution
license. If ExtraHop later publishes a license or signed releases, record the
grant and trusted source here.

## Other bundled material

- Source Sans 3 retains the license stored beside the font files.
- Vendor integration logos remain vendor trademarks and are used only for
  identification.
- Package and container component inventories are generated as SPDX SBOMs; see
  `docs/DEPENDENCY-MAINTENANCE.md`.
