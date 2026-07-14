# Health Check Diagnostic Playbooks

Run these when a category is Warning or Degraded before finalizing the verdict.
The goal is to find whether the symptom is local, downstream, fleet-wide, or a
sensor/deployment artifact.

Stop drilling when you have a defensible root-cause direction, when three
sequential checks are clean, when the next step is clearly out-of-band, or when
the first answer would become less useful by continuing.

## HTTP 5xx or HTTP Latency

Starting signal: actionable HTTP 5xx rate > 1%, elevated HTTP latency, or a
volume anomaly on a web/app tier.

1. Check `http_server:tprocess` p50/p95 on the same web server or fleet.
2. Compare same-role peers. Single-server means host/app fault; whole tier means
   load balancer, shared dependency, deploy, or external load event.
3. Check backend database latency for significant peers discovered from metrics
   or topology.
4. Check outbound API/TLS/HTTP client latency from the web server.
5. Check TCP transport to specific backends: RTO, retransmission, zero-window,
   and setup time.
6. If downstream cause is confirmed, keep the upstream user-impact verdict but
   target recommendations at the downstream device or tier.

## Active Directory / Domain Controller Health

Starting signal: Kerberos actionable errors, LDAP actionable errors, account
lockouts, or auth latency on a domain controller.

1. Query Kerberos, LDAP, and DNS on the same DC together.
2. Treat co-occurring Kerberos and LDAP degradation as one AD-services finding,
   not two independent failures.
3. For Kerberos:
   - account-lockout spike plus broad account distribution can indicate a
     password spray and should be handed to security triage;
   - `KDC_ERR_S_PRINCIPAL_UNKNOWN` points to SPN registration/migration issues;
   - `KDC_ERR_KEY_EXPIRED` points to password-policy or expiration waves;
   - `KDC_ERR_PREAUTH_FAILED` points to bad credentials, MFA fallback, or spray.
4. For LDAP:
   - `invalidCredentials` often means stale application service-account config;
   - `unavailable` or `busy` suggests DC overload;
   - `operationsError` can point to NTDS or replication issues.
5. Check TCP to replication partners and DNS health on the same DC.

## Database Latency

Starting signal: `db_server:tprocess` p95 or p50 over threshold, sustained.

1. Classify workload as OLTP, OLAP, or mixed before applying thresholds.
2. Check TCP layer on the DB server: RTO, retransmission, zero-window, setup
   time, and RTT.
3. Check DB-to-DB replication peers if the environment has them.
4. Compare `db_server:rsp_ttlb` and `db_server:tprocess`:
   - both elevated: large result sets, missing index, or runaway queries;
   - processing elevated but time-to-last-byte normal: server CPU/locking;
   - TCP clean and DB latency high: likely DBA/storage/app issue out of band.
5. Compare peers. One DB points to instance fault; many DBs point to shared
   storage, virtualization, or network segment.

## TCP Retransmissions or Flow Stalls

Starting signal: retransmission, RTO, multi-RTO, zero-window, or setup-time
degradation.

1. Rule out sensor artifact with `tcp:unidirectional_flows`.
2. Localize direction: `rto_out` vs `rto_in`.
3. Rank top devices or peers by RTO/retrans count with `total_by_object`.
4. Decide concentrated vs distributed:
   - concentrated on one peer: NIC, path, PMTU, or host issue;
   - spread across many peers: segment/uplink/switch/mirroring issue.
5. Check PMTU signature: a few large packets repeatedly fail while small
   packets succeed, often on VPN or tunnel paths.
6. For zero-window, distinguish receiver backpressure from network loss.

## SMB/CIFS File Server Slowness

Starting signal: `cifs_server:access_time` elevated, CIFS errors, or file-share
complaints.

1. Check TCP transport first: RTO and zero-window on the file server.
2. Break down read vs write volume with `bytes_read` and `bytes_write`.
3. Compare same-role file servers if possible.
4. Use records only after degradation is confirmed and the time window is narrow
   enough. Look for slow transactions, concentrated clients, and operation type.
5. If TCP is clean and slowness is server-wide, recommend storage/host checks.

## DNS Degradation

Starting signal: SERVFAIL/FORMERR rate, DNS latency, request timeout, or DNS
volume drop.

1. Determine authoritative vs recursive/forwarding role and apply the right
   latency thresholds.
2. For SERVFAIL on recursive/forwarding servers, check upstream resolver or
   internet connectivity from the DNS server.
3. For authoritative DNS latency, check resource pressure and TCP symptoms on
   the DNS server.
4. Compare the DNS fleet:
   - one resolver degraded: local config, forwarder, or host issue;
   - whole fleet degraded: upstream, shared infrastructure, or client-side load.
5. DNS Warning findings deserve follow-up because blast radius is often broad.

## Silent Outage / Load Shift

Starting signal: request or response volume changes by more than 5x versus a
valid baseline.

1. Confirm the baseline meets activity gates and is comparable.
2. Check peers with the same role.
3. Interpret:
   - dropped member plus peer pickup: source is likely offline or bypassed; peer
     is now carrying redundancy risk;
   - dropped member with no peer pickup: client-side issue, routing, or broader
     service outage;
   - peer pickup plus peer latency/error rise: cascading capacity failure.
4. Do not dismiss the finding because error rate is normal; that is expected
   when little or no traffic reaches the service.

## Sensor / Visibility Artifact

Starting signal: stale data, high unidirectional flows, uniform volume collapse,
low protocol/device diversity, or sensor-wide TCP anomalies.

1. Compare freshness and volume across sensors.
2. Check whether all protocol/device diversity collapsed together.
3. Check for high `tcp:unidirectional_flows` broadly distributed.
4. If likely artifact, return Insufficient Evidence for affected categories and
   recommend sensor, SPAN, VPC mirror, overlay decapsulation, or appliance
   connectivity investigation.
