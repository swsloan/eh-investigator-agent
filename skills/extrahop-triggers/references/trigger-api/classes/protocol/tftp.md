---
{
  "anchor": "tftp",
  "api_area": "trigger-api",
  "doc_kind": "class",
  "events": [
    "TFTP_REQUESTS",
    "TFTP_RESPONSE"
  ],
  "examples": [],
  "methods": [
    "commitRecord(): void"
  ],
  "name": "TFTP",
  "properties": [
    "blocks: Number",
    "error: String | null",
    "fileComplete: Boolean",
    "filename: String",
    "mode: String",
    "operation: String",
    "payload: Buffer",
    "payloadMediaType: String",
    "payloadSHA256: String",
    "size: Number"
  ],
  "section": "protocol-and-network-data-classes",
  "source_url": "https://docs.extrahop.com/current/extrahop-trigger-api/",
  "source_version": "26.2"
}
---

### TFTP

The TFTP (Trivial File Transfer Protocol) class enables you to store metrics and access properties on `TFTP_REQUEST` and `TFTP_RESPONSE` events.

#### Events

- **TFTP_REQUESTS**: Runs on every TFTP request processed by the device.
- **TFTP_RESPONSE**: Runs on every TFTP response processed by the device.

#### Methods

- **commitRecord(): void**: Sends a record to the configured recordstore on a

`TFTP_RESPONSE`

event. Record commits on

`TFTP_REQUEST`

events are not supported.

To view the default properties committed to the record object, see the `record` property below.

For built-in records, each unique record is committed only once, even if the `commitRecord()` method is called multiple times for the same unique record.

#### Properties

- **blocks: Number**: The number of data blocks written or read.

Access only on `TFTP_RESPONSE` events; otherwise, an error will occur.
- **error: String | null**: The detailed error message recorded by the ExtraHop system.

Access only on `TFTP_RESPONSE` events; otherwise, an error will occur.
- **fileComplete: Boolean**: If the value is

`false`

, only part of the file was transferred, either because the client timed out during a write operation or the server timed out during a read operation.

Access only on `TFTP_RESPONSE` events; otherwise, an error will occur.
- **filename: String**: The name of the file transferred.
- **mode: String**: The mode that the file was transferred with. The following values are valid:

- `netascii`
- `octet`
- `mail`
- **operation: String**: The TFTP operation. The following values are valid:

- `READ`
- `WRITE`
- **payload: Buffer**: The

[Buffer](#buffer)

object that contains the raw payload bytes of the first data block transferred. The maximum size of a block is 512 bytes.
- **payloadMediaType: String**: The type of file transferred.

Access only on `TFTP_RESPONSE` events; otherwise, an error will occur.
- **payloadSHA256: String**: The hexadecimal representation of the SHA-256 hash of the payload. The string contains no delimiters, as shown in the following example:

```javascript
468c6c84db844821c9ccb0983c78d1cc05327119b894b5ca1c6a1318784d3675
```

Access only on `TFTP_RESPONSE` events; otherwise, an error will occur.
- **size: Number**: The size of the file transferred, expressed in bytes.

Access only on `TFTP_RESPONSE` events; otherwise, an error will occur.
