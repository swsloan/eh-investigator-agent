# Dependency and image maintenance

Phase 2 pins primary direct build inputs and locks the application's Node tree,
substantially reducing silent drift. OS packages and transitive dependencies
installed by third-party CLI/Python layers can still change, so clean builds,
scanner output, and SBOMs remain required review evidence. Pins were resolved
from the moving inputs on 2026-07-17 UTC and must be advanced through a reviewed
pull request.

## Reviewed direct inputs

| Input | Pin |
| --- | --- |
| Node base image | `node:22-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3` |
| Graphiti base image | `zepai/knowledge-graph-mcp:standalone@sha256:460bafb39439d99ff001ea6ef03efbe0bd5d9e6afe2655edf926da4fd9df97c5` |
| FalkorDB image | `falkordb/falkordb:latest@sha256:9042fdc4e53f5390ca5a3993aa71506523970efb40ffb9a98e6a4b1a9a4f8862` |
| Ollama image | `ollama/ollama:latest@sha256:6345fbc18bd73a1e16404be681dbc6fd291a027cab43ed541abe78c4c81051b0` |
| Pi CLI | `@earendil-works/pi-coding-agent@0.80.10` |
| Claude Code CLI | `@anthropic-ai/claude-code@2.1.212` |
| Graphiti Anthropic Python SDK | `anthropic==0.117.0` |
| Graphiti docstring parser | `docstring-parser==0.18.0` |
| Node packages | Exact top-level versions in `package.json`; complete tree in `package-lock.json` |
| Optional PDF Python dependency | `weasyprint==66.0` in `requirements.txt` |

The image digests are multi-architecture manifest digests supporting the
project's AMD64/ARM64 Docker paths. The package lockfile remains authoritative
for transitive Node dependencies and installations use `npm ci`.

## Automated review

Dependabot checks npm, Docker, the Graphiti Dockerfile, and GitHub Actions each
week. `.github/workflows/security-supply-chain.yml` then:

1. reviews dependency changes on pull requests;
2. verifies every bundled excli artifact checksum;
3. builds both application images;
4. reports fixable HIGH/CRITICAL container findings as JSON without blocking initially;
5. generates SPDX JSON SBOMs for both images and uploads them as artifacts.

Scanner and SBOM tool containers are themselves pinned by manifest digest in
`scripts/security-scan.sh` and `scripts/generate-sbom.sh`. Workflow actions are
pinned to full commit SHAs with their release major noted in comments;
Dependabot proposes reviewed SHA updates.

Trivy reports are stored under `artifacts/security/`; SPDX SBOMs are stored
under `artifacts/sbom/`. Both directories are ignored locally and uploaded by
CI. The Trivy database cache lives under ignored `.runtime/` state and is reused
between image scans.

### Initial report-only baseline

The 2026-07-17 scan reported 17 unique fixable HIGH/CRITICAL findings in the
application image and 32 in the Graphiti image. Application findings are
concentrated in the bundled `excli` Go binary plus two Node runtime findings;
the Debian application layer itself reported none at those severities. Graphiti
findings are inherited from its pinned Debian base, Python environment, and
bundled `uv` binaries. Counts can change as vulnerability databases are revised,
so the JSON artifacts—not these historical numbers—are the review source.

The scan remains non-blocking while those inherited findings are triaged. Do
not enable a blanket blocking threshold until each finding has an upgrade,
documented non-applicability, or time-bounded exception; otherwise every PR
would be blocked by pre-existing upstream debt.

## Updating a pin

1. Resolve the new version/digest from the publisher's registry and record why
   the update is needed.
2. Change one related input group per PR; do not mix unrelated upgrades.
3. Run `npm ci`, `npm run check`, `npm test`, `docker compose config`, and clean
   builds of the affected images.
4. Run `npm run security:scan` and `npm run sbom` after naming the built images
   `eh-investigator-agent:ci` and `eh-graphiti-mcp:ci`.
5. Exercise ExtraHop preflight, both agent backends, Graphiti extraction, and
   report generation when their dependencies changed.
6. Keep the old digest/version in the PR description so rollback is a one-line
   revert.

After the initial vulnerability baseline is triaged, set
`TRIVY_EXIT_CODE=1` in CI for an agreed blocking policy. Exceptions should name
the CVE, affected component, rationale, owner, and expiration date.
