---
{
  "anchor": "udp",
  "api_area": "trigger-api",
  "doc_kind": "class",
  "events": [
    "UDP_PAYLOAD"
  ],
  "examples": [],
  "methods": [],
  "name": "UDP",
  "properties": [],
  "section": "protocol-and-network-data-classes",
  "source_url": "https://docs.extrahop.com/current/extrahop-trigger-api/",
  "source_version": "26.2"
}
---

### UDP

The `UDP` class enables you to access properties and retrieve metrics from UDP events and from `FLOW_TICK` and `FLOW_TURN` events.

The

`FLOW_TICK`

and

`FLOW_TURN`

events are defined in the

[Flow](#flow)

section.

#### Events

- **UDP_PAYLOAD**: Runs when the payload matches the criteria configured in the associated trigger.

Depending on the [Flow](#flow), the UDP payload can be found in the following properties:

- `Flow.client.payload`
- `Flow.payload1`
- `Flow.payload2`
- `Flow.receiver.payload`
- `Flow.sender.payload`
- `Flow.server.payload`

| Tip: | Running a trigger on all `UDP_PAYLOAD` events might affect system performance. We recommend that you limit the events that the trigger runs on by specifying one or both of the following advanced trigger options:Client Port Range Server Port Range |
| --- | --- |

Additional payload options are available when you create a trigger that runs on this event. See [Advanced trigger options](#advanced-trigger-options) for more information.
