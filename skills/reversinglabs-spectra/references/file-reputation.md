# File Reputation

Use this workflow for presence checks, quick classification, and bounded batch
triage. Load the threat-analysis reference only when the question needs deeper
static, dynamic, behavioral, or IOC evidence.

## Validate Hashes

Normalize surrounding whitespace and lowercase for comparison. Accept only:

| Type | Length | Pattern |
|---|---:|---|
| MD5 | 32 | `^[0-9a-fA-F]{32}$` |
| SHA1 | 40 | `^[0-9a-fA-F]{40}$` |
| SHA256 | 64 | `^[0-9a-fA-F]{64}$` |
| SHA512 | 128 | `^[0-9a-fA-F]{128}$` |

Reject an invalid value before retrieval and identify the bad length or
character set. Preserve the exact submitted hash in notes and the canonical
hashes returned by the vendor. Do not guess a hash type from a near match.

## Retrieve and Preserve

Check presence before requesting reports:

```bash
./reversinglabs-interface sample-status \
  -json '{"hashes":["<hash-1>","<hash-2>"]}' \
  > reversinglabs/status-<subject>-<utc>.json
```

Request summary reputation for hashes reported as processed or available:

```bash
./reversinglabs-interface reputation \
  -json '{"hashes":["<hash-1>","<hash-2>"]}' \
  > reversinglabs/reputation-<subject>-<utc>.json
```

Batch related hashes rather than making one request per value. If the interface
rejects the request size, split it into bounded batches and retain all response
files. Do not request a report for an explicitly absent hash merely to turn a
miss into a verdict.

## Interpret the Response

Use the actual returned schema and preserve raw values. Common useful fields
include:

- vendor classification (`malicious`, `suspicious`, `goodware`/`known`,
  `unknown`, or `unclassified`, depending on appliance response);
- threat or family name and vendor risk score, when present (risk fields can be
  named `factor`, `riskscore`, or `risk_score` across response shapes);
- MD5, SHA1, SHA256, sample/file type, size, and known filenames;
- first-seen, last-seen, analysis time, source, and local/cloud scope;
- processing, availability, and completeness state.

Do not translate `known` into `goodware`, or vice versa, without retaining the
original value, and do not silently merge differently named score fields. Do
not invent severity bands from a numeric score. Explain the score using
vendor-provided meaning when available; otherwise present it as a vendor value
with no fabricated threshold.

Treat these states separately:

- **Vendor malicious/suspicious/goodware-or-known/unknown/unclassified:** a
  returned vendor classification.
- **Not found:** the hash was not present in the queried scope; this is not a
  benign result and may reflect scope, spelling, retention, or submission state.
- **Analysis incomplete/unavailable:** the sample may exist without the desired
  section or final classification.
- **Lookup failed:** authentication, connectivity, permission, validation, or
  service failure; no reputation conclusion is possible.

An extension or name associated with YARA, Sigma, STIX, IDS, or another research
artifact can explain why content looks suspicious, but must not automatically
override the vendor verdict. Test that hypothesis against file type, contents,
provenance, behavior, signatures, and observed environment context.

## Decide Whether to Go Deeper

Use `details` for selected analysis dimensions and `ticore` for static
decomposition when:

- the vendor reports malicious or suspicious and the investigation needs IOCs,
  behaviors, detection rationale, or containment scope;
- the vendor reports unknown/unclassified and available analysis may reduce
  uncertainty;
- the user explicitly requests a deep analysis; or
- conflicting metadata needs examination.

Do not retrieve every field by default. See
[Threat analysis and IOC pivots](threat-analysis-and-ioc-pivots.md).

## Present Results

For a single hash, lead with the vendor classification, exact hash, threat name,
score if present, sample type, scope, and timestamps. Follow with a short
investigator assessment that is clearly labeled as inference. Show a
human-readable file size for readability while retaining the exact byte count
in evidence. If no specific threat name was returned, say so rather than
inventing a family.

For multiple hashes, show a summary table and counts by the exact returned
classification. Include not-found, incomplete, and failed lookups as distinct
counts. Show full hashes in evidence and detailed findings; truncate only in a
display table where the full value remains available nearby. Expand individual
detail first for material malicious/suspicious results or values the user names.

Recommendations must follow the evidence and the user's operating context.
Avoid automatic "delete immediately" language when identity, prevalence, or
business impact has not been established.
