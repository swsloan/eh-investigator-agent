---
{
  "anchor": "rfb",
  "api_area": "trigger-api",
  "doc_kind": "class",
  "events": [
    "RFB_CLOSE",
    "RFB_OPEN",
    "RFB_TICK"
  ],
  "examples": [],
  "methods": [
    "commitRecord(): void"
  ],
  "name": "RFB",
  "properties": [
    "authType: Number",
    "authResult: Number",
    "duration: Number",
    "error: String",
    "record: Object",
    "reqBytes: Number",
    "reqL2Bytes: Number",
    "reqPkts: Number",
    "reqRTO: Number",
    "reqZeroWnd: Number",
    "roundTripTime: Number",
    "rspBytes: Number",
    "rspL2Bytes: Number",
    "rspPkts: Number",
    "rspRTO: Number",
    "rspZeroWnd: Number",
    "version: String"
  ],
  "section": "protocol-and-network-data-classes",
  "source_url": "https://docs.extrahop.com/current/extrahop-trigger-api/",
  "source_version": "26.2"
}
---

### RFB

The RFB class enables you to store metrics and access properties on `RFB_OPEN`, `RFB_CLOSE`, and `RFB_TICK` events.

#### Events

- **RFB_CLOSE**: Runs when an RFB connection is closed.
- **RFB_OPEN**: Runs when a new RFB connection is opened.
- **RFB_TICK**: Runs periodically on RFB flows.

#### Methods

- **commitRecord(): void**: Commits a record object to the recordstore. To view the default properties committed to the record object, see the

`record`

property below.

For built-in records, each unique record is committed only once, even if the `commitRecord()` method is called multiple times for the same unique record.

#### Properties

- **authType: Number**: The number that corresponds to the security type negotiated by the client and server.

Access only on `RFB_OPEN` events; otherwise, an error will occur.

| Security type | Number |
| --- | --- |
| `Invalid` | `0` |
| `None` | `1` |
| `VNC Authentication` | `2` |
| `RealVNC` | `3-15` |
| `Tight` | `16` |
| `Ultra` | `17` |
| `TLS` | `18` |
| `VeNCrypt` | `19` |
| `GTK-VNC SASL` | `20` |
| `MD5 hash authentication` | `21` |
| `Colin Dean xvp` | `22` |
| `RealVNC` | `128-255` |
- **authResult: Number**: Indicates whether authentication was successful.

| Value | Description |
| --- | --- |
| `0` | `Succeeded` |
| `1` | `Failed` |
- **duration: Number**: The duration of the RFB session, expressed in seconds.

Access only on `RFB_CLOSE` events; otherwise, an error will occur.
- **error: String**: The detailed error message recorded by the ExtraHop system.

Access only on `RFB_OPEN` events; otherwise, an error will occur.
- **record: Object**: The record object committed to the recordstore through a call to

`RFB.commitRecord()`

.

The event on which the method was called determines which properties the default record object can contain as displayed in the following table:

| `RFB_OPEN` | `RFB_TICK` | `RFB_CLOSE` |
| --- | --- | --- |
| `authType` | `clientIsExternal` | `clientIsExternal` |
| `authResult` | `reqBytes` | `duration` |
| `clientIsExternal` | `receiverIsExternal` | `receiverIsExternal` |
| `error` | `reqL2Bytes` | `senderIsExternal` |
| `receiverIsExternal` | `reqPkts` | `serverIsExternal` |
| `senderIsExternal` | `reqRTO` |  |
| `serverIsExternal` | `reqZeroWnd` |  |
| `version` | `roundTripTime` |  |
|  | `rspBytes` |  |
|  | `rspL2Bytes` |  |
|  | `rspPkts` |  |
|  | `rspRTO` |  |
|  | `rspZeroWnd` |  |
|  | `senderIsExternal` |  |
|  | `serverIsExternal` |  |
- **reqBytes: Number**: The number of

L4

request bytes, excluding L4 headers.

Access only on `RFB_TICK` events; otherwise, an error will occur.
- **reqL2Bytes: Number**: The number of

L2

request bytes, including L2 headers.

Access only on `RFB_TICK` events; otherwise, an error will occur.
- **reqPkts: Number**: The number of request packets.

Access only on `RFB_TICK` events; otherwise, an error will occur.
- **reqRTO: Number**: The number of request

retransmission timeouts

(RTOs).

Access only on `RFB_TICK` events; otherwise, an error will occur.
- **reqZeroWnd: Number**: The number of zero windows in the request.

Access only on `RFB_TICK` events; otherwise, an error will occur.
- **roundTripTime: Number**: The median TCP round trip time (RTT), expressed in milliseconds.

An RTT is the time it took for a device to send a single TCP packet and receive an immediate corresponding acknowledgment (ACK) packet.

The median value is calculated by sampling the RTTs observed since the last

`RFB_TICK`

event ran. The value is

`NaN`

if there are no RTT samples.

Access only on `RFB_TICK` events; otherwise, an error will occur.
- **rspBytes: Number**: The number of

L4

response bytes, excluding L4 protocol overhead, such as ACKs, headers, and retransmissions.

Access only on `RFB_TICK` events; otherwise, an error will occur.
- **rspL2Bytes: Number**: The number of

L2

response bytes, including protocol overhead, such as headers.

Access only on `RFB_TICK` events; otherwise, an error will occur.
- **rspPkts: Number**: The number of response packets.

Access only on `RFB_TICK` events; otherwise, an error will occur.
- **rspRTO: Number**: The number of response

retransmission timeouts

(RTOs).

Access only on `RFB_TICK` events; otherwise, an error will occur.
- **rspZeroWnd: Number**: The number of zero windows in the response.

Access only on `RFB_TICK` events; otherwise, an error will occur.
- **version: String**: The version of the RFB protocol negotiated by the client and server.

Access only on `RFB_OPEN` events; otherwise, an error will occur.
