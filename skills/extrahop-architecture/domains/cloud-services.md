# ExtraHop Cloud Services

Use this file when cloud connectivity, Enterprise assumptions, air-gapped limits, or cloud-delivered updates matter.

## Connected deployments

ExtraHop Cloud Services are used by connected RevealX 360 and connected RevealX Enterprise deployments. Do not equate Enterprise with offline.

Cloud Services can provide:

- ML detection scoring over selected streamed/tokenized metrics;
- threat intelligence feeds;
- model, signature, and fingerprint updates;
- new or updated detection content;
- feature updates where applicable;
- remote support or professional-services access where enabled.

## Data boundary

Cloud ML uses selected metric-derived data, not raw packet payloads. When exact data-sharing boundaries matter, verify against current product documentation or the customer's configured policy.

## Air-gapped deployments

Air-gapped deployments sever this cloud surface. They lose cloud ML, cloud threat intelligence, cloud-delivered fingerprint updates, and model/signature updates unless an approved offline update path exists.

Local packet analysis, rule-based detections, locally stored records, and locally stored packets can still be useful, depending on deployed components and licensing.

## Reasoning rule

Always distinguish hosting model from cloud-service dependency. A customer can self-manage the console and storage while still depending on cloud-delivered detection and enrichment capabilities.
