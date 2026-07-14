# Health Check Methodology

This reference keeps the operational-health rules that should be stable across
CLI releases. Exact JSON shapes are tool-specific: inspect
`./excli-interface TOOL -help` before first use.

## Pre-Assessment Gates

### Freshness

Run once at the start of every assessment. Query capture-level `net:bytes` for
the most recent 5-minute window.

| Newest telemetry | Treatment |
| --- | --- |
| <= 60 seconds old | Fresh; proceed normally |
| 1-5 minutes old | Proceed; mention slight staleness only if it matters |
| 5-10 minutes old | Proceed with reduced confidence and recommend ingestion check |
| > 10 minutes old | Insufficient Evidence; do not issue Normal/Warning/Degraded |
| no data | Insufficient Evidence; investigate deployment or credential/scope issue |

For a console with multiple sensors, scope the verdict to sensors with fresh
data and call out blind spots.

### Minimum Activity

Rate-based verdicts need enough volume to be meaningful.

| Category | Minimum before rate verdicts |
| --- | --- |
| HTTP, DNS, LDAP, Kerberos, CIFS/SMB, DB | >= 100 responses |
| TCP retransmissions | >= 1,000 connections or >= 100,000 outgoing packets |
| TCP zero-window events | >= 500 connections |
| SSL/TLS | >= 50 connections |

Below the gate, report raw counts and classify as Insufficient Evidence for
that category, unless the user only asked for a count.

### Asymmetric Routing

Capture-level `tcp:unidirectional_flows` indicates one-way visibility and makes
TCP-derived health unreliable.

| Unidirectional flows / total flows | Treatment |
| --- | --- |
| < 10% | Full confidence |
| 10-25% | Medium confidence; caveat asymmetric routing |
| > 25% | Do not issue TCP Warning/Degraded from that sensor alone |

High unidirectional flow across many devices usually means a sensor deployment
or mirroring problem, not a real network outage.

## Metric Scope Model

Object scope drives category names:

- `capture`: sensor-level aggregates. Use bare categories such as `http`, `dns`,
  `net`, `tcp`, `app`. Good for environment screening.
- `device`: per-device metrics by OID. Device protocol categories usually need
  `_server` or `_client` suffixes such as `http_server` and `dns_client`.
- `device_group`: group-level aggregation over member devices. Use for fleets
  when available.
- `application`: application-level rollups when the environment defines them.

Always verify category and stat names with the metric catalog when uncertain.

Useful categories:

| Area | Categories/stats |
| --- | --- |
| Volume | `net:bytes`, `net:pkts_in`, `net:pkts_out`, protocol `req`/`rsp` |
| Capture screening | `app:bytes`, protocol `rsp`, protocol `rsp_error`, `tcp:desync`, `tcp:unidirectional_flows` |
| HTTP | `http_server:req`, `rsp`, `rsp_error`, `tprocess`, `rsp_ttlb`, `rtt`, `status_code` |
| DNS | `dns_server:req`, `rsp`, `rsp_error`, `tprocess`, `req_timeout`, `rsp_rcode` |
| Kerberos | `kerberos_server:rsp`, `rsp_error`, `tprocess`, `account_lockout`; `kerberos_server_detail:error_msg` |
| LDAP | `ldap_server:rsp`, `rsp_error`, `tprocess`, `rtt`, `error_msg_short` |
| SMB/CIFS | `cifs_server:rsp`, `rsp_error`, `access_time`, `rtt`, `bytes_read`, `bytes_write` |
| Database | `db_server:rsp`, `rsp_error`, `tprocess`, `rsp_ttlb`, `rtt` |
| TLS | `ssl_server:connected`, `aborted`, `expired_cert`, `self_signed`, `weak_ciphers`, `version` |
| TCP | `rto_in`, `rto_out`, `retrans_out`, `rto_multi_in`, `rto_multi_out`, `aborted_in`, `aborted_out`, `connected`, `accepted`, `rtt`, `setup_time`, `zwnd_in`, `zwnd_out`, `syn_unanswered_in`, `syn_unanswered_out` |

Dataset metrics such as `tprocess`, `rtt`, `setup_time`, `rsp_ttlb`, and
`access_time` require a calculation. Prefer percentiles with
`[10, 25, 50, 75, 90, 95, 99]`.

## Two-Pass Error Classification

Raw `rsp_error` contains benign protocol behavior. Always:

1. Query aggregate `rsp` and `rsp_error`.
2. Query the breakdown stat.
3. Calculate actionable error rate from actionable classes only.

| Protocol | Breakdown | Actionable | Usually benign/excluded |
| --- | --- | --- | --- |
| HTTP | `http_server:status_code` | 5xx | 3xx, most 4xx |
| DNS | `dns_server:rsp_rcode` | SERVFAIL, FORMERR | NXDOMAIN; REFUSED is context-dependent |
| Kerberos | `kerberos_server_detail:error_msg` | PREAUTH_FAILED, CLIENT_REVOKED, KEY_EXPIRED, unknown principal, policy/lockout errors | KDC_ERR_PREAUTH_REQUIRED |
| LDAP | `ldap_server:error_msg_short` | invalidCredentials, insufficientAccessRights, unavailable, busy, operationsError, unwillingToPerform | referral, noSuchObject |
| TLS | `ssl_server:version`, aborts, cert/cipher stats | handshake failures, high abort ratio, old versions for compliance | self-signed/expired may be informational unless tied to user impact |

Database and SMB/CIFS errors are environment-specific; treat raw error rates as
signals, then inspect records or breakdowns for actual failure modes before a
hard verdict.

## Thresholds

Apply thresholds only after gates and classification.

| Indicator | Normal | Warning | Degraded |
| --- | --- | --- | --- |
| HTTP 5xx rate | < 1% | 1-5% | > 5% |
| DNS actionable error rate | < 0.5% | 0.5-2% | > 2% |
| Kerberos actionable error rate | < 1% | 1-5% | > 5% |
| LDAP actionable error rate | < 1% | 1-5% | > 5% |
| DB error rate | < 1% | 1-5% | > 5% |
| SMB/CIFS error rate | < 1% | 1-5% | > 5% |
| TLS abort ratio | < 2% | 2-5% | > 5% |
| TCP abort ratio | < 2% | 2-10% | > 10% |
| TCP RTO per packet | < 0.1% | 0.1-1% | > 1% |
| TCP retrans/RTO events per connection | < 0.5/conn | 0.5-2/conn | > 2/conn |

Latency p50 thresholds:

| Workload | Normal | Warning | Degraded |
| --- | --- | --- | --- |
| HTTP application | < 200 ms | 200 ms-1 s | > 1 s |
| HTTP static/cache edge | < 50 ms | 50-200 ms | > 200 ms |
| DNS authoritative | < 5 ms | 5-20 ms | > 20 ms |
| DNS recursive/forwarding | < 50 ms | 50-200 ms | > 200 ms |
| DB OLTP | < 100 ms | 100-500 ms | > 500 ms |
| DB OLAP/data warehouse | < 5 s | 5-30 s | > 30 s |
| LDAP | < 50 ms | 50-200 ms | > 200 ms |
| Kerberos | < 20 ms | 20-100 ms | > 100 ms |
| SMB/CIFS access time | < 50 ms | 50-200 ms | > 200 ms |

Workload inference matters. For databases, compare `db_server:rsp_ttlb`,
`db_server:tprocess`, request rate, and response size. Do not apply OLTP
thresholds to data-warehouse workloads without a caveat.

## TCP Math

Use the right denominator:

```text
events_per_connection = (rto_out + retrans_out) / (connected + accepted)
per_packet_rate = rto_out / pkts_out
```

Prefer per-packet rate when `pkts_out` is available. Events per connection is
not a percentage and can exceed 1 on long-lived flows.

If events per connection is high but per-packet rate is low, report a workload
pattern such as long-lived high-throughput connections rather than packet-loss
degradation.

## Silent Outage / Volume Drop

Always compare request or response volume against a valid baseline.

| Volume vs baseline | Treatment |
| --- | --- |
| within 2x | Normal variation |
| 2-5x drop or rise | Warning volume anomaly |
| > 5x drop toward zero | Degraded silent outage |
| > 5x rise | Warning load event; check errors/latency and peer absorption |

A service can be unhealthy with zero errors if it has stopped serving traffic.
When one peer drops, check whether same-role peers absorbed the load and whether
they still have headroom.

## Baselines and Modifiers

Choose the baseline:

| Assessment window | Preferred baseline |
| --- | --- |
| <= 1 hour | prior equivalent block |
| 1-6 hours | prior equivalent block or same hour yesterday |
| 6-24 hours | same period 7 days ago when history exists |
| > 24 hours | same-day-last-week |
| low-volume or first-seen devices | peer comparison before historical rates |

Meaningful deviation requires all three:

1. Rate changes by more than 2x.
2. Absolute difference exceeds the activity gate.
3. Baseline itself meets the activity gate.

Compare current and baseline verdicts:

- same verdict: chronic;
- worse current verdict: new;
- better current verdict: recovered.

## Temporal Pattern

Use time-series buckets when the shape affects severity:

- sustained: > 50% of buckets affected; full severity;
- transient: < 20% of buckets affected; reduce severity by one level unless
  impact was severe;
- intermittent: 20-50%; report the aggregate severity and pattern;
- step change: name the transition time and assess post-change state.

Use `cycle: auto` unless tool help says otherwise.

## Role Weighting

Do not let irrelevant secondary protocols drive overall device health.

| Role | Primary categories | Secondary categories |
| --- | --- | --- |
| `http_server`, `load_balancer` | HTTP, SSL/TLS, TCP latency | net throughput, transport anomalies |
| `dns_server` | DNS, TCP | net throughput |
| `domain_controller` | Kerberos, LDAP, DNS | TCP, SSL/TLS |
| `file_server` | CIFS/SMB, TCP | net throughput |
| `db_server` | Database, TCP | net throughput |
| `gateway`, `nat_gateway` | net throughput, TCP | protocol mix |

Overall status is the max severity across primary categories. A secondary
Warning does not elevate an otherwise Normal device. A secondary Degraded can
elevate the device to Warning if it is operationally relevant.

## Health Satisfaction Index

HSI can calibrate detailed reports, but it is not displayed in concise chat
answers unless the user asks.

```text
HSI = (Satisfied + 0.5 * Tolerating) / Total
```

- Satisfied: successful response and latency <= T.
- Tolerating: successful response and T < latency <= 4T.
- Frustrated: actionable error or latency > 4T.

Bands:

| HSI | Band |
| --- | --- |
| >= 94% | Excellent |
| 85-93% | Good |
| 70-84% | Fair |
| 50-69% | Poor |
| < 50% | Unacceptable |

Approximate latency buckets from percentile metrics when histograms are not
available. Prefer exact histograms if the metric catalog exposes them.
