# Components

Use this file for component roles and legacy name mapping. Use current terms in new artifacts; map historical names and model prefixes when interpreting older context.

## Packet Sensor

The Packet Sensor is the core analysis component. It ingests packets, performs flow and protocol analysis, writes local metrics, emits records, supports triggers, and may support IDS depending on model and licensing.

Historical name: ExtraHop Discover Appliance. Legacy acronym and model prefix: EDA.

## Console

The console is the browser-based command center and federation layer. It connects to sensors, recordstores, and packetstores; provides centralized views; distributes selected configuration; and proxies workflows as needed.

The console does not process packets and should not be treated as a complete metric-history store.

Historical name: ExtraHop Command Appliance. Legacy acronym and model prefix: ECA. "Command" and "Console" are often used interchangeably in older context.

## Recordstore

Recordstores warehouse records for search and investigation. Deployments can use ExtraHop-managed investigation storage, customer-managed recordstore infrastructure, or supported external analytics/search platforms.

Historical name: ExtraHop Explore Appliance. Legacy acronym and model prefix: EXA. "Investigation" can refer to hosted or module-level recordstore-backed workflows.

## Packetstore

Packetstores retain raw packets for forensic retrieval. They usually receive a feed parallel to the packet sensor and can scale as evidence-retention infrastructure.

Historical name: ExtraHop Trace Appliance. Legacy acronym and model prefix: ETA, as in appliance models such as ETA9350 or ETA8250.

## Flow Sensor

Flow sensors ingest flow telemetry where packet access is unavailable or supplemental visibility is useful. EFC is the model designation prefix for Flow Sensors.

There are different virtual Flow Sensor types:

- NetFlow/sFlow/IPFIX EFC sensors;
- AWS VPC Flow Logs EFC sensors.

They generate basic L2-L4 metrics and ExFlow-style records from the telemetry they receive.

Flow telemetry is complementary. It does not provide the same L7 reconstruction, timing precision, payload-derived fields, or protocol analyzer depth as packet-derived wire data.

## IDS

IDS adds signature-based detection. It can run with packet-sensor context or in a companion IDS-sensor architecture depending on deployment generation and model. Keep IDS additive to NDR; do not describe it as a replacement for behavioral detections.

IDS signature content includes vendor-managed signatures such as ET Pro and customer-provided signatures where supported.

## AIO and Multifunction Sensors

All-in-One Sensors colocate Packet Sensor and Packetstore capability on one system, often for branch or cloud deployments.

Multifunction Sensors are a current but declining category for this use case. They run Packet Sensor workloads such as NDR, NPM, and IDS but do not include built-in Packetstore capability. Their value is narrower than AIO because they avoid Packetstore but still require a sensor footprint; future designs are generally moving toward AIOs where this combined role is needed.

Multifunction Sensors are distinct from older sensors that take a throughput hit when IDS is enabled. Verify model-specific sizing, but do not assume the historical IDS performance penalty applies to every Multifunction Sensor.

## Historical notes

Standalone companion IDS sensors are end-of-sale historical architecture context. They were dedicated IDS-only sensors with their own data feed that paired with a packet sensor running the NDR/NPM workloads. The purpose was to fully offload IDS compute, but the added feed complexity outweighed the high-throughput benefit for most deployments.
