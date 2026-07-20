# Deployment security hardening

## Local and hardened profiles

The default `docker-compose.yml` publishes the web app, Graphiti MCP endpoint,
and FalkorDB browser only on host loopback. In that single-host profile,
`eh-memory-proxy-local` is an intentional zero-configuration routing guard
between Graphiti and the app. It is not a security boundary against a malicious
local process or an untrusted container attached to the Compose network.

Do not reuse that default if the app is exposed beyond loopback, connected to a
shared/untrusted container network, or operated as a remote service. Start the
hardened-token overlay instead:

```bash
npm run compose:hardened -- up -d
```

The wrapper creates `.runtime/hardened.env` with mode `0600`, generates a
64-character random token once, and injects the same value into the app and
Graphiti. The token persists across restarts but is ignored by Git. Supplying
`EH_MEMORY_PROXY_TOKEN` explicitly is also supported; hardened startup rejects
the local default and tokens shorter than 32 characters.

To inspect the resolved configuration without starting services:

```bash
npm run compose:hardened -- config
```

To return to the local profile, stop the hardened stack and use the base file:

```bash
npm run compose:hardened -- down
docker compose up -d
```

## Memory proxy safety bounds

The proxy accepts only authenticated `POST /v1/messages` requests, the operation
already observed from Graphiti's Anthropic client. Defaults are deliberately
above normal extraction traffic:

| Variable | Default | Purpose |
| --- | ---: | --- |
| `EH_MEMORY_PROXY_MAX_BODY_BYTES` | 4 MiB | Bounds buffered request memory. |
| `EH_MEMORY_PROXY_TIMEOUT_MS` | 90 seconds | Cancels a stalled Anthropic request. |
| `EH_MEMORY_PROXY_MAX_REQUESTS_PER_MINUTE` | 120 | Bounds accidental request loops. |
| `EH_MEMORY_PROXY_MAX_CONCURRENT` | 8 | Bounds simultaneous upstream work. |

Rejected operations return `403`, `404`, `405`, `413`, `429`, or `504` without
including credentials. Increase a limit only after measuring legitimate
Graphiti traffic and retain the negative-path tests in
`lib/memory-llm-proxy.test.js`.

## Private certificate authorities

TLS verification remains enabled by default. For an enterprise appliance using
a certificate signed by a private CA, provide a PEM-encoded CA certificate with
the optional Compose overlay:

```bash
export EH_CUSTOM_CA_HOST_PATH=/absolute/path/to/company-ca.crt
docker compose \
  -f docker-compose.yml \
  -f docker-compose.custom-ca.yml \
  up -d --build eh-investigator
```

At container startup the CA is copied into the Debian trust store,
`update-ca-certificates` is run, `NODE_EXTRA_CA_CERTS` is set for Node.js, and
`SSL_CERT_FILE` points command-line clients such as `excli` at the combined
bundle. A configured but missing/empty CA fails startup instead of silently
disabling verification.

`EXTRAHOP_INSECURE=true` and `RL_VERIFY_SSL=false` remain explicit compatibility
escape hatches. The server emits a warning when either is active. Never use an
insecure setting as an automatic response to a certificate error.

For a direct non-container Node.js run, set `NODE_EXTRA_CA_CERTS` to the PEM CA
path and configure the relevant command-line client/system trust separately.

### TLS trust matrix (validated)

The app has three outbound TLS clients, each with its own verify/insecure knob.
The behaviour was first validated on 2026-07-17, credential-free, against a real
RevealX 360 endpoint (`extrahop-se.api.cloud.extrahop.com`, a public
Amazon-issued cert) — TLS verification happens during the handshake, before any
OAuth, so no client secret is involved.

Since 2026-07-20 the private-CA cells are validated **end-to-end against a
privately issued certificate** rather than inferred. A throwaway CA issues a
leaf for a local stub, which answers every request with 401 — so a 401 proves
the handshake completed, while a TLS error proves it was rejected. The same
trick keeps it credential-free. This is a faithful instrument, not a shortcut:
an enterprise private CA *is* a self-signed CA, so the client's trust decision
is identical.

| TLS client | Verify knob | verify-on, trusted CA | verify-on, untrusted CA | insecure override | custom/private CA |
| --- | --- | --- | --- | --- | --- |
| `excli` → appliance (Go binary) | `EXTRAHOP_INSECURE` (default `false`) | connects | fails closed (`x509: certificate signed by unknown authority`) | `=true` connects | honoured via `SSL_CERT_FILE` (overlay) — verified |
| Node integrations (e.g. ReversingLabs) | `rejectUnauthorized: !insecure` | connects, `authorized=true` | fails closed | `false` connects, `authorized=false` | honoured via `NODE_EXTRA_CA_CERTS` / `ca:[…]` — verified |
| Memory proxy → Anthropic | no override (Node default) | connects, verify-on | fails closed | n/a (never disabled) | via `NODE_EXTRA_CA_CERTS` |

Key results: verification **fails closed** against an untrusted CA; the insecure
escape hatch connects but still reports `authorized=false` (it bypasses
rejection, it does not fake trust); a private CA supplied through the overlay is
honoured by **both** Node and `excli`, so the Go binary does read
`SSL_CERT_FILE` on the Linux container path; and a configured-but-unusable CA
(missing path or empty file) aborts startup with exit 1 rather than silently
continuing with verification disabled.

Do not assert a specific OpenSSL error code for the untrusted case. Which code
surfaces depends on how the chain is built — a self-signed root absent from the
store yields `UNABLE_TO_VERIFY_LEAF_SIGNATURE`, while a missing intermediate
yields `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`. Both are fail-closed; only that
property is contractual.

Reproducing it:

- Node cells — `npm test` (`lib/tls-trust.test.js`), hermetic, runs in CI.
- `excli` cell — `scripts/verify-tls-trust.sh`, which needs a built image
  because `bin/excli` is fetched at build time. Run it in a disposable
  container, since installing a CA mutates the image's trust store:
  `docker run --rm --entrypoint bash eh-investigator-agent:local /app/scripts/verify-tls-trust.sh`

Caveats and known noise:

- Installing a custom CA prints `rehash: warning: skipping ca-certificates.crt,
  it does not contain exactly one certificate or CRL` during startup. This is
  benign Debian `c_rehash` noise about the combined bundle, not a failure — the
  CA is still installed. It is easy to mistake for a TLS misconfiguration.
- A synthetic CA cannot reproduce appliance-specific certificate quirks (SAN/CN
  mismatches, chain depth, key algorithms, expiry handling). One confirmation
  against a real appliance behind a private CA is still worth doing.
- macOS/native `excli` is untested. Go's certificate handling is
  platform-dependent, and `SSL_CERT_FILE` is not honoured the same way on
  darwin, so a non-container dev run may not pick up the overlay. The container
  is the supported path.
- macOS system `curl` uses the system keychain and ignores `--cacert`; the
  Debian container's OpenSSL-linked `curl` honours it, so the container is the
  source of truth for `curl`/`excli` fail-closed behaviour.

## Vulnerability baseline

`scripts/security-scan.sh` (run by the `image-security` workflow) scans every
built image with Trivy for **fixable** HIGH and CRITICAL vulnerabilities and
uploads the full JSON reports. It applies a deliberately narrow **merge gate**:

- **Blocks the build** on any fixable **CRITICAL** in our own application image
  (`eh-investigator-agent`). This image's own dependency tree currently
  contributes zero fixable HIGH/CRITICAL findings.
- **Report-only** for **HIGH** severity, and **report-only** for third-party
  images (`eh-graphiti-mcp` is built `FROM` an upstream base we do not control).
  These are tracked and remediated via issues rather than blocking merges on
  vulnerabilities we cannot fix directly (e.g. packages baked into an upstream
  base image, or compiled into the fetched `excli` binary). Current tracking
  issues: base-image bundled npm (#41), `excli` go-sdk upstream (#42), and the
  `eh-graphiti-mcp` upstream base image (#43).

Override with `TRIVY_GATE_IMAGES` / `TRIVY_GATE_SEVERITY`, or set
`TRIVY_ENFORCE=0` to report without failing. Tighten the gate (e.g. add HIGH, or
add the third-party image) as the tracked findings are driven down.
