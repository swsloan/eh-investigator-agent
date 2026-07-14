---
{
  "anchor": "aaa",
  "api_area": "trigger-api",
  "doc_kind": "class",
  "events": [
    "AAA_REQUEST",
    "AAA_RESPONSE"
  ],
  "examples": [],
  "methods": [
    "commitRecord(): void"
  ],
  "name": "AAA",
  "properties": [
    "authenticator: String",
    "avps: Array",
    "avpLength: Number",
    "id: Number",
    "isGrouped: Boolean",
    "name: String",
    "vendor: String",
    "value: String | Array | Number",
    "isDiameter: Boolean",
    "isError: Boolean",
    "isRadius: Boolean",
    "isRspAborted: Boolean",
    "method: Number",
    "processingTime: Number",
    "record: Object",
    "reqBytes: Number",
    "reqL2Bytes: Number",
    "reqPkts: Number",
    "reqRTO: Number",
    "reqZeroWnd: Number",
    "roundTripTime: Number",
    "rspBytes: Number",
    "rspL2Bytes: Number",
    "rspPkts: Number",
    "rspRTO: Number",
    "rspZeroWnd: Number",
    "statusCode: String",
    "txId: Number"
  ],
  "section": "protocol-and-network-data-classes",
  "source_url": "https://docs.extrahop.com/current/extrahop-trigger-api/",
  "source_version": "26.2"
}
---

### AAA

The AAA (Authentication, Authorization, and Accounting) class enables you to store metrics and access properties on `AAA_REQUEST` or `AAA_RESPONSE` events.

#### Events

- **AAA_REQUEST**: Runs when the ExtraHop system finishes processing an AAA request .
- **AAA_RESPONSE**: Runs on every AAA response processed by the device.

#### Methods

- **commitRecord(): void**: Sends a record to the configured recordstore on either an

`AAA_REQUEST`

or

`AAA_RESPONSE`

event.

The event determines which properties are committed to the record object. To view the default properties committed on each event, see the `record` property below.

For built-in records, each unique record is committed only once, even if the `commitRecord()` method is called multiple times for the same unique record.

#### Properties

- **authenticator: String**: The value of the authenticator field (RADIUS only).
- **avps: Array**: An array of AVP objects with the following properties:

- **avpLength: Number**: The size of the AVP, expressed in bytes. This value includes the AVP header data, as well as the value.
- **id: Number**: The numeric ID of the attribute represented as an integer.
- **isGrouped: Boolean**: The value is

`true`

if this is a grouped AVP (Diameter only).
- **name: String**: The name for the given AVP.
- **vendor: String**: The vendor name for vendor AVPs (Diameter only).
- **value: String | Array | Number**: For single AVPs, a string or numeric value. For grouped AVPs (Diameter only), an array of objects.
- **isDiameter: Boolean**: The value is

`true`

if the request or response is Diameter.
- **isError: Boolean**: The value is

`true`

if the response is an error. To retrieve the error details in Diameter, check

`AAA.statusCode`

. To retrieve the error details in RADIUS, check the AVP with code 18 (Reply-Message).

Access only on `AAA_RESPONSE` events; otherwise, an error will occur.
- **isRadius: Boolean**: The value is

`true`

if the request or response is RADIUS.
- **isRspAborted: Boolean**: The value is

`true`

if the

`AAA_RESPONSE`

event is aborted.

Access only on `AAA_RESPONSE` events; otherwise, an error will occur.
- **method: Number**: The method that corresponds to the command code in either RADIUS or Diameter.

The following table contains valid Diameter command codes:

| Command name | Abbr. | Code |
| --- | --- | --- |
| `AA-Request` | `AAR` | `265` |
| `AA-Answer` | `AAA` | `265` |
| `Diameter-EAP-Request` | `DER` | `268` |
| `Diameter-EAP-Answer` | `DEA` | `268` |
| `Abort-Session-Request` | `ASR` | `274` |
| `Abort-Session-Answer` | `ASA` | `274` |
| `Accounting-Request` | `ACR` | `271` |
| `Credit-Control-Request` | `CCR` | `272` |
| `Credit-Control-Answer` | `CCA` | `272` |
| `Capabilities-Exchange-Request` | `CER` | `257` |
| `Capabilities-Exchange-Answer` | `CEA` | `257` |
| `Device-Watchdog-Request` | `DWR` | `280` |
| `Device-Watchdog-Answer` | `DWA` | `280` |
| `Disconnect-Peer-Request` | `DPR` | `282` |
| `Disconnect-Peer-Answer` | `DPA` | `282` |
| `Re-Auth-Answer` | `RAA` | `258` |
| `Re-Auth-Request` | `RAR` | `258` |
| `Session-Termination-Request` | `STR` | `275` |
| `Session-Termination-Answer` | `STA` | `275` |
| `User-Authorization-Request` | `UAR` | `300` |
| `User-Authorization-Answer` | `UAA` | `300` |
| `Server-Assignment-Request` | `SAR` | `301` |
| `Server-Assignment-Answer` | `SAA` | `301` |
| `Location-Info-Request` | `LIR` | `302` |
| `Location-Info-Answer` | `LIA` | `302` |
| `Multimedia-Auth-Request` | `MAR` | `303` |
| `Multimedia-Auth-Answer` | `MAA` | `303` |
| `Registration-Termination-Request` | `RTR` | `304` |
| `Registration-Termination-Answer` | `RTA` | `304` |
| `Push-Profile-Request` | `PPR` | `305` |
| `Push-Profile-Answer` | `PPA` | `305` |
| `User-Data-Request` | `UDR` | `306` |
| `User-Data-Answer` | `UDA` | `306` |
| `Profile-Update-Request` | `PUR` | `307` |
| `Profile-Update-Answer` | `PUA` | `307` |
| `Subscribe-Notifications-Request` | `SNR` | `308` |
| `Subscribe-Notifications-Answer` | `SNA` | `308` |
| `Push-Notification-Request` | `PNR` | `309` |
| `Push-Notification-Answer` | `PNA` | `309` |
| `Bootstrapping-Info-Request` | `BIR` | `310` |
| `Bootstrapping-Info-Answer` | `BIA` | `310` |
| `Message-Process-Request` | `MPR` | `311` |
| `Message-Process-Answer` | `MPA` | `311` |
| `Update-Location-Request` | `ULR` | `316` |
| `Update-Location-Answer` | `ULA` | `316` |
| `Authentication-Information-Request` | `AIR` | `318` |
| `Authentication-Information-Answer` | `AIA` | `318` |
| `Notify-Request` | `NR` | `323` |
| `Notify-Answer` | `NA` | `323` |

The following table contains valid RADIUS command codes:

| Command name | Code |
| --- | --- |
| `Access-Request` | `1` |
| `Access-Accept` | `2` |
| `Access-Reject` | `3` |
| `Accounting-Request` | `4` |
| `Accounting-Response` | `5` |
| `Access-Challenge` | `11` |
| `Status-Server (experimental)` | `12` |
| `Status-Client (experimental)` | `13` |
| `Reserved` | `255` |
- **processingTime: Number**: The server processing time, expressed in milliseconds. The value is

`NaN`

if the timing is invalid.

Access only on `AAA_RESPONSE` events; otherwise, an error will occur.
- **record: Object**: The record object that can be sent to the configured recordstore through a call to

`AAA.commitRecord()`

on either an

`AAA_REQUEST`

or

`AAA_RESPONSE`

event.

The event on which the method was called determines which properties the default record object can contain as displayed in the following table:

| AAA_REQUEST | AAA_RESPONSE |
| --- | --- |
| `authenticator` | `authenticator` |
| `clientIsExternal` | `clientIsExternal` |
| `clientZeroWnd` | `clientZeroWnd` |
| `method` | `isError` |
| `receiverIsExternal` | `isRspAborted` |
| `reqBytes` | `method` |
| `reqL2Bytes` | `processingTime` |
| `reqPkts` | `receiverIsExternal` |
| `reqRTO` | `roundTripTime` |
| `senderIsExternal` | `rspBytes` |
| `serverIsExternal` | `rspL2Bytes` |
| `serverZeroWnd` | `rspPkts` |
| `txId` | `rspRTO` |
| `type` | `statusCode` |
|  | `senderIsExternal` |
|  | `serverIsExternal` |
|  | `serverZeroWnd` |
|  | `txId` |
|  | `type` |
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

Access only on `AAA_REQUEST` events; otherwise, an error will occur.
- **reqZeroWnd: Number**: The number of zero windows in the request.
- **roundTripTime: Number**: The median round trip time (RTT), expressed in milliseconds.

An RTT is the time it took for a device to send a single TCP packet and receive an immediate corresponding acknowledgment (ACK) packet.

The median value is calculated by sampling the RTTs observed since the last

`AAA_REQUEST`

or

`AAA_RESPONSE`

event ran. The value is

`NaN`

if there are no RTT samples.
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

Access only on `AAA_RESPONSE` events; otherwise, an error will occur.
- **rspZeroWnd: Number**: The number of zero windows in the response.
- **statusCode: String**: A string representation of the AVP identifier 268 (Result-Code).

Access only on `AAA_RESPONSE` events; otherwise, an error will occur.
- **txId: Number**: A value that corresponds to the hop-by-hop identifier in Diameter and msg-id in RADIUS.
