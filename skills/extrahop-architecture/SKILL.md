---
name: extrahop-architecture
description: "Use this skill as a reasoning substrate for understanding ExtraHop deployments, what data ExtraHop can consume and produce, and how core components, modules, and evidence types fit together. Also trigger on: ExtraHop, RevealX, NDR, NPM, Packet Sensor, Packetstore, Recordstore, Flow Sensor, EDA, ETA, EXA, ECA, EFC."
---

# ExtraHop Architecture & Capabilities - Foundational Skill

First-principles architecture reference. Use these concepts to reason about what ExtraHop can and cannot do, how the product family architecture fits together. For current SKUs, exact packaging, UI names, appliance limits, or support matrices, use current product documentation instead of this skill.

## Nomenclature Rule

Use current product/component names when creating new artifacts. Understand historical names, legacy acronyms, and model prefixes when reading user input, old diagrams, inventories, or appliance model numbers. Legacy acronyms are not preferred prose, but they can still appear as model prefixes.

| Current term | Historical name | Legacy acronym / model prefix | One-line meaning |
| --- | --- | --- | --- |
| Packet Sensor | ExtraHop Discover Appliance | EDA | Passive packet-analysis sensor; derives metrics and records in memory. |
| Packetstore | ExtraHop Trace Appliance | ETA | Raw packet capture and retrieval system; evidence layer, not analysis dependency. |
| Recordstore | ExtraHop Explore Appliance | EXA | Search store for flow, mid-layer, and L7 transaction records. |
| Console | ExtraHop Command Appliance | ECA | Federation and management layer; does not process packets. |
| Flow Sensor | ExtraHop Flow Collector | EFC | Flow telemetry sensor; separate virtual sensor types exist for NetFlow/sFlow/IPFIX and AWS VPC Flow Logs. |
| All-in-One Sensor | AIO sensor | AIO | Combined Packet Sensor and Packetstore capability on one system. |
| Multifunction Sensor | Multifunction Sensor | model-specific | Packet Sensor workloads such as NDR/NPM/IDS without built-in Packetstore. |
| Packet Forensics | Packet Forensics | none | Module/workflow for packet capture, retention, retrieval, and packet-level validation. |
| RevealX 360 | RevealX 360 | none | SaaS-oriented deployment track with ExtraHop-hosted management/investigation workflows. |
| RevealX Enterprise | RevealX Enterprise | none | Self-managed deployment track; may still use ExtraHop Cloud Services when connected. |

## Load Narrow Context

Load only the file needed for the task:

- `domains/core-packet-engine.md` - packet ingest, in-memory flow processing, TCP state machines, decryption, L7 protocol analysis, triggers.
- `domains/metrics.md` - sensor-local time-series metrics, rollups, metric value, metric limits, device/application/network buckets.
- `domains/records.md` - flow, mid-layer, and L7 transaction records; recordstore use; record query tradeoffs.
- `domains/packets-and-packetstore.md` - packetstore architecture, independent feeds, packet retrieval, packet forensics.
- `domains/components.md` - packet sensors, consoles, recordstores, packetstores, flow sensors, IDS, AIO and multifunction sensors.
- `domains/deployment-tracks.md` - RevealX 360, RevealX Enterprise, air-gapped deployments, hosting boundaries.
- `domains/device-discovery.md` - L2, L3, Remote L3, VPN discovery, locality, fingerprinting, deduplication.
- `domains/detections.md` - rule-based detections, ML detections, ARD, IDS detections, tuning, threat intelligence, threat briefings.
- `domains/cloud-services.md` - what connected deployments exchange with ExtraHop Cloud Services and what air-gapped deployments lose.
- `domains/modules-and-entitlements.md` - durable NDR, NPM, Packet Forensics, IDS, RBAC, and integration boundaries.

---

## Operating Model

ExtraHop's core advantage is passive, real-time, in-memory analysis of full packet streams. Sensors reconstruct flows, maintain TCP state, decrypt where keys are supplied, identify protocols by traffic behavior, extract metrics and records, and expose processing events to triggers.

Stored packets are not the source of metrics or records. Packetstore is an evidence and retrieval layer. Packet sensors derive metrics and records in memory as traffic is observed.

Metrics are the broadest and cheapest historical primitive. Records are deeper transaction and flow metadata. Packets are raw byte-level evidence. Use that ordering for investigations: metrics to find where and when, records to understand what happened, packets when bytes or payload-level proof matter.

Each packet sensor has its own feed and perspective. Do not reason as if multiple sensors form one horizontally scaled analysis plane unless an explicit product workflow federates their results.

The console federates and manages; it does not process packets. It holds configuration and queries sensors/stores for data workflows.

## Evidence Selection

Choose evidence by the question being asked:

- Behavior over time, top talkers, slow services, broad pivots: metrics.
- Specific connections, transactions, TLS handshakes, protocol fields, historical metadata: records.
- Payload, exact bytes, legal/compliance evidence, protocol edge cases, fields not extracted into metrics or records: packets.
- Signature match context: IDS detections plus records/packets as needed.
- Retrospective IOC questions: ARD and recordstore-backed searches.

## Stable Principles

1. Analysis is in-memory and real-time on packet sensors.
2. Packetstore is evidence infrastructure, not analysis infrastructure.
3. Sensors do not horizontally merge into one analysis plane; coverage follows feed design.
4. Packetstores receive their own feed, often parallel to packet sensors.
5. Metrics live on sensors; consoles federate metric workflows.
6. Devices are local to a sensor's discovery context unless a product workflow explicitly correlates them.
7. Records are exported analysis artifacts stored for faceted historical search.
8. Detection mechanisms differ by source: on-box rules, cloud ML over streamed metrics, recordstore-driven ARD, and IDS signatures.
9. Cloud-connected Enterprise is still cloud-connected for Cloud Services; air-gapped deployments lose cloud-fed capabilities.
10. RevealX 360 vs. RevealX Enterprise is mostly a hosting and operations distinction, not a different packet-analysis engine.

---

When the exact product state matters, verify against current ExtraHop documentation or authoritative local project data before asserting it.
