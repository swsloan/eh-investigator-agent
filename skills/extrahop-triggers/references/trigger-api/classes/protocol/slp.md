---
{
  "anchor": "slp",
  "api_area": "trigger-api",
  "doc_kind": "class",
  "events": [
    "SLP_MESSAGE"
  ],
  "examples": [],
  "methods": [
    "commitRecord(): void"
  ],
  "name": "SLP",
  "properties": [
    "attrList: String | null",
    "functionId: Number",
    "msgType: String",
    "record: Object",
    "scopeList: String | null"
  ],
  "section": "protocol-and-network-data-classes",
  "source_url": "https://docs.extrahop.com/current/extrahop-trigger-api/",
  "source_version": "26.2"
}
---

### SLP

The `SLP` class enables you to store metrics and access properties on `SLP_MESSAGE` events.

#### Events

- **SLP_MESSAGE**: Runs on every SLP message processed by the device.

#### Methods

- **commitRecord(): void**: Sends a record to the configured recordstore on an

`SLP_MESSAGE`

event.

To view the default properties committed, see the `record` property below.

For built-in records, each unique record is committed only once, even if the `commitRecord()` method is called multiple times for the same record.

#### Properties

- **attrList: String | null**: The attributes for the SLP message, in a comma-separated list.
- **functionId: Number**: The numeric function ID of the SLP message, which corresponds to the message type string.
- **msgType: String**: The SLP message type string, which corresponds to the numeric function ID as shown in the following table:

| Message Type | Function ID |
| --- | --- |
| `Service Request` | `1` |
| `Service Reply` | `2` |
| `Service Registration` | `3` |
| `Service Deregister` | `4` |
| `Service Acknowledge` | `5` |
| `Attribute Request` | `6` |
| `Attribute Reply` | `7` |
| `DA Advertisement` | `8` |
| `Service Type Request` | `9` |
| `Service Type Reply` | `10` |
| `SA Advertisement` | `11` |
- **record: Object**: The record object that can be sent to the configured recordstore through a call to

`SLP.commitRecord()`

on an SLP_MESSAGE event. The default record object can contain the following properties:

- `clientIsExternal`
- `functionId`
- `msgType`
- `receiverIsExternal`
- `scopeList`
- `senderIsExternal`
- `serverIsExternal`
- **scopeList: String | null**: The scope for the SLP message, in a comma-separated list.
