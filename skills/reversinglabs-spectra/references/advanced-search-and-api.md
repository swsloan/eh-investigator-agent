# Advanced Search and API Notes

Use this reference to translate a hunting question into a bounded Spectra
Analyze search and to operate the brokered interface safely.

## Normalized Interface Contract

The only supported operations are:

```bash
mkdir -p reversinglabs
./reversinglabs-interface status > reversinglabs/interface-status-<utc>.json
./reversinglabs-interface probe > reversinglabs/probe-<utc>.json
./reversinglabs-interface sample-status -json '{"hashes":["<hash>"]}' > reversinglabs/sample-status-<subject>-<utc>.json
./reversinglabs-interface reputation -json '{"hashes":["<hash>"]}' > reversinglabs/reputation-<subject>-<utc>.json
./reversinglabs-interface details -json '{"hashes":["<hash>"],"fields":["network_indicators"]}' > reversinglabs/details-<subject>-<utc>.json
./reversinglabs-interface ticore -json '{"hash":"<hash>"}' > reversinglabs/ticore-<subject>-<utc>.json
./reversinglabs-interface search -json '{"query":"classification:malicious","page":1,"recordsPerPage":20,"cloud":false}' > reversinglabs/search-<subject>-<utc>.json
./reversinglabs-interface search-count -json '{"query":"classification:malicious","cloud":true,"startSearchDate":"<YYYY-MM-DD>","endSearchDate":"<YYYY-MM-DD>"}' > reversinglabs/search-count-<subject>-<utc>.json
```

`status` reports local interface/configuration state without being a substitute
for a live request. Use `probe` for a bounded authenticated connectivity check.
Do not infer reputation from either operation.

All data operations require `-json`. Use camel-case `recordsPerPage`; the
interface normalizes the appliance's wire format. Never pass endpoint paths,
hosts, headers, tokens, or arbitrary URLs.

`search` is local by default. Set `cloud:true` only when the user requests cloud
scope and the configured integration permits it. `search-count` is a
Spectra-Intelligence/cloud operation and therefore requires `cloud:true`; do not
use it to claim an exact local-appliance count. It also requires an explicit,
bounded `startSearchDate` and `endSearchDate` in `YYYY-MM-DD` form for current
appliance versions; the wrapper carries that range through its legacy-endpoint
compatibility fallback.

## Build the Query

Start with fields established by the direct appliance notes:

| Goal | Field examples |
|---|---|
| Vendor classification | `classification:malicious`, `classification:suspicious` |
| Threat family/name | `threatname:Emotet*` |
| File format | `filetype:PE`, `sampletype:PE/Exe` |
| Time | `firstseen:[2026-07-01T00:00:00Z TO 2026-07-10T23:59:59Z]` |
| YARA tag | `tag-yara:malicious` |
| Vendor risk score | `riskscore:[8 TO 10]` |

Additional useful field families surfaced by the supplied search workflow, but
can vary by appliance/version, include:

- exact hashes (`md5`, `sha1`, `sha256`, `hashes`) and `imphash`;
- `filename`, `size`, file/sample type, AV count/detection, tags, actor, and
  vertical;
- `domain`, `ipv4`/`ip`, URI/static/dynamic/C2/source URL fields;
- MITRE attack technique/tactic and exploit/CVE fields;
- PE imports/exports/functions, company/product/PDB metadata;
- mutex, behavioral, and certificate issuer/subject/serial/thumbprint fields.

Useful appliance-dependent candidates include:

| Concept | Candidate fields / aliases | Example |
|---|---|---|
| Threat level and trust | `threatlevel`, `trustfactor` | `threatlevel:4+` |
| AV coverage/detection | `av-count` (`positives`, `p`), `av-detection` (`engines`) | `av-count:10+` |
| Identity | `filename` (`name`), `sampletype` (`filetype`, `type`, `format`), `size`, `imphash` | `size:[1MB TO 5MB]` |
| Time | `firstseen` (`fs`), `lastseen` (`ls`), `lastanalysis` (`la`) | `lastseen:[<utc> TO *]` |
| Network | `domain`, `ipv4`/`ip`, `uri-static`, `uri-dynamic`, `uri-config`/`c2`, `uri-source`/`itw` | `domain:example.test` |
| PE metadata | `pe-company-name`, `pe-product-name`, `pe-import`/`imports`, `pe-export`/`exports`, `pe-function`, `pdb-path`/`pdb` | `imports:wininet.dll` |
| Behavior | `mutex`, `mutex-dynamic`, `mutex-config`, `attack-technique`, `attack-tactic`, `exploit` | `exploit:CVE-2025-0001` |
| Certificate | `cert-issuer-org`, `cert-subject-org`, `cert-serial`, `cert-thumbprint` | `cert-thumbprint:<exact-value>` |

Candidate exact `tag` values include malware roles (`backdoor`, `c2`,
`ransomware`, `downloader`, `keylogger`), packing/evasion (`packed`,
`obfuscated`, `custom-packed`, `polymorphic`, `antidebugging`, `antisandbox`,
`antiemulation`), behavior (`autorun`, `av-disable`, `data-exfiltration`,
`process-injection`, `privilege-escalation`), capability, certificate, email,
crypto, and platform tags. Use an exact candidate only when it matches the
hunt; if the appliance rejects it, do not substitute a broader claim.

Treat a validation response from the connected appliance as authoritative.
The supplied materials conflict on benign classification syntax (`goodware`
versus `known`) and on some advanced aliases. Do not silently rewrite one into
the other. Start with the user's intended concept, record the exact query, and
retry a documented alternative only after a validation error.

## Apply Syntax Carefully

- Use `<field>:<value>` clauses. Use explicit uppercase `AND`, `OR`, and `NOT`
  plus parentheses for complex expressions; simple appliance queries may also
  accept space-separated implicit AND.
- Use `*` for zero or more characters and `?` for one character only on fields
  that support wildcards.
- Never wildcard exact MD5, SHA1, SHA256, import-hash, exact tag, or ATT&CK ID
  fields.
- Quote values containing spaces and quote URL/URI values.
- Use inclusive ranges as `[lower TO upper]`, uppercase `TO`, and `*` only for
  an open bound.
- Use complete UTC timestamps: `YYYY-MM-DDTHH:MM:SSZ`. Compute relative dates
  explicitly from the current date; do not send phrases such as "last week."
- Require at least four query characters and avoid an unbounded wildcard-only
  search.

Examples:

```text
threatname:Emotet*
classification:malicious AND sampletype:PE/Exe
classification:suspicious AND filetype:PDF AND firstseen:[2026-07-01T00:00:00Z TO *]
ipv4:203.0.113.10
attack-technique:T1059.001
(threatname:FamilyA* OR threatname:FamilyB*) AND classification:malicious
```

## Search in Bounded Steps

1. Clarify the scope: local or cloud, sample attributes, time range, and whether
   the user needs examples, a complete page set, or only an estimate.
2. Translate the request into the fewest clauses needed and validate exact
   identifiers before searching.
3. Start with 10-25 records for exploration. Use at most 100 per page; paginate
   deliberately with `page` rather than requesting an enormous result set.
4. Use `search-count` only when a cloud-wide estimate materially changes the
   hunt and the operator has allowed cloud queries.
5. Preserve every response under `reversinglabs/`, including
   empty pages and validation errors that explain query revisions.
6. Narrow large sets by time, classification, family, type, or IOC. For long
   date ranges, split into non-overlapping UTC intervals if pagination becomes
   ambiguous.

Examples of natural-language mapping:

| User goal | Starting query |
|---|---|
| Find a family | `threatname:<family>*` |
| Malicious PE samples in the last seven days | `classification:malicious AND sampletype:PE/Exe AND firstseen:[<utc-7d> TO <utc-now>]` |
| Samples associated with a network IOC | exact `domain:`, `ipv4:`, or URI field supported by the appliance |
| Samples mapped to an ATT&CK technique | `attack-technique:<technique-id>` if supported |
| Related import-table samples | `imphash:<exact-imphash>` if supported |

## Analyze and Present Results

Preserve each entry's available hashes, classification, threat name, sample
type, filename, score, size, first/last seen, source/scope, and availability.
Do not assume a wrapper-created response path from legacy material; inspect the
actual normalized output.

For the returned page set, compute useful descriptive summaries when they help:

- exact classification counts;
- top threat names and sample types;
- earliest and latest first-seen timestamps;
- clusters of related samples in a short interval;
- returned-record count versus the vendor-reported total, when present.

Label these as statistics for the retrieved subset unless all pages were
collected. A temporal cluster can motivate a campaign hypothesis but does not
prove coordinated activity. Show no more than about 25 representative rows in
chat, keep full hashes in raw evidence, and state pagination/scope limitations.

On zero results, preserve the empty response and broaden only one dimension at
a time: remove the most restrictive clause, widen time, or use a supported
wildcard. A zero-result query is not evidence that the artifact or campaign is
benign or absent outside the queried scope.

## Handle Errors as Data-Collection Failures

- Validation error: correct the specific syntax or unsupported field and record
  both queries.
- Permission/cloud-policy error: keep the search local or report that cloud
  scope was unavailable; do not bypass the setting.
- Authentication/connectivity/service error: report no result and preserve safe
  stderr in a separate `.stderr.txt` evidence file without exposing secrets.
  Keep stdout reserved for valid JSON; do not combine the streams.
- Missing/incomplete analysis: distinguish it from not found and from a vendor
  classification.

Never fall back to direct HTTP calls, token-bearing commands, sample submission,
download, or reanalysis.
