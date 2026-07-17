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
