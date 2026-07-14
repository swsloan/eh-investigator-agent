---
{
  "anchor": "redis",
  "api_area": "trigger-api",
  "doc_kind": "class",
  "events": [
    "REDIS_REQUEST",
    "REDIS_RESPONSE"
  ],
  "examples": [],
  "methods": [
    "commitRecord(): void"
  ],
  "name": "Redis",
  "properties": [
    "errors: Array",
    "isReqAborted: Boolean",
    "isRspAborted: Boolean",
    "method: String",
    "payload: Buffer",
    "processingTime: Number",
    "record: Object",
    "reqKey: Array",
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
    "rspTransferTime: Number",
    "rspSize: Number",
    "rspTimeToFirstByte: Number",
    "rspTimeToLastByte: Number",
    "rspZeroWnd: Number"
  ],
  "section": "protocol-and-network-data-classes",
  "source_url": "https://docs.extrahop.com/current/extrahop-trigger-api/",
  "source_version": "26.2"
}
---

### Redis

Remote Dictionary Server (Redis) is an open-source, in-memory data structure server. The `Redis` class enables you to store metrics and access properties on `REDIS_REQUEST` and `REDIS_RESPONSE` events.

#### Events

- **REDIS_REQUEST**: Runs on every Redis request processed by the device.
- **REDIS_RESPONSE**: Runs on every Redis response processed by the device.

#### Methods

- **commitRecord(): void**: Sends a record to the configured recordstore on either a

`REDIS_REQUEST`

or

`REDIS_RESPONSE`

event.

The event determines which properties are committed to the record object. To view the default properties committed for each event, see the `record` property below.

For built-in records, each unique record is committed only once, even if the `commitRecord()` method is called multiple times for the same unique record.

#### Properties

- **errors: Array**: An array of detailed error messages recorded by the ExtraHop system.

Access only on `REDIS_RESPONSE` events; otherwise, an error will occur.
- **isReqAborted: Boolean**: The value is

`true`

if the connection is closed before the Redis request was complete.
- **isRspAborted: Boolean**: The value is

`true`

if the connection is closed before the Redis response was complete.

Access only on `REDIS_RESPONSE` events; otherwise, an error will occur.
- **method: String**: The Redis method such as GET or KEYS.
- **payload: Buffer**: The body of the response or request.
- **processingTime: Number**: The server processing time, expressed in milliseconds. The value is

`NaN`

on malformed and aborted responses or if the timing is invalid.

Access only on `REDIS_RESPONSE` events; otherwise, an error will occur.
- **record: Object**: The record object that can be sent to the configured recordstore through a call to

`Redis.commitRecord()`

on either a

`REDIS_REQUEST`

or

`REDIS_RESPONSE`

event.

The event on which the method was called determines which properties the default record object can contain as displayed in the following table:

| `REDIS_REQUEST` | `REDIS_RESPONSE` |
| --- | --- |
| `clientIsExternal` | `clientIsExternal` |
| `clientZeroWnd` | `clientZeroWnd` |
| `method` | `error` |
| `receiverIsExternal` | `method` |
| `reqKey` | `processingTime` |
| `reqSize` | `receiverIsExternal` |
| `reqTransferTime` | `reqKey` |
| `isReqAborted` | `rspSize` |
| `senderIsExternal` | `rspTransferTime` |
| `serverZeroWnd` | `isRspAborted` |
|  | `rspTimeToFirstByte` |
|  | `rspTimeToLastByte` |
|  | `senderIsExternal` |
|  | `serverIsExternal` |
|  | `serverZeroWnd` |
- **reqKey: Array**: An array containing the Redis key strings sent with the request.
- **reqBytes: Number**: The number of

L4

request bytes, excluding L4 headers.
- **reqL2Bytes: Number**: The number of

L2

request bytes, including L2 headers.
- **reqPkts: Number**: The number of request packets.
- **reqRTO: Number**: The number of request

retransmission timeouts

(RTOs).
- **reqSize: Number**: The number of L7 request bytes, excluding Redis headers.
- **reqTransferTime: Number**: The request transfer time, expressed in milliseconds. If the request is contained in a single packet, the transfer time is zero. If the request spans multiple packets, the value is the amount of time between detection of the first Redis request packet and detection of the last packet by the ExtraHop system. A high value might indicate a large Redis request or a network delay. The value is

`NaN`

if there is no valid measurement, or if the timing is invalid.
- **reqZeroWnd: Number**: The number of zero windows in the request.
- **roundTripTime: Number**: The median TCP round trip time (RTT), expressed in milliseconds.

An RTT is the time it took for a device to send a single TCP packet and receive an immediate corresponding acknowledgment (ACK) packet.

The median value is calculated by sampling the RTTs observed since the last

`REDIS_REQUEST`

or

`REDIS_RESPONSE`

event ran. The value is

`NaN`

if there are no RTT samples.
- **rspBytes: Number**: The number of

L4

response bytes, excluding L4 protocol overhead, such as ACKs, headers, and retransmissions.
- **rspL2Bytes: Number**: The number of

L2

response bytes, including protocol overhead, such as headers.
- **rspPkts: Number**: The number of response packets.
- **rspRTO: Number**: The number of response

retransmission timeouts

(RTOs).
- **rspTransferTime: Number**: The response transfer time, expressed in milliseconds. If the response is contained in a single packet, the transfer time is zero. If the response spans multiple packets, the value is the amount of time between detection of the first Redis response packet and detection of the last packet by the ExtraHop system. A high value might indicate a large Redis response or a network delay. The value is

`NaN`

if there is no valid measurement, or if the timing is invalid.

Access only on `REDIS_RESPONSE` events; otherwise, an error will occur.
- **rspSize: Number**: The number of L7 response bytes, excluding Redis headers.

Access only on `REDIS_RESPONSE` events; otherwise, an error will occur.
- **rspTimeToFirstByte: Number**: The time from the first byte of the request until the furst byte of the response, expressed in milliseconds. The value is

`NaN`

on malformed and aborted responses, or if the timing is invalid.

Access only on `REDIS_RESPONSE` events; otherwise, an error will occur.
- **rspTimeToLastByte: Number**: The time from the first byte of the request until the last byte of the response, expressed in milliseconds. The value is

`NaN`

on malformed and aborted responses, or if the timing is invalid.

Access only on `REDIS_RESPONSE` events; otherwise, an error will occur.
- **rspZeroWnd: Number**: The number of zero windows in the response.
