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

Capture scope is a screening layer, not a substitute for device evidence.
Capture protocol categories generally lack device processing latency, detailed
error classes, and peer-specific TCP transport. Move to device or group scope
before attributing a capture-level signal to a host or dependency.

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

TCP transport thresholds:

| Indicator | Normal | Warning | Degraded |
| --- | --- | --- | --- |
| RTT versus valid baseline | < 2x | 2-5x | > 5x |
| Setup time p50 | < 100 ms | 100-500 ms | > 500 ms |
| Multi-RTO flow stalls | near zero | > 0.1 / 100 connections | > 1 / 100 connections |
| Zero-window events | < 1 / 100 connections | 1-10 / 100 connections | > 10 / 100 connections |
| Unanswered SYN ratio | < 1% | 1-5% | > 5% |

### Workload Inference

Infer workload once per device before applying latency thresholds. Prefer the
user's stated workload type; otherwise use observed behavior and label an
ambiguous classification as mixed.

Database indicators:

| Signal | OLTP | OLAP / warehouse |
| --- | --- | --- |
| `rsp_ttlb` p50 | usually < 200 ms | often > 500 ms |
| request rate | high and steady | lower and bursty |
| response size | small | large |
| `tprocess` baseline | tens of ms | seconds |

Use a recent stable window:

- `rsp_ttlb` p50 < 200 ms and `tprocess` p50 < 100 ms: classify as OLTP.
- `rsp_ttlb` p50 > 500 ms and `tprocess` p50 > 1 s: classify as OLAP.
- Otherwise classify as mixed, use the more conservative applicable baseline,
  and ask the operator to confirm before making a threshold-driven severe claim.

Use HTTP static/cache thresholds only when a stable baseline shows very low
processing and response-completion latency or the device is known to be a
cache/CDN/static tier. Otherwise use application-server thresholds.

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

Keep direction explicit. `rto_in` and `rto_out`, `zwnd_in` and `zwnd_out`, and
connection initiator/responder perspectives localize different sides of a
problem. Do not blend them into one rate if the asymmetry changes the action.

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

Reject a baseline that crosses a maintenance period, mismatched business/off
hours, or a weekend boundary that the assessment window does not. A missing,
zero, or operationally incomparable baseline cannot support `(new)`,
`(chronic)`, or `(recovered)`.

For peer comparison:

1. Resolve the device role and a bounded same-role peer population.
2. Compute the median for the shared metric and the median absolute deviation
   (MAD).
3. Treat values more than `2 * MAD` from the median as outlier candidates, but
   retain the activity and visibility gates.
4. Report the absolute value and rank, not only the multiplier.

Historical comparison answers "did this device change?" Peer comparison
answers "is this device worse than its siblings now?" Use both when volume is
moderate and history exists.

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

For percentile approximation, find the adjacent returned percentiles whose
values bracket `T` and `4T`, linearly interpolate the percentile rank at each
boundary, and multiply by total samples. Count actionable errors as Frustrated.
Because the API does not provide a joint latency/error distribution, label HSI
derived this way as an estimate and use it for calibration or trend—not as the
sole reason for a severe verdict.

For fleet summaries, flag a materially wide distribution when per-device HSI
standard deviation exceeds `0.10`, or when MAD exceeds `0.05` and at least one
device is more than `2 * MAD` below the median. Lead with the healthy and
unhealthy subpopulations rather than the fleet mean.

## Confidence Rollup

Calibrate confidence from the evidence that drives the verdict:

| Driving evidence | Treatment |
| --- | --- |
| fresh, above activity gates, comparable baseline, reliable visibility | High confidence |
| near a gate, baseline boundary concern, or 10-25% unidirectional flows | Medium confidence; state the caveat |
| below a driving activity gate, missing valid baseline for a change claim, or > 25% unidirectional flows | Insufficient Evidence for the affected claim |

Do not use a generic confidence label to rescue a verdict whose required
evidence failed. Downgrade the affected category to Insufficient Evidence and
name what would make it decidable.

## Account Lockouts

Treat `kerberos_server:account_lockout` as a first-class finding when there are
at least five lockouts in the window or the rate is at least three times a valid
baseline.

| Pattern | Likely direction | Next check |
| --- | --- | --- |
| low constant rate | stale service-account credentials | identify sources and rotate credentials |
| sudden spike across many accounts | password spray | pivot to security triage and identify source IPs |
| sudden spike on a few accounts | credential testing or MFA fallback issue | verify MFA and inspect affected accounts |
| coincident `KDC_ERR_PREAUTH_FAILED` spike | auth failures driving lockouts | treat as one correlated finding |

Do not label a spray from count alone. Use account distribution, source
distribution, timing, and the strongest benign alternative.

## Deployment And Enterprise Caveats

- Broadly distributed `unidirectional_flows` above 25% often indicates SPAN or
  cloud traffic-mirroring loss; return Insufficient Evidence for TCP health.
- Uniform sensor-wide volume collapse is an ingestion or sensor-connectivity
  signal, not a silent outage on every application.
- Low device/protocol diversity can indicate undecapsulated overlay traffic.
- Uniform setup-time elevation across one virtual sensor can reflect sensor-host
  resource pressure; recommend out-of-band host checks.
- Load balancers, health probes, scanners, NAT gateways, backup windows, and
  brief routing convergence can create baseline-consistent aborts or bursts.
  Separate those patterns from user-impacting degradation.
- A few destinations with repeated RTOs on large transfers but healthy small
  traffic can indicate a path-MTU blackhole; keep this as a hypothesis until
  packet or path evidence supports it.
