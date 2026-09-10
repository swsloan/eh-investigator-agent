# Wire indicators — identity, AD, and lateral movement

Corroboration detail for detections involving Active Directory, Kerberos, NTLM,
SMB, and host-to-host movement. Every indicator here is something ExtraHop can
observe on the wire. Use it to decide **what to pull at the records rung**, not
to decide what to investigate.

## How to use this file

**Scope first.** These indicators corroborate a detection you are already
investigating, inside that detection's own window and participant set. Finding
one of them on a different host, or outside the detection window, is a **pivot**
— log it with `./investigation-plan` as its own finding. It is not evidence for
the current verdict. See `skills/evidence-ladder/SKILL.md` §3.

**Rung is stated per indicator.** Most of this is records-tier. Where an
indicator is marked packets-tier, that is a real limit of what the protocol puts
in cleartext — not an invitation to climb. If the deciding question is already
answered at records, stop.

**`[verify]` means the field may not exist.** ExtraHop's record schema varies by
version and by which modules are licensed. Before building a query on a
`[verify]` field, confirm it with `./excli-interface search_records -help` or
`search_metric_catalog`. If it isn't there, say so and fall back to the
alternative given — do not report a negative result from a query that could
never have matched.

**ATT&CK IDs below are unverified.** They are best-effort mappings, not
authoritative. Confirm against current ATT&CK before citing one in a verdict —
a wrong technique in a report is worse than no technique.

## Identifiers that do NOT exist on the wire

Common analyst vocabulary that comes from Windows event logs or security
descriptors. Searching ExtraHop records for these returns zero hits, and a zero
result here means *"wrong query"*, never *"no attack"*:

- **AD extended-right GUIDs** — `1131f6aa-9c07-11d1-f79f-00c04fc2dcd2` and the
  rest of the DS-Replication family. These live in Event 4662 and in security
  descriptors, not in DRSUAPI traffic.
- **AD access-mask bitmasks** — `GenericAll 0x10000000`, `WriteDACL 0x00040000`,
  `WriteOwner 0x00080000`, `ExtendedRight 0x00000100`, `AccessMask 0x100`.
- **Windows NTSTATUS sub-status codes** — `0xC000006A` (wrong password),
  `0xC0000064` (no such user), `0xC0000234` (locked out). With RDP NLA these are
  encrypted; elsewhere they are a host artifact.
- **Windows Security Event IDs** — 4624, 4625, 4648, 4662, 4672, 4768, 4769,
  4776, 7045. If the deciding question genuinely needs one of these, that is an
  **EDR/SIEM handoff** — say so plainly rather than substituting a weaker
  network claim.

**Kerberos encryption types are decimal on the wire**, and hex in most published
detection content. Query for `23`, not `0x17`.

---

## Kerberos encryption types and error codes

Reference values for every Kerberos indicator below.

| etype | Meaning | Reading |
|---|---|---|
| 23 | RC4-HMAC | Legacy. Suspicious *when the device normally uses AES*. |
| 24 | RC4-HMAC-EXP | Legacy/export. |
| 17 | AES128-CTS-HMAC-SHA1-96 | Normal modern. |
| 18 | AES256-CTS-HMAC-SHA1-96 | Normal modern. |
| 1, 3 | DES variants | Alarming; effectively extinct. |

| Error | Code | Meaning |
|---|---|---|
| `KDC_ERR_C_PRINCIPAL_UNKNOWN` | 6 | Client principal not in the directory |
| `KDC_ERR_S_PRINCIPAL_UNKNOWN` | 7 | Service principal not in the directory |
| `KDC_ERR_POLICY` | 12 | Rejected by policy |
| `KDC_ERR_ETYPE_NOSUPP` | 14 | No shared encryption type |
| `KDC_ERR_CLIENT_REVOKED` | 18 | Account disabled/locked |
| `KDC_ERR_TGT_REVOKED` | 20 | TGT revoked — a PAC-validation failure signal |
| `KDC_ERR_PREAUTH_FAILED` | 24 | Bad password — the brute-force signal |
| `KRB_AP_ERR_SKEW` | 37 | Clock skew |
| `KRB_AP_ERR_MODIFIED` | 41 | Ticket integrity failure |

Kerberos message types: AS-REQ 10, AS-REP 11, TGS-REQ 12, TGS-REP 13,
KRB-ERROR 30.

---

## DCSync — replication from a non-DC

An adversary with replication rights impersonates a DC and pulls password
hashes out of NTDS. `[ATT&CK T1003.006, unverified]`

| Indicator | Value | Where | Rung |
|---|---|---|---|
| DRSUAPI interface bound by a non-DC | UUID `e3514235-4b06-11d1-ab04-00c04fc2dcd2` v4.0 | DCERPC record: interface UUID | records |
| The replication call | `DsGetNCChanges` = **opnum 3**; preceded by `DRSBind` = opnum 0 | DCERPC record: opnum `[verify]` | records |
| Transport | EPM on TCP **135** (`e1af8308-5d1f-11c9-91a4-08002b14a0fa`) → dynamic 49152–65535. **ncacn_ip_tcp only** — never a named pipe, so an SMB-only path rules DCSync out | DCERPC endpoint; flow record | records |
| Client role mismatch | Source is not in the DC device group | device group / device context | metrics |
| Precursor | LDAP search of the domain root reading `nTSecurityDescriptor` | LDAP record: base DN, filter `[verify]` on attribute list | records |
| Follow-on | Kerberos AS-REQ/TGS-REQ with etype 23 from the same client shortly after | Kerberos record | records |

**What you cannot say.** The requested object is inside the encrypted
`DRS_MSG_GETCHGREQ` blob. You can prove *"replication occurred from a non-DC"*;
you cannot prove *"they pulled krbtgt"* from records. Response byte volume is a
weak proxy — a full domain dump is large, a single-user pull is small.

**FP separators.** DC↔DC replication is constant and normal, so the whole
detection rests on an accurate DC inventory — build it from device group
membership, not hostname regex. **Azure AD Connect / Entra Connect legitimately
calls `DsGetNCChanges`** (typically an `MSOL_*` account), as do some AD backup
and identity products (Veeam AD backup, Semperis, Quest). Those are stable,
scheduled, and from a fixed host. RODCs replicate inbound only. The convicting
bundle is: non-DC source + DRSBind→DsGetNCChanges within seconds + no prior
history for that pair + high response bytes + subsequent RC4 Kerberos from the
same host.

This is among the lowest-FP detections available on the wire. ExtraHop also
ships a native detection for it — pull that first and corroborate, rather than
rebuilding it from raw records.

---

## Coercion primitives (the feed for NTLM relay)

Each is a DCERPC call whose interface UUID and opnum are wire-visible. Named
pipes are opened as files over SMB, so the pipe path appears in the SMB
tree/create target.

| Coercion | Interface UUID | Opnums | Named pipe |
|---|---|---|---|
| **PetitPotam** (MS-EFSRPC) | `c681d488-d850-11d0-8c52-00c04fd90f7e`, `df1941c5-fe89-4e79-bf10-463657acf44d` | `EfsRpcOpenFileRaw`=0, `EncryptFileSrv`=4, `DecryptFileSrv`=5, `QueryUsersOnFile`=6, `QueryRecoveryAgents`=7 | `\pipe\lsarpc`, `\pipe\efsrpc`, `\pipe\samr`, `\pipe\netlogon`, `\pipe\lsass` |
| **PrinterBug / SpoolSample** (MS-RPRN) | `12345678-1234-abcd-ef00-0123456789ab` | `RpcRemoteFindFirstPrinterChangeNotificationEx` = **65** | `\pipe\spoolss` |
| **PrinterBug async** (MS-PAR) | `76f03f96-cdfd-44fc-a22c-64950a001209` | opnum `[verify]` — match on UUID alone | `\pipe\spoolss` |
| **DFSCoerce** (MS-DFSNM) | `4fc742e0-4a10-11cf-8273-00aa004ae673` | `NetrDfsAddStdRoot`=12, `NetrDfsRemoveStdRoot`=13 | `\pipe\netdfs` |
| **ShadowCoerce** (MS-FSRVP) | `a8e0653c-2744-4389-a61d-7373df8b2292` | `IsPathSupported`=8, `IsPathShadowCopied`=9 | `\pipe\FssagentRpc` |

**Rung: records.** The decisive signal is not the call itself but the pairing —
a coercion RPC to a DC, followed within seconds by inbound NTLM from that DC's
machine account to a host that is not its normal peer.

**FP separators.** MS-EFSRPC and MS-DFSNM have the cleanest signal: nobody
legitimately calls `EfsRpcOpenFileRaw` remotely against a DC. MS-RPRN is the
noisiest — real print clients use it constantly, but against *print servers*,
not domain controllers from a workstation.

---

## NTLM relay

`[ATT&CK T1557.001, T1187, unverified]`

| Indicator | Value | Where | Rung |
|---|---|---|---|
| Relay fan-out | One client producing successful NTLM sessions as **many different users** to many servers in a short window | NTLM/CIFS metrics per device, client perspective | **metrics — start here** |
| Machine account from the wrong IP | NTLM auth where the user is `HOST$` but the client IP is not that host | NTLM record + device context | records |
| Kerberos-capable host using NTLM | A domain-joined device authenticating by NTLM where it normally uses Kerberos | NTLM vs Kerberos record for the same device | records |
| Target not requiring SMB signing | SMB2 `SecurityMode` lacking `SMB2_NEGOTIATE_SIGNING_REQUIRED` = `0x0002` (vs `..._ENABLED` = `0x0001`) → relayable | SMB record: signing field | records |
| NTLMv1 downgrade | Negotiate flags missing `NTLMSSP_NEGOTIATE_EXTENDED_SESSIONSECURITY` = `0x00080000`. Definitive test: NtChallengeResponse length exactly **24 bytes** (v2 is longer, blob starts `0x01 0x01 0x00 0x00`) | flags: records `[verify]`; the length test: **packets** | records / packets |
| Relay to LDAP | `bindRequest` with SASL/NTLM (not simple, not Kerberos) on TCP **389**, from a non-domain-joined IP, result code 0 | LDAP record: bind type, result | records |
| Relay to LDAPS without channel binding | NTLM inside TLS on TCP **636** | SSL record + LDAP record | records |
| Relay to AD CS web enrollment | HTTP POST to `/certsrv/certfnsh.asp` or `/certsrv/certrqxt.asp`, NTLM-authenticated, client = a DC machine account | HTTP record: host, URI, method | records |
| NTLM workstation-name mismatch | AUTHENTICATE_MESSAGE `Workstation` ≠ observed device | `[verify]` — may not be exposed | records / packets |
| LLMNR / NBT-NS / mDNS poisoning | Responses on UDP **5355** / **137** / **5353** from a non-resolver, answering many distinct victims | `[verify]` — likely flow/L4 metrics only, not parsed records | metrics / packets |
| mitm6 | Rogue DHCPv6 advertisements then DNS answers from a new IPv6 responder | DHCP record `[verify]` for DHCPv6; DNS record | records |

**FP separators.** Legitimate NTLM is everywhere. Vulnerability scanners
(Nessus, Qualys, Tenable), backup agents, print servers, monitoring, and any
non-domain-joined appliance authenticate by NTLM to many hosts from one IP — a
visual match for relay fan-out. The discriminator is **how many distinct users**:
a scanner uses one service account, a relay uses many. Machine-account NTLM from
an unexpected IP also happens with cluster failover, NLB, and multi-homed
servers — check whether a coercion RPC preceded it.

---

## Golden ticket / silver ticket

`[ATT&CK T1558.001 / T1558.002, unverified]`

| Indicator | Value | Where | Rung |
|---|---|---|---|
| **TGS-REQ with no preceding AS-REQ/AS-REP** for that principal from that client | msg types 12 with no 10/11 | Kerberos record: msg type, client, client IP | **records** — stronger on the wire than in logs, because ExtraHop sees both sides with no audit-policy dependency |
| RC4 in an AES environment | etype **23** where the device normally uses 17/18 | Kerberos record: encryption type | records |
| Realm anomaly | Nonexistent realm, case-mismatched realm (`corp.local` vs `CORP.LOCAL`), or a client principal with no AD counterpart | Kerberos record: realm, client | records |
| PAC-validation rejection | KRB-ERROR **20**, **41**, **6**, **7**, **12**, **14**, **37** | Kerberos record: error code | records |
| **Silver ticket** | Service access (SMB session setup, HTTP, MSSQL) authenticated by Kerberos where **no TGS-REQ for that SPN was ever seen at the KDC** | Kerberos record ∪ CIFS/HTTP/DB record | records |
| Embedded ticket etype | In TGS-REQ, the AP-REQ's `Ticket.enc-part.etype` is cleartext — a Mimikatz-default RC4 golden ticket shows here | `[verify]` — ExtraHop may report only the request etype | records / packets |
| Ticket lifetime beyond policy | — | **Largely inapplicable.** For a forged TGT the lifetime is in the encrypted enc-part and is not wire-readable. Ignore this widely-published indicator. | — |
| Injected SIDs / PAC contents | — | Not observable; encrypted. | — |

**Silver ticket is the standout.** It is nearly undetectable in DC logs and
straightforward for ExtraHop, because ExtraHop sees the KDC traffic *and* the
service traffic. If a detection involves unexplained service access, check
whether the KDC ever issued a matching ticket.

**FP separators.** RC4 is not dead — legacy trusts, appliances, NAS, printers,
MFPs, older Java/Linux Kerberos, accounts with `msDS-SupportedEncryptionTypes`
unset, and cross-realm referrals all produce etype 23 legitimately. Baseline per
device: the signal is *a device that normally speaks AES suddenly speaking RC4*.

**The most important FP trap in this file:** "TGS without AS" has real causes —
the TGT was issued before your lookback window opened, the client got its TGT
from a **different DC you aren't monitoring**, S4U2Self/S4U2Proxy delegation, and
cached tickets after a laptop resumes. **Use a lookback longer than the domain's
max TGT lifetime (≥10–11 h) and confirm you have visibility on every DC** before
treating an orphan TGS-REQ as evidence.

---

## Pass-the-ticket / overpass-the-hash

`[ATT&CK T1550.003, unverified]`

| Indicator | Value | Where | Rung |
|---|---|---|---|
| Same principal, multiple client IPs | Distinct client-IP count > 1 for one `cname` in a short window, IPs mapping to different devices | Kerberos record: client, client IP | metrics to count, records to enumerate |
| Orphan TGS-REQ, per device | As above, scoped per-device | Kerberos record | records |
| Overpass-the-hash signature | AS-REQ offering **only etype 23** from a modern Windows host that normally offers 17/18 — the `sekurlsa::pth` shape | `[verify]` — needs the full etype *list*, not just the negotiated one | records |
| Identity/device divergence | A principal authenticating from a device whose DHCP hostname and prior Kerberos history belong to someone else | Kerberos + DHCP records + device context | records |

**Not observable:** ticket identity. ExtraHop cannot tell "these are the same
ticket bytes" — enc-parts are encrypted. All PtT detection is behavioural
(principal↔device binding), never cryptographic. Frame conclusions accordingly.

**FP separators.** Multi-IP per user is normal: VPN concentrators and NAT
collapse many users behind one IP and give one user many; Citrix/RDS/VDI farms
issue tickets for one user from many hosts; laptop + desktop + phone is routine.
**Filter VPN/NAT/terminal-server ranges first** or this indicator is pure noise.

Distinguish from **Kerberoasting** (T1558.003): that is many *distinct SPNs*
requested with etype 23 from one host — a harvesting shape. PtT is one principal
used broadly for access.

---

## Kerberoasting

- **Indicator:** TGS-REQ for **≥5 unique SPNs** from a single non-server host,
  with etype 23 requested. Preferring RC4 when the domain supports AES is the
  discriminator.
- **Where:** Kerberos records — request type, client principal, SPN. Encryption
  type `[verify]`; without it you lose the strongest half and fall back on
  SPN-count alone.
- **Rung:** records.
- **FP separators:** SCCM servers, monitoring systems, and Exchange/SharePoint
  front-ends legitimately request many SPNs all day. The signal is a
  *workstation* requesting many SPNs in a tight burst it has never made before,
  for accounts unrelated to anything that host uses.

---

## AD ACL abuse and directory writes

`[ATT&CK T1098, T1222.001, T1484.001, unverified]`

| Indicator | Value | Where | Rung |
|---|---|---|---|
| Mass directory enumeration (BloodHound/SharpHound shape) | LDAP `searchRequest`, base = domain root DN, scope = wholeSubtree (2), filter `(objectClass=*)` or `(objectCategory=person)`, from a workstation, very large response volume | LDAP record + LDAP byte metrics | **metrics** to find, records to confirm |
| Recon via SAMR / LSA | samr `12345778-1234-abcd-ef00-0123456789ac`; lsarpc `12345778-1234-abcd-ef00-0123456789ab`; pipes `\pipe\samr`, `\pipe\lsarpc` | DCERPC record; SMB pipe path | records |
| The write itself | LDAP `modifyRequest` against a privileged DN — `CN=Domain Admins,...`, an AdminSDHolder-protected object, or a GPO under `CN=Policies,CN=System` | LDAP record: operation, DN, result | records; target **attribute name** `[verify]`, likely not parsed |
| Shadow Credentials | LDAP modify writing `msDS-KeyCredentialLink` | LDAP record `[verify]` | records / packets |
| RBCD | LDAP modify writing `msDS-AllowedToActOnBehalfOfOtherIdentity` | LDAP record `[verify]` | records / packets |
| Targeted Kerberoasting | LDAP modify adding an SPN, then a TGS-REQ for that new SPN with etype 23 | LDAP + Kerberos records | records |
| Password reset via SAMR | `SamrSetInformationUser2` = **opnum 58** `[verify]` | DCERPC record: opnum | records |
| **GPO tampering** | SMB write to `\\<dc>\SYSVOL\<domain>\Policies\{GUID}\...\GptTmpl.inf` or `ScheduledTasks.xml` | CIFS record: share, path, file, operation | **records — clean and high-fidelity** |

**FP separators.** Helpdesk tooling does exactly this all day — password resets,
group adds, ADUC/PowerShell writes from an admin jump host are the baseline.
Discriminators are the *source device* (a workstation that is not an admin
console), the *time*, and the *target* (a tier-0 object). GPO writes from
SCCM/Intune are routine; a SYSVOL write from a non-admin workstation is not.
Directory enumeration is also done by PingCastle, Purple Knight, Quest, and
backup tools — from a known scanner, on a schedule.

Single legs are noise. The chain is the finding: LDAP modify → new SPN → RC4
TGS-REQ → lateral SMB.

---

## SMB lateral movement

### Admin-share fan-out
- **Indicator:** admin-share tree-connects to ≥5 unique hosts (high confidence
  at ≥10). Shares: `ADMIN$`, `C$`, `D$`, `E$`, `IPC$`.
- **Where:** CIFS records — share, user, client, server, operation, status.
- **Rung:** records.
- **FP separators:** **exclude `IPC$`-only sessions** — it is used by ordinary
  named-pipe RPC, printer enumeration, and browsing, so it fires constantly.
  Legitimate `ADMIN$`/`C$` fan-out comes from SCCM, PDQ Deploy, Ansible, AV/EDR
  deployment, patch runs, and backup agents. The **SMB `user` field** is the
  discriminator: deployment uses a known service account from a known management
  server on a maintenance schedule.

### Remote service execution (PsExec family)
- **Indicator:** SMB write of an executable to `ADMIN$` — classic `PSEXESVC.exe`,
  or Impacket's randomized 8-character `.exe` — followed within seconds on the
  same client→server pair by DCERPC to **svcctl** (`CreateServiceW` /
  `StartServiceW`).
- **Where:** CIFS records (filename, path, operation) + DCERPC records. The
  correlation is the detection; neither half alone suffices. Opnum granularity
  `[verify]`.
- **Rung:** records; packets only to prove binary content.
- **FP separators:** PsExec is a legitimate admin tool still in wide use, and
  some deployment/monitoring products use the same mechanism. Source device role
  and account, plus whether the pair also shows fan-out.

### Lateral tool transfer
- **Indicator:** SMB writes >60,000 bytes per operation, ≥100 such writes in
  300 s; or >10 MB written on port 445; the *same file* written to many servers.
- **Where:** CIFS records + CIFS write-byte metrics.
- **Rung:** records for filename repetition, metrics for volume.
- **FP separators:** software deployment pushing one MSI/EXE to 200 machines is
  the same pattern. Separate on writing account, source device role, and file
  extension.

### SMB authentication failure burst
- **Indicator:** ≥10 failed SMB attempts from one source in 5 minutes; non-zero
  SMB2 header status.
- **Where:** CIFS records with status; SMB error metrics.
- **Rung:** metrics to find the spike, records for accounts and status codes.
  Note `STATUS_ACCESS_DENIED` is *authorization*, not authentication, and is
  usually benign.
- **FP separators:** a service account with a stale cached password produces
  hundreds of failures against one server — a helpdesk ticket, not an attack.
  Shape tells you which: one account × many hosts = spray; many accounts × one
  host = brute force; one account × one host at a flat continuous rate = broken
  config.

---

## WMI and DCOM execution

`[ATT&CK T1047 / T1021.003, unverified]`

| Indicator | Value | Where | Rung |
|---|---|---|---|
| DCOM activation | `IRemoteSCMActivator` `000001a0-0000-0000-c000-000000000046` `RemoteCreateInstance`=**4**; legacy `IRemoteActivation` `4d9f4ab8-7d1c-11cf-861e-0020af6e7c57` opnum **0** | DCERPC record | records |
| OXID resolution | `IObjectExporter` `99fcfec4-5260-101b-bbcb-00aa0021347a`, `ServerAlive2`=**5** | DCERPC record | records |
| WMI login | `IWbemLevel1Login` `f309ad18-d86a-11d0-a075-00c04fb68820`, `NTLMLogin`=**6** | DCERPC record | records — cleanest single WMI-over-DCOM marker |
| WMI operations | `IWbemServices` `9556dc99-828c-11cf-a37e-00aa003240c7`; `ExecMethod`=**24**, `ExecMethodAsync`=**25**, `ExecQuery`=**20** `[verify opnums]` | DCERPC record | records |
| Transport shape | EPM TCP **135** → dynamic **49152–65535**, same pair, within seconds | flow record + DCERPC endpoint | metrics to spot, records to confirm |
| **Impacket `wmiexec` output retrieval** | SMB read of a file on **`ADMIN$`** named `__<epoch>.<fraction>` (e.g. `__1712345678.91`) | CIFS record: share, file, operation | **records — highest-fidelity WMI-lateral indicator available** |
| WinRM variant | HTTP POST to `/wsman` on TCP **5985**/**5986**, `Content-Type: application/soap+xml`, UA `Microsoft WinRM Client` | WinRM/WSMAN record; HTTP record | records |
| Target CLSID (MMC20 `{49B2791A-B1AE-4C90-9B8E-E860BA07F889}`, ShellWindows `{9BA05972-F6A8-11CF-A442-00A0C90A8F39}`, ShellBrowserWindow `{C08AFD90-F2A1-11D1-8455-00A0C91F3880}`) | in the activation body | `[verify]` — assume **packets** | packets |
| WMI method/class and command line | inside the marshalled ORPC payload, usually under `RPC_C_AUTHN_LEVEL_PKT_PRIVACY` | — | **packets, and often encrypted even then.** Do not promise the command line from network data. |

**Honest framing for DCOM.** Records get you *"host A remotely activated a COM
object on host B"* — already unusual between two workstations. Records do **not**
tell you *which* CLSID unless the activation body is parsed. Do not claim
"MMC20 was used" from records alone.

**FP separators.** SCCM/MECM, Intune, monitoring (SolarWinds, PRTG, Nagios),
inventory, and vulnerability scanners use WMI over DCOM constantly and against
*every* host. **A DCOM fan-out detector without a management-server allowlist
produces nothing but false positives** — allowlist by device, not subnet. The
`ADMIN$` + `__<timestamp>` filename pattern is the discriminator management
tooling does not reproduce; prefer it over the RPC indicators. The meaningful
anomaly is workstation→workstation or workstation→DC activation.

The host-side discriminators everyone cites (`explorer.exe` spawning `cmd.exe`,
`mmc.exe` parented by `svchost.exe -k DcomLaunch`) are **not available** — that
is an explicit EDR handoff.

---

## Internal reconnaissance

### Port sweep / east-west fan-out
- **Indicator:** ≥50 unique internal destinations in 60 s, or ≥30 in 300 s; ≥3
  distinct ports among {445, 135, 139, 3389, 5985, 5986} with >50 connections/h.
  Signature shape: very short connections, near-zero payload bytes, RST or
  no-reply.
- **Where:** flow records (peer, port, bytes, duration); device connection-count
  and peer-count timeseries.
- **Rung:** metrics for the count, records to enumerate peers.
- **FP separators:** authorized vulnerability scanners and asset-discovery tools
  produce an identical shape, as do SCCM inventory sweeps and monitoring
  pollers. **Check device tags/groups for a scanner tag before escalating.** A
  scanner is stable, tagged, always-on, with a flat daily profile against the
  same target set. An attacker's sweep is first-time behaviour from a
  workstation-role device, off-hours, *followed by successful sessions on a
  subset*.
- `[ATT&CK T1046, T1018, unverified]`

### RDP brute force and pivoting
- **Indicators:** ≥20 connection attempts to 3389 from one source in 60 s;
  one source establishing >60 s RDP sessions to ≥3 internal hosts; chained RDP
  (A→B then B→C) within an hour. Failure shape: TCP connect → TLS handshake →
  few KB → teardown in <5 s, repeatedly. Success is long-lived and high-byte.
- **Where:** RDP records; flow records for 3389 duration and bytes. The X.224
  `Cookie: mstshash=<username>` routing token is cleartext pre-TLS `[verify]`.
- **Rung:** metrics for the rate spike, records for the chain.
- **FP separators:** jump hosts and bastions *are* RDP chains by design; VDI
  brokers and RD Gateway concentrate RDP the same way. Whitelist the jump-host
  device group. Health checks and LB probes open/close 3389 constantly — those
  are periodic from a fixed prober; brute force is bursty from a new source.
- **With NLA enabled, ExtraHop cannot see success vs failure directly.** Say
  "consistent with repeated failed authentication" and use session duration and
  bytes as the proxy. Do not assert "N failed logons" from network data.
  Corroborate with Kerberos error 24/18 bursts from the same source — that
  yields the account names RDP hides.

---

## Provenance

Indicator values in this file were curated in September 2026 from
`github.com/mukul975/Anthropic-Cybersecurity-Skills` (Apache-2.0) plus model
knowledge, then filtered to what ExtraHop observes. The source's framework
frontmatter was discarded as unreliable. Protocol constants (UUIDs, opnums,
etypes, error codes, port numbers) are facts, verifiable against the relevant
Microsoft protocol specifications and RFC 4120.
