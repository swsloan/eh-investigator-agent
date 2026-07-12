# Modules and Entitlements

Use this file for durable module boundaries. Treat exact packaging, feature names, entitlement labels, and UI paths as time-sensitive.

## NDR

Network Detection and Response supports security visibility, detections, investigation, response workflows, threat intelligence, security dashboards, tuning, notifications, and guided pivots.

## NPM

Network Performance Monitoring supports network, infrastructure, and application performance workflows: service views, dashboards, performance detections, alerts, and flow-log visibility where applicable.

## Packet Forensics

Packet Forensics enables packet capture, packetstore-backed retention, packet retrieval, packet viewing, and packet-level evidence workflows. It can support security or performance use cases.

Use this module when discussing full packet capture or byte-level validation.

## IDS

IDS is additive to NDR and provides signature-based detections through vendor-managed and/or customer-managed signatures where supported.

IDS does not replace ExtraHop behavioral detections. Performance and sizing impact depend on deployment generation and sensor model; verify current sizing data for design work.

## Cross-module platform capabilities

The platform commonly includes capabilities such as dashboards, charts, maps, assets, devices, applications, networks, metrics, records, packets, detections, investigations, tuning, notifications, integrations, APIs, metric catalog, bundles, triggers, analysis priorities, RBAC, and assistant workflows.

Do not present that as a permanent exhaustive feature list.

## Integrations

Describe integrations by purpose unless the user asks for a current supported-products list.

Common integration patterns:

- turnkey integrations built and maintained by ExtraHop;
- trigger, webhook, or REST API integrations for bespoke workflows.
