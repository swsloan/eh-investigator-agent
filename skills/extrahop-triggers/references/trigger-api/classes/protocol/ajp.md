---
{
  "anchor": "ajp",
  "api_area": "trigger-api",
  "doc_kind": "class",
  "events": [
    "AJP_REQUEST",
    "AJP_RESPONSE"
  ],
  "examples": [],
  "methods": [
    "commitRecord(): Void",
    "findHeaders(name: String): Array"
  ],
  "name": "AJP",
  "properties": [
    "attributes: Object",
    "fwdReqClientAddr: IPAddress",
    "fwdReqHost: String",
    "fwdReqIsEncrypted: Boolean",
    "fwdReqServerName: String",
    "fwdReqServerPort: Number",
    "headers: Object",
    "method: String",
    "processingTime: Number",
    "protocol: String",
    "record: Object",
    "reqBytes: Number",
    "reqL2Bytes: Number",
    "reqPkts: Number",
    "reqRTO: Number",
    "reqSize: Number",
    "rspBytes: Number",
    "rspL2Bytes: Number",
    "rspPkts: Number",
    "rspRTO: Number",
    "rspSize: Number",
    "statusCode: Number",
    "uri: String"
  ],
  "section": "protocol-and-network-data-classes",
  "source_url": "https://docs.extrahop.com/current/extrahop-trigger-api/",
  "source_version": "26.2"
}
---

### AJP

Apache JServ Protocol (AJP) proxies inbound requests from a web server to an application server and is often applied to load-balanced environments where one or more front-end web servers feed requests into one or more application servers. The `AJP` class enables you to store metrics and access properties on `AJP_REQUEST` and `AJP_RESPONSE` events.

#### Events

- **AJP_REQUEST**: Runs after the web server sends an AJP Forward Request message to a servlet container, and then transfers any subsequent request body.
- **AJP_RESPONSE**: Runs after a servlet container sends an AJP End Response message to signal that the servlet container has finished processing an AJP Forward Request and has sent back the requested information.

#### Methods

- **commitRecord(): Void**: Sends a record to the configured recordstore on an

`AJP_RESPONSE`

event. Record commits on

`AJP_REQUEST`

events are not supported.

To view the default properties committed to the record object, see the `record` property below.

For built-in records, each unique record is committed only once, even if the `commitRecord()` method is called multiple times for the same unique record.
- **findHeaders(name: String): Array**: Accesses AJP header values and returns an array of header objects (with name and value properties) where the names match the prefix of the specified string. Accesses request headers on

`AJP_REQUEST`

events and response headers on

`AJP_RESPONSE`

requests.

#### Properties

- **attributes: Object**: An array of optional AJP attributes sent with the request, such as remote_user, auth_type, query_string, jvm_route, ssl_cert, ssl_cipher, and ssl_session.

Access only on `AJP_REQUEST` events; otherwise, an error will occur.
- **fwdReqClientAddr: IPAddress**: The

[IPAddress](#ipaddress)

of the HTTP client that made the original request to the server. The value is

`null`

if the available information cannot be parsed to an IP address.
- **fwdReqHost: String**: The HTTP host specified by the HTTP client that made the original request to the server.
- **fwdReqIsEncrypted: Boolean**: The value is

`true`

if TLS encryption was applied by the HTTP client that made the original request to the server.
- **fwdReqServerName: String**: The name of the server to which the HTTP client made the original request.
- **fwdReqServerPort: Number**: The TCP port on the server to which the HTTP client made the original request.
- **headers: Object**: When accessed on

`AJP_REQUEST`

events, an array of header names and values sent with the request.

When accessed on `AJP_RESPONSE` events, an array of headers conveyed in the AJP Send Headers message by the server to the end user browser.
- **method: String**: The HTTP method of the request, such as POST or GET, from the server to the servlet container.
- **processingTime: Number**: The time between the last byte of the request received and the first byte of the response payload sent, expressed in milliseconds. The value is

`NaN`

on malformed and aborted responses or if the timing is invalid.

Access only on `AJP_RESPONSE` events; otherwise, an error will occur.
- **protocol: String**: The protocol of the request from the server to the servlet container. Not set for other message types.
- **record: Object**: The record object that can be sent to the configured recordstore through a call to

`AJP.commitRecord()`

on an

`AJP_RESPONSE`

event.

The default record object can contain the following properties:

- `clientIsExternal`
- `fwdReqClientAddr`
- `fwdReqHost`
- `fwdReqIsEncrypted`
- `fwdReqServerName`
- `fwdReqServerPort`
- `method`
- `processingTime`
- `protocol`
- `receiverIsExternal`
- `reqSize`
- `rspSize`
- `statusCode`
- `senderIsExternal`
- `serverIsExternal`
- `uri`

Access only on `AJP_RESPONSE` events; otherwise, an error will occur.
- **reqBytes: Number**: The number of

L4

request bytes, excluding L4 headers.

Access only on `AJP_RESPONSE` events; otherwise, an error will occur.
- **reqL2Bytes: Number**: The number of

L2

request bytes, including L2 headers.
- **reqPkts: Number**: The number of request packets.
- **reqRTO: Number**: The number of request

retransmission timeouts

(RTOs).
- **reqSize: Number**: The number of L7 request bytes, excluding AJP headers.
- **rspBytes: Number**: The number of

L4

response bytes, excluding L4 protocol overhead, such as ACKs, headers, and retransmissions.

Access only on `AJP_RESPONSE` events; otherwise, an error will occur.

- **rspL2Bytes: Number**: The number of

L2

response bytes, including protocol overhead, such as headers.

Access only on `AJP_RESPONSE` events; otherwise, an error will occur.

- **rspPkts: Number**: The number of response packets.

Access only on `AJP_RESPONSE` events; otherwise, an error will occur.

- **rspRTO: Number**: The number of response

retransmission timeouts

(RTOs).

Access only on `AJP_RESPONSE` events; otherwise, an error will occur.

- **rspSize: Number**: The number of L7 response bytes, excluding AJP headers.

Access only on `AJP_RESPONSE` events; otherwise, an error will occur.

- **statusCode: Number**: The HTTP status code returned by the servlet container for responses to AJP Forward Request messages.

Access only on `AJP_RESPONSE` events; otherwise, an error will occur.

- **uri: String**: The URI for the request from the server to the servlet container. Not set for non-AJP message types.
