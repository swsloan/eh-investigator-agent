---
{
  "anchor": "dnp3",
  "api_area": "trigger-api",
  "doc_kind": "class",
  "events": [
    "DNP3_REQUEST",
    "DNP3_RESPONSE"
  ],
  "examples": [],
  "methods": [
    "commitRecord(): void"
  ],
  "name": "DNP3",
  "properties": [
    "control: Number",
    "dstAddr: Number",
    "record: Object",
    "reqPayload: Buffer",
    "rspPayload: Buffer",
    "srcAddr: Number"
  ],
  "section": "protocol-and-network-data-classes",
  "source_url": "https://docs.extrahop.com/current/extrahop-trigger-api/",
  "source_version": "26.2"
}
---

### DNP3

The Distributed Network Protocol (DNP3) class enables you to store metrics and access properties on `DNP3_REQUEST` and `DNP3_RESPONSE` events.

#### Events

- **DNP3_REQUEST**: Runs on every DNP3 request processed by the device.
- **DNP3_RESPONSE**: Runs on every DNP3 response processed by the device.

#### Methods

- **commitRecord(): void**: Sends a record to the configured recordstore on a

`DNP3_RESPONSE`

event. Record commits on

`DNP3_REQUEST`

events are not supported.To view the default properties committed to the record object, see the record property below.

For built-in records, each unique record is committed only once, even if the `commitRecord()` method is called multiple times for the same unique record.

#### Properties

- **control: Number**: The numeric code that specifies control flags for the request or response.
- **dstAddr: Number**: The address of the station that the request or response is being sent to.
- **record: Object**: The record object that can be sent to the configured recordstore through a call to

`DNP3.commitRecord()`

on a

`DNP3_RESPONSE`

event.

The default record object can contain the following properties:

- `application`
- `client`
- `clientAddr`
- `clientIsExternal`
- `clientPort`
- `control`
- `dstAddr`
- `flowId`
- `receiverIsExternal`
- `senderIsExternal`
- `server`
- `serverAddr`
- `serverIsExternal`
- `serverPort`
- `srcAddr`
- `vlan`

Access only on `DNP3_RESPONSE` events; otherwise, an error will occur.
- **reqPayload: Buffer**: A

[Buffer](#buffer)

object that contains the raw payload bytes of the request.
- **rspPayload: Buffer**: A

[Buffer](#buffer)

object that contains the raw payload bytes of the response.

Access only on `DNP3_RESPONSE` events; otherwise, an error will occur.
- **srcAddr: Number**: The address of the station that the request or response is being sent from.
