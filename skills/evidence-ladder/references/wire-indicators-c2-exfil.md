# Wire indicators — C2, DNS abuse, and exfiltration

Corroboration detail for detections involving command-and-control channels, DNS
abuse, and data leaving the estate. Read
[wire-indicators-identity.md](wire-indicators-identity.md) first for the shared
conventions — the same rules apply here:

- **Scope first.** These corroborate a detection already under investigation,
  inside its own window and participant set. Activity found outside that scope
  is a **pivot** for `./investigation-plan`, not evidence for this verdict.
- **`[verify]`** means the field may not exist in your build — confirm with
  `./excli-interface search_records -help` or `search_metric_catalog` before
  querying. A zero result from a field that does not exist is not a negative
  finding.
- **ATT&CK IDs are unverified** best-effort mappings. Confirm before citing.

## Two limits that decide half the queries in this file

**1. Metric granularity is 30 s at best**, then 5-minute and 1-hour rollups. Any
beacon with a period under ~2–3 minutes cannot have its inter-arrival variance
computed from a timeseries — the buckets alias. Metrics tell you *"this device
talks to this peer in every bucket, forever"*; **records give you real
per-transaction timestamps for interval maths.** Default to metrics-then-records
and do not pretend a timeseries yields jitter.

**2. Without TLS decryption you have SNI and byte counts, not content.** For
HTTPS you get the TLS handshake — SNI, certificate, cipher, version — and flow
volumes. You do **not** get HTTP host, URI, method, or headers. "Uploaded 800 MB
to `dropbox.com`" is provable; "POSTed these files" is not. Every HTTP-record
indicator below silently assumes cleartext HTTP or an environment where ExtraHop
is decrypting. **State which case you are in before reporting.**

**Top-N metrics are top-N.** Unique-cardinality questions ("how many distinct
subdomains under this parent domain") truncate in a topnset and must be answered
from records.

---

## Beaconing — interval regularity

Periodic check-ins from one client to one destination at a near-constant
interval. `[ATT&CK T1071.001, T1573.002, unverified]`

**Thresholds.** Coefficient of variation (stdev ÷ mean) of inter-connection
intervals:

| CV | Reading |
|---|---|
| < 0.05 | Very high confidence — automated |
| 0.05 – 0.15 | High |
| 0.15 – 0.25 | Moderate |
| > 0.30 | **Not a beacon** — treat as human or random |

Gates: **>50 connections per 24 h** (sample size); mean interval between **30 s
and 86,400 s**; pattern persisting **>1 h**, ideally >24 h.

**Snap-to-round-number intervals** are a strong boost — score up if the mean is
within 10% of 60, 120, 300, 600, 900, 1800, or 3600 s.

**Jitter-aware variant.** Against 0–50% jitter, use **IQR/mean < 0.50** instead
of CV — a 60 s beacon at 30% jitter legitimately spans 42–78 s.

**Framework defaults** worth matching a measured interval against: Cobalt Strike
60 s / 0–50% jitter; Sliver 60 s / 0–30%; Brute Ratel 60 s / 10–30%; Covenant
10 s / 10%; Meterpreter 5 s / 0%; Havoc 5 s / 0–20%. Reference point for slow
beacons: SUNBURST ran ~12–15 min ± 90 s after a 12–14 day dormancy.

**Where.** Metrics (rung 1): per-device HTTP request-rate, TCP connection-rate,
and bytes in/out per device→peer — find devices present in *every* bucket over
days with flat amplitude. This is a candidate filter, not the test. Records
(rung 2, where the answer is): pull HTTP, SSL, or flow records filtered to
`client = device, server = peer` over ≥24 h, sort by timestamp, compute deltas.
Packets: almost never needed for a timing question.

**Payload-size regularity** is as diagnostic as the interval: CV of
bytes-per-connection **< 0.30**. A beacon with flat request bytes and an
occasional **large response spike** is tasking or tool transfer — that spike is
the most investigable moment in the timeline.

**Long-haul variant:** some C2 holds one session open instead of reconnecting —
connection duration **>3600 s** to an external peer with low byte volume
relative to duration.

**FP separators — this is most of the work:**

| Benign source | Why it matches | Separator |
|---|---|---|
| NTP | Textbook periodicity | Fixed **48-byte** payloads, port 123, destination is a time server/DC |
| EDR heartbeats (CrowdStrike, SentinelOne, Defender) | Very low CV, TLS, 24/7 | Vendor cloud destination; **every endpoint does it** — a beacon on one device is suspicious, on 4,000 it is an agent |
| Monitoring agents (Zabbix 10050, NRPE, SNMP, Datadog) | Exact intervals, tiny payloads | Destination is internal with a monitoring-server role; often inbound-polled |
| Windows Update / Delivery Optimization | Periodic check-in | Highly **variable** response bytes; `*.windowsupdate.com`, `*.delivery.mp.microsoft.com` |
| Telemetry, crash reporters | Periodic small POSTs | Well-known SNI, fleet-wide |
| OCSP / CRL | Regular | URI contains `/ocsp` or `.crl` |
| Chat/collab (Slack, Teams, Zoom) | ~30 s WebSocket ping | One long-lived connection with keepalives, not repeated new connections |
| Long-haul FPs | Duration >1 h | Admin SSH, VPN tunnels, DB connection pools, IMAP IDLE, RDP |

**The decisive corroborator** is fleet prevalence: is this destination contacted
by **1–3 internal hosts** (C2) or by hundreds (SaaS)? Run that check before
anything else. Then device role — a print server beaconing is not a laptop
beaconing.

---

## Cobalt Strike traffic characteristics

Config *extraction* needs a malware sample and is out of scope. The resulting
*traffic* is wire-observable.

**Default TLS identity** (unmodified team servers):
- Certificate issuer/subject CN **`Major Cobalt Strike`**; the full default DN
  also carries `O=cobaltstrike`, `OU=AdvancedPenTesting` `[verify]`.
- Certificate serial **`8BB00EE`** hex `[verify]` — uncertain whether ExtraHop
  exposes certificate serial as a queryable field; the issuer CN is nearly as
  good and more likely present.
- Self-signed, short validity, CN not matching SNI.
- Non-standard HTTPS ports **8080, 8443, 444**.
- JA3S hashes `ae4edc6faf64d08308082ad26be60767`,
  `a0e9f5d64349fb13191bc781f81f42e1` `[verify]` — ExtraHop surfaces a JA3-style
  *client* fingerprint in some builds; **server-side JA3S availability is much
  less certain.** Verify before building a hunt on it.

**Explicitly not usable: JARM.** It is an *active-scanning* fingerprint
requiring crafted ClientHellos. ExtraHop is passive. It remains valid as
external enrichment via `security-research`, never as a RevealX query.

**Malleable-profile HTTP shapes** (require cleartext or decryption):
- Default URIs: `^/[a-zA-Z]{4}$` (the classic 4-char GET), `/submit.php`
  (often `?id=<digits>`), `/pixel`, `/dpixel`, `/pixel.gif`, `/___utm.gif`,
  `/ca`, `/updates.rss`, `/visit.js`, `/api/v1/status`.
- Default User-Agents: `Mozilla/5.0 (compatible; MSIE 9.0; Windows NT 6.1;
  Trident/5.0)`, `Mozilla/4.0 (compatible; MSIE 7.0; Windows NT 5.1)`,
  `Mozilla/5.0 (compatible; MSIE 10.0; Windows NT 6.2; WOW64; Trident/6.0)`.
- **Structural tells, more durable than any literal string:** metadata carried
  in a `Cookie:` header as a 60+ character base64 blob on a GET with no prior
  `Set-Cookie` `[verify — arbitrary request headers may not be stored]`;
  GET/POST asymmetry (GETs with ~0 body and small responses for tasking, POSTs
  with body to a *different* URI for output); `Host` not matching SNI.
- **Cheapest high-yield query:** a legacy IE User-Agent from a device that
  otherwise emits modern Chrome/Edge UAs.

**FP separators.** `/pixel.gif` and `/___utm.gif` are *real* analytics
endpoints — that is the entire point of those profiles — and `/api/v1/status` is
a real health endpoint on countless products. **Never alert on URI alone**; the
URI corroborates a destination already flagged by timing or certificate. A
legacy UA alone is more likely an embedded appliance than a beacon. The default
`Major Cobalt Strike` cert is near-zero-FP but also near-extinct — a hit is most
likely a red-team exercise, so check before escalating.

**SMB / named-pipe beacon** (internal peer-to-peer C2): SMB2 create or
tree-connect to `IPC$` with a pipe name matching `msagent_*`,
`MSSE-<digits>-server`, `postex_*`, `status_*` `[verify]`, between two
workstations that have no file-sharing relationship; the internal peer then
shows the external beacon pattern. FP separator: legitimate pipes are constant —
`srvsvc`, `wkssvc`, `atsvc`, `lsarpc`, `samr`, `netlogon`, `spoolss`, plus EDR
and management agents. Filter to non-standard names and workstation-to-workstation
direction.

---

## DNS tunnelling and exfiltration

`[ATT&CK T1071.004, T1048.003, T1572, unverified]`

**Entropy needs a length gate.** Shannon entropy of a string of length *L*
cannot exceed log2(*L*), so "entropy > 4.0" is *arithmetically impossible* for a
subdomain shorter than 17 characters. Theoretical ceilings: hex 4.0, base32 5.0,
base64 6.0. **Always pair an entropy threshold with a minimum-length gate
(≥20–30 chars), and prefer per-label entropy over whole-name entropy.**

| Measure | Normal | Tunnelling |
|---|---|---|
| Full query length | 20–30 chars | **>50**; alert band 40–253 |
| First-label length | 5–20 | **>30**, commonly 40–63 (63 = max label) |
| Label count | 2–4 | **5–10+** |
| Per-label entropy (length-gated) | 2.0–3.5 | **>3.5** suspicious, **>4.0** high confidence |
| Unique subdomains per parent domain | few | **>50**, often >100/h |
| Unique-subdomain ratio (unique ÷ total) | low | **>0.7**, often >0.9 |
| Queries, one src → one parent domain | <50/h | **>100/h**; active tunnel 100s–1000s/min |

Reference entropy points: `google` ≈ 2.25, `x8kj2m9p4qw7n` ≈ 3.70, a base64
tunnel label ≈ 3.50.

**Charset tests** (cheap and precise when length-gated): hex ratio **>0.85** with
length >20 → hex encoding; base32 charset (`a–z2–7`) ratio **>0.95** → iodine,
dns2tcp, Sliver; base64-like ratio **>0.9** *and* entropy >4.0.

**Tool fingerprints:** iodine → **NULL** primary plus TXT/CNAME/MX/A, base32/64,
50+ char subdomains, ~100 kbps. dnscat2 → TXT/CNAME/MX/A, hex 16+ chars,
sometimes a literal `dnscat.` label, ~10 kbps. dns2tcp → TXT and **KEY**, base32
20+ chars, ~50 kbps. Sliver DNS → A/TXT, alphanumeric 30+, entropy 3.5–4.2.
Cobalt Strike DNS mode → hex 8–20 chars, **A/AAAA for check-in and TXT for
download** (the alternation is the shape), 60 s default, and — a strong cheap
tell — a fixed sentinel `dns_idle` answer IP repeated across many distinct
subdomains under one parent.

**Tool-name fragments** occasionally appear literally in the qname: `.dnscat.`,
`.dns2tcp.`, `.iodine.`, `.dnscapy.`, iodine's `*.pirate.sea`.

**Volume estimate:** encoded label length × **0.75** ≈ bytes exfiltrated (base64).

**Where.** Metrics (rung 1): per-device DNS request-rate timeseries and
"requests by record type" — a device 50× above its own baseline, or whose TXT
share jumps. Records (rung 2, mandatory): qname for length/entropy/charset, and
critically **unique-subdomain cardinality grouped by registered domain per
source device** — the single most discriminating measure, and records-only.
Packets: only to recover exfiltrated content for damage assessment.

**FP separators — long, high-entropy, single-use subdomains are the normal
operating mode of large parts of the modern internet:**

| Benign source | Why it matches | Separator |
|---|---|---|
| **AV / reputation lookups** (McAfee GTI `*.avqs.mcafee.com`, `*.sophosxl.net`, ESET, Umbrella) | Hashes encoded as long high-entropy subdomains, thousands unique/hour | Known vendor parent domain; **fleet-wide**; fixed-length hash, not variable |
| **DNSBL/RBL from mail gateways** (`*.spamhaus.org`, `*.barracudacentral.org`) | Huge unique count to one destination | Source is a mail-gateway role; names are dotted-quad shaped, low entropy |
| CDN / cloud randomized hostnames | Genuinely high entropy | Shared across many clients; resolve to CDN ASNs |
| AD service lookups (`_ldap._tcp.dc._msdcs...`) | High SRV volume | Internal resolver, internal domain |
| Chatty / misconfigured clients, search-suffix loops | Massive volume, high NXDOMAIN | Names **repeat** — the unique-ratio test kills this |

**Run the prevalence check first:** does this parent domain receive queries from
**one host** (tunnel) or **the whole estate** (vendor service)?

---

## DNS record-type abuse

- **TXT ratio to a single domain >30%**, or absolute **>50 TXT queries** per
  source in the window. Escalation bands: >100/h medium, >500 high, >1000
  critical.
- **NULL (qtype 10) queries — any volume is anomalous.** Essentially never used
  legitimately and iodine's primary carrier. **Highest-precision single
  indicator in this file.**
- **KEY** queries → dns2tcp. Elevated CNAME/MX from a non-mail endpoint.
- **TXT response size:** normal <100 bytes; tunnelling 200–4000+; alert >400–500.
  The per-string cap is 255 bytes, so a multi-string TXT response is itself a
  tell. Carrying capacity per type: A 4 B, AAAA 16 B, TXT ~255 B/string,
  CNAME/MX/SRV ~253 B, NULL ~65,535 B.
- **Where:** DNS records (qtype, answer count, answer values). Answer *byte
  size* `[verify]` — derivable from the returned string; the DNS response-bytes
  metric per device is a workable rung-1 proxy.
- **FP separators:** legitimate TXT is everywhere — SPF (`v=spf1`), DKIM
  (`*._domainkey.*`), DMARC (`*._dmarc.*`), and verification records
  (`google-site-verification=`, `MS=`, `apple-domain-verification=`,
  `facebook-domain-verification=`). **Exclude `*._domainkey.*`, `*._dmarc.*`,
  `*._spf.*` before counting.** Mail servers legitimately drive high MX/TXT
  volume — gate on device role. NULL has no such excuse; keep it strict.

---

## DGA

`[ATT&CK T1568.002, unverified]`

**The primary signal is NXDOMAIN volume**, not character features: a host
resolving many failed, never-before-seen registered domains. High NXDOMAIN count
plus high unique-registered-domain count from one device *is* the detection.

Character features for scoring the names, once you have them: entropy >3.5; SLD
length >12–15; vowel ratio <0.2; consonant ratio >0.7; digit ratio >0.3; max
consecutive consonants >4; unique-char ratio <0.4; hex ratio >0.8. The
successful resolution *after* many NXDOMAINs is the rendezvous point — that one
is your IOC.

**Where.** Metrics: DNS response-error / NXDOMAIN counters per device are
first-class in ExtraHop, which makes this genuinely cheap. Records: DNS filtered
`rcode = NXDOMAIN`, grouped by device, count distinct registered domains.

**FP separators.** Search-domain suffix chains and typo'd internal names produce
NXDOMAIN floods with *low* domain diversity — the unique-domain count separates
them. Chrome's startup random-hostname probe is 3 queries, not hundreds.
**Dictionary DGAs (e.g. Suppobox) have low entropy and evade every character
test** — the NXDOMAIN-volume test still catches them.

---

## Domain fronting and SNI anomalies

`[ATT&CK T1090.004, unverified]`

**The core test needs decryption.** SNI is always available; the HTTP `Host`
header is inside TLS. The classic "SNI ≠ Host" comparison therefore **cannot be
run without TLS decryption deployed.** Say this rather than shipping a hunt that
silently returns nothing.

**Without decryption**, the reachable proxies are: SNI vs certificate SAN/CN
mismatch (server presents a cert not covering the requested SNI); SNI resolving
to an IP/ASN inconsistent with that SNI's normal resolution; a TLS connection to
a CDN with **no SNI at all**; and ECH/encrypted-ClientHello presence `[verify]`.

**With decryption**, join TLS records (`server name`) to HTTP records (`host`)
on the same flow and compare **registered** domains, not FQDNs.

CDN certificate CNs to recognise: `*.cloudfront.net`, `*.azureedge.net`,
`sni.cloudflaressl.com`, `*.akamaiedge.net`, `*.fastly.net`.

**FP separators.** Legitimate CDN and multi-tenant hosting produce SNI/Host
differences routinely — that *is* how CDNs work. The mismatch alone is noise;
the finding is the **Host side being newly-registered, low-reputation, or
contacted by no other host in the estate**. Note also that the major CDNs
largely killed classic domain fronting in 2018 — a genuine hit today is more
likely CDN or serverless *abuse*, so adjust the narrative rather than reporting
textbook fronting.

---

## TLS certificate posture

- **Indicators:** validation failure or self-signed on **external** destinations;
  unusually short validity; issuer CN that is an IP or nonsense; CN not matching
  SNI; one certificate reused across multiple unrelated destination IPs
  (infrastructure clustering); rare cipher/version combination for that
  destination; `not_before` within days of first observation.
- **Where:** SSL/TLS records — subject, issuer, not-before/not-after,
  self-signed flag, SNI, cipher, version. All first-class; **one of the
  strongest ExtraHop-native plays available.**
- **Rung:** records.
- **FP separators:** internal self-signed is endemic — iDRAC/iLO, printers, dev
  boxes, appliances. **Scope to external destinations** and the FP rate
  collapses. Let's Encrypt now issues a large fraction of all public
  certificates, so "free CA" alone is meaningless; short validity is now normal
  practice. Only the *combination* is worth analyst time. And know your own
  posture: an enterprise TLS-inspection proxy re-signs everything and will make
  every external certificate look internally issued.

---

## Lookalike domains — the observed-traffic half only

**Scope boundary, state it to the user.** Generating permutations, checking
registration age, querying Certificate Transparency logs, WHOIS, and page-similarity
scoring are **not ExtraHop** — they belong to the `security-research` skill.
ExtraHop answers the other half, which is the half that matters: *did anything on
our network actually talk to it.* A lookalike domain in a CT log is a
possibility; the same domain in your DNS or SNI records is an incident, and you
get the list of which internal clients resolved it.

- **Indicators:** an observed **DNS qname**, **TLS SNI**, or **HTTP Host** that
  is a near-miss of a protected brand domain — Levenshtein ratio **≥0.75–0.8**
  against the brand's second-level label, or containing the brand string without
  being the brand domain. Permutation classes: homoglyph (`examp1e.com`,
  Cyrillic `о` U+043E, Cyrillic `і` U+0456), transposition (`exmaple`), omission
  (`examle`), insertion (`exaample`), repetition (`exxample`), keyboard
  replacement (`rxample`), hyphenation (`exam-ple`), bitsquatting (`dxample`),
  vowel swap (`exomple`), subdomain-dot insertion (`ex.ample.com`), dictionary
  addition (`example-login.com`). **A `xn--` punycode prefix in an observed qname
  or SNI is directly detectable and is a strong signal.**
- **Where:** DNS records (qname), SSL records (SNI, cert subject/SAN), HTTP
  records (host).
- **Rung:** records.
- **FP separators:** legitimate brand variants, regional TLDs, marketing
  domains, acquired-company domains, and vendor domains that embed your brand
  (`yourbrand.zendesk.com`, `yourbrand.okta.com`). **Maintain an explicit
  owned/approved domain allowlist first — without it this technique is
  unusable.** Resolution to an IP outside known ranges is a usable wire-side
  discriminator.

---

## Exfiltration

### Outbound volume anomaly
- **Indicators:** >2× the 30-day per-host average; `daily_bytes > avg + 3×stdev`
  **and** >100 MB; >100 MB total outbound per host; any transfer >100 MB
  off-hours; >50 MB to a first-seen destination; >500 MB/day per user to cloud
  storage. **Directionality is the point** — alert on `bytes_out`, and on
  **inverted ratio**: a client whose outbound exceeds inbound on a protocol that
  is normally download-skewed.
- **Where:** per-device and per-application **timeseries metrics** for bytes
  sent/received. This is a textbook metrics-tier question — do not try to answer
  it with records; use records only to attribute specific sessions.
- **FP separators:** benign high-volume destinations —
  `windowsupdate.com`, `microsoft.com`, `googleapis.com`, `gstatic.com`,
  `amazonaws.com`, `cloudfront.net`, `apple.com`, `icloud.com`, `adobe.com`,
  `akamai.net`. Add offsite backup/DR replication, corporate cloud-storage sync,
  CI/CD artifact pushes, video conferencing, and database replication. A backup
  replica moves gigabytes *every night on schedule to the same destination*.

### Cloud storage and web services
- **Indicators:** TLS SNI or HTTP Host matching `drive.google.com`,
  `storage.googleapis.com`, `dropbox.com`, `dl.dropboxusercontent.com`,
  `box.com`, `onedrive.live.com`, `sharepoint.com`, `mega.nz`, `wetransfer.com`,
  `sendspace.com`, `mediafire.com`, `pastebin.com`, `paste.ee`, `github.com`,
  `gitlab.com`, `bitbucket.org`, `discord.com`, `cdn.discordapp.com`,
  `api.telegram.org`, `slack.com` — **from a device whose role has no business
  using them**, with beacon-shaped timing or a large upload.
- **Where:** SSL records (SNI) + flow bytes; HTTP records where decrypted.
- **FP separators:** sanctioned corporate use of exactly these services is
  normal, and `github.com`/`slack.com`/`sharepoint.com` will be top talkers in
  any developer organisation. **Personal vs corporate tenant is usually not
  distinguishable from SNI alone** — this produces leads, not conclusions. The
  realistic play is **servers and appliances**: a domain controller reaching
  `api.telegram.org` is a finding; a laptop doing it is Tuesday.

### Alternative protocols
- **FTP** STOR/PUT with filenames and bytes; **SSH/SCP/SFTP** long sessions with
  heavily outbound-skewed ratio to an external peer (content is opaque, so this
  is a flow-ratio play); **SMTP** attachment size >10 MB (or >25 MB) to external
  consumer-mail domains.
- **FP separators:** FTP/SFTP is still the backbone of B2B exchange — EDI,
  payroll, vendor feeds — and those are large, scheduled, and to fixed partners.

### Remote data staging
- **Indicators:** one SMB client reading from **many distinct shares** then
  writing a **small number of large files to one path**; archive extensions
  written to a share (`.7z`, `.rar`, `.zip`, `.tar.gz`, `.cab`); split-archive
  naming (`.7z.001`, `.part1.rar`); >100 MB staged per user.
- **Where:** CIFS records (filename, extension, path, share, user, bytes);
  per-client read-vs-write byte metrics.
- **Not observable:** local staging on an endpoint's own disk (`%TEMP%`,
  `$Recycle.Bin`, `/dev/shm`), archiver command lines and passwords. Only
  staging that crosses the network onto a share is visible.
- **FP separators:** users zip project folders onto shares; developers push build
  artifacts; backup-to-disk writes large archives by design; log rotation writes
  `.gz` continuously. The finding is an archive written by an account with no
  history of it, from directories that account doesn't normally read,
  immediately preceded by wide read fan-in and followed by an outbound transfer.

### Low-and-slow
Small transfers at fixed cadence summing to a large volume — deliberately under
any per-event threshold. Example shape: 0.58 kbps sustained over 18 h ≈ 4.7 MB.
**Metrics only** — invisible at records tier because no individual session is
remarkable. Same FP separators as beaconing.

---

## Ransomware

### Precursors
Covered above and in [wire-indicators-identity.md](wire-indicators-identity.md):
port sweep, admin-share fan-out, remote service execution, credential access,
lateral tool transfer.

### Encryption in progress `[not from source material — model knowledge]`
Published detection content overwhelmingly stops at pre-encryption. Given
ExtraHop's SMB visibility this is the largest gap worth filling.
`[ATT&CK T1486, unverified]`

- **Indicators:** one SMB client driving sustained **read → write →
  rename/delete per file** across thousands of files, at hundreds-to-thousands of
  file operations per minute; **read:write byte ratio approaching 1:1**
  (encryption rewrites roughly what it reads — normal file-server workloads are
  read-skewed, often 10:1 or more); write sizes tightly clustered by a fixed
  encryption buffer; a burst of **creates of an identically-named file in every
  directory** (ransom notes); a burst of **renames converging on one new
  extension**.
- **Detect on shape, not on name lists.** Ransom-note filenames and encrypted
  extensions are family-specific and change constantly. Query for *"the same new
  filename appearing in hundreds of directories"* and *"one extension suddenly
  dominating rename targets"*, not for `README.txt` or `.locked`.
- **Where:** CIFS records (operation, filename, path, share, user, sizes) plus
  CIFS operation-rate metrics per client and per share.
- **Rung:** metrics to catch the rate and ratio break; records to identify the
  user, share, and file set for scoping.
- **FP separators — severe here.** Backup jobs read entire shares at machine
  speed; AV/EDR full scans open every file; search indexers touch everything;
  file-server migrations, DFS replication, and robocopy produce mass read+write;
  encryption-at-rest rollouts genuinely rewrite files. **The read:write ratio is
  the discriminator, not the operation rate** — backups and scanners are
  overwhelmingly read-only. Migrations write to a *new* path; ransomware writes
  back over the *source* path. **Require at least two of {ratio inversion,
  rename-extension convergence, repeated-note-filename} before calling it.**

---

## Rare destinations and non-standard ports

- **Indicators:** destination contacted by exactly **1** source device with **<5
  total connections**; known-bad defaults **4444** (Metasploit), **31337**; CS
  HTTPS listeners on **8080/8443/444**; TLS on a port ExtraHop classifies as
  something else; unclassified L7 on a high port.
- **Where:** flow records for the port and rarity maths; **device context** (role,
  tags, groups, observed activity) to answer "is this normal *for this device*"
  — which is what makes RevealX better at this than a flat log search.
- **FP separators: this technique is a noise generator on its own.** Rare
  destinations are overwhelmingly benign — one-off downloads, personal SaaS,
  vendor sites. **New/rare is a ranking signal, never an alert.** Combine with
  periodicity or certificate posture before it means anything. Non-standard
  ports are routine in dev/test estates.

---

## ICMP tunnelling

- **Indicators:** echo payload **>64 bytes** average (normal Windows ping = 32,
  Linux = 56); **>100 ICMP packets** on one source→destination pair; payload
  contents differing from the standard incrementing filler.
- **Where:** flow records and ICMP/network metrics give packet counts and byte
  volumes per pair — enough for the volume/size anomaly. A per-message payload
  length field is `[verify]`; use bytes-per-packet from flow data as the
  practical substitute. Payload *content* and entropy require **packets** — one
  of the few genuine packet cases in this file.
- **FP separators:** monitoring tools (SolarWinds, PRTG, ThousandEyes) send large
  and high-volume ICMP by design; path-MTU discovery and some LB health checks
  use oversized ICMP. Check for a monitoring role before proceeding.

---

## Provenance

Curated in September 2026 from
`github.com/mukul975/Anthropic-Cybersecurity-Skills` (Apache-2.0) plus model
knowledge, filtered to what ExtraHop observes. Source framework frontmatter was
discarded as unreliable; conflicting entropy and threshold values across source
files were reconciled to the most defensible band and the length-gate caveat
added. The ransomware-encryption section has no source-material basis and is
flagged as such.
