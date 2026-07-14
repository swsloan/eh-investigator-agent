---
{
  "anchor": "modbus",
  "api_area": "trigger-api",
  "doc_kind": "class",
  "events": [
    "MODBUS_REQUEST",
    "MODBUS_RESPONSE"
  ],
  "examples": [],
  "methods": [
    "commitRecord(): void"
  ],
  "name": "Modbus",
  "properties": [
    "error: String",
    "functionId: Number",
    "functionName: String",
    "isReqAborted: Boolean",
    "isRspAborted: Boolean",
    "payload: Buffer",
    "payloadOffset: Number",
    "processingTime: Number",
    "record: Object",
    "reqBytes: Number",
    "reqL2Bytes: Number",
    "reqPkts: Number",
    "reqRTO: Number",
    "reqSize: Number",
    "reqTransferTime: Number",
    "reqZeroWnd: Number",
    "roundTripTime: Number",
    "rspBytes: Number",
    "rspL2Bytes: Number",
    "rspPkts: Number",
    "rspRTO: Number",
    "rspSize: Number",
    "rspTransferTime: Number",
    "rspZeroWnd: Number",
    "statusCode: Number",
    "txId: Number",
    "unitId: Number"
  ],
  "section": "protocol-and-network-data-classes",
  "source_url": "https://docs.extrahop.com/current/extrahop-trigger-api/",
  "source_version": "26.2"
}
---

### Modbus

The `Modbus` class enables you to access properties from `MODBUS_REQUEST` and `MODBUS_RESPONSE` events. Modbus is a serial communications protocol that enables connections between multiple devices on the same network.

#### Events

- **MODBUS_REQUEST**: Runs on every request sent by a Modbus client. A Modbus client in the ExtraHop system is the Modbus master device.
- **MODBUS_RESPONSE**: Runs on every response sent by a Modbus server. A Modbus server in the ExtraHop system is the Modbus slave device.

#### Methods

- **commitRecord(): void**: Sends a record to the configured recordstore on a

`MODBUS_RESPONSE`

event. Record commits on

`MODBUS_REQUEST`

events are not supported.

To view the default properties committed to the record object, see the `record` property below.

For built-in records, each unique record is committed only once, even if the `commitRecord()` method is called multiple times for the same unique record.

#### Properties

- **error: String**: The detailed error message recorded by the ExtraHop system.

Access only on `MODBUS_RESPONSE` events; otherwise, an error will occur.
- **functionId: Number**: The Modbus function code contained in the request or response.

| Function ID | Function name |
| --- | --- |
| `1` | `Read Coil` |
| `2` | `Read Discrete Inputs` |
| `3` | `Read Holding Registers` |
| `4` | `Read Input Registers` |
| `5` | `Write Single Coil` |
| `6` | `Write Single Holding Register` |
| `15` | `Write Multiple Coils` |
| `16` | `Write Multiple Holding Registers` |
- **functionName: String**: The name of the Modbus function code contained in the request or response.
- **isReqAborted: Boolean**: The value is

`true`

if the connection is closed before the request was complete.
- **isRspAborted: Boolean**: The value is

`true`

if the connection is closed before the response was complete.

Access only on `MODBUS_RESPONSE` events; otherwise, an error will occur.
- **payload: Buffer**: The

[Buffer](#buffer)

object containing the body of the request or response.
- **payloadOffset: Number**: The file offset, expressed in bytes, within the

`resource`

property. The payload property is obtained from the

`resource`

property at the offset.
- **processingTime: Number**: The processing time of the Modbus server, expressed in milliseconds. The value is

`NaN`

on malformed and aborted responses or if the timing is invalid.

Access only on `MODBUS_RESPONSE` events; otherwise, an error will occur.
- **record: Object**: The record object that can be sent to the configured recordstore through a call to

`Modbus.commitRecord`

on a

`MODBUS_RESPONSE`

event.

The default record object can contain the following properties:

- `clientIsExternal`
- `error`
- `functionId`
- `functionName`
- `protocolId`
- `reqL2Bytes`
- `rspL2Bytes`
- `receiverIsExternal`
- `reqPkts`
- `rspPkts`
- `reqBytes`
- `rspBytes`
- `reqRTO`
- `rspRTO`
- `roundTripTime`
- `clientZeroWnd`
- `senderIsExternal`
- `serverIsExternal`
- `serverZeroWnd`
- `statusCode`
- `txId`
- `unitId`

Access only on `MODBUS_RESPONSE` events; otherwise, an error will occur.
- **reqBytes: Number**: The number of

L4

request bytes, excluding L4 headers.

Access only on `MODBUS_RESPONSE` events; otherwise, an error will occur.
- **reqL2Bytes: Number**: The number of L2 request bytes, including

L2

headers.

Access only on `MODBUS_RESPONSE` events; otherwise, an error will occur.
- **reqPkts: Number**: The number of packets in the request.

Access only on `MODBUS_RESPONSE` events; otherwise, an error will occur.
- **reqRTO: Number**: The number of

retransmission timeouts

(RTOs) in the request.

Access only on `MODBUS_RESPONSE` events; otherwise, an error will occur.
- **reqSize: Number**: The number of L7 request bytes, excluding Modbus headers.
- **reqTransferTime: Number**: The transfer time of the request, expressed in milliseconds. If the request is contained in a single packet, the transfer time is zero. If the request spans multiple packets, the value is the amount of time between detection of the first request packet and detection of the last packet by the ExtraHop system. A high value might indicate a large request or a network delay. The value is

`NaN`

if there is no valid measurement, or if the timing is invalid.
- **reqZeroWnd: Number**: The number of zero windows in the request.

Access only on `MODBUS_RESPONSE` events; otherwise, an error will occur.
- **roundTripTime: Number**: The median round trip time (RTT), expressed in milliseconds.

An RTT is the time it took for a device to send a single TCP packet and receive an immediate corresponding acknowledgment (ACK) packet.

The median value is calculated by sampling the RTTs observed since the last

`MODBUS_RESPONSE`

event ran. The value is

`NaN`

if there are no RTT samples.

Access only on `MODBUS_RESPONSE` events; otherwise, an error will occur.
- **rspBytes: Number**: The number of

L4

response bytes, excluding L4 protocol overhead, such as ACKs, headers, and retransmissions.
- **rspL2Bytes: Number**: The number of

L2

response bytes, including protocol overhead, such as headers.

Access only on `MODBUS_RESPONSE` events; otherwise, an error will occur.
- **rspPkts: Number**: The number of packets in the response.

Access only on `MODBUS_RESPONSE` events; otherwise, an error will occur.
- **rspRTO: Number**: The number of

retransmission timeouts

(RTOs) in the response.

Access only on `MODBUS_RESPONSE` events; otherwise, an error will occur.
- **rspSize: Number**: The number of L7 response bytes, excluding Modbus protocol headers.

Access only on `MODBUS_RESPONSE` events; otherwise, an error will occur.
- **rspTransferTime: Number**: The transfer time of the response, expressed in milliseconds. If the response is contained in a single packet, the transfer time is zero. If the response spans multiple packets, the value is the amount of time between detection of the first response packet and detection of the last packet by the ExtraHop system. A high value might indicate a large response or a network delay. The value is

`NaN`

if there is no valid measurement, or if the timing is invalid.

Access only on `MODBUS_RESPONSE` events; otherwise, an error will occur.
- **rspZeroWnd: Number**: The number of zero windows in the response.

Access only on `MODBUS_RESPONSE` events; otherwise, an error will occur.
- **statusCode: Number**: The numeric status code of the response.

| Status code number | Status description |
| --- | --- |
| `1` | `Illegal Function` |
| `2` | `Illegal Data Address` |
| `3` | `Illegal Data Value` |
| `4` | `Slave Device Failure` |
| `5` | `Acknowledge` |
| `6` | `Slave Device Busy` |
| `7` | `Negative Acknowledge` |
| `8` | `Memory Parity Error` |
| `10` | `Gateway Path Unavailable` |
| `11` | `Gateway Target Device Failed to Respond` |

Access only on `MODBUS_RESPONSE` events; otherwise, an error will occur.
- **txId: Number**: The transaction identifier of the request or response.
- **unitId: Number**: The unit identifier of the Modbus server responding to the Modbus client.
