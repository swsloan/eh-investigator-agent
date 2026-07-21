# Health Check Console Links

Use console links to take the operator from a finding to the matching RevealX
device or group page and assessment window. Construct them only from verified
metadata.

## Required Inputs

Call the wrapped appliance-metadata tool once and cache the result for the
session.

| Value | Accepted source |
| --- | --- |
| console FQDN | `display_host`, then `external_hostname`; otherwise a RevealX URL the user supplied in this conversation |
| appliance UUID for device pages | a value that is exactly 32 hexadecimal characters; on RevealX 360 this can be the metadata `hostname`, while self-managed `hostname` is commonly an FQDN |
| device discovery ID | `get_device` field `discovery_id` or `extrahop_id`, verified as the device identifier returned by the live tool |
| device-group ID | group `id` returned by device-group discovery |

Never use `mgmt_ipaddr` as the FQDN. Never use a non-hex hostname as an
appliance UUID. When the FQDN is unavailable, emit plain identifiers. When only
the UUID is unavailable, keep device identifiers plain but still link groups.

## URL Forms

Device overview:

```text
https://<fqdn>/extrahop/#/metrics/devices/<appliance_uuid>.<discovery_id>/overview/?from=<N>&interval_type=<UNIT>&until=0
```

Device protocol:

```text
https://<fqdn>/extrahop/#/metrics/devices/<appliance_uuid>.<discovery_id>/<protocol-slug>?from=<N>&interval_type=<UNIT>&until=0
```

Device group:

```text
https://<fqdn>/extrahop/#/metrics/devicegroups/<group_id>/<protocol-slug>?from=<N>&interval_type=<UNIT>&until=0
```

Relative windows:

| Window | `from` | `interval_type` |
| --- | --- | --- |
| 30 minutes | `30` | `MIN` |
| 1 hour | `1` | `HR` |
| 6 hours | `6` | `HR` |
| 24 hours | `1` | `DAY` |
| 7 days | `1` | `WK` |
| 30 days | `30` | `DAY` |

For a fixed historical assessment, omit `interval_type` and use
`from=<epoch_seconds>&until=<epoch_seconds>`. Console URLs use seconds even
though ExtraHop API calls use milliseconds. Match every link to the report's
actual window.

## Protocol Slugs

| Finding | Slug |
| --- | --- |
| HTTP server/client | `http-server` / `http-client` |
| DNS server/client | `dns-server` / `dns-client` |
| SMB/CIFS server | `cifs-server` |
| LDAP server | `ldap-server` |
| Kerberos server | `kerberos-server` |
| database server | `db-server` |
| TLS server | `ssl-server` |
| retransmission, RTO, flow stall, RTT, setup time | `tcp` |
| throughput or packet/byte volume | `network` |
| overall or multi-protocol health | `overview` |

Use the perspective that drove the finding. Default to `overview` when a
finding spans protocols or the role is unclear.

## Placement And Safeguards

- Link the first important device or group occurrence in a finding and re-link
  it in an operator action or drill-down where that improves scanning.
- Keep identifiers code-formatted inside Markdown links, for example
  [`web-app-01`](https://console.example.invalid/path).
- Keep the identifier readable and keep the finding self-contained; a URL never
  replaces evidence or explanation.
- Skip links in stale-data refusals and quick-look answers.
- Do not link guessed identifiers, metric names, or threshold values.
- Do not chase missing link metadata at the expense of the health assessment.
