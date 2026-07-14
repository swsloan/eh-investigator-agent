---
{
  "anchor": "mongodb",
  "api_area": "trigger-api",
  "doc_kind": "class",
  "events": [
    "MONGODB_REQUEST",
    "MONGODB_RESPONSE"
  ],
  "examples": [],
  "methods": [
    "commitRecord(): void"
  ],
  "name": "MongoDB",
  "properties": [
    "collection: String",
    "database: String",
    "error: String",
    "isReqAborted: Boolean",
    "isReqTruncated: Boolean",
    "isRspAborted: Boolean",
    "method: String",
    "opcode: String",
    "processingTime: Number",
    "record: Object",
    "reqBytes: Number",
    "reqL2Bytes: Number",
    "reqPkts: Number",
    "reqRTO: Number",
    "reqSize: Number",
    "reqTimeToLastByte: Number",
    "reqZeroWnd: Number",
    "request: Array",
    "roundTripTime: Number",
    "rspBytes: Number",
    "rspL2Bytes: Number",
    "rspPkts: Number",
    "rspRTO: Number",
    "rspSize: Number",
    "rspTimeToFirstByte: Number",
    "rspTimeToLastByte: Number",
    "rspZeroWnd: Number",
    "user: String"
  ],
  "section": "protocol-and-network-data-classes",
  "source_url": "https://docs.extrahop.com/current/extrahop-trigger-api/",
  "source_version": "26.2"
}
---

### MongoDB

The MongoDB class enables you to store metrics and access properties on `MONGODB_REQUEST` and `MONGODB_RESPONSE` events.

#### Events

- **MONGODB_REQUEST**: Runs on every MongoDB request processed by the device.
- **MONGODB_RESPONSE**: Runs on every MongoDB response processed by the device.

#### Methods

- **commitRecord(): void**: Sends a record to the configured recordstore on either a

`MONGODB_REQUEST`

or

`MONGODB_RESPONSE`

event.

The event determines which properties are committed to the record object. To view the default properties committed for each event, see the `record` property below.

For built-in records, each unique record is committed only once, even if the `commitRecord()` method is called multiple times for the same unique record.

#### Properties

- **collection: String**: The name of the database collection specified in the current request.
- **database: String**: The MongoDB database instance. In some cases, such as when login events are encrypted, the database name is not available.
- **error: String**: The detailed error message recorded by the ExtraHop system.

Access only on `MONGODB_RESPONSE` events; otherwise, an error will occur.
- **isReqAborted: Boolean**: The value is

`true`

if the connection is closed before the MongoDB request was complete.
- **isReqTruncated: Boolean**: The value is

`true`

if the request document(s) size is greater than the maximum payload document size.
- **isRspAborted: Boolean**: The value is

`true`

if the connection is closed before the MongoDB response was complete.

Access only on `MONGODB_RESPONSE` events; otherwise, an error will occur.
- **method: String**: The MongoDB database method (appears under

Methods

in the user interface).
- **opcode: String**: The MongoDB operational code on the wire protocol, which might differ from the MongoDB method used.
- **processingTime: Number**: The time to process the request, expressed in milliseconds (equivalent to

`rspTimeToFirstByte`

-

`reqTimeToLastByte`

). The value is

`NaN`

on malformed and aborted responses or if the timing is invalid.

Access only on `MONGODB_RESPONSE` events; otherwise, an error will occur.
- **record: Object**: The record object that can be sent to the configured recordstore through a call to

`MongoDB.commitRecord()`

on either a

`MONGODB_REQUEST`

or

`MONGODB_RESPONSE`

event.

The event on which the method was called determines which properties the default record object can contain as displayed in the following table:

| `MONGODB_REQUEST` | `MONGODB_RESPONSE` |
| --- | --- |
| `clientIsExternal` | `clientIsExternal` |
| `clientZeroWnd` | `clientZeroWnd` |
| `collection` | `collection` |
| `database` | `database` |
| `isReqAborted` | `error` |
| `isReqTruncated` | `isRspAborted` |
| `method` | `method` |
| `opcode` | `opcode` |
| `receiverIsExternal` | `processingTime` |
| `reqBytes` | `receiverIsExternal` |
| `reqL2Bytes` | `roundTripTime` |
| `reqPkts` | `rspBytes` |
| `reqRTO` | `rspL2Bytes` |
| `reqSize` | `rspPkts` |
| `reqTimeToLastByte` | `rspRTO` |
| `senderIsExternal` | `rspSize` |
| `serverIsExternal` | `rspTimeToFirstByte` |
| `serverZeroWnd` | `rspTimeToLastByte` |
| `user` | `senderIsExternal` |
|  | `serverIsExternal` |
|  | `serverZeroWnd` |
|  | `user` |
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
- **reqSize: Number**: The number of L7 request bytes, excluding MongoDB headers.
- **reqTimeToLastByte: Number**: The time from the first byte of the request until the last byte of the request, expressed in milliseconds.
- **reqZeroWnd: Number**: The number of zero windows in the request.
- **request: Array**: An array of JS objects parsed from MongoDB request payload documents. Total document size is limited to 4K.

If BSON documents are truncated, `isReqTruncated` flag is set. Truncated values are represented as follows:

- Primitive string values like code, code with scope, and binary data are partially extracted.
- Objects and Arrays are partially extracted.
- All other primitive values like Numbers, Dates, RegExp, etc., are substituted with `null` .

If no documents are included in the request, an empty array is returned.

The value of the `request` property is the same when accessed on either the `MONGODB_REQUEST` or the `MONGODB_RESPONSE` event.
- **roundTripTime: Number**: The median round trip time (RTT), expressed in milliseconds.

An RTT is the time it took for a device to send a single TCP packet and receive an immediate corresponding acknowledgment (ACK) packet.

The median value is calculated by sampling the RTTs observed since the last

`MONGODB_REQUEST`

or

`MONGODB_RESPONSE`

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
- **rspSize: Number**: The number of L7 response bytes, excluding MongoDB headers.

Access only on `MONGODB_RESPONSE` events; otherwise, an error will occur.
- **rspTimeToFirstByte: Number**: The time from the first byte of the request until the first byte of the response, expressed in milliseconds. The value is

`NaN`

on malformed and aborted responses, or if the timing is invalid.

Access only on `MONGODB_RESPONSE` events; otherwise, an error will occur.
- **rspTimeToLastByte: Number**: The time from the first byte of the request until the last by of the response, expressed in milliseconds. The value is

`NaN`

on malformed and aborted responses, or if the timing is invalid.

Access only on `MONGODB_RESPONSE` events; otherwise, an error will occur.
- **rspZeroWnd: Number**: The number of zero windows in the response.
- **user: String**: The user name, if available. In some cases, such as when login events are encrypted, the user name is not available.
