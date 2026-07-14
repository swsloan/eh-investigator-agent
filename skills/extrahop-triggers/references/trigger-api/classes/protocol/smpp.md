---
{
  "anchor": "smpp",
  "api_area": "trigger-api",
  "doc_kind": "class",
  "events": [
    "SMPP_REQUEST",
    "SMPP_RESPONSE"
  ],
  "examples": [],
  "methods": [
    "commitRecord(): void"
  ],
  "name": "SMPP",
  "properties": [
    "command: String",
    "destination: String",
    "error: String",
    "message: Buffer",
    "processingTime: Number",
    "record: Object",
    "reqSize: Number",
    "reqTimeToLastByte: Number",
    "rspSize: Number",
    "rspTimeToFirstByte: Number",
    "rspTimeToLastByte: Number",
    "source: String"
  ],
  "section": "protocol-and-network-data-classes",
  "source_url": "https://docs.extrahop.com/current/extrahop-trigger-api/",
  "source_version": "26.2"
}
---

### SMPP

The SMPP class enables you to store metrics and access properties on `SMPP_REQUEST` and `SMPP_RESPONSE` events.

| Note: | The `mdn`, `shortcode`, and `error` properties may be `null`, depending on availability and relevance. |
| --- | --- |

#### Events

- **SMPP_REQUEST**: Runs on every SMPP request processed by the device.
- **SMPP_RESPONSE**: Runs on every SMPP response processed by the device.

#### Methods

- **commitRecord(): void**: Sends a record to the configured recordstore on a

`SMPP_RESPONSE`

event. Record commits on

`SMPP_REQUEST`

events are not supported.

To view the default properties committed to the record object, see the `record` property below.

For built-in records, each unique record is committed only once, even if the `commitRecord()` method is called multiple times for the same unique record.

#### Properties

- **command: String**: The SMPP command ID.
- **destination: String**: The destination address as specified in the

`SMPP_REQUEST`

. The value is

`null`

if this is not available for the current command type.
- **error: String**: The error code corresponding to command_status. If the command status is ROK, the value is

`null`

.

Access only on `SMPP_RESPONSE` events; otherwise, an error will occur.
- **message: Buffer**: The contents of the short_message field on DELIVER_SM and SUBMIT_SM messages. The value is

`null`

if unavailable or not applicable.

Access only on `SMPP_REQUEST` events; otherwise, an error will occur.
- **processingTime: Number**: The server processing time, expressed in milliseconds. Equivalent to

`rspTimeToFirstByte`

-

`reqTimeToLastByte`

. The value is

`NaN`

on malformed and aborted responses or if the timing is invalid.

Access only on `SMPP_RESPONSE` events; otherwise, an error will occur.
- **record: Object**: The record object that can be sent to the configured recordstore through a call to

`SMPP.commitRecord()`

on a

`SMPP_RESPONSE`

event.

The default record object can contain the following properties:

- `clientIsExternal`
- `clientZeroWnd`
- `command`
- `destination`
- `error`
- `receiverIsExternal`
- `reqSize`
- `reqTimeToLastByte`
- `rspSize`
- `rspTimeToFirstByte`
- `rspTimeToLastByte`
- `senderIsExternal`
- `serverIsExternal`
- `serverZeroWnd`
- `source`
- `processingTime`
- **reqSize: Number**: The number of L7 request bytes, excluding SMPP headers.
- **reqTimeToLastByte: Number**: The time from the first byte of the request until the last byte of the request, expressed in milliseconds. The value is

`NaN`

on malformed and aborted requests, or if the timing is invalid.
- **rspSize: Number**: The number of L7 response bytes, excluding SMPP headers.

Access only on `SMPP_RESPONSE` events; otherwise, an error will occur.
- **rspTimeToFirstByte: Number**: The time from the first byte of the request until the first byte of the response, expressed in milliseconds. The value is

`NaN`

on malformed and aborted responses, or if the timing is invalid.

Access only on `SMPP_RESPONSE` events; otherwise, an error will occur.
- **rspTimeToLastByte: Number**: The time from the first byte of the request until the last byte of the response, expressed in milliseconds. The value is

`NaN`

on malformed and aborted responses, or if the timing is invalid.

Access only on `SMPP_RESPONSE` events; otherwise, an error will occur.
- **source: String**: The source address as specified in the

`SMPP_REQUEST`

. The value is

`null`

if this is not available for the current command type.
