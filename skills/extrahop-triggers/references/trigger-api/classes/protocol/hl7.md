---
{
  "anchor": "hl7",
  "api_area": "trigger-api",
  "doc_kind": "class",
  "events": [
    "HL7_REQUEST",
    "HL7_RESPONSE"
  ],
  "examples": [],
  "methods": [
    "commitRecord(): void"
  ],
  "name": "HL7",
  "properties": [
    "ackCode: String",
    "ackId: String",
    "msgId: String",
    "msgType: String",
    "processingTime: Number",
    "record: Object",
    "reqZeroWnd: Number",
    "roundTripTime: Number",
    "rspZeroWnd: Number",
    "segments: Array",
    "name: String",
    "fields: Array of Strings",
    "subfieldDelimiter: String",
    "version: String"
  ],
  "section": "protocol-and-network-data-classes",
  "source_url": "https://docs.extrahop.com/current/extrahop-trigger-api/",
  "source_version": "26.2"
}
---

### HL7

The HL7 class enables you to store metrics and access properties on `HL7_REQUEST` and `HL7_RESPONSE` events.

#### Events

- **HL7_REQUEST**: Runs on every HL7 request processed by the device.
- **HL7_RESPONSE**: Runs on every HL7 response processed by the device.

#### Methods

- **commitRecord(): void**: Sends a record to the configured recordstore on an

`HL7_RESPONSE`

event. Record commits on

`HL7_REQUEST`

events are not supported.

To view the default properties committed to the record object, see the `record` property below.

For built-in records, each unique record is committed only once, even if the `commitRecord()` method is called multiple times for the same unique record.

#### Properties

- **ackCode: String**: The two character acknowledgment code.

Access only on `HL7_RESPONSE` events; otherwise, an error will occur.
- **ackId: String**: The identifier for the message being acknowledged.

Access only on `HL7_RESPONSE` events; otherwise, an error will occur.
- **msgId: String**: The unique identifier for this message.
- **msgType: String**: The entire message type field, including the msgId subfield.
- **processingTime: Number**: The server processing time, expressed in milliseconds. The value is

`NaN`

on malformed and aborted responses or if the timing is invalid.

Access only on `HL7_RESPONSE` events; otherwise, an error will occur.
- **record: Object**: The record object that can be sent to the configured recordstore through a call to

`HL7.commitRecord()`

on an

`HL7_RESPONSE`

event.

The default record object can contain the following properties:

- `ackCode`
- `ackId`
- `clientIsExternal`
- `clientZeroWnd`
- `msgId`
- `msgType`
- `receiverIsExternal`
- `roundTripTime`
- `processingTime`
- `senderIsExternal`
- `serverIsExternal`
- `serverZeroWnd`
- `version`

Access the record object only on `HL7_RESPONSE` events; otherwise, an error will occur.
- **reqZeroWnd: Number**: The number of zero windows in the request.
- **roundTripTime: Number**: The median round trip time (RTT), expressed in milliseconds.

An RTT is the time it took for a device to send a single TCP packet and receive an immediate corresponding acknowledgment (ACK) packet.

The median value is calculated by sampling the RTTs observed since the last

`HL7_RESPONSE`

event ran. The value is

`NaN`

if there are no RTT samples.

Access only on `HL7_RESPONSE` events; otherwise, an error will occur.
- **rspZeroWnd: Number**: The number of zero windows in the response.
- **segments: Array**: An array of segment objects with the following fields:

- **name: String**: The name of the segment.
- **fields: Array of Strings**: The segment field values. Because the indices of the array start at 0, and HL7 field numbers start at 1, the index is the HL7 field number minus 1. For example, to select field 16 of a PRT segment (the participation device ID), specify 15, as shown in the following example code:

```javascript
HL7.segments[5].fields[15]
```

| Note: | If a segment is blank, the array contains an empty string at the segment index. |
| --- | --- |
- **subfieldDelimiter: String**: Supports non-standard field delimiters.
- **version: String**: The version advertised in the MSH segment.

| Note: | The amount of buffered data is limited by the following capture option: `("message_length_max": number)` |
| --- | --- |
