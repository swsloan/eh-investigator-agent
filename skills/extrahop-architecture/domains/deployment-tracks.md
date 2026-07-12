# Deployment Tracks

Use this file for hosting and operations boundaries.

## RevealX 360

RevealX 360 is the SaaS-oriented track. Customers deploy sensors, while ExtraHop hosts management and investigation workflows such as console and recordstore capabilities.

Use this framing for cloud-hosted management, ExtraHop-hosted investigation storage, built-in cloud-service integration, and customer environments where sensors remain close to the traffic.

## RevealX Enterprise

RevealX Enterprise is the self-managed track. Customers operate the console and supporting storage components or approved external storage/search platforms.

Connected Enterprise deployments still use ExtraHop Cloud Services for cloud-delivered capabilities. Do not describe Enterprise as air-gapped unless the deployment explicitly lacks cloud connectivity.

## Air-gapped

Air-gapped deployments have no ExtraHop cloud connectivity. Local rule-based/on-box detections and locally available records or packets can still function, but cloud ML, cloud threat intelligence, fingerprint updates, and model/signature updates are absent or severely constrained.

## What does not change

The packet-analysis engine is not a different architecture just because the console or investigation storage is hosted differently. Reason about analysis from the sensor first, then reason about hosting and retention.
