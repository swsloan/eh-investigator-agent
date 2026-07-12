# Detections

Use this file when reasoning about where detections come from and what evidence supports them.

## Detection object

An ExtraHop detection is an object representing detected activity. Different mechanisms can create detections, and their data sources and dependencies are not interchangeable.

## Rule-based detections

Rule-based detections run on-box in real time. They use rule logic maintained by ExtraHop threat research and delivered through update mechanisms where connectivity exists.

They do not require cloud ML scoring to fire.

## ML-based detections

ML detections are based on selected metrics streamed or tokenized to ExtraHop cloud for behavioral scoring. They are not based on raw packets or recordstore scans.

Cloud ML returns detection objects to the deployment. It does not autonomously change customer configuration.

## Automatic Retrospective Detection

ARD operates on stored records. When new IOC or threat data is available, ExtraHop can scan the recordstore and surface detections for historical activity.

ARD requires a populated recordstore and should not be described as live packet analysis or metric scoring.

## IDS detections

IDS detections are signature-based. They are additive to NDR behavioral detections.

Use records and packets to validate or contextualize IDS detections when needed. Do not infer that an IDS signature alone provides full transaction context.

## Tuning

Detection tuning adds environment-specific knowledge to reduce noise, such as trusted domains, vulnerability scanners, known benign participants, or rules that hide specific detections or participants.

Use tuning to suppress known noise, not to hide unresolved risk.

## Threat intelligence and briefings

Threat intelligence feeds and threat briefings are cloud-delivered in connected deployments. They provide guided starting points, related detections, targeted record queries, and affected-device context.

Treat them as investigation accelerators, not substitutes for environment-specific validation.
