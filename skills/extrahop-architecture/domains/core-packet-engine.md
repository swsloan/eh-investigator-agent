# Core Packet Engine

Use this file when reasoning about how ExtraHop turns observed packets into analysis artifacts.

## Ingest and flow processing

Packet sensors passively observe traffic from a TAP, packet broker, or port mirror. They group packets into flows and maintain a discrete TCP state machine per peer, effectively a receive-only TCP stack for both sides of the conversation.

That state model lets the sensor infer timing and transport behavior that is not directly visible from a single packet. For example, TCP RTO can be identified by calculating SRTT per peer and determining when retransmission should have occurred.

## Processing stages

Think of packet analysis as a pipeline:

1. Observe packets.
2. Reassemble streams and maintain per-peer TCP state.
3. Group packets into flows.
4. Identify transactions.
5. Discover and classify devices by activity.
6. Apply protocol analyzers.
7. Generate metrics and records.
8. Aggregate metrics into metric cycles and write them to the sensor datastore.

Preserve the difference between packet observation, stream reassembly, flow grouping, transaction identification, device discovery, metric generation, and record production.

## Decryption

ExtraHop supports out-of-band TLS decryption when session keys are supplied externally, commonly from a monitored server agent or proxy/load balancer. ExtraHop is not inline, so the traffic path and end-to-end application behavior are preserved.

ExtraHop can also decrypt Microsoft protocols through domain-controller integration, enabling visibility into protocols such as SMB, Kerberos, and MSRPC where configured.

## Protocol analysis

Protocol analyzers run after L4 analysis and are selected by traffic behavior rather than port assumptions. They extract protocol-specific fields into metrics and records.

## Trigger engine

The internal JavaScript trigger API exposes lifecycle and protocol events such as `Flow.close`, `HTTP.onResponse`, and `TLS.onHandshake`. Triggers can parse custom protocols, emit custom metrics or records, and perform external I/O such as HTTP, Syslog, or Kafka.

Treat triggers as the primary platform extensibility primitive.
