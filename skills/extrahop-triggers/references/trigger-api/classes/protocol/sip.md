---
{
  "anchor": "sip",
  "api_area": "trigger-api",
  "doc_kind": "class",
  "events": [
    "SIP_REQUEST",
    "SIP_RESPONSE"
  ],
  "examples": [],
  "methods": [
    "commitRecord(): void",
    "findHeaders(name: String): Array"
  ],
  "name": "SIP",
  "properties": [
    "callId: String",
    "from: String",
    "hasSDP: Boolean",
    "headers: Object",
    "string property:",
    "numeric property:",
    "method: String",
    "payload: Buffer | null",
    "processingTime: Number",
    "record: Object",
    "reqBytes: Number",
    "reqL2Bytes: Number",
    "reqPkts: Number",
    "reqRTO: Number",
    "reqSize: Number",
    "reqZeroWnd: Number",
    "roundTripTime: Number",
    "rspBytes: Number",
    "rspL2Bytes: Number",
    "rspPkts: Number",
    "rspRTO: Number",
    "rspSize: Number",
    "rspZeroWnd: Number",
    "statusCode: Number",
    "to: String",
    "uri: String"
  ],
  "section": "protocol-and-network-data-classes",
  "source_url": "https://docs.extrahop.com/current/extrahop-trigger-api/",
  "source_version": "26.2"
}
---

### SIP

The SIP class enables you to store metrics and access properties on `SIP_REQUEST` and `SIP_RESPONSE` events.

#### Events

- **SIP_REQUEST**: Runs on every SIP request processed by the device.
- **SIP_RESPONSE**: Runs on every SIP response processed by the device.

#### Methods

- **commitRecord(): void**: Sends a record to the configured recordstore on either a

`SIP_REQUEST`

or

`SIP_RESPONSE`

event.

The event determines which properties are committed to the record object. To view the default properties committed for each event, see the `record` property below.

For built-in records, each unique record is committed only once, even if the `commitRecord()` method is called multiple times for the same unique record.
- **findHeaders(name: String): Array**: Enables access to SIP header values. The result is an array of header objects (with name and value properties) where the names match the prefix of the string passed to

`findHeaders`

.

#### Properties

- **callId: String**: The call ID for this message.
- **from: String**: The contents of the From header.
- **hasSDP: Boolean**: The value is

`true`

if this event includes

SDP

information.
- **headers: Object**: An array-like object that enables access to SIP header names and values. Access a specific header with one of the following methods:

- **string property:**: The name of the header, accessible in a dictionary-like fashion. For example:

```javascript
var headers = SIP.headers;
session = headers["X-Session-Id"];
accept = headers.accept;
```
- **numeric property:**: The order in which headers appear on the wire. The returned object has a name and a value property. Numeric properties are useful for iterating over all the headers and disambiguating headers with duplicate names. For example:

```javascript
for (i = 0; i < headers.length; i++) {
   hdr = headers[i];
   debug("headers[" + i + "].name: " + hdr.name);
   debug("headers[" + i + "].value: " + hdr.value);
}
```

| Note: | Saving `SIP.headers` to the Flow store does not save all of the individual header values. It is best practice to save the individual header values to the Flow store. |
| --- | --- |
- **method: String**: The SIP method.

| Method Name | Description |
| --- | --- |
| `ACK` | Confirms the client has received a final response to an INVITE request. |
| `BYE` | Terminates a call. Can be sent by either the caller or the callee. |
| `CANCEL` | Cancels any pending request |
| `INFO` | Sends mid-session information that doesn't change the session state. |
| `INVITE` | Invites a client to participate in a call session. |
| `MESSAGE` | Transports instant messages using SIP. |
| `NOTIFY` | Notify the subscriber of a new event. |
| `OPTIONS` | Queries the capabilities of servers. |
| `PRACK` | Provisional acknowledgment. |
| `PUBLISH` | Publish an event to the server. |
| `REFER` | Ask recipient to issue a SIP request (call transfer). |
| `REGISTER` | Registers the address listed in the To header field with a SIP server. |
| `SUBSCRIBE` | Subscribes for an event of Notification from the Notifier. |
| `UPDATE` | Modifies the state of a session without changing the state of the dialog. |
- **payload: Buffer | null**: The

[Buffer](#buffer)

object that contains the raw payload bytes of the event transaction. If the payload was compressed, the decompressed content is returned.

The buffer contains the `N` first bytes of the payload, where `N` is the number of payload bytes specified by the Bytes to Buffer field when the trigger was configured through the ExtraHop WebUI. The default number of bytes is 2048. For more information, see [Advanced trigger options](#advanced-trigger-options).
- **processingTime: Number**: The time between the request and the first response, expressed in milliseconds. The value is

`NaN`

on malformed and aborted responses or if the timing is invalid.

Access only on `SIP_RESPONSE` events; otherwise, an error will occur.
- **record: Object**: The record object that can be sent to the configured recordstore through a call to

`SIP.commitRecord()`

on either a

`SIP_REQUEST`

or

`SIP_RESPONSE`

event.

The event on which the method was called determines which properties the default record object can contain as displayed in the following table:

| `SIP_REQUEST` | `SIP_RESPONSE` |
| --- | --- |
| `callId` | `callId` |
| `clientIsExternal` | `clientIsExternal` |
| `clientZeroWnd` | `clientZeroWnd` |
| `from` | `from` |
| `hasSDP` | `hasSDP` |
| `method` | `processingTime` |
| `receiverIsExternal` | `receiverIsExternal` |
| `reqBytes` | `roundTripTime` |
| `reqL2Bytes` | `rspBytes` |
| `reqPkts` | `rspL2Bytes` |
| `reqRTO` | `rspPkts` |
| `reqSize` | `rspRTO` |
| `senderIsExternal` | `rspSize` |
| `serverIsExternal` | `senderIsExternal` |
| `serverZeroWnd` | `serverIsExternal` |
| `to` | `serverZeroWnd` |
| `uri` | `statusCode` |
|  | `to` |
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
- **reqSize: Number**: The number of L7 request bytes, excluding SIP headers.

Access only on `SIP_REQUEST` events; otherwise, an error will occur.
- **reqZeroWnd: Number**: The number of zero windows in the request.
- **roundTripTime: Number**: The median round trip time (RTT), expressed in milliseconds.

An RTT is the time it took for a device to send a single TCP packet and receive an immediate corresponding acknowledgment (ACK) packet.

The median value is calculated by sampling the RTTs observed since the last

`SIP_REQUEST`

or

`SIP_RESPONSE`

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
- **rspSize: Number**: The number of L7 response bytes, excluding SIP headers.

Access only on `SIP_RESPONSE` events; otherwise, an error will occur.
- **rspZeroWnd: Number**: The number of zero windows in the response.
- **statusCode: Number**: The SIP response status code.

Access only on `SIP_RESPONSE` events; otherwise, an error will occur.

The following table displays provisional responses:

| Number | Response |
| --- | --- |
| `100` | `Trying` |
| `180` | `Ringing` |
| `181` | `Call is Being Forwarded` |
| `182` | `Queued` |
| `183` | `Session In Progress` |
| `199` | `Early Dialog Terminated` |

The following table displays successful responses:

| Number | Response |
| --- | --- |
| `200` | `OK` |
| `202` | `Accepted` |
| `204` | `No Notification` |

The following table displays redirection responses:

| Number | Response |
| --- | --- |
| `300` | `Multiple Choice` |
| `301` | `Moved Permanently` |
| `302` | `Moved Temporarily` |
| `305` | `Use Proxy` |
| `380` | `Alternative Service` |

The following table displays client failure responses:

| Number | Response |
| --- | --- |
| `400` | `Bad Request` |
| `401` | `Unauthorized` |
| `402` | `Payment Required` |
| `403` | `Forbidden` |
| `404` | `Not Found` |
| `405` | `Method Not Allowed` |
| `406` | `Not Acceptable` |
| `407` | `Proxy Authentication Required` |
| `408` | `Request Timeout` |
| `409` | `Conflict` |
| `410` | `Gone` |
| `411` | `Length Required` |
| `412` | `Conditional Request Failed` |
| `413` | `Request Entity Too Large` |
| `414` | `Request URI Too Long` |
| `415` | `Unsupported Media Type` |
| `416` | `Unsupported URI Scheme` |
| `417` | `Unknown Resource Priority` |
| `420` | `Bad Extension` |
| `421` | `Extension Required` |
| `422` | `Session Interval Too Small` |
| `423` | `Interval Too Brief` |
| `424` | `Bad Location Information` |
| `428` | `Use Identity Header` |
| `429` | `Provide Referrer Identity` |
| `430` | `Flow Failed` |
| `433` | `Anonymity Disallowed` |
| `436` | `Bad Identity Info` |
| `437` | `Unsupported Certificate` |
| `438` | `Invalid Identity Header` |
| `439` | `First Hop Lacks Outbound Support` |
| `470` | `Consent Needed` |
| `480` | `Temporarily Unavailable` |
| `481` | `Call/Transaction Does Not Exist` |
| `482` | `Loop Detected` |
| `483` | `Too Many Hops` |
| `484` | `Address Incomplete` |
| `485` | `Ambiguous` |
| `486` | `Busy Here` |
| `487` | `Request Terminated` |
| `488` | `Not Acceptable Here` |
| `489` | `Bad Event` |
| `491` | `Request Pending` |
| `493` | `Undecipherable` |
| `494` | `Security Agreement Required` |

The following table displays server failure responses:

| Number | Response |
| --- | --- |
| `500` | `Server Internal Error` |
| `501` | `Not Implemented` |
| `502` | `Bad Gateway` |
| `503` | `Service Unavailable` |
| `504` | `Server Timeout` |
| `505` | `Version Not Supported` |
| `513` | `Message Too Large` |
| `580` | `Precondition Failure` |

The following table displays global failure responses:

| Name | Response |
| --- | --- |
| `600` | `Busy Everywhere` |
| `603` | `Decline` |
| `604` | `Does Not Exist Anywhere` |
| `606` | `Not Acceptable` |
- **to: String**: The contents of the To header.
- **uri: String**: The URI for

SIP

request or response.
