# Identifier Research Playbooks

Load only the section matching the observed value. Preserve the original value
and record every materially used source in `research/`.

## CVE or vulnerability

1. Search the exact CVE ID.
2. Prefer the assigning CNA/vendor advisory and the CVE or NVD record.
3. Check CISA KEV or another authoritative exploitation source before saying a
   vulnerability is known exploited.
4. Confirm affected and fixed versions from the vendor. Do not infer exposure
   from a banner or product family alone.
5. Separate vulnerability existence, public exploit availability, observed
   exploitation, and applicability to the environment.

## Filename or binary name

1. Search the exact basename in quotes, including its extension.
2. Add a publisher, product, path fragment, signer, hash, protocol, or adjacent
   record value when available.
3. Compare legitimate software documentation and security research. Common
   filenames are not unique identities.
4. Prefer a cryptographic hash or signer over a filename for attribution.
5. Do not download or execute the binary.

## Cryptographic hash

1. Validate the hash shape and record its algorithm.
2. Search the exact hash without truncation.
3. Prefer original malware-research reports or configured reputation services.
4. Treat family names and detection labels as assessments, not ground truth.
5. No reputation match means unknown, not benign.

## Domain or public IP address

1. Confirm that the value is public before externalizing it.
2. Search the exact value and inspect current authoritative ownership or RDAP
   data when it helps.
3. Look for independent reporting that ties it to a campaign, service, hosting
   provider, CDN, scanner, or legitimate product.
4. Account for shared hosting, CDNs, NAT, reassignment, and time. Current
   ownership does not prove ownership at the event time.
5. Do not label infrastructure malicious from one blocklist or search result.

## URL or URI

1. Preserve the exact observed value locally, but search only the public-safe
   portion. Remove internal query parameters, tokens, usernames, and paths that
   might contain customer data.
2. Search the domain and distinctive public path or filename separately.
3. Use a safe fetcher; do not open the URL in an authenticated browser or submit
   forms.
4. Distinguish a malicious page, a compromised legitimate site, and a benign
   site referenced by malicious traffic.

## Product, vendor, protocol, or term

1. Search the exact phrase plus the relevant vendor or protocol.
2. Prefer current official documentation for behavior, supported versions, and
   remediation.
3. Use dated sources for changing facts and record the retrieval time.
4. When the term is ambiguous, list plausible meanings and identify which
   evidence would distinguish them.

## Threat actor, campaign, or technique

1. Search the exact name and known aliases.
2. Prefer original reporting and authoritative government or vendor sources.
3. Treat attribution as confidence-based and time-bounded.
4. Do not map observed activity to an actor solely because one IOC, tool, or
   ATT&CK technique overlaps.
5. Record contradictory attribution or materially different campaign scopes.
