---
{
  "anchor": "cifs",
  "api_area": "trigger-api",
  "doc_kind": "class",
  "events": [
    "CIFS_REQUEST",
    "CIFS_RESPONSE"
  ],
  "examples": [
    "Example: Monitor SMB actions on devices"
  ],
  "methods": [
    "commitRecord(): void"
  ],
  "name": "CIFS",
  "properties": [
    "accessMask: Number",
    "accessTime: Number",
    "clientDialects: Array of Strings",
    "createOptions: Number",
    "dialect: String",
    "encryptedBytes: Number",
    "encryptionProtocol: String",
    "error: String",
    "filename: String",
    "isCommandCreate: Boolean",
    "isCommandClose: Boolean",
    "isCommandDelete: Boolean",
    "isCommandFileInfo: Boolean",
    "isCommandLock: Boolean",
    "isCommandRead: Boolean",
    "isCommandRename: Boolean",
    "isCommandWrite: Boolean",
    "isDecrypted: Boolean",
    "isEncrypted: Boolean",
    "isRspAborted: Boolean",
    "isRspSigned: Boolean",
    "isLvl2OplockSupported: Boolean",
    "isUnicodeSupported: Boolean",
    "maxBufferLen: Number",
    "maxMpxCount: Number",
    "method: String",
    "msgID: Number",
    "nativeLanman: String | Null",
    "nativeOS: String | Null",
    "payload: Buffer",
    "payloadMediaType: String | Null",
    "payloadOffset: Number",
    "payloadSHA256: String | Null",
    "primaryDomain: String | Null",
    "processingTime: Number",
    "record: Object",
    "reqBytes: Number",
    "reqL2Bytes: Number",
    "reqPkts: Number",
    "reqRTO: Number",
    "reqSize: Number",
    "reqTransferTime: Number",
    "reqVersion: String",
    "reqZeroWnd: Number",
    "resource: String",
    "roundTripTime: Number",
    "rspBytes: Number",
    "rspL2Bytes: Number",
    "rspPkts: Number",
    "rspRTO: Number",
    "rspSize: Number",
    "rspTransferTime: Number",
    "rspVersion: String",
    "rspZeroWnd: Number",
    "sessionId: Number",
    "share: String",
    "statusCode: Number",
    "user: String",
    "warning: String"
  ],
  "section": "protocol-and-network-data-classes",
  "source_url": "https://docs.extrahop.com/current/extrahop-trigger-api/",
  "source_version": "26.2"
}
---

### CIFS

The `CIFS` class enables you to store metrics and access properties on `CIFS_REQUEST` and `CIFS_RESPONSE` events.

#### Events

- **CIFS_REQUEST**: Runs on every SMB request processed by the device.
- **CIFS_RESPONSE**: Runs on every SMB response processed by the device.

| Note: | The `CIFS_RESPONSE` event runs after every `CIFS_REQUEST` event, even if the corresponding response is never observed by the ExtraHop system. |
| --- | --- |

#### Methods

- **commitRecord(): void**: Sends a record to the configured recordstore on a

`CIFS_RESPONSE`

event. Record commits on

`CIFS_REQUEST`

events are not supported.

To view the default properties committed to the record object, see the `record` property below.

For built-in records, each unique record is committed only once, even if the `commitRecord()` method is called multiple times for the same unique record.

#### Properties

| Important: | Access time is the time it takes for a SMB server to receive a requested block. There is no access time for operations that do not access actual block data within a file. Processing time is the time it takes for a SMB server to respond to the operation requested by the client, such as a metadata retrieval request.There are no access times for SMB2_CREATE commands, which create a file that is referenced in the response by an SMB2_FILEID command. The referenced file blocks are then read from or written to the NAS-storage device. These file read and write operations are calculated as access times. |
| --- | --- |

- **accessMask: Number**: A numeric representation of the hexadecimal number that specifies the access mask for the request.

Access only on `CIFS_REQUEST` events; otherwise, an error will occur.
- **accessTime: Number**: The amount of time taken by the server to access a file on disk, expressed in milliseconds. For SMB, this is the time from the first READ command in a SMB flow until the first byte of the response payload. The value is

`NaN`

if the measurement or timing is invalid.

Access only on `CIFS_RESPONSE` events; otherwise, an error will occur.
- **clientDialects: Array of Strings**: An array of SMB protocol versions that the client supports.
- **createOptions: Number**: A numeric representation of the hexadecimal number that specifies the options for creating or opening a file.

Access only on `CIFS_REQUEST` events; otherwise, an error will occur.
- **dialect: String**: The dialect of SMB negotiated between the client and the server.
- **encryptedBytes: Number**: The number of encrypted bytes in the request or response.
- **encryptionProtocol: String**: The protocol that the transaction is encrypted with.
- **error: String**: The detailed error message recorded by the ExtraHop system.

Access only on `CIFS_RESPONSE` events; otherwise, an error will occur.
- **filename: String**: The name of the file being transferred.
- **isCommandCreate: Boolean**: The value is

`true`

if the message contains an SMB file creation command.
- **isCommandClose: Boolean**: The value is

`true`

if the message contains an SMB CLOSE command.
- **isCommandDelete: Boolean**: The value is

`true`

if the message contains an SMB DELETE command.
- **isCommandFileInfo: Boolean**: The value is

`true`

if the message contains an SMB file info command.
- **isCommandLock: Boolean**: The value is

`true`

if the message contains an SMB locking command.
- **isCommandRead: Boolean**: The value is

`true`

if the message contains an SMB READ command.
- **isCommandRename: Boolean**: The value is

`true`

if the message contains an SMB RENAME command.
- **isCommandWrite: Boolean**: The value is

`true`

if the message contains an SMB WRITE command.
- **isDecrypted: Boolean**: The value is true if the ExtraHop system securely decrypted and analyzed the transaction. Decrypted traffic analysis can expose advanced threats that hide within encrypted traffic.
- **isEncrypted: Boolean**: The value is true if the transaction is encrypted.
- **isRspAborted: Boolean**: The value is true if the connection is closed before the SMB response was complete.

Access only on `CIFS_RESPONSE` events; otherwise, an error will occur.
- **isRspSigned: Boolean**: The value is true if the response is signed by the SMB server.
- **isLvl2OplockSupported: Boolean**: Indicates whether the client supports level 2 oplocks for files.
- **isUnicodeSupported: Boolean**: Indicates whether the client supports unicode characters.
- **maxBufferLen: Number**: The maximum message buffer size that the client supports, specified in bytes. If the client does not specify a maximum buffer size, the value is

`0`

.
- **maxMpxCount: Number**: The maximum number of SMB operations initiated by the client that can run concurrently on the server. If the client does not specify a maximum number of operations, the value is

`0`

.
- **method: String**: The SMB method. Correlates to the methods listed under the SMB metric in the ExtraHop system.
- **msgID: Number**: The SMB transaction identifier.
- **nativeLanman: String | Null**: The LAN Manager software running on the SMB client. If the client does not specify the LAN Manager software, the value is

`null`

.
- **nativeOS: String | Null**: The OS running on the SMB client. If the client does not specify an OS, the value is

`null`

.
- **payload: Buffer**: The

[Buffer](#buffer)

object containing the payload bytes starting from the READ or WRITE command in the SMB message.

The buffer contains the `N` first bytes of the payload, where `N` is the number of payload bytes specified by the L7 Payload Bytes to Buffer option when the trigger was configured through the ExtraHop WebUI. The default number of bytes is 2048. For more information, see [Advanced trigger options](#advanced-trigger-options).

| Note: | The buffer cannot contain more than 4 KB, even if the L7 Payload Bytes to Buffer option is set to a higher value. |
| --- | --- |

For larger volumes of payload bytes, the payload might be spread across a series of READ or WRITE commands so that no single trigger event contains the entire requested payload. You can reassemble the payload into a single, consolidated buffer through the `Flow.store` and `payloadOffset` properties.
- **payloadMediaType: String | Null**: The type of media contained in the payload. The value is

`null`

if there is no payload or the media type is unknown.
- **payloadOffset: Number**: The file offset, expressed in bytes, within the

`resource`

property. The payload property is obtained from the

`resource`

property at the offset.
- **payloadSHA256: String | Null**: The hexadecimal representation of the SHA-256 hash of the payload. The string contains no delimiters, as shown in the following example:

```javascript
468c6c84db844821c9ccb0983c78d1cc05327119b894b5ca1c6a1318784d3675
```

If there is no payload, the value is `null`.
- **primaryDomain: String | Null**: The primary Active Directory domain that the client belongs to. If the client does not specify a primary domain, the value is

`null`

.
- **processingTime: Number**: The server processing time, expressed in milliseconds. The value is

`NaN`

on malformed and aborted responses or if the timing is invalid.

Access only on `CIFS_RESPONSE` events; otherwise, an error will occur.
- **record: Object**: The record object that can be sent to the configured recordstore through a call to

`CIFS.commitRecord()`

on a

`CIFS_RESPONSE`

event.

The default record object can contain the following properties:

- `accessTime`
- `clientIsExternal`
- `clientZeroWnd`
- `error`
- `isCommandCreate`
- `isCommandDelete`
- `isCommandFileInfo`
- `isCommandLock`
- `isCommandRead`
- `isCommandRename`
- `isCommandWrite`
- `isHighEntropy`
- `method`
- `processingTime`
- `receiverIsExternal`
- `reqPayloadMediaType`
- `reqPayloadSHA256`
- `reqSize`
- `reqXfer`
- `resource`
- `rspBytes`
- `rspPayloadMediaType`
- `rspPayloadSHA256`
- `rspXfer`
- `senderIsExternal`
- `serverIsExternal`
- `serverZeroWnd`
- `share`
- `statusCode`
- `user`
- `warning`

Access only on `CIFS_RESPONSE` events; otherwise, an error will occur.
- **reqBytes: Number**: The number of

L4

request bytes, excluding L4 headers.

Access only on `CIFS_RESPONSE` events; otherwise, an error will occur.
- **reqL2Bytes: Number**: The number of

L2

request bytes, including L2 headers.

Access only on `CIFS_RESPONSE` events; otherwise, an error will occur.
- **reqPkts: Number**: The number of request packets.

Access only on `CIFS_RESPONSE` events; otherwise, an error will occur.
- **reqRTO: Number**: The number of request

retransmission timeouts

(RTOs).

Access only on `CIFS_RESPONSE` events; otherwise, an error will occur.
- **reqSize: Number**: The number of L7 request bytes, excluding SMB headers.
- **reqTransferTime: Number**: The request transfer time, expressed in milliseconds. If the request is contained in a single packet, the transfer time is zero. If the request spans multiple packets, the value is the amount of time between detection of the first SMB request packet and detection of the last packet by the ExtraHop system. A high value might indicate a large SMB request or a network delay. The value is

`NaN`

if there is no valid measurement, or if the timing is invalid.

Access only on `CIFS_REQUEST` events; otherwise, an error will occur.
- **reqVersion: String**: The version of SMB running on the request.
- **reqZeroWnd: Number**: The number of zero windows in the request.
- **resource: String**: The share, path, and filename, concatenated together.
- **roundTripTime: Number**: The median round trip time (RTT), expressed in milliseconds.

An RTT is the time it took for a device to send a single TCP packet and receive an immediate corresponding acknowledgment (ACK) packet.

The median value is calculated by sampling the RTTs observed since the last

`CIFS_RESPONSE`

event ran. The value is

`NaN`

if there are no RTT samples.

Access only on `CIFS_RESPONSE` events; otherwise, an error will occur.
- **rspBytes: Number**: The number of

L4

response bytes, excluding L4 protocol overhead, such as ACKs, headers, and retransmissions.

Access only on `CIFS_RESPONSE` events; otherwise, an error will occur.
- **rspL2Bytes: Number**: The number of

L2

response bytes, including protocol overhead, such as headers.

Access only on `CIFS_RESPONSE` events; otherwise, an error will occur.
- **rspPkts: Number**: The number of response packets.

Access only on `CIFS_RESPONSE` events; otherwise, an error will occur.
- **rspRTO: Number**: The number of response

retransmission timeouts

(RTOs).

Access only on `CIFS_RESPONSE` events; otherwise, an error will occur.
- **rspSize: Number**: The number of L7 response bytes, excluding SMB headers.

Access only on `CIFS_RESPONSE` events; otherwise, an error will occur.
- **rspTransferTime: Number**: The response transfer time, expressed in milliseconds. If the response is contained in a single packet, the transfer time is zero. If the response spans multiple packets, the value is the amount of time between detection of the first SMB response packet and detection of the last packet by the ExtraHop system. A high value might indicate a large SMB response or a network delay. The value is

`NaN`

if there is no valid measurement, or if the timing is invalid.

Access only on `CIFS_RESPONSE` events; otherwise, an error will occur.
- **rspVersion: String**: The version of SMB running on the response.

Access only on `CIFS_RESPONSE` events; otherwise, an error will occur.
- **rspZeroWnd: Number**: The number of zero windows in the response.
- **sessionId: Number**: The ID of the SMB session.
- **share: String**: The name of the share the user is connected to.
- **statusCode: Number**: The numeric status code of the response (SMB1 and SMB2 only).

Access only on `CIFS_RESPONSE` events; otherwise, an error will occur.
- **user: String**: The username, if available. In some cases, such as when the login event was not visible or the access was anonymous, the username is not available.
- **warning: String**: The detailed warning message recorded by the ExtraHop system.

Access only on `CIFS_RESPONSE` events; otherwise, an error will occur.

#### Trigger Examples

- [Example: Monitor SMB actions on devices](#example-monitor-smb-actions-on-devices)
