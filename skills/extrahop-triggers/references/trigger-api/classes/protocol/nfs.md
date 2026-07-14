---
{
  "anchor": "nfs",
  "api_area": "trigger-api",
  "doc_kind": "class",
  "events": [
    "NFS_REQUEST",
    "NFS_RESPONSE"
  ],
  "examples": [],
  "methods": [
    "commitRecord(): void"
  ],
  "name": "NFS",
  "properties": [
    "accessTime: Number",
    "authMethod: String",
    "error: String",
    "fileHandle: Buffer",
    "isCommandFileInfo: Boolean",
    "isCommandRead: Boolean",
    "isCommandWrite: Boolean",
    "isRspAborted: Boolean",
    "method: String",
    "offset: Number",
    "processingTime: Number",
    "record: Object",
    "renameDirChanged: Boolean",
    "reqBytes: Number",
    "reqL2Bytes: Number",
    "reqPkts: Number",
    "reqRTO: Number",
    "reqSize: Number",
    "reqTransferTime: Number",
    "reqZeroWnd: Number",
    "resource: String",
    "roundTripTime: Number",
    "rspBytes: Number",
    "rspL2Bytes: Number",
    "rspPkts: Number",
    "rspRTO: Number",
    "rspSize: Number",
    "rspTransferTime: Number",
    "rspZeroWnd: Number",
    "statusCode: String",
    "symlink: Buffer | null",
    "txId: Number",
    "user: String",
    "verifierMethod: String",
    "version: Number"
  ],
  "section": "protocol-and-network-data-classes",
  "source_url": "https://docs.extrahop.com/current/extrahop-trigger-api/",
  "source_version": "26.2"
}
---

### NFS

The NFS class enables you to store metrics and access properties on `NFS_REQUEST` and `NFS_RESPONSE` events.

#### Events

- **NFS_REQUEST**: Runs on every NFS request processed by the device.
- **NFS_RESPONSE**: Runs on every NFS response processed by the device.

| Note: | The `NFS_RESPONSE` event runs after every `NFS_REQUEST` event, even if the corresponding response is never observed by the ExtraHop system. |
| --- | --- |

#### Methods

- **commitRecord(): void**: Sends a record to the configured recordstore on an

`NFS_RESPONSE`

event. Record commits on

`NFS_REQUEST`

events are not supported.

To view the default properties committed to the record object, see the `record` property below.

For built-in records, each unique record is committed only once, even if the `commitRecord()` method is called multiple times for the same unique record.

#### Properties

- **accessTime: Number**: The amount of time taken by the server to access a file on disk, expressed in milliseconds. For NFS, it is the time from every non-pipelined READ and WRITE command in an NFS flow until the payload containing the response is recorded by the ExtraHop system. The value is

`NaN`

on malformed and aborted responses, or if the timing is invalid or is not applicable.

Access only on `NFS_RESPONSE` events; otherwise, an error will occur.
- **authMethod: String**: The method for authenticating users.
- **error: String**: The detailed error message recorded by the ExtraHop system.

Access only on `NFS_RESPONSE` events; otherwise, an error will occur.
- **fileHandle: Buffer**: The file handle returned by the server on LOOKUP, CREATE, SYMLINK, MKNOD, LINK, or READDIRPLUS operations.
- **isCommandFileInfo: Boolean**: The value is

`true`

for file info commands.
- **isCommandRead: Boolean**: The value is

`true`

for READ commands.
- **isCommandWrite: Boolean**: The value is

`true`

for WRITE commands.
- **isRspAborted: Boolean**: The value is true if the connection is closed before the response was complete.

Access only on `NFS_RESPONSE` events; otherwise, an error will occur.
- **method: String**: The NFS method. Valid methods are listed under the NFS metric in the ExtraHop system.
- **offset: Number**: The file offset associated with NFS READ and WRITE commands.

Access only on `NFS_REQUEST` events; otherwise, an error will occur.
- **processingTime: Number**: The server processing time, expressed in milliseconds. The value is

`NaN`

on malformed and aborted responses or if the timing is invalid.

Access only on `NFS_RESPONSE` events; otherwise, an error will occur.
- **record: Object**: The record object that can be sent to the configured recordstore through a call to

`NFS.commitRecord()`

on a

`NFS_RESPONSE`

event.

The default record object can contain the following properties:

- `accessTime`
- `authMethod`
- `clientIsExternal`
- `clientZeroWnd`
- `error`
- `isCommandFileInfo`
- `isCommandRead`
- `isCommandWrite`
- `isRspAborted`
- `method`
- `offset`
- `processingTime`
- `receiverIsExternal`
- `renameDirChanged`
- `reqSize`
- `reqXfer`
- `resource`
- `rspSize`
- `rspXfer`
- `senderIsExternal`
- `serverIsExternal`
- `serverZeroWnd`
- `statusCode`
- `txID`
- `user`
- `version`

Access the record object only on `NFS_RESPONSE` events; otherwise, an error will occur.
- **renameDirChanged: Boolean**: The value is

`true`

if a resource rename request includes a directory move.

Access only on `NFS_REQUEST` events; otherwise, an error will occur.
- **reqBytes: Number**: The number of

L4

request bytes, excluding L4 headers.

Access only on `NFS_RESPONSE` events; otherwise, an error will occur.
- **reqL2Bytes: Number**: The number of

L2

request bytes, including L2 headers.

Access only on `NFS_RESPONSE` events; otherwise, an error will occur.
- **reqPkts: Number**: The number of request packets.

Access only on `NFS_RESPONSE` events; otherwise, an error will occur.
- **reqRTO: Number**: The number of request

retransmission timeouts

(RTOs).

Access only on `NFS_REQUEST` events; otherwise, an error will occur.
- **reqSize: Number**: The number of L7 request bytes, excluding NFS headers.
- **reqTransferTime: Number**: The request transfer time, expressed in milliseconds. If the request is contained in a single packet, the transfer time is zero. If the request spans multiple packets, the value is the amount of time between detection of the first NFS request packet and detection of the last packet by the ExtraHop system. A high value might indicate a large NFS request or a network delay. The value is

`NaN`

if there is no valid measurement, or if the timing is invalid.

Access only on `NFS_REQUEST` events; otherwise, an error will occur.
- **reqZeroWnd: Number**: The number of zero windows in the request.
- **resource: String**: The path and filename, concatenated together.
- **roundTripTime: Number**: The median round trip time (RTT), expressed in milliseconds.

An RTT is the time it took for a device to send a single TCP packet and receive an immediate corresponding acknowledgment (ACK) packet.

The median value is calculated by sampling the RTTs observed since the last

`NFS_RESPONSE`

event ran. The value is

`NaN`

if there are no RTT samples.

Access only on `NFS_RESPONSE` events; otherwise, an error will occur.
- **rspBytes: Number**: The number of

L4

response bytes, excluding L4 protocol overhead, such as ACKs, headers, and retransmissions.

Access only on `NFS_RESPONSE` events; otherwise, an error will occur.
- **rspL2Bytes: Number**: The number of

L2

response bytes, including protocol overhead, such as headers.

Access only on `NFS_RESPONSE` events; otherwise, an error will occur.
- **rspPkts: Number**: The number of response packets.

Access only on `NFS_RESPONSE` events; otherwise, an error will occur.
- **rspRTO: Number**: The number of request

retransmission timeouts

(RTOs).

Access only on `NFS_RESPONSE` events; otherwise, an error will occur.
- **rspSize: Number**: The number of L7 response bytes, excluding NFS headers.

Access only on `NFS_RESPONSE` events; otherwise, an error will occur.
- **rspTransferTime: Number**: The response transfer time, expressed in milliseconds. If the response is contained in a single packet, the transfer time is zero. If the response spans multiple packets, the value is the amount of time between detection of the first NFS response packet and detection of the last packet by the ExtraHop system. A high value might indicate a large NFS response or a network delay. The value is

`NaN`

if there is no valid measurement, or if the timing is invalid.

Access only on `NFS_RESPONSE` events; otherwise, an error will occur.
- **rspZeroWnd: Number**: The number of zero windows in the response.
- **statusCode: String**: The NFS status code of the request or response.
- **symlink: Buffer | null**: The argument specified in an NFS SYMLINK request.

The value is null if this property is accessed on an event other than NFS_REQUEST or if the `NFS.method` is not `SYMLINK`.
- **txId: Number**: The transaction ID.
- **user: String**: The ID of the Linux user, formatted as

uid:xxxx

.
- **verifierMethod: String**: The method for verifying the sender of the request.
- **version: Number**: The NFS version.
