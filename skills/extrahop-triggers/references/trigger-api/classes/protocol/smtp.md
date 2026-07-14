---
{
  "anchor": "smtp",
  "api_area": "trigger-api",
  "doc_kind": "class",
  "events": [
    "SMTP_OPEN",
    "SMTP_REQUEST",
    "SMTP_RESPONSE"
  ],
  "examples": [],
  "methods": [
    "commitRecord(): void"
  ],
  "name": "SMTP",
  "properties": [
    "dataSize: Number",
    "domain: String",
    "error: String",
    "headers: Object",
    "isEncrypted: Boolean",
    "isReqAborted: Boolean",
    "isRspAborted: Boolean",
    "method: String",
    "processingTime: Number",
    "recipientList: Array of Strings",
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
    "statusCode: Number",
    "statusText: String"
  ],
  "section": "protocol-and-network-data-classes",
  "source_url": "https://docs.extrahop.com/current/extrahop-trigger-api/",
  "source_version": "26.2"
}
---

### SMTP

The SMTP class enables you to store metrics and access properties on `SMTP_REQUEST` and `SMTP_RESPONSE` events.

#### Events

- **SMTP_OPEN**: Runs on every SMTP greeting processed by the device.
- **SMTP_REQUEST**: Runs on every SMTP request processed by the device.
- **SMTP_RESPONSE**: Runs on every SMTP response processed by the device.

#### Methods

- **commitRecord(): void**: Sends a record to the configured recordstore on a

`SMTP_RESPONSE`

event. Record commits on

`SMTP_REQUEST`

events are not supported.

To view the default properties committed to the record object, see the `record` property below.

For built-in records, each unique record is committed only once, even if the `commitRecord()` method is called multiple times for the same unique record.

#### Properties

- **dataSize: Number**: The size of the attachment, expressed in bytes.
- **domain: String**: The domain of the address the message is coming from.
- **error: String**: The error code corresponding to status code.

Access only on `SMTP_RESPONSE` events; otherwise, an error will occur.
- **headers: Object**: An object that enables access to SMTP header names and values.

The value of the `headers` property is the same when accessed on either the `SMTP_REQUEST` or the `SMTP_RESPONSE` event.
- **isEncrypted: Boolean**: The value is

`true`

if the application is encrypted with STARTTLS.
- **isReqAborted: Boolean**: The value is

`true`

if the connection is closed before the SMTP request is complete.
- **isRspAborted: Boolean**: The value is

`true`

if the connection is closed before the SMTP response is complete.

Access only on `SMTP_RESPONSE` events; otherwise, an error will occur.
- **method: String**: The SMTP method.
- **processingTime: Number**: The server processing time, expressed in milliseconds. Equivalent to

`rspTimeToFirstByte`

-

`reqTimeToLastByte`

. The value is

`NaN`

on malformed and aborted responses or if the timing is invalid.

Access only on `SMTP_RESPONSE` events; otherwise, an error will occur.
- **recipientList: Array of Strings**: A list of recipient addresses.

The value of the `recipientList` property is the same when accessed on either the `SMTP_REQUEST` or the `SMTP_RESPONSE` event.
- **record: Object**: The record object that can be sent to the configured recordstore through a call to

`SMTP.commitRecord()`

on a

`SMTP_RESPONSE`

event.

The default record object can contain the following properties:

- `clientIsExternal`
- `clientZeroWnd`
- `dataSize`
- `domain`
- `error`
- `isEncrypted`
- `isReqAborted`
- `isRspAborted`
- `method`
- `processingTime`
- `receiverIsExternal`
- `recipient`
- `recipientList`
- `reqBytes`
- `reqL2Bytes`
- `reqPkts`
- `reqRTO`
- `reqSize`
- `reqTimeToLastByte`
- `roundTripTime`
- `rspBytes`
- `rspL2Bytes`
- `rspPkts`
- `rspRTO`
- `rspSize`
- `rspTimeToFirstByte`
- `rspTimeToLastByte`
- `sender`
- `senderIsExternal`
- `serverIsExternal`
- `serverZeroWnd`
- `statusCode`
- `statusText`

Access the record object only on `SMTP_RESPONSE` events; otherwise, an error will occur.
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
- **reqSize: Number**: The number of L7 request bytes, excluding SMTP headers.
- **reqTimeToLastByte: Number**: The time from the first byte of the request until the last byte of the request, expressed in milliseconds. The value is

`NaN`

on malformed and aborted requests, or if the timing is invalid.
- **reqZeroWnd: Number**: The number of zero windows in the request.
- **roundTripTime: Number**: The median TCP round trip time (RTT), expressed in milliseconds.

An RTT is the time it took for a device to send a single TCP packet and receive an immediate corresponding acknowledgment (ACK) packet.

The median value is calculated by sampling the RTTs observed since the last

`SMTP_RESPONSE`

event ran. The value is

`NaN`

if there are no RTT samples.

Access only on `SMTP_RESPONSE` events; otherwise, an error will occur.
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
- **rspSize: Number**: The number of L7 response bytes, excluding SMTP headers.

Access only on `SMTP_RESPONSE` events; otherwise, an error will occur.
- **rspTimeToFirstByte: Number**: The time from the first byte of the request until the first byte of the response, expressed in milliseconds. The value is

`NaN`

on malformed and aborted responses, or if the timing is invalid.

Access only on `SMTP_RESPONSE` events; otherwise, an error will occur.
- **rspTimeToLastByte: Number**: The time from the first byte of the request until the last byte of the response, expressed in milliseconds. The value is

`NaN`

on malformed and aborted responses, or if the timing is invalid.

Access only on `SMTP_RESPONSE` events; otherwise, an error will occur.
- **rspZeroWnd: Number**: The number of zero windows in the response.
- **sender: String**: The sender of the message.
- **statusCode: Number**: The SMTP status code of the response or greeting.

Access only on `SMTP_RESPONSE` or `SMTP_OPEN` events; otherwise, an error will occur.
- **statusText: String**: The multi-line response or greeting string.

Access only on `SMTP_RESPONSE` or `SMTP_OPEN` events; otherwise, an error will occur.
