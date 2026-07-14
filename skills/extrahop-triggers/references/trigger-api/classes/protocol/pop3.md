---
{
  "anchor": "pop3",
  "api_area": "trigger-api",
  "doc_kind": "class",
  "events": [
    "POP3_REQUEST",
    "POP3_RESPONSE"
  ],
  "examples": [],
  "methods": [
    "commitRecord(): void"
  ],
  "name": "POP3",
  "properties": [
    "dataSize: Number",
    "error: String",
    "isEncrypted: Boolean",
    "isReqAborted: Boolean",
    "isRspAborted: Boolean",
    "method: String",
    "processingTime: Number",
    "recipientList: Array",
    "record: Object",
    "reqBytes: Number",
    "reqL2Bytes: Number",
    "reqPkts: Number",
    "reqRTO: Number",
    "reqSize: Number",
    "reqTimeToLastByte: Number",
    "reqZeroWnd: Number",
    "roundTripTime: Number",
    "rspBytes: Number",
    "rspL2Bytes: Number",
    "rspPkts: Number",
    "rspRTO: Number",
    "rspSize: Number",
    "rspTimeToFirstByte: Number",
    "rspTimeToLastByte: Number",
    "rspZeroWnd: Number",
    "sender: String",
    "status: String"
  ],
  "section": "protocol-and-network-data-classes",
  "source_url": "https://docs.extrahop.com/current/extrahop-trigger-api/",
  "source_version": "26.2"
}
---

### POP3

The POP3 class enables you to store metrics and access properties on `POP3_REQUEST` and `POP3_RESPONSE` events.

#### Events

- **POP3_REQUEST**: Runs on every POP3 request processed by the device.
- **POP3_RESPONSE**: Runs on every POP3 response processed by the device.

#### Methods

- **commitRecord(): void**: Sends a record to the configured recordstore on a

`POP3_RESPONSE`

event. Record commits on

`POP3_REQUEST`

events are not supported.

To view the default properties committed to the record object, see the `record` property below.

For built-in records, each unique record is committed only once, even if the `commitRecord()` method is called multiple times for the same unique record.

#### Properties

- **dataSize: Number**: The size of the message, expressed in bytes.

Access only on `POP3_RESPONSE` events; otherwise, an error will occur.
- **error: String**: The detailed error message recorded by the ExtraHop system.

Access only on `POP3_RESPONSE` events; otherwise, an error will occur.
- **isEncrypted: Boolean**: The value is

`true`

if the transaction is over a secure POP3 server.
- **isReqAborted: Boolean**: The value is

`true`

if the connection is closed before the POP3 request was complete.
- **isRspAborted: Boolean**: The value is

`true`

if the connection is closed before the POP3 response was complete.

Access only on `POP3_RESPONSE` events; otherwise, an error will occur.
- **method: String**: The POP3 method such as RETR or DELE.
- **processingTime: Number**: The server processing time, expressed in milliseconds. The value is

`NaN`

on malformed and aborted responses or if the timing is invalid.

Access only on `POP3_RESPONSE` events; otherwise, an error will occur.
- **recipientList: Array**: An array that contains a list of recipient addresses.

Access only on `POP3_RESPONSE` events; otherwise, an error will occur.
- **record: Object**: The record object that can be sent to the configured recordstore through a call to

`POP3.commitRecord()`

on a

`POP3_RESPONSE`

event.

The default record object can contain the following properties:

- `clientIsExternal`
- `clientZeroWnd`
- `dataSize`
- `error`
- `isEncrypted`
- `isReqAborted`
- `isRspAborted`
- `method`
- `processingTime`
- `receiverIsExternal`
- `recipientList`
- `reqSize`
- `reqTimeToLastByte`
- `rspSize`
- `rspTimeToFirstByte`
- `rspTimeToLastByte`
- `sender`
- `senderIsExternal`
- `serverIsExternal`
- `serverZeroWnd`
- `statusCode`

Access the record object only on `POP3_RESPONSE` events; otherwise, an error will occur.
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
- **reqSize: Number**: The number of L7 request bytes, excluding POP3 headers.
- **reqTimeToLastByte: Number**: The time from the first byte of the request until the last byte of the request, expressed in milliseconds. The value is

`NaN`

on expired requests and responses, or if the timing is invalid.
- **reqZeroWnd: Number**: The number of zero windows in the request.
- **roundTripTime: Number**: The median TCP round trip time (RTT), expressed in milliseconds.

An RTT is the time it took for a device to send a single TCP packet and receive an immediate corresponding acknowledgment (ACK) packet.

The median value is calculated by sampling the RTTs observed since the last

`POP3_RESPONSE`

event ran. The value is

`NaN`

if there are no RTT samples.

Access only on `POP3_RESPONSE` events; otherwise, an error will occur.
- **rspBytes: Number**: The number of

L4

response bytes, excluding L4 protocol overhead, such as ACKs, headers, and retransmissions.

Access only on `POP3_RESPONSE` events; otherwise, an error will occur.
- **rspL2Bytes: Number**: The number of

L2

response bytes, including protocol overhead, such as headers.

Access only on `POP3_RESPONSE` events; otherwise, an error will occur.
- **rspPkts: Number**: The number of response packets.

Access only on `POP3_RESPONSE` events; otherwise, an error will occur.
- **rspRTO: Number**: The number of response

retransmission timeouts

(RTOs).

Access only on `POP3_RESPONSE` events; otherwise, an error will occur.
- **rspSize: Number**: The number of L7 response bytes, excluding POP3 headers.

Access only on `POP3_RESPONSE` events; otherwise, an error will occur.
- **rspTimeToFirstByte: Number**: The time from the first byte of the request until the furst byte of the response, expressed in milliseconds. The value is

`NaN`

on malformed and aborted responses, or if the timing is invalid.

Access only on `POP3_RESPONSE` events; otherwise, an error will occur.
- **rspTimeToLastByte: Number**: The time from the first byte of the request until the last byte of the response, expressed in milliseconds. The value is

`NaN`

on malformed and aborted responses, or if the timing is invalid.

Access only on `POP3_RESPONSE` events; otherwise, an error will occur.
- **rspZeroWnd: Number**: The number of zero windows in the response.
- **sender: String**: The address of the sender of the message.

Access only on `POP3_RESPONSE` events; otherwise, an error will occur.
- **status: String**: The POP3 status message of the response which can be

`OK`

,

`ERR`

or

`NULL`

.

Access only on `POP3_RESPONSE` events; otherwise, an error will occur.
