---
name: extrahop-excli
description: "Use this skill when investigating ExtraHop data with the brokered `./excli-interface` command."
---

# ExtraHop excli-interface

Use `./excli-interface` to interact with a connected ExtraHop environment when it's available. It brokers calls to the official `excli` CLI without exposing ExtraHop secrets to the agent shell. Start broad, prove data exists, then narrow into the detail source that answers the question.

## Tool Discipline

1. Run `./excli-interface -listtools` when tool availability is uncertain.
2. Run `./excli-interface TOOL -help` before using a tool for the first time in a session. Tool help wins over this skill if they conflict.
3. Invoke tools as `./excli-interface TOOL -json '{...}'`.
4. ExtraHop API timestamps are epoch milliseconds; negative values are relative offsets.

## Evidence Choice

- Metrics answer "how much, how often, over time, and which objects?" Use them first for trends, dashboards, scorecards, top-N/ranking, baselines, protocol volume, hygiene, and broad impact.
- Records answer "what exactly happened in this transaction?" Use them for usernames, exact hostnames, URIs, TLS version strings, LDAP fields, NTLM pairs, examples, and enrichment after metrics identify where to look.
- Packets answer byte-level questions. Use Packetstore/PCAP workflows when payload, protocol edge cases, or forensic proof matters.
- Detections answer alert context. Use detections to understand why ExtraHop surfaced something, then validate scope with metrics, records, and packets as needed.
- Entities answer "which object should I query?" Use devices, groups, applications, and activity searches to get real IDs before querying evidence.

## Pivot IDs

- Metric device queries use device OIDs: `search_devices` returns them as `id`, and detection device participants expose them as `object_id`.
- Record device filters use discovery IDs. For a detection-to-records pivot, call `get_device` with the device OID, then filter records with that device's `discovery_id` across `client`, `server`, `sender`, and `receiver`.
- IP participants can pivot to records with `.ipaddr`.

## Metrics Workflow

For metric-shaped questions, this is the suggested sequence:

1. Search the metric catalog for the protocol/topic and target `object_type`.
2. Find candidate object IDs from `search_devices`, groups, applications, or another entity tool over a relevant time window. Avoid guessed IDs.
3. Query `total_by_object` first to prove the category/stat/object combination has data and to find nonzero targets.
4. Query `timeseries` only after totals work. Use a larger `limit` when querying many objects, many stats, or long windows.
5. Use records only after metrics identify the objects/time ranges, or when the question requires fields that metrics do not expose.

Catalog and category notes:

- Device metric categories commonly use perspective suffixes such as `http_server`, `http_client`, `ldap_server`, `ssl_client`, and `dns_server`.
- Capture/application metrics may use bare protocol categories such as `http`, `ldap`, `ssl`, or `dns`.
- Client and server perspectives are not interchangeable. If the first category is empty, check whether the opposite perspective matches the question.
- Confirm both metric names and category names with `search_metric_catalog`; do not infer stat names from UI labels.

## Empty Metric Responses

If `execute_metric_query` returns `sensors: []`, empty arrays, or unexpectedly sparse data, do not immediately conclude that the environment has no matching traffic. Check these:

1. Switch to `total_by_object` for the same objects, category, stats, and time range.
2. Increase `limit`; timeseries queries can need more cells than expected.
3. Widen the time range enough to prove whether the issue is sparsity or query shape.
4. Reconfirm `object_type`, `object_ids`, `metric_category`, and stat names with catalog/entity tools.
5. Try the relevant client/server category pair.
6. Use active object IDs discovered in the same window.

## PCAP Downloads

`download_pcap` writes packet files to the directory named by `EXTRAHOP_PCAP_DOWNLOAD_DIRECTORY`. The broker sets that variable to this session's `evidence/packets` directory only for real `download_pcap` calls; do not set it inline, because the interface does not forward caller environment variables. Create the packets directory when starting a PCAP workflow so shell redirects have a destination.

```bash
mkdir -p evidence/packets
./excli-interface download_pcap -json '{...}' > evidence/packets/<name>.json
```

When pivoting from records, use `_source.first` and `_source.last` with a small cushion for the packet window. If packet analysis matters, use `tshark` when it is available.

## Query Pattern

For complex JSON, write the request body to a file first, then pass it with command substitution only if the shell quoting stays readable; for example:

```bash
mkdir -p scratch evidence/metrics
./excli-interface execute_metric_query -json "$(cat scratch/ldap-hygiene-query.json)" > evidence/metrics/ldap-hygiene-total.json
```

## Processing output (keep raw JSON out of context)

Redirect large tool output to an `evidence/` file, then summarize it locally and
report only the summary — do not echo full JSON payloads into the conversation.
**`jq` is available** (as is `python3`); prefer `jq` for slicing/aggregating:

```bash
./excli-interface search_records -json '{...}' > evidence/records/http.json
jq '.records | length' evidence/records/http.json
jq -r '.records[]._source | "\(.method) \(.uri) \(.statusCode)"' evidence/records/http.json | sort | uniq -c | sort -rn | head
```
