---
{
  "anchor": "http",
  "api_area": "trigger-api",
  "doc_kind": "class",
  "events": [
    "HTTP_REQUEST",
    "HTTP_RESPONSE"
  ],
  "examples": [
    "Example: Track 500-level HTTP responses by customer ID and URI",
    "Example: Track SOAP requests",
    "Example: Access HTTP header attributes",
    "Example: Record data to a session table",
    "Example: Create an application container"
  ],
  "methods": [
    "commitRecord(): void",
    "findHeaders(name: String): Array",
    "parseQuery(String): Object"
  ],
  "name": "HTTP",
  "properties": [
    "age: Number",
    "contentType: String",
    "cookies: Array",
    "encryptionProtocol: String",
    "filename: String | Null",
    "headers: Object",
    "length: Number",
    "string property:",
    "numeric property:",
    "headersRaw: String",
    "host: String",
    "isClientReset: Boolean",
    "isContinued: Boolean",
    "isDesync: Boolean",
    "isEncrypted: Boolean",
    "isDecrypted: Boolean",
    "isPipelined: Boolean",
    "isReqAborted: Boolean",
    "isRspAborted: Boolean",
    "isRspChunked: Boolean",
    "isRspCompressed: Boolean",
    "isServerPush: Boolean",
    "isServerReset: Boolean",
    "isSQLi: Boolean",
    "isXSS: Boolean",
    "ja4HTTP: String",
    "method: String",
    "oauthBearerToken: String",
    "origin: IPAddress | String",
    "path: String",
    "payload: Buffer | Null",
    "payloadParts: Array of Objects | Null",
    "payloadSHA256: String",
    "payloadMediaType: String | Null",
    "payload: Buffer",
    "size: Number",
    "filename: String",
    "processingTime: Number",
    "query: String",
    "record: Object",
    "referer: String",
    "reqBytes: Number",
    "reqL2Bytes: Number",
    "reqPkts: Number",
    "reqRTO: Number",
    "reqSize: Number",
    "reqTimeToLastByte: Number",
    "reqZeroWnd: Number",
    "roundTripTime: Number",
    "rspBytes: Number",
    "rspL2Bytes: Number",
    "rspPkts: Number",
    "rspRTO: Number",
    "rspSize: Number",
    "rspTimeToFirstHeader: Number",
    "rspTimeToFirstPayload: Number",
    "rspTimeToLastByte: Number",
    "rspVersion: String",
    "rspZeroWnd: Number",
    "samlRequestXML: Buffer | Null",
    "samlResponseXML: Buffer | Null",
    "sqli: Array of Strings",
    "statusCode: Number",
    "streamId: Number",
    "title: String",
    "thinkTime: Number",
    "uri: String",
    "userAgent: String",
    "xss: Array of Strings"
  ],
  "section": "protocol-and-network-data-classes",
  "source_url": "https://docs.extrahop.com/current/extrahop-trigger-api/",
  "source_version": "26.2"
}
---

### HTTP

The HTTP class enables you to store metrics and access properties on `HTTP_REQUEST` and `HTTP_RESPONSE` events.

#### Events

- **HTTP_REQUEST**: Runs on every HTTP request processed by the device.
- **HTTP_RESPONSE**: Runs on every HTTP response processed by the device.

Additional payload options are available when you create a trigger that runs on either of these events. See [Advanced trigger options](#advanced-trigger-options) for more information.

#### Methods

- **commitRecord(): void**: Sends a record to the configured recordstore on an

`HTTP_REQUEST`

or

`HTTP_RESPONSE`

event. To view the default properties committed to the record object, see the

`record`

property below.

If the `commitRecord()` method is called on an `HTTP_REQUEST` event, the record is not created until the `HTTP_RESPONSE` event runs. If the `commitRecord()` method is called on both the `HTTP_REQUEST` and the corresponding `HTTP_RESPONSE`, only one record is created for request and response, even if the `commitRecord()` method is called multiple times on the same trigger events.

- **findHeaders(name: String): Array**: Enables access to HTTP header values and returns an array of header objects (with name and value properties) where the names match the prefix of the string value. See

[Example: Access HTTP header attributes](#example-access-http-header-attributes)

for more information.
- **parseQuery(String): Object**: Accepts a query string and returns an object with names and values corresponding to those in the query string as shown in the following example:

```javascript
var query = HTTP.parseQuery(HTTP.query);
debug("user id: " + query.userid);
```

| Note: | If the query string contains repeated keys, the corresponding values are returned in an array. For example, the query string `event_type=status_update_event&event_type=api_post_event` returns the following object:{ "event_type": ["status_update_event", "api_post_event"] } |
| --- | --- |

#### Properties

- **age: Number**: For

`HTTP_REQUEST`

events, the time from the first byte of the request until the last seen byte of the request. For

`HTTP_RESPONSE`

events, the time from the first byte of the request until the last seen byte of the response. The time is expressed in milliseconds. Specifies a valid value on malformed and aborted requests. The value is

`NaN`

on expired requests and responses, or if the timing is invalid.
- **contentType: String**: The value of the content-type HTTP header.
- **cookies: Array**: An array of objects that represents cookies and contains properties such as "domain" and "expires." The properties correspond to the attributes of each cookie as shown in the following example:

```javascript
var cookies = HTTP.cookies,
    cookie,
    i;
for (i = 0; i < cookies.length; i++) {
    cookie = cookies[i];
    if (cookie.domain) {
        debug("domain: " + cookie.domain);
    }
}
```
- **encryptionProtocol: String**: The protocol that the transaction is encrypted with.
- **filename: String | Null**: The name of the file being transferred. If the HTTP request or response did not transfer a file, the value is null.
- **headers: Object**: An array-like object that enables access to HTTP header names and values. Header information is available through one of the following properties:

- **length: Number**: The number of headers.
- **string property:**: The name of the header, accessible in a dictionary-like fashion, as shown in the following example:

```javascript
var headers = HTTP.headers;
    session = headers["X-Session-Id"];
    accept = headers.accept;
```
- **numeric property:**: Corresponds to the order in which the headers appear on the wire. The returned object has a name and a value property. Numeric properties are useful for iterating over all the headers and disambiguating headers with duplicate names as shown in the following example:

```javascript
var headers = HTTP.headers;
for (i = 0; i < headers.length; i++) {
    hdr = headers[i];
    debug("headers[" + i + "].name: " + hdr.name);
    debug("headers[" + i + "].value: " + hdr.value);
}
```

| Note: | Saving `HTTP.headers` to the Flow store does not save all of the individual header values. It is a best practice to save the individual header values to the Flow store. Refer to the [Flow](#flow) class section for details. |
| --- | --- |
- **headersRaw: String**: The unmodified block of HTTP headers, expressed as a string.
- **host: String**: The value in the HTTP host header.
- **isClientReset: Boolean**: The value is

`true`

if the HTTP/2 stream is reset by the client. If the protocol is HTTP1.1, the value is

`false`

.
- **isContinued: Boolean**: The value is

`true`

if the client sent an initial HTTP/1.1 request with an

`Expect: 100-continue`

header and received a 100 status code from the server as part of the transaction. If the protocol is HTTP/2, the value is

`false`
- **isDesync: Boolean**: The value is

`true`

if the protocol parser became desynchronized due to missing packets.
- **isEncrypted: Boolean**: The value is

`true`

if the transaction is over secure HTTP.
- **isDecrypted: Boolean**: The value is

`true`

if the ExtraHop system securely decrypted and analyzed the transaction. Decrypted traffic analysis can expose advanced threats that hide within encrypted traffic.
- **isPipelined: Boolean**: The value is

`true`

if the transaction is pipelined.
- **isReqAborted: Boolean**: The value is

`true`

if the connection is closed before the HTTP request was complete.
- **isRspAborted: Boolean**: The value is

`true`

if the connection is closed before the HTTP response was complete.

Access only on `HTTP_RESPONSE` events; otherwise, an error will occur.
- **isRspChunked: Boolean**: The value is

`true`

if the response is chunked.

Access only on `HTTP_RESPONSE` events; otherwise, an error will occur.
- **isRspCompressed: Boolean**: The value is

`true`

if the response is compressed.

Access only on `HTTP_RESPONSE` events; otherwise, an error will occur.
- **isServerPush: Boolean**: The value is

`true`

if the transaction is the result of a server push.
- **isServerReset: Boolean**: The value is

`true`

if the HTTP/2 stream is reset by the server.
- **isSQLi: Boolean**: The value is true if the request included one or more suspicious SQL fragments. These fragments indicate a potential SQL injection (SQLi). SQLi is a technique where an attacker can access and tamper with data by inserting malicious SQL statements into a SQL query.
- **isXSS: Boolean**: The value is true if the HTTP request included potential cross-site scripting (XSS) attempts. A successful XSS attempt can inject a malicious client-side script or payload into a trusted website or application. When a victim visits the website, the malicious script is then injected into the victim's browser.
- **ja4HTTP: String**: The JA4HTTP fingerprint for the client that sent the HTTP request, which includes the HTTP method, HTTP version, whether cookies or referrers are specified, the number of headers, and the first four characters of the first language specified in the Accept-Language header.
- **method: String**: The HTTP method of the transaction such as POST and GET.
- **oauthBearerToken: String**: The OAuth token sent by the client to the server for authorization.
- **origin: IPAddress | String**: The value in the X-Forwarded-For or the true-client-ip header.
- **path: String**: The path portion of the URI:

/path/

.
- **payload: Buffer | Null**: The

[Buffer](#buffer)

object that contains the raw payload bytes of the event transaction. If the payload was compressed, the decompressed content is returned.

The buffer contains the `N` first bytes of the payload, where `N` is the number of payload bytes specified by the Bytes to Buffer field when the trigger was configured through the ExtraHop WebUI. The default number of bytes is 2048. For more information, see [Advanced trigger options](#advanced-trigger-options).

The following script is an example of HTTP payload analysis:

```javascript
// Extract the user name based on a pattern "user=*&" from payload
// of a login URI that has "auth/login" as a URI substring.

if (HTTP.payload && /auth\/login/i.test(HTTP.uri)) {
    var user = /user=(.*?)\&/i.exec(HTTP.payload);
    if (user !== null) {
        debug("user: " + user[1]);
    }
}
```

| Note: | If two HTTP payload buffering triggers are assigned to the same device, the higher value is selected and the value of `HTTP.payload` is the same for both triggers. |
| --- | --- |
- **payloadParts: Array of Objects | Null**: An array of objects that contain the individual payloads of a multipart HTTP request or response. The value is null if the content type is not multipart. Each object contains the following fields:

- **headers: Object**: A header object that specifies HTTP headers. For more information, see the description of the

`HTTP.headers`

property.
- **payloadSHA256: String**: The hexadecimal representation of the SHA-256 hash of the payload. The string contains no delimiters.
- **payloadMediaType: String | Null**: The media type of the payload. The value is null if the media type is unknown.
- **payload: Buffer**: The

[Buffer](#buffer)

object containing the raw payload bytes.
- **size: Number**: The size of the payload, expressed in bytes.
- **filename: String**: The filename specified in the Content-Disposition header.
- **processingTime: Number**: The server processing time, expressed in milliseconds (equivalent to

`rspTimeToFirstPayload`

-

`reqTimeToLastByte`

). The value is

`NaN`

on malformed and aborted responses or if the timing is invalid.

Access only on `HTTP_RESPONSE` events; otherwise, an error will occur.
- **query: String**: The query string portion of the

`URI: query=string`

. This typically follows the URL and is separated from it by a question mark. Multiple query strings are separated by an ampersand (&) or semicolon (;) delimiter.
- **record: Object**: The record object that can be sent to the configured recordstore through a call to

`HTTP.commitRecord()`

.

The default record object can contain the following properties:

- `clientIsExternal`
- `clientZeroWnd`
- `contentType`
- `host`
- `isPipelined`
- `isReqAborted`
- `isRspAborted`
- `isRspChunked`
- `isRspCompressed`
- `method`
- `oauthAlgorithm`
- `oauthAudience`
- `oauthClientId`
- `oauthIssuer`
- `oauthJWTId`
- `origin`
- `query`
- `receiverIsExternal`
- `referer`
- `reqBytes`
- `reqL2Bytes`
- `reqPayloadMediaType`
- `reqPayloadSHA256`
- `reqPkts`
- `reqRTO`
- `reqSize`
- `reqTimeToLastByte`
- `roundTripTime`
- `rspBytes`
- `rspL2Bytes`
- `rspPayloadMediaType`
- `rspPayloadSHA256`
- `rspPkts`
- `rspRTO`
- `rspSize`
- `rspTimeToFirstHeader`
- `rspTimeToFirstPayload`
- `rspTimeToLastByte`
- `rspVersion`
- `samlRspAudience`
- `samlRspCertificateSubject`
- `samlRspDigestMethodAlgorithm`
- `samlRspIssuer`
- `samlRspNameID`
- `samlRspSignatureMethodAlgorithm`
- `samlRspStatusCode`
- `senderIsExternal`
- `serverIsExternal`
- `serverZeroWnd`
- `statusCode`
- `thinkTime`
- `title`
- `processingTime`
- `uri`
- `userAgent`

Access the record object only on `HTTP_RESPONSE` events; otherwise, an error will occur.
- **referer: String**: The value in the HTTP referrer header.
- **reqBytes: Number**: The number of

L4

request bytes, excluding L4 headers.

Access only on `HTTP_RESPONSE` events; otherwise, an error will occur.
- **reqL2Bytes: Number**: The number of

L2

request bytes, including L2 headers.

Access only on `HTTP_RESPONSE` events; otherwise, an error will occur.
- **reqPkts: Number**: The number of request packets.

Access only on `HTTP_RESPONSE` events; otherwise, an error will occur.
- **reqRTO: Number**: The number of request

retransmission timeouts

(RTOs).

Access only on `HTTP_RESPONSE` events; otherwise, an error will occur.
- **reqSize: Number**: The number of L7 request bytes, excluding HTTP headers.
- **reqTimeToLastByte: Number**: The time from the first byte of the request until the last byte of the request, expressed in milliseconds. The value is

`NaN`

on expired requests and responses, or if the timing is invalid.
- **reqZeroWnd: Number**: The number of zero windows in the request.
- **roundTripTime: Number**: The median round trip time (RTT), expressed in milliseconds.

An RTT is the time it took for a device to send a single TCP packet and receive an immediate corresponding acknowledgment (ACK) packet.

The median value is calculated by sampling the RTTs observed since the last

`HTTP_RESPONSE`

event ran. The value is

`NaN`

if there are no RTT samples.

Access only on `HTTP_RESPONSE` events; otherwise, an error will occur.
- **rspBytes: Number**: The number of

L4

response bytes, excluding L4 protocol overhead, such as ACKs, headers, and retransmissions.

Access only on `HTTP_RESPONSE` events; otherwise, an error will occur.
- **rspL2Bytes: Number**: The number of

L2

response bytes, including protocol overhead, such as headers.

Access only on `HTTP_RESPONSE` events; otherwise, an error will occur.
- **rspPkts: Number**: The number of response packets.

Access only on `HTTP_RESPONSE` events; otherwise, an error will occur.
- **rspRTO: Number**: The number of response

retransmission timeouts

(RTOs).

Access only on `HTTP_RESPONSE` events; otherwise, an error will occur.
- **rspSize: Number**: The number of L7 response bytes, excluding HTTP headers.

Access only on `HTTP_RESPONSE` events; otherwise, an error will occur.
- **rspTimeToFirstHeader: Number**: The time from the first byte of the request until the status line that precedes the response headers, expressed in milliseconds. The value is

`NaN`

on malformed and aborted responses, or if the timing is invalid.

Access only on `HTTP_RESPONSE` events; otherwise, an error will occur.
- **rspTimeToFirstPayload: Number**: The time from the first byte of the request until the first payload byte of the response, expressed in milliseconds. Returns zero value when the response does not contain payload. The value is

`NaN`

on malformed and aborted responses, or if the timing is invalid.

Access only on `HTTP_RESPONSE` events; otherwise, an error will occur.
- **rspTimeToLastByte: Number**: The time from the first byte of the request until the last byte of the response, expressed in milliseconds. The value is

`NaN`

on malformed and aborted responses, or if the timing is invalid.

Access only on `HTTP_RESPONSE` events; otherwise, an error will occur.
- **rspVersion: String**: The HTTP version of the response.

Access only on `HTTP_RESPONSE` events; otherwise, an error will occur.
- **rspZeroWnd: Number**: The number of zero windows in the response.
- **samlRequestXML: Buffer | Null**: The

[Buffer](#buffer)

object that contains the raw XML bytes of the SAML request. If the HTTP request or response did not contain a SAML request, the value is

`null`

.
- **samlResponseXML: Buffer | Null**: The

[Buffer](#buffer)

object that contains the raw XML bytes of the SAML response. If the HTTP request or response did not contain a SAML response, the value is

`null`

.
- **sqli: Array of Strings**: An array of suspicious SQL fragments included in the request. These fragments might contain a potential SQL injection (SQLi). SQLi is a technique where an attacker can access and tamper with data by inserting malicious SQL statements into a SQL query.
- **statusCode: Number**: The HTTP status code of the response.

Access only on `HTTP_RESPONSE` events; otherwise, an error will occur.

| Note: | Returns a status code of 0 if no valid `HTTP_RESPONSE` is received. |
| --- | --- |
- **streamId: Number**: The ID of the stream that transferred the resource. Because responses might be returned out of order, this property is required for HTTP/2 transactions to match requests with responses. The value is

`1`

for the HTTP/1.1 upgrade request and

`null`

for previous HTTP versions.
- **title: String**: The value in the title element of the HTML content, if present. If the title was compressed, the decompressed content is returned.
- **thinkTime: Number**: The time elapsed between the server having transferred the response to the

client

and the client transferring a new request to the server, expressed in milliseconds. The value is

`NaN`

if there is no valid measurement.
- **uri: String**: The URI without a query string:

f.q.d.n/path/

.
- **userAgent: String**: The value in the HTTP user-agent header.
- **xss: Array of Strings**: An array of suspicious HTTP request fragments included in the request. These fragments might inject a malicious client-side script or payload into a trusted website or application. When a victim visits the website, the malicious script is then injected into the victim's browser.

#### Trigger Examples

- [Example: Track 500-level HTTP responses by customer ID and URI](#example-track-500-level-http-responses-by-customer-id-and-uri)
- [Example: Track SOAP requests](#example-track-soap-requests)
- [Example: Access HTTP header attributes](#example-access-http-header-attributes)
- [Example: Record data to a session table](#example-record-data-to-a-session-table)
- [Example: Create an application container](#example-create-an-application-container)
