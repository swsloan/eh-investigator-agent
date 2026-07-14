---
{
  "anchor": "dicom",
  "api_area": "trigger-api",
  "doc_kind": "class",
  "events": [
    "DICOM_REQUEST",
    "DICOM_RESPONSE"
  ],
  "examples": [],
  "methods": [
    "commitRecord(): void",
    "findElement(groupTag: Number, elementTag: Number): Buffer",
    "groupTag: Number",
    "elementTag: Number"
  ],
  "name": "DICOM",
  "properties": [
    "calledAETitle: String",
    "callingAETitle: String",
    "elements: Array",
    "error: String",
    "isReqAborted: Boolean",
    "isRspAborted: Boolean",
    "isSubOperation: Boolean",
    "methods: Array of Strings",
    "processingTime: Number",
    "record: Object",
    "reqBytes: Number",
    "reqL2Bytes: Number",
    "reqPDU: String",
    "reqPkts: Number",
    "reqRTO: Number",
    "reqSize: Number",
    "reqTransferTime: Number",
    "reqZeroWnd: Number",
    "roundTripTime: Number",
    "rspBytes: Number",
    "rspL2Bytes: Number",
    "rspPDU: String",
    "rspPkts: Number",
    "rspRTO: Number",
    "rspSize: Number",
    "rspTransferTime: Number",
    "rspZeroWnd: Number",
    "version: Number"
  ],
  "section": "protocol-and-network-data-classes",
  "source_url": "https://docs.extrahop.com/current/extrahop-trigger-api/",
  "source_version": "26.2"
}
---

### DICOM

The DICOM (Digital Imaging and Communications in Medicine) class enables you to store metrics and access properties on `DICOM_REQUEST` and `DICOM_RESPONSE` events.

#### Events

- **DICOM_REQUEST**: Runs on every DICOM request processed by the device.
- **DICOM_RESPONSE**: Runs on every DICOM response processed by the device.

#### Methods

- **commitRecord(): void**: Sends a record to the configured recordstore on a

`DICOM_REQUEST`

or

`DICOM_RESPONSE`

event.

The event determines which properties are committed to the record object. To view the default properties committed on each event, see the `record` property below.

For built-in records, each unique record is committed only once, even if the `commitRecord()` method is called multiple times for the same unique record.
- **findElement(groupTag: Number, elementTag: Number): Buffer**: Returns a buffer that contains the DICOM data element specified by the passed group and element tag numbers.

The data element is represented by a unique ordered pair of integers that represent the group tag and element tag numbers. For example, the ordered pair "0008, 0008" represents the "image type" element. A [Registry of DICOM Data Elements](http://dicom.nema.org/dicom/2013/output/chtml/part06/chapter_6.html) and defined tags is available at [dicom.nema.org](http://dicom.nema.org/dicom/2013/output/chtml/part06/chapter_6.html).

- **groupTag: Number**: The first number in the unique ordered pair of integers that represent a specific data element.
- **elementTag: Number**: The second number in the unique ordered pair or integers that represent a specific data element.

#### Properties

- **calledAETitle: String**: The application entity (AE) title of the destination device or program.
- **callingAETitle: String**: The application entity (AE) title of the source device or program.
- **elements: Array**: An array of presentation data values (PDV) command elements and data elements that comprise a DICOM message.
- **error: String**: The detailed error message recorded by the ExtraHop system.
- **isReqAborted: Boolean**: The value is

`true`

if the connection is closed before the DICOM request is complete.

Access only on `DICOM_REQUEST` events; otherwise, an error will occur.
- **isRspAborted: Boolean**: The value is

`true`

if the connection is closed before the DICOM response is complete.

Access only on `DICOM_RESPONSE` events; otherwise, an error will occur.
- **isSubOperation: Boolean**: The value is

`true`

if the timing metric on an

L7

protocol message is not available because the primary request or response is not complete.
- **methods: Array of Strings**: An array of command fields in the message. Each command field specifies a DIMSE operation name, such as N-CREATE-RSP.
- **processingTime: Number**: The server processing time, expressed in milliseconds. The value is

`NaN`

on malformed and aborted responses or if the timing is invalid.

Access only on `DICOM_RESPONSE` events; otherwise, an error will occur.
- **record: Object**: The record object that can be sent to the configured recordstore through a call to

`DICOM.commitRecord()`

on either a

`DICOM_REQUEST`

or

`DICOM_RESPONSE`

event.

The event on which the method was called determines which properties the default record object can contain as displayed in the following table:

| `DICOM_REQUEST` | `DICOM_RESPONSE` |
| --- | --- |
| `calledAETitle` | `calledAETitle` |
| `callingAETitle` | `callingAETitle` |
| `clientIsExternal` | `clientIsExternal` |
| `clientZeroWnd` | `clientZeroWnd` |
| `error` | `error` |
| `isReqAborted` | `isRspAborted` |
| `isSubOperation` | `isSubOperation` |
| `method` | `method` |
| `receiverIsExternal` | `processingTime` |
| `reqPDU` | `receiverIsExternal` |
| `reqSize` | `rspPDU` |
| `reqTransferTime` | `rspSize` |
| `senderIsExternal` | `rspTransferTime` |
| `serverIsExternal` | `senderIsExternal` |
| `serverZeroWnd` | `serverIsExternal` |
| `version` | `serverZeroWnd` |
|  | `version` |
- **reqBytes: Number**: The number of

L4

request bytes, excluding L4 headers.

Access only on `DICOM_REQUEST` events; otherwise, an error will occur.
- **reqL2Bytes: Number**: The number of

L2

request bytes, including L2 headers.
- **reqPDU: String**: The Protocol Data Unit (PDU), or message format, of the request.
- **reqPkts: Number**: The number of request packets.
- **reqRTO: Number**: The number of request

retransmission timeouts

(RTOs).
- **reqSize: Number**: The number of L7 request bytes.

Access only on `DICOM_REQUEST` events; otherwise, an error will occur.
- **reqTransferTime: Number**: The request transfer time, expressed in milliseconds.

Access only on `DICOM_REQUEST` events; otherwise, an error will occur.
- **reqZeroWnd: Number**: The number of zero windows in the request.
- **roundTripTime: Number**: The median round trip time (RTT), expressed in milliseconds.

An RTT is the time it took for a device to send a single TCP packet and receive an immediate corresponding acknowledgment (ACK) packet.

The median value is calculated by sampling the RTTs observed since the last

`DICOM_RESPONSE`

event ran. The value is

`NaN`

if there are no RTT samples.

Access only on `DICOM_RESPONSE` events; otherwise, an error will occur.
- **rspBytes: Number**: The number of

L4

response bytes, excluding L4 protocol overhead, such as ACKs, headers, and retransmissions.

Access only on `DICOM_RESPONSE` events; otherwise, an error will occur.
- **rspL2Bytes: Number**: The number of

L2

response bytes, including protocol overhead, such as headers.
- **rspPDU: String**: The Protocol Data Unit (PDU), or message format, of the response.

Access only on `DICOM_RESPONSE` events; otherwise, an error will occur.
- **rspPkts: Number**: The number of response packets.
- **rspRTO: Number**: The number of response

retransmission timeouts

(RTOs).
- **rspSize: Number**: The number of L7 response bytes.

Access only on `DICOM_RESPONSE` events; otherwise, an error will occur.
- **rspTransferTime: Number**: The response transfer time, expressed in milliseconds.

Access only on `DICOM_RESPONSE` events; otherwise, an error will occur.
- **rspZeroWnd: Number**: The number of zero windows in the response.
- **version: Number**: The DICOM version number.
