# PQC TLS readiness report

For post-quantum TLS readiness assessments across internal TLS servers. Template: `assets/pqc-readiness-report-template.html`.

The report answers:

1. Which internal devices acted as TLS servers during the analysis window.
2. Which servers negotiated at least one post-quantum or hybrid-PQC key exchange.
3. How many unique client IPs negotiated PQC vs. classical-only key exchange with each server.
4. Which servers and client populations should be prioritized for remediation.

## Output contract

- Primary artifact: an HTML report copied from `assets/pqc-readiness-report-template.html` to the workspace root, named `report-pqc-readiness-<YYYY-MM-DD>.html` or a clearer user-specific slug.
- Fill the static HTML template by replacing the bracketed placeholders and repeating/removing the marked server lozenges, metric cards, bar rows, table rows, and finding cards as needed. The template intentionally contains no JavaScript so it renders in the app's sandboxed file viewer.
- Compute totals, percentages, sorting, bar widths, and traffic shares before writing the report. Keep all core report content present in the HTML at load time; do not rely on client-side scripts to populate content.
- Remove all placeholder organizations, hosts, IPs, findings, and dates from the copied report.
- Secondary artifact: JSON export named `tls_pqc_readiness_<YYYY-MM-DD>.json` when the user asks for export data, when another tool needs machine-readable results, or when the server table is substantial. Present it as supporting data, not as the report.
- Do not produce CSV unless the user explicitly asks.

## Data constraints

- Use read-only ExtraHop RevealX metrics. Do not use records, PCAP, or device-state changes for this report.
- Default to the last 30 days unless the user specifies a different window.
- Use UTC collection times in provenance and preserve exact query parameters.
- Scope to internal devices. The built-in TLS Server Activity group already applies that scope.
- Count unique client IP addresses for client readiness; do not substitute session counts.
- Treat `post_quantum_kex > 0` as "PQC observed/negotiated," not proof that every client or every session is quantum-safe.

## Required metrics

| Metric category | Stat name | Dimension | Use |
|---|---|---|---|
| `ssl_server` | `connected` | scalar | Total TLS sessions terminated by the server |
| `ssl_server` | `post_quantum_kex` | scalar | TLS sessions using a PQC or hybrid-PQC key exchange |
| `ssl_server_detail` | `connected` | topn by `ipaddr` | Unique client IPs with TLS sessions to the server |
| `ssl_server_detail` | `post_quantum_kex` | topn by `ipaddr` | Unique client IPs with PQC sessions to the server |

Use `exmcp:search_metric_catalog` only when a stat name needs confirmation.

## Procedure

1. Locate the built-in TLS server group.

```text
exmcp:search_devicegroups(name = "TLS Server", type = "built_in")
```

Use the device group named `TLS Server Activity`. If it is unavailable, query `ssl_server:connected` across known internal devices with `bucketing = "total_by_object"` and treat non-zero devices as TLS servers.

2. Enumerate candidate TLS server devices.

```text
exmcp:list_devices_in_devicegroup(
  id = <TLS Server Activity group id>,
  active_from = "-30d",
  limit = 5000
)
```

Paginate until complete. Retain device OID, display name, IPv4/IPv6 address, and any available device type or role hint.

3. Pull scalar TLS metrics for all candidate servers.

```text
exmcp:execute_metric_query(
  object_type = "device",
  object_ids = [<candidate OIDs>],
  metric_category = "ssl_server",
  metric_specs = [
    { name: "connected" },
    { name: "post_quantum_kex" }
  ],
  bucketing = "total_by_object",
  from = "-30d",
  until = 0
)
```

Confirmed TLS servers have `connected > 0`. Discard candidates with zero or absent `connected`.

Classification:

- `post_quantum_kex > 0`: PQC key exchange observed for this server.
- `post_quantum_kex == 0`: no PQC key exchange observed for this server in the window.

4. Pull per-client detail metrics for confirmed servers.

```text
exmcp:execute_metric_query(
  object_type = "device",
  object_ids = [<confirmed TLS server OIDs>],
  metric_category = "ssl_server_detail",
  metric_specs = [
    { name: "post_quantum_kex" },
    { name: "connected" }
  ],
  bucketing = "total_by_object",
  from = "-30d",
  until = 0,
  limit = 1000
)
```

For each server:

```text
pqc_client_ips     = set(addr values from post_quantum_kex detail)
all_client_ips     = set(addr values from connected detail)
non_pqc_client_ips = all_client_ips - pqc_client_ips
clientsPqc         = count(pqc_client_ips)
clientsNonPqc      = count(non_pqc_client_ips)
```

A client in `post_quantum_kex` detail counts as PQC-capable for this report even if it also made classical sessions. The readiness question is whether the client successfully negotiated PQC at least once with that server.

5. Optional: identify negotiated key agreement groups.

If the report needs named groups, query `ssl_server:key_agreement` topn by string for servers with PQC traffic. Do not block the core report on this enrichment.

## Populate the static HTML template

Map collected data into the visible HTML sections:

| Report section | Source / computation |
|---|---|
| Hero customer/date/window/source | User/customer context, report date, absolute UTC window, `ExtraHop RevealX`, console/sensor name if known |
| Thesis | Main conclusion with the most important counts and percentages |
| Scope | Devices, time window, exclusions, and qualified server count |
| Estate lozenges | One per confirmed TLS server, sorted by session count; width proportional to `sqrt(server.sessions / maxSessions)`; add `pqc` class when `pqcSessions > 0` |
| Headline metrics | Server count, PQC-ready count, classical-only count, total TLS sessions, total PQC sessions, unique PQC/classical-only clients |
| Coverage rows | One per server; bar width = `clientsPqc / (clientsPqc + clientsNonPqc) * 100` |
| Volume rows | One per server; main bar width = `sessions / maxSessions * 100`; cyan overlay width = `pqcSessions / maxSessions * 100`; mini share = `pqcSessions / totalPqcSessions * 100` |
| Server table | One row per confirmed TLS server with raw counts and derived client coverage |
| Findings | 2-5 evidence-backed findings, each with one action |
| Provenance | Source, sensor, window, generated date, population, and concise method/caveats |

Use `—` for unknown metadata fields. Use `TLS Server` for unknown roles. Do not invent product versions, owners, remediation dates, or application functions. Keep the local vendored font import and `data-report-theme` CSS intact so the report follows the core app's light/dark viewer theme.

## JSON export

When emitting the secondary JSON artifact, export the clean data model rather than the HTML-oriented `REPORT_DATA` object:

```json
{
  "report_type": "pqc_tls_readiness",
  "generated_at_utc": "2026-07-08T00:00:00Z",
  "window": {
    "from_utc": "2026-06-08T00:00:00Z",
    "to_utc": "2026-07-08T00:00:00Z",
    "label": "30 days"
  },
  "source": {
    "system": "ExtraHop RevealX",
    "sensor": null,
    "queries": []
  },
  "summary": {
    "tls_servers": 0,
    "pqc_servers": 0,
    "classical_only_servers": 0,
    "total_tls_sessions": 0,
    "total_pqc_sessions": 0,
    "unique_clients_pqc": 0,
    "unique_clients_non_pqc": 0
  },
  "servers": [
    {
      "device_id": "0",
      "device_name": "example",
      "ip_address": "192.0.2.10",
      "role": "TLS Server",
      "total_tls_sessions": 0,
      "total_pqc_sessions": 0,
      "pqc_negotiated": false,
      "unique_clients_pqc": 0,
      "unique_clients_non_pqc": 0,
      "client_ips_pqc": [],
      "client_ips_non_pqc": []
    }
  ],
  "caveats": []
}
```

Include `queries[]` entries with metric category, stat names, object IDs or group ID, bucketing, window, collection time, and result limits. Remove the example server object before shipping real JSON.

## PQC classification

ExtraHop counts recognized PQC or hybrid-PQC key agreement groups under `post_quantum_kex`, including:

| Group name | Type |
|---|---|
| `X25519Kyber768` | Hybrid classical + Kyber-768 |
| `X25519MLKEM768` | Hybrid classical + ML-KEM-768 / FIPS 203 |
| `P256Kyber768Draft00` | Hybrid draft |
| `SecP256r1MLKEM768` | Hybrid NIST P-256 + ML-KEM-768 |

## Edge cases

- Missing TLS Server Activity group: use the scalar fallback and disclose it in `method` and JSON `caveats`.
- Truncated detail results: increase `limit` or disclose that client counts may be understated.
- Device with no IP: use MAC address, hostname, or display name as the stable identifier; do not leave the identifier blank.
- IPv6-only device: use the IPv6 address.
- Zero PQC sessions with non-zero TLS sessions: `pqc_negotiated = false`, `clientsPqc = 0`, `clientsNonPqc = count(all_client_ips)`.

## Done

- HTML report is the primary deliverable and contains no sample data.
- The thesis states server readiness, session readiness, and client readiness with counts and percentages.
- Every finding ties back to metrics collected in the run.
- JSON, when produced, is presented as secondary supporting data.
- Scope, fallback paths, truncation, and ExtraHop visibility limits are explicit.
