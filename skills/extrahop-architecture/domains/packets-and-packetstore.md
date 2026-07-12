# Packets and Packetstore

Use this file when byte-level evidence, Packet Forensics, PCAP retrieval, or packetstore architecture matters.

## What packets are for

Packets provide raw evidence. They are useful for:

- payload or byte-level validation;
- protocol edge cases;
- fields not extracted into metrics or records;
- legal, compliance, or escalation evidence;
- file or payload workflows where licensed and visible.

Packets should usually be a targeted retrieval step, not the default starting point for broad investigation.

## Packetstore architecture

Packetstores provide continuous packet capture, retention, retrieval, and packet-level forensic evidence.

The packetstore receives its own feed, commonly parallel to a packet sensor from the same TAP or broker environment. It is not downstream of the packet sensor. Parallel feeds allow broker-level filtering, where one traffic subset can go to analysis and another to storage.

If no separate packetstore feed is specified, it is reasonable for sizing conversations to assume packetstore ingest matches the packet sensor feed, then validate against the actual feed design.

## Retrieval path

Packet sensors and consoles can query packetstores and proxy PCAP retrieval to users. Retrieval is commonly constrained by BPF or similar packet filters.

## Sizing implications

Packetstore design must satisfy both peak ingest throughput and average-rate retention depth. Capacity alone is not enough. Prefer operational headroom over designs that depend on exact catalog maximums unless the user explicitly asks for theoretical maximum capacity.

## All-in-one behavior

Some sensors include packetstore capability on the same system. Treat that as colocated capability, not proof that packet storage is part of the analysis pipeline.
