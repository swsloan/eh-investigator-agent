# Records

Use this file for transaction search, historical metadata, faceted pivots, and recordstore reasoning.

## What records are

Records are structured flow, mid-layer, transaction, or message artifacts emitted by sensor analysis and stored in recordstores. They are log-like, but derived from observed network activity rather than emitted by applications.

## Main record classes

- Flow records: L3/L4 connection metadata such as participants, ports, bytes, duration, timing, and connection context.
- Mid-layer records: TLS handshake details, cipher suites, certificate metadata, and similar non-application context.
- L7 transaction records: protocol-specific transaction data. Some protocols split request and response records; others collapse a transaction into one record.

HTTP records can include URI, method, status code, request timestamp, client/server IPs, client ports, transfer timing, server processing time, selected headers, and errors. Use that as an example pattern, not a complete field model.

## Value

Records provide faceted historical comprehension: filtering on combinations of fields, reconstructing transaction context, pivoting between entities, and validating what happened after metrics identify an interesting place or time.

## Cost

Records are heavier than metrics. Query them with bounded time windows and useful filters. For broad historical questions, start with metrics and then drill into records.

## Custom records

Triggers can emit custom records. This is useful when the built-in protocol records do not capture the relevant field or when retaining only a targeted subset reduces storage cost.
