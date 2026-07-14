---
{
  "anchor": "llmnr",
  "api_area": "trigger-api",
  "doc_kind": "class",
  "events": [
    "LLMNR_REQUEST",
    "LLMNR_RESPONSE"
  ],
  "examples": [],
  "methods": [
    "commitRecord(): void"
  ],
  "name": "LLMNR",
  "properties": [
    "answer: Object",
    "data: String | IPAddress",
    "name: String",
    "ttl: Number",
    "type: String",
    "error: String",
    "errorNum: Number",
    "opcode: String",
    "opcodeNum: Number",
    "qname: String",
    "qtype: String",
    "qtypeNum: Number",
    "record: Object",
    "reqBytes: Number",
    "reqL2Bytes: Number",
    "reqPkts: Number",
    "rspBytes: Number",
    "rspL2Bytes: Number",
    "rspPkts: Number"
  ],
  "section": "protocol-and-network-data-classes",
  "source_url": "https://docs.extrahop.com/current/extrahop-trigger-api/",
  "source_version": "26.2"
}
---

### LLMNR

The `LLMNR` class enables you to store metrics and access properties on `LLMNR_REQUEST` and `LLMNR_RESPONSE` events.

#### Events

- **LLMNR_REQUEST**: Runs on every LLMNR request processed by the device.
- **LLMNR_RESPONSE**: Runs on every LLMNR response processed by the device.

#### Methods

- **commitRecord(): void**: Sends a record to the configured recordstore on an

`LLMNR_REQUEST`

or

`LLMNR_RESPONSE`

event.

The event determines which properties are committed to the record object. To view the default properties committed to the record object, see the `record` property below.

For built-in records, each unique record is committed only once, even if the `commitRecord()` method is called multiple times for the same unique record.

#### Properties

- **answer: Object**: An object that corresponds to an answer resource record.

Access only on `LLMNR_RESPONSE` events; otherwise, an error will occur.

The objects contain the following properties:

- **data: String | IPAddress**: The value of data depends on the type. The value is

`null`

for unsupported record types. Supported record types include:

- `A`
- `AAAA`
- `NS`
- `PTR`
- `CNAME`
- `MX`
- `SRV`
- `SOA`
- `TXT`
- **name: String**: The record name.
- **ttl: Number**: The time-to-live value.
- **type: String**: The LLMNR record type.
- **error: String**: The name of the LLMNR error code, in accordance with IANA LLMNR parameters.

Returns OTHER for error codes that are unrecognized by the system; however, `errorNum` specifies the numeric code value.

Access only on `LLMNR_RESPONSE` events; otherwise, an error will occur.
- **errorNum: Number**: The numeric representation of the LLMNR error code in accordance with IANA LLMNR parameters.

Access only on `LLMNR_RESPONSE` events; otherwise, an error will occur.
- **opcode: String**: The name of the LLMNR operation code in accordance with IANA LLMNR parameters. The following codes are recognized by the ExtraHop system:

| OpCode | Name |
| --- | --- |
| `0` | `Query` |
| `1` | `IQuery (Inverse Query - Obsolete)` |
| `2` | `Status` |
| `3` | `Unassigned` |
| `4` | `Notify` |
| `5` | `Update` |
| `6-15` | `Unassigned` |

Returns OTHER for codes that are unrecognized by the system; however, the `opcodeNum` property specifies the numeric code value.
- **opcodeNum: Number**: The numeric representation of the LLMNR operation code in accordance with IANA LLMNR parameters.
- **qname: String**: The hostname queried.
- **qtype: String**: The name of the LLMNR request record type in accordance with IANA LLMNR parameters.

Returns OTHER for types that are unrecognized by the system; however, the `qtypeNum` property specifies the numeric type value.
- **qtypeNum: Number**: The numeric representation of the LLMNR request record type in accordance with IANA LLMNR parameters.
- **record: Object**: The record object that can be sent to the configured recordstore through a call to

`LLMNR.commitRecord()`

on either an

`LLMNR_REQUEST`

or

`LLMNR_RESPONSE`

event.

The default record object can contain the following properties:

| `LLMNR_REQUEST` | `LLMNR_RESPONSE` |
| --- | --- |
| `clientIsExternal` | `answer` |
| `opcode` | `clientIsExternal` |
| `qname` | `error` |
| `qtype` | `opcode` |
| `receiverIsExternal` | `qname` |
| `reqBytes` | `qtype` |
| `reqL2Bytes` | `receiverIsExternal` |
| `reqPkts` | `rspBytes` |
| `senderIsExternal` | `rspL2Bytes` |
| `serverIsExternal` | `rspPkts` |
|  | `senderIsExternal` |
|  | `serverIsExternal` |
- **reqBytes: Number**: The number of

L4

request bytes, excluding L4 headers.

Access only on `LLMNR_REQUEST` events; otherwise, an error will occur.
- **reqL2Bytes: Number**: The number of

L2

request bytes, including L2 headers.

Access only on `LLMNR_REQUEST` events; otherwise, an error will occur.
- **reqPkts: Number**: The number of request packets.

Access only on `LLMNR_REQUEST` events; otherwise, an error will occur.
- **rspBytes: Number**: The number of

L4

response bytes, excluding L4 protocol overhead, such as ACKs, headers, and retransmissions.

Access only on `LLMNR_RESPONSE` events; otherwise, an error will occur.
- **rspL2Bytes: Number**: The number of

L2

response bytes, including protocol overhead, such as headers.

Access only on `LLMNR_RESPONSE` events; otherwise, an error will occur.
- **rspPkts: Number**: The number of application-level response bytes.

Access only on `LLMNR_RESPONSE` events; otherwise, an error will occur.
