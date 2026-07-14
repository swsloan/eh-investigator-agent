---
{
  "anchor": "turn",
  "api_area": "trigger-api",
  "doc_kind": "class",
  "events": [],
  "examples": [],
  "methods": [],
  "name": "Turn",
  "properties": [
    "clientBytes: Number",
    "clientTransferTime: Number",
    "processingTime: Number",
    "reqSize: Number",
    "reqTransferTime: Number",
    "rspSize: Number",
    "rspTransferTime: Number",
    "serverBytes: Number",
    "serverTransferTime: Number",
    "sourceDevice: Device",
    "thinkTime: Number"
  ],
  "section": "protocol-and-network-data-classes",
  "source_url": "https://docs.extrahop.com/current/extrahop-trigger-api/",
  "source_version": "26.2"
}
---

### Turn

`Turn` is a class that enables you to store metrics and access properties available on `FLOW_TURN` events.

The `FLOW_TURN` event is defined in the [Flow](#flow) section.

#### Properties

- **clientBytes: Number**: The total number of bytes sent by the

client

since the last

`FLOW_TURN`

event ran.
- **clientTransferTime: Number**: The client transfer time, expressed in milliseconds.
- **processingTime: Number**: The time elapsed between when the client transfers the request to the server and when the server begins to transfer the response back to the client, expressed in milliseconds.
- **reqSize: Number**: The size of the request payload, expressed in bytes.
- **reqTransferTime: Number**: The request transfer time, expressed in milliseconds. If the request is contained in a single packet, the transfer time is zero. If the request spans multiple packets, the value is the amount of time between detection of the first request packet and detection of the last packet by the ExtraHop system. A high value might indicate a large request or a network delay. The value is

`NaN`

if there is no valid measurement, or if the timing is invalid.
- **rspSize: Number**: The size of the response payload, expressed in bytes.
- **rspTransferTime: Number**: The response transfer time, expressed in milliseconds. If the response is contained in a single packet, the transfer time is zero. If the response spans multiple packets, the value is the amount of time between detection of the first response packet and detection of the last packet by the ExtraHop system. A high value might indicate a large response or a network delay. The value is

`NaN`

if there is no valid measurement, or if the timing is invalid.
- **serverBytes: Number**: The total number of bytes sent by the server since the last

`SSL_RECORD`

event ran.
- **serverTransferTime: Number**: The server transfer time, expressed in milliseconds.
- **sourceDevice: Device**: The source device object. See the

[Device](#device)

class for more information.
- **thinkTime: Number**: The time elapsed between the server having transferred the response to the

client

and the client transferring a new request to the server, expressed in milliseconds. The value is

`NaN`

if there is no valid measurement.
