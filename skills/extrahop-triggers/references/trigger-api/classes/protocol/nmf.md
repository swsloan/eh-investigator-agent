---
{
  "anchor": "nmf",
  "api_area": "trigger-api",
  "doc_kind": "class",
  "events": [
    "NMF_RECORD"
  ],
  "examples": [],
  "methods": [
    "commitRecord(): void"
  ],
  "name": "NMF",
  "properties": [
    "envelope: Buffer",
    "wireSize: Number",
    "mode: Number",
    "via: String",
    "version: String"
  ],
  "section": "protocol-and-network-data-classes",
  "source_url": "https://docs.extrahop.com/current/extrahop-trigger-api/",
  "source_version": "26.2"
}
---

### NMF

The NET Message Framing Protocol (NMF) class enables you to store metrics and access properties on `NMF_RECORD` events.

#### Events

- **NMF_RECORD**: Runs on every NMF record processed by the device.

#### Methods

- **commitRecord(): void**: Sends a record to the configured recordstore on an

`NMF_RECORD`

event. To view the default properties committed to the record object, see the record property below.

For built-in records, each unique record is committed only once, even if the `commitRecord()` method is called multiple times for the same unique record.

#### Properties

- **envelope: Buffer**: The

[Buffer](#buffer)

object that contains the payload bytes of the message.
- **wireSize: Number**: The length of the raw record as it was observed, expressed in bytes. If the record is compressed, this property reflects the length of the compressed record.
- **mode: Number**: The numeric code for the communication mode. The following codes are valid:

| Code | Description |
| --- | --- |
| `1` | Singleton-Unsized |
| `2` | Duplex |
| `3` | Simplex |
| `4` | Singleton-Sized |
- **via: String**: The URI that subsequent messages will be sent to.
- **version: String**: The version of the NMF protocol.
