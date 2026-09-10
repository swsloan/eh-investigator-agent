# Wire indicators — ICS / OT protocols

Corroboration detail for detections involving industrial protocols. Read
[wire-indicators-identity.md](wire-indicators-identity.md) first for the shared
conventions — scope discipline, `[verify]` markers, and the caveat that ATT&CK
mappings here are unverified.

**Only use this file when OT is actually in scope.** If the environment has no
industrial segment, these protocols will not appear and querying for them wastes
budget.

**Field granularity is the open question throughout.** ExtraHop parses Modbus
and DNP3, but how much of each PDU is exposed as a queryable record field varies.
Confirm with `./excli-interface search_records -help` and
`search_metric_catalog` before building logic on any `[verify]` field — several
of the most useful values below (unit ID, register range, IIN bits) may not be
reachable without packets.

**The systemic false positive in OT is an engineering workstation doing its
job.** During commissioning, tuning, and maintenance windows an EWS legitimately
issues writes, reads device identity, runs diagnostics, restarts outstations,
and transfers files — indistinguishable by function code alone from an attack.
Every detection below depends on: (a) is the source in the authorized-master or
EWS device group; (b) is there an approved maintenance window; (c) is this the
*first* occurrence for this source→destination pair, or the hundredth. Build
allowlists **per pair**, not globally, and baseline for 1–2 weeks first.

---

## Modbus (TCP 502)

### Function codes

| FC | Operation | Class |
|---|---|---|
| 1 | Read Coils | read |
| 2 | Read Discrete Inputs | read |
| 3 | Read Holding Registers | read |
| 4 | Read Input Registers | read |
| 5 | Write Single Coil | **write** |
| 6 | Write Single Register | **write** |
| 15 | Write Multiple Coils | **write** |
| 16 | Write Multiple Registers | **write** |
| 22 | Mask Write Register | **write** |
| 23 | Read/Write Multiple Registers | read/write |
| 7 | Read Exception Status | diagnostic |
| 8 | Diagnostics | diagnostic |
| 11 | Get Comm Event Counter | diagnostic |
| 12 | Get Comm Event Log | diagnostic |
| 17 | Report Slave ID | diagnostic |
| 43 | Encapsulated Interface Transport | diagnostic |

### Unauthorized client / allowlist violation
- **Indicator:** any Modbus request from a source not on the authorized-master
  list; any function code outside the per-pair allowlist. An off-allowlist
  **write** is critical; an off-allowlist read is high.
- **Where:** Modbus records (function code, client, server); Modbus metrics for
  the FC-mix profile per pair over time. Unit ID and register address `[verify]`.
- **Rung:** records for the violation, metrics for the profile.
- `[ATT&CK ICS T0855 Unauthorized Command Message, T0836 Modify Parameter]`

### Protocol violations and limit abuse
- **Unit ID 0 with a write FC (5, 6, 15, 16)** = broadcast write affecting every
  slave. Legitimate systems essentially never do this. **Caveat:** some vendor
  TCP gateways use unit ID 0 to mean "the only device", not broadcast — check
  whether it predates your baseline.
- **MBAP protocol ID ≠ `0x0000`** — the field is defined as always zero, so any
  other value is a violation or a tunnelling attempt. `[verify]` — least likely
  of these fields to be exposed.
- **Quantity beyond protocol limits:** coil read >**2000**, register read >**125**,
  register write >**123**; PDU >**253** bytes; unit ID outside **1–247**.
- **Scanning:** >5 unique function codes from one source.
- **Exception-response burst** — indicates something probing registers that do
  not exist. `[verify]`, though the exception field is the most likely of these
  to be parsed.
- **FP separator:** buggy or old Modbus stacks genuinely emit malformed headers
  and over-limit requests. **If it has been happening continuously since before
  your baseline, it is a device quirk, not an attack.** New onset is what matters.

### Polling-cadence deviation
- **Indicator:** Modbus polling is deterministic, which makes timing a real
  signal. Alert at **z-score >5.0** against the baselined per-pair interval
  (mean and stdev from 1–2 weeks), or on a simple band — expected 1.0 s with
  alert below 0.5 s or above 3.0 s. A *faster* rate can indicate an injected
  second master; a gap can indicate a MITM or hijacked session.
- **Where:** Modbus request-rate timeseries per client→server pair.
- **Rung:** metrics — this is a rate question and belongs nowhere else.
- **FP separators:** HMI screen changes legitimately alter poll sets and rates;
  adding or removing a tag changes cadence; congestion, device reboots, and
  scheduled batch operations all shift timing. **A z-score of 5 on a single
  interval sample is meaningless — require a sustained shift over many samples.**

---

## DNP3 (TCP 20000)

### Function codes

| FC | Operation | Reading |
|---|---|---|
| `0x00` | Confirm | normal |
| `0x01` | Read | normal |
| `0x02` | Write | caution |
| `0x03` | Select | **control** |
| `0x04` | Operate | **control** |
| `0x05` | Direct Operate | **control** |
| `0x06` | Direct Operate No Ack | **control** |
| `0x07`–`0x0C` | Freeze variants | caution |
| `0x0D` | Cold Restart | **critical — DoS against an outstation** |
| `0x0E` | Warm Restart | **critical** |
| `0x0F` | Initialize Data | **critical** |
| `0x10` | Initialize Application | **critical** |
| `0x11` | Start Application | **critical** |
| `0x12` | Stop Application | **critical** |
| `0x13` | Save Configuration | caution |
| `0x14` / `0x15` | Enable / Disable Unsolicited | normal session management |
| `0x16` | Assign Class | normal |
| `0x17` | Delay Measurement | normal |
| `0x18` | Record Current Time | normal |
| `0x19`–`0x1E` | Open / Close / Delete / Get Info / Authenticate / Abort **File** | **critical — the firmware-manipulation path** |
| `0x81` | Response | — |
| `0x82` | Unsolicited Response | — |

**Select-before-Operate:** an `0x04` Operate **without a preceding `0x03`
Select** is itself an anomaly.

**File operations (`0x19`–`0x1E`) are a documented PIPEDREAM indicator.**

**Data-link framing** for validation: start bytes **`0x0564`**; control-byte bit
**`0x80`** distinguishes Master→Outstation from Outstation→Master; source and
destination link addresses are 16-bit little-endian. `[verify]` on link
addresses and IIN bits — likely packets-tier.

**Rate:** >10 events/sec from a single source = burst.

- **Where:** DNP3 records for request and reply function codes (at minimum);
  DNP3 metrics for rate and per-pair FC mix. Object-group granularity `[verify]`
  and probably absent.
- **Rung:** records for function codes, metrics for rate, packets for link
  addresses and IIN if not parsed.
- **FP separators:** the EWS problem, plus a DNP3-specific one — **restarts and
  file operations are legitimate during firmware upgrades and commissioning**,
  which utilities schedule in advance. `0x14`/`0x15` are ordinary session
  management. Off-hours control commands are the strongest single discriminator.
- `[ATT&CK ICS T0816 Device Restart/Shutdown for 0x0D/0x0E; T0839 Module Firmware
  for the file operations]`

### Unauthorized master
- **Indicator:** a frame with the master bit set (control `& 0x80`) from a source
  not in the authorized-master set, or a master↔outstation pair outside the
  documented topology.
- **Where:** DNP3 records + **device groups** — device context does the heavy
  lifting here.
- **FP separator:** redundant/backup masters and DR sites legitimately take over,
  and test/staging masters exist. **This detection is only as good as the device
  group** — enumerate them up front.

---

## Historian servers

Vendor-API-based historian auditing (PI Web API, Ignition gateway endpoints,
stored-value integrity checks) is **not ExtraHop** — it requires authenticating
to the historian itself. What survives as network observation:

- **Historian service ports** for identifying the traffic: PI Data Archive
  **5457**, PI Web API **443/5459**, Wonderware Historian **1433 (MSSQL)**,
  FactoryTalk Historian **1433**, Ignition Gateway **8088**, iFIX Historian
  **5051**. Any client outside the baselined set is a finding.
- **Bulk data read** — >10,000 points in one session, manifesting as abnormal
  response byte volume from the historian to one client, or an abnormal
  transaction count in one session. **Needs a per-client baseline, not a flat
  threshold.**
- **Brute force** — >5 failed logins from one source.
- **Direct SQL against the historian backend** from a client that should be
  using the historian's own API — visible in database/SQL records (statement,
  user, database, error). One of the better ExtraHop plays here.
- **The best indicator: the historian originating outbound connections to Level 1
  device ports — 502 (Modbus), 102 (S7comm/ISO-TSAP), 44818 (EtherNet/IP CIP).**
  A historian is architecturally a *receiver* of process data; it initiating
  sessions to PLCs is a strong compromise signal. Build this as an alert on the
  historian device originating to those ports — **it should be silent in a
  healthy environment**, which makes it low-FP and worth standing up.
- **Anonymous/unauthenticated API access** — HTTP requests to `/piwebapi/*` or
  Ignition's `/StatusPing`, `/system/gwinfo`, `/system/webdev`,
  `/main/web/status` with no auth header. `[verify]` — depends on request-header
  exposure, which for HTTPS needs decryption.

- **Where:** flow records (who talks to historian ports, and critically what the
  historian *originates*), database/SQL records, HTTP records, and device
  role/criticality context to identify the historian in the first place.
- **Rung:** records, with metrics for the bulk-read volume anomaly and the
  connection-direction baseline.
- **FP separators:** historians are *supposed* to have many clients — reporting
  servers, dashboards, MES, ERP integrations, data-science pulls, and PI-to-PI
  replication all connect and read in bulk, and month-end and quarter-end
  reporting produces enormous legitimate bulk reads. Interface nodes and
  connectors sit between the historian and OT and can blur the direction test.
  The outbound-to-PLC-ports test is the low-FP one; lean on it.

---

## ARP poisoning / L2 man-in-the-middle

`[ATT&CK T1557.002, unverified]`

Listed here because it is most often an OT and flat-network concern, though it
applies anywhere ExtraHop sees a monitored L2 segment.

**Indicators, in severity order:**
- **Gateway MAC change** — the default-gateway IP suddenly answered by a
  different MAC. Highest value.
- **Duplicate IP** — two distinct MACs claiming one IP.
- **Flip-flop** — an IP mapping to **>2 unique MACs within 60 seconds**.
- **One MAC claiming ≥3 different IPs.**
- **Gratuitous ARP** — sender protocol IP equals target protocol IP, unsolicited,
  opcode **2**.
- **Rate** — >50 ARP packets per 10 s from one source MAC. Cisco DAI's practical
  access-port rate limit, for calibration, is 15 pps.

**Where — be careful how you claim to query this.** **Device context is the
reliable path**: ExtraHop tracks IP↔MAC observations per device, so "this IP is
now associated with a new MAC" and "this MAC now holds several IPs" are
answerable from device metadata, and ExtraHop ships native detections in this
family. A dedicated ARP record type with opcode/sender/target fields is
`[verify]` — **do not promise `arp.opcode`-level querying without checking the
record catalog first.** ARP packet rate as a metric is also `[verify]`.

**Rung:** metrics and device context for binding changes and rates; **packets**
to prove opcode-2 gratuitous replies and reconstruct the attack. One of the few
techniques in these files that genuinely needs the packet rung.

**FP separators — this detection is noisy in a normal enterprise and benign MAC
changes are extremely common:**
- **HSRP/VRRP failover** legitimately moves a gateway IP to a new MAC — *exactly*
  the highest-severity signature. Recognise the virtual MACs by OUI and allowlist
  them: **`00:00:0c:07:ac:xx`** (HSRP), **`00:00:5e:00:01:xx`** (VRRP).
- **vMotion / live VM migration**, **NIC teaming and bonding failover**,
  **wireless roaming between APs**, **dual-homed hosts**, and **load-balancer VIP
  failover** all produce binding changes.
- **DHCP lease churn** — a laptop then a phone getting the same IP hours apart.
- **Separators:** failover is a *single clean transition*, poisoning is *repeated
  flip-flopping within seconds*; DHCP reuse is separated by a lease interval, not
  by seconds; and an attacker's MAC will also claim *several* IPs at once, which
  failover never does. **Require flip-flop-within-60s or one-MAC-many-IPs before
  escalating — never a single binding change.**

---

## Provenance

Curated in September 2026 from
`github.com/mukul975/Anthropic-Cybersecurity-Skills` (Apache-2.0) plus model
knowledge, filtered to what ExtraHop observes. The Modbus and DNP3 function-code
tables and protocol limits are specification facts. The source material carried
no false-positive analysis for any technique in this file; every FP separator
here was added during curation and is the part most worth keeping.
