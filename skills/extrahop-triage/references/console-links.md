# Security Triage Console Links

Use exact RevealX deep links to turn a Detection Set into an analyst launchpad.
Construct links only from verified metadata and keep the conclusion readable
without clicking them.

## Required Inputs

Call the wrapped appliance-metadata tool once and cache the result.

| Value | Accepted source |
| --- | --- |
| console FQDN | `display_host`, then `external_hostname`; otherwise a RevealX URL the user supplied in this conversation |
| appliance UUID for device pages | exactly 32 hexadecimal characters; on RevealX 360 this can be metadata `hostname`, while self-managed `hostname` is commonly an FQDN |
| device discovery ID | verified `discovery_id` or `extrahop_id` from device details |
| detection/investigation ID | full value returned by the interface |

Never use `mgmt_ipaddr` as the FQDN, a non-hex hostname as an appliance UUID,
or an abbreviated console display ID in a state-changing handoff. If a required
piece is missing, leave that identifier unlinked.

## URL Forms

Detection:

```text
https://<fqdn>/extrahop/#/detections/detail/<detection_id>
```

Investigation:

```text
https://<fqdn>/extrahop/#/detections/investigations/<investigation_id>
```

Device participant:

```text
https://<fqdn>/extrahop/#/metrics/devices/<appliance_uuid>.<discovery_id>/overview/
```

Detection and investigation links need only the FQDN. Device links additionally
need the verified UUID and discovery ID. A device page may use the detection's
time window when useful; follow the relative/absolute mapping in the companion
health-check `console-links.md` rather than inventing query parameters.

## Placement

- Link detection IDs on a final Detection Set.
- Link offender/victim devices when every required component is available.
- Link a newly created investigation only after the create call returns its ID.
- Link similar historical detections when they materially support the verdict.
- Keep bulk `Closing (N)` lists plain; link excluded items individually.
- Keep internal escalation queues plain.

Link the first occurrence per Detection Set. Never substitute a link for the
evidence path, verdict rationale, or exact approved ID list.
