---
{
  "anchor": "ftp",
  "api_area": "trigger-api",
  "doc_kind": "class",
  "events": [
    "FTP_REQUEST",
    "FTP_RESPONSE"
  ],
  "examples": [],
  "methods": [
    "commitRecord(): void"
  ],
  "name": "FTP",
  "properties": [
    "args: String",
    "cwd: String",
    "error: string",
    "filename: String",
    "isReqAborted: Boolean",
    "isRspAborted: Boolean",
    "method: String",
    "path: String",
    "payloadMediaType: String | Null",
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
    "statusCode: Number",
    "transferBytes: Number",
    "user: String"
  ],
  "section": "protocol-and-network-data-classes",
  "source_url": "https://docs.extrahop.com/current/extrahop-trigger-api/",
  "source_version": "26.2"
}
---

### FTP

The FTP class enables you to store metrics and access properties on `FTP_REQUEST` and `FTP_RESPONSE` events.

#### Events

- **FTP_REQUEST**: Runs on every FTP request processed by the device.
- **FTP_RESPONSE**: Runs on every FTP response processed by the device.

#### Methods

- **commitRecord(): void**: Sends a record to the configured recordstore on an

`FTP_RESPONSE`

event. Record commits on

`FTP_REQUEST`

events are not supported.

To view the default properties committed to the record object, see the `record` property below.

For built-in records, each unique record is committed only once, even if the `commitRecord()` method is called multiple times for the same unique record.

#### Properties

- **args: String**: The arguments to the command.

Access only on `FTP_RESPONSE` events; otherwise, an error will occur.
- **cwd: String**: In the case of a user at

`/`

, when the

client

sends "CWD subdir":

- The value is `/` when method == "CWD".
- The value is `/subdir` for subsequent commands (rather than CWD becoming the changed to directory as part of the CWD response trigger).

Includes "..." at the beginning of the path in the event of a resync or the path is truncated.

Includes "..." at the end of the path if the path is too long. Path truncates at 4096 characters.

Access only on `FTP_RESPONSE` events; otherwise, an error will occur.
- **error: string**: The detailed error message recorded by the ExtraHop system.

Access only on `FTP_RESPONSE` events; otherwise, an error will occur.
- **filename: String**: The name of the file being transferred.
- **isReqAborted: Boolean**: The value is

`true`

the connection is closed before the FTP request was complete.
- **isRspAborted: Boolean**: The value is

`true`

if the connection is closed before the FTP response was complete.

Access only on `FTP_RESPONSE` events; otherwise, an error will occur.
- **method: String**: The FTP method.
- **path: String**: The path for FTP commands. Includes "..." at the beginning of the path in the event of a resync or the path is truncated. Includes "..." at the end of the path if the path is too long. Path truncates at 4096 characters.

Access only on `FTP_RESPONSE` events; otherwise, an error will occur.
- **payloadMediaType: String | Null**: The type of media contained in the payload. The value is null if there is no payload or the media type is unknown.
- **processingTime: Number**: The server processing time, expressed in milliseconds (equivalent to

`rspTimeToFirstPayload`

-

`reqTimeToLastByte`

). The value is

`NaN`

on malformed and aborted responses or if the timing is invalid.

Access only on `FTP_RESPONSE` events; otherwise, an error will occur.
- **record: Object**: The record object that can be sent to the configured recordstore through a call to

`FTP.commitRecord()`

on an

`FTP_RESPONSE`

event.

The default record object can contain the following properties:

- `args`
- `clientIsExternal`
- `clientZeroWnd`
- `cwd`
- `error`
- `isReqAborted`
- `isRspAborted`
- `method`
- `path`
- `processingTime`
- `receiverIsExternal`
- `reqBytes`
- `reqL2Bytes`
- `reqPayloadMediaType`
- `reqPayloadSHA256`
- `reqPkts`
- `reqRTO`
- `roundTripTime`
- `rspBytes`
- `rspL2Bytes`
- `rspPayloadMediaType`
- `rspPayloadSHA256`
- `rspPkts`
- `rspRTO`
- `senderIsExternal`
- `serverIsExternal`
- `serverZeroWnd`
- `statusCode`
- `transferBytes`
- `user`

Access the record object only on `FTP_RESPONSE` events; otherwise, an error will occur.
- **reqBytes: Number**: The number of

L4

request bytes, excluding L4 headers.

Access only on `FTP_RESPONSE` events; otherwise, an error will occur.
- **reqL2Bytes: Number**: The number of

L2

request bytes, including L2 headers.

Access only on `FTP_RESPONSE` events; otherwise, an error will occur.
- **reqPkts: Number**: The number of request packets.

Access only on `FTP_RESPONSE` events; otherwise, an error will occur.
- **reqRTO: Number**: The number of request

retransmission timeouts

(RTOs).

Access only on `FTP_RESPONSE` events; otherwise, an error will occur.
- **reqZeroWnd: Number**: The number of zero windows in the request.
- **roundTripTime: Number**: The median round trip time (RTT), expressed in milliseconds.

An RTT is the time it took for a device to send a single TCP packet and receive an immediate corresponding acknowledgment (ACK) packet.

The median value is calculated by sampling the RTTs observed since the last

`FTP_RESPONSE`

event ran. The value is

`NaN`

if there are no RTT samples.

Access only on `FTP_RESPONSE` events; otherwise, an error will occur.
- **rspBytes: Number**: The number of

L4

response bytes, excluding L4 protocol overhead, such as ACKs, headers, and retransmissions.

Access only on `FTP_RESPONSE` events; otherwise, an error will occur.
- **rspL2Bytes: Number**: The number of

L2

response bytes, including protocol overhead, such as headers.

Access only on `FTP_RESPONSE` events; otherwise, an error will occur.
- **rspPkts: Number**: The number of response packets.

Access only on `FTP_RESPONSE` events; otherwise, an error will occur.
- **rspRTO: Number**: The number of response

retransmission timeouts

(RTOs).

Access only on `FTP_RESPONSE` events; otherwise, an error will occur.
- **rspZeroWnd: Number**: The number of zero windows in the response.
- **statusCode: Number**: The FTP status code of the response.

Access only on `FTP_RESPONSE` events; otherwise, an error will occur.

The following codes are valid:

| Code | Description |
| --- | --- |
| 110 | Restart marker replay. |
| 120 | Service ready in `nnn` minutes. |
| 125 | Data connection already open; transfer starting. |
| 150 | File status okay; about to open data connection. |
| 202 | Command not implemented, superfluous at this site. |
| 211 | System status, or system help reply. |
| 212 | Directory status. |
| 213 | File status. |
| 214 | Help message. |
| 215 | NAME system type. |
| 220 | Service ready for new user. |
| 221 | Service closing control connection. |
| 225 | Data connection open; no transfer in progress. |
| 226 | Closing data connection. Requested file action successful. |
| 227 | Entering Passive Mode. |
| 228 | Entering Long Passive Mode. |
| 229 | Entering Extended Passive Mode. |
| 230 | User logged in, proceed. Logged out if appropriate. |
| 231 | User logged out; service terminated. |
| 232 | Logout command noted, will complete when transfer done |
| 250 | Requested file action okay, completed. |
| 257 | "PATHNAME" created. |
| 331 | User name okay, need password. |
| 332 | Need account for login. |
| 350 | Requested file action pending further information. |
| 421 | Service not available, closing control connection. |
| 425 | Can't open data connection. |
| 426 | Connection closed; transfer aborted. |
| 430 | Invalid username or password. |
| 434 | Requested host unavailable. |
| 450 | Requested file action not taken. |
| 451 | Requested action aborted. Local error in processing. |
| 452 | Requested action not taken. |
| 501 | Syntax error in parameters or arguments. |
| 502 | Command not implemented. |
| 503 | Bad sequence of commands. |
| 504 | Command not implemented for that parameter. |
| 530 | Not logged in. |
| 532 | Need account for storing files. |
| 550 | Requested action not taken. File unavailable. |
| 551 | Requested action aborted. Page type unknown. |
| 552 | Requested file action aborted. Exceeded storage allocation. |
| 553 | Requested action not taken. File name not allowed. |
| 631 | Integrity protected reply. |
| 632 | Confidentiality and integrity protected reply. |
| 633 | Confidentiality protected reply. |
| 10054 | Connection reset by peer. |
| 10060 | Cannot connect to remote server. |
| 10061 | Cannot connect to remote server. The connection is active refused. |
| 10066 | Directory not empty. |
| 10068 | Too many users, server is full. |
- **transferBytes: Number**: The number of bytes transferred over the data channel during an

`FTP_RESPONSE`

event.

Access only on `FTP_RESPONSE` events; otherwise, an error will occur.
- **user: String**: The user name, if available. In some cases, such as when login events are encrypted, the user name is not available.
