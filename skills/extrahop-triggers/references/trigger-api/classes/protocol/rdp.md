---
{
  "anchor": "rdp",
  "api_area": "trigger-api",
  "doc_kind": "class",
  "events": [
    "RDP_CLOSE",
    "RDP_OPEN",
    "RDP_TICK"
  ],
  "examples": [],
  "methods": [
    "commitRecord(): void"
  ],
  "name": "RDP",
  "properties": [
    "clientBuild: String",
    "clientName: String",
    "cookie: String",
    "desktopHeight: Number",
    "desktopWidth: Number",
    "encryptionProtocol: String",
    "error: String",
    "filename: String",
    "isDecrypted: Boolean",
    "isEncrypted: Boolean",
    "isError: Boolean",
    "keyboardLayout: String",
    "payloadFileSize: Number | Null",
    "payloadMediaType: String | Null",
    "payloadSHA256: String | Null",
    "record: Object",
    "requestedColorDepth: String",
    "requestedProtocols: Array of Strings",
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
    "selectedProtocol: String",
    "user: String"
  ],
  "section": "protocol-and-network-data-classes",
  "source_url": "https://docs.extrahop.com/current/extrahop-trigger-api/",
  "source_version": "26.2"
}
---

### RDP

RDP (Remote Desktop Protocol) is a proprietary protocol created by Microsoft that enables a Windows computer to connect to another Windows computer on the same network or over the Internet. The `RDP` class enables you to store metrics and access properties on `RDP_OPEN`, `RDP_CLOSE`, or `RDP_TICK` events.

#### Events

- **RDP_CLOSE**: Runs when an RDP connection is closed.
- **RDP_OPEN**: Runs when a new RDP connection is opened.
- **RDP_TICK**: Runs periodically while the user interacts with the RDP application.

#### Methods

- **commitRecord(): void**: Sends a record to the configured recordstore on an

`RDP_OPEN`

,

`RDP_CLOSE`

, or

`RDP_TICK`

event.

The event determines which properties are committed to the record object. To view the default properties committed to the record object, see the `record` property below.

For built-in records, each unique record is committed only once, even if the `commitRecord()` method is called multiple times for the same unique record.

#### Properties

- **clientBuild: String**: The build number of the RDP client. This property is not available if the RDP connection is encrypted.
- **clientName: String**: The name of the client computer. This property is not available if the RDP connection is encrypted.
- **cookie: String**: The routing cookie stored by the RDP client.
- **desktopHeight: Number**: The height of the desktop, expressed in pixels. This property is not available if the RDP connection is encrypted.
- **desktopWidth: Number**: The width of the desktop, expressed in pixels. This property is not available if the RDP connection is encrypted.
- **encryptionProtocol: String**: The protocol that the transaction is encrypted with.
- **error: String**: The detailed error message recorded by the ExtraHop system.
- **filename: String**: The name of the file contained in the payload. The value is

`null`

if the payload does not contain a file or if there is no payload.
- **isDecrypted: Boolean**: The value is

`true`

if the ExtraHop system securely decrypted and analyzed the transaction. Decrypted traffic analysis can expose advanced threats that hide within encrypted traffic.
- **isEncrypted: Boolean**: The value is

`true`

if the RDP connection is encrypted.
- **isError: Boolean**: The value is

`true`

if an error occurred on the event.
- **keyboardLayout: String**: The keyboard layout, which indicates the arrangement of keys and the input language. This property is not available if the RDP connection is encrypted.
- **payloadFileSize: Number | Null**: The size of the file contained in the payload, expressed in bytes. The value is

`null`

if there is no payload.
- **payloadMediaType: String | Null**: The type of media contained in the payload. The value is

`null`

if there is no payload or the media type is unknown.
- **payloadSHA256: String | Null**: The hexadecimal representation of the SHA-256 hash of the payload. The string contains no delimiters, as shown in the following example:

```javascript
468c6c84db844821c9ccb0983c78d1cc05327119b894b5ca1c6a1318784d3675
```

The value is `null` if there is no payload.
- **record: Object**: The record object that can be sent to the configured recordstore through a call to

`RDP.commitRecord()`

on either an

`RDP_OPEN`

,

`RDP_CLOSE`

, or

`RDP_TICK`

event.

The default record object can contain the following properties:

| `RDP_OPEN` and `RDP_CLOSE` | `RDP_TICK` |
| --- | --- |
| `clientBuild` | `clientBuild` |
| `clientIsExternal` | `clientBytes` |
| `clientName` | `clientIsExternal` |
| `cookie` | `clientL2Bytes` |
| `desktopHeight` | `clientName` |
| `desktopWidth` | `clientPkts` |
| `error` | `clientRTO` |
| `isEncrypted` | `clientZeroWnd` |
| `keyboardLayout` | `cookie` |
| `receiverIsExternal` | `desktopHeight` |
| `requestedColorDepth` | `desktopWidth` |
| `requestedProtocols` | `error` |
| `selectedProtocol` | `isEncrypted` |
| `senderIsExternal` | `keyboardLayout` |
| `serverIsExternal` | `receiverIsExternal` |
|  | `requestedColorDepth` |
|  | `requestedProtocols` |
|  | `roundTripTime` |
|  | `selectedProtocol` |
|  | `senderIsExternal` |
|  | `serverBytes` |
|  | `serverIsExternal` |
|  | `serverL2Bytes` |
|  | `serverPkts` |
|  | `serverRTO` |
|  | `serverZeroWnd` |
- **requestedColorDepth: String**: The color depth requested by the RDP client. This property is not available if the RDP connection is encrypted.
- **requestedProtocols: Array of Strings**: The list of supported security protocols.
- **reqBytes: Number**: The number of

L4

bytes in the request.

Access only on `RDP_TICK` events; otherwise, an error will occur.
- **reqL2Bytes: Number**: The number of

L2

bytes in the request.

Access only on `RDP_TICK` events; otherwise, an error will occur.
- **reqPkts: Number**: The number of packets in the request.

Access only on `RDP_TICK` events; otherwise, an error will occur.
- **reqRTO: Number**: The number of

retransmission timeouts

(RTOs) in the request.

Access only on `RDP_TICK` events; otherwise, an error will occur.
- **reqZeroWnd: Number**: The number of zero windows in the request.

Access only on `RDP_TICK` events; otherwise, an error will occur.
- **roundTripTime: Number**: The median round trip time (RTT), expressed in milliseconds.

An RTT is the time it took for a device to send a single TCP packet and receive an immediate corresponding acknowledgment (ACK) packet.

The median value is calculated by sampling the RTTs observed since the last

`RDP_TICK`

event ran. The value is

`NaN`

if there are no RTT samples.

Access only on `RDP_TICK` events; otherwise, an error will occur.
- **rspBytes: Number**: The number of

L4

response bytes, excluding L4 protocol overhead, such as ACKs, headers, and retransmissions.

Access only on `RDP_TICK` events; otherwise, an error will occur.
- **rspL2Bytes: Number**: The number of

L2

response bytes, including protocol overhead, such as headers.

Access only on `RDP_TICK` events; otherwise, an error will occur.
- **rspPkts: Number**: The number of packets in the response.

Access only on `RDP_TICK` events; otherwise, an error will occur.
- **rspRTO: Number**: The number of

retransmission timeouts

(RTOs) in the response.

Access only on `RDP_TICK` events; otherwise, an error will occur.
- **rspZeroWnd: Number**: The number of zero windows in the response.

Access only on `RDP_TICK` events; otherwise, an error will occur.
- **selectedProtocol: String**: The selected security protocol.
- **user: String**: The username, if available. In some cases, such as when login events are encrypted and the sensor has not been configured to

[decrypt the traffic](https://docs.extrahop.com/26.2/ssl-decryption-concepts)

, the username is unavailable.
