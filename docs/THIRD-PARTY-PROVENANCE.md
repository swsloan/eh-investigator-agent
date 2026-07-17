# Third-party provenance and redistribution decisions

## Bundled ExtraHop CLI

The repository currently contains this release family under `vendor/excli/`:

- version/build identifier: `0.0.107-c8d63d1bce`;
- Darwin AMD64 and ARM64 archives;
- Linux AMD64 and ARM64 archives;
- Windows AMD64 executable;
- publisher-supplied-looking SHA-256 checksum manifest.

`npm run verify:vendor` verifies every artifact present in the repository
against that manifest. This detects corruption or an accidental replacement,
but it does not authenticate who produced the manifest.

The following provenance fields are not established by repository evidence:

- official download URL or internal release source;
- retrieval date and person/system that retrieved it;
- signature, attestation, or independently trusted checksum source;
- license terms and permission to redistribute the binaries publicly.

Repository owner/legal review must resolve those fields. Until then, do not
describe the binaries as open source or confirmed redistributable, and do not
remove them in a way that silently breaks the documented offline install.

If redistribution is approved, record the grant/license and trusted source here
and retain checksum validation. If it is not approved, first implement and test
a controlled download from an official authenticated source, including an
offline-deployment decision, before deleting the artifacts.

## Other bundled material

- Source Sans 3 retains the license stored beside the font files.
- Vendor integration logos remain vendor trademarks and are used only for
  identification.
- Package and container component inventories are generated as SPDX SBOMs; see
  `docs/DEPENDENCY-MAINTENANCE.md`.
