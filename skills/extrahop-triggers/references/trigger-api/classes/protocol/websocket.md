---
{
  "anchor": "websocket",
  "api_area": "trigger-api",
  "doc_kind": "class",
  "events": [
    "WEBSOCKET_OPEN",
    "WEBSOCKET_CLOSE",
    "WEBSOCKET_MESSAGE"
  ],
  "examples": [],
  "methods": [],
  "name": "WebSocket",
  "properties": [
    "clientBytes: Number",
    "clientL2Bytes: Number",
    "clientPkts: Number",
    "clientRTO: Number",
    "clientZeroWnd: Number",
    "closeReason: String",
    "host: String",
    "isClientClose: Boolean",
    "isEncrypted: Boolean",
    "isMasked: Boolean",
    "isServerClose: Boolean",
    "msg: Buffer",
    "msgLength: Number",
    "msgType: String",
    "origin: String",
    "rawMsgLength: Number",
    "serverBytes: Number",
    "serverL2Bytes: Number",
    "serverPkts: Number",
    "serverRTO: Number",
    "serverZeroWnd: Number",
    "statusCode: Number",
    "uri: String"
  ],
  "section": "protocol-and-network-data-classes",
  "source_url": "https://docs.extrahop.com/current/extrahop-trigger-api/",
  "source_version": "26.2"
}
---

### WebSocket

The `WebSocket` class enables you to access properties on `WEBSOCKET_OPEN`, `WEBSOCKET_CLOSE`, and `WEBSOCKET_MESSAGE` events.

#### Events

- **WEBSOCKET_OPEN**: Runs when a successful handshake has been observed.
- **WEBSOCKET_CLOSE**: Runs when both close frames are observed, or when the underlying TCP connection is closed.
- **WEBSOCKET_MESSAGE**: Runs when all frames of a text or binary message have been observed.

#### Properties

- **clientBytes: Number**: The total number of bytes sent by the client during the entire WebSockets session.

Access only on `WEBSOCKET_MESSAGE` events; otherwise, an error will occur.
- **clientL2Bytes: Number**: The total number of

L2

client bytes observed during the entire WebSockets session.

Access only on `WEBSOCKET_MESSAGE` events; otherwise, an error will occur.
- **clientPkts: Number**: The total number of packets sent by the client during the entire WebSockets session.

Access only on `WEBSOCKET_MESSAGE` events; otherwise, an error will occur.
- **clientRTO: Number**: The total number of client

retransmission timeouts

(RTOs) observed during the WebSockets session.

Access only on `WEBSOCKET_MESSAGE` events; otherwise, an error will occur.
- **clientZeroWnd: Number**: The total number of zero windows sent by the client during the entire WebSockets session.

Access only on `WEBSOCKET_MESSAGE` events; otherwise, an error will occur.
- **closeReason: String**: The text message included in the first observed close frame that describes the reason the connection was closed. The value is

`null`

if the frame does not contain this information.

Access only on `WEBSOCKET_CLOSE` events; otherwise, an error will occur.
- **host: String**: The host provided in the handshake request from the client. The value is

`null`

if no host is provided.

Access only on `WEBSOCKET_OPEN` events; otherwise, an error will occur.
- **isClientClose: Boolean**: The value is

`true`

if the initial close frame was sent by the client.

Access only on `WEBSOCKET_CLOSE` events; otherwise, an error will occur.
- **isEncrypted: Boolean**: The value is

`true`

if the WebSocket connection is TLS-encrypted.
- **isMasked: Boolean**: The value is true if the frames of the WebSocket message are masked.

Access only on `WEBSOCKET_MESSAGE` events; otherwise, an error will occur.
- **isServerClose: Boolean**: The value is

`true`

if the initial close frame was sent by the server. The value is

`false`

if the connection was terminated abnormally.

Access only on `WEBSOCKET_CLOSE` events; otherwise, an error will occur.
- **msg: Buffer**: The

[Buffer](#buffer)

object containing the WebSocket message. If the message is compressed, the buffer contains the decompressed message. The buffer is

`null`

if the contents exceed the maximum length.

Access only on `WEBSOCKET_MESSAGE` events; otherwise, an error will occur.
- **msgLength: Number**: The length of the message, expressed in bytes. If the message is compressed, the length reflects the total length of the decompressed message, even if the message exceeds the maximum length.

Access only on `WEBSOCKET_MESSAGE` events; otherwise, an error will occur.
- **msgType: String**: The type of WebSocket message frame. Valid values are

`TEXT`

or

`BINARY`

.

Access only on `WEBSOCKET_MESSAGE` events; otherwise, an error will occur.
- **origin: String**: The origin URL provided in the handshake request initiated by the client.

Access only on `WEBSOCKET_OPEN` events; otherwise, an error will occur.
- **rawMsgLength: Number**: The length of the raw message as it was observed, expressed in bytes. If the message is compressed, this property reflects the length of the compressed message.

Access only on `WEBSOCKET_MESSAGE` events; otherwise, an error will occur.
- **serverBytes: Number**: The total number of bytes sent by the server during the entire WebSockets session.

Access only on `WEBSOCKET_MESSAGE` events; otherwise, an error will occur.
- **serverL2Bytes: Number**: The total number of

L2

server bytes observed during the entire WebSockets session.

Access only on `WEBSOCKET_MESSAGE` events; otherwise, an error will occur.
- **serverPkts: Number**: The total number of packets sent by the server during the entire WebSockets session.

Access only on `WEBSOCKET_MESSAGE` events; otherwise, an error will occur.
- **serverRTO: Number**: The total number of server

retransmission timeouts

(RTOs) observed during the WebSockets session.

Access only on `WEBSOCKET_MESSAGE` events; otherwise, an error will occur.
- **serverZeroWnd: Number**: The total number of zero windows sent by the server during the entire WebSockets session.

Access only on `WEBSOCKET_MESSAGE` events; otherwise, an error will occur.
- **statusCode: Number**: The status code that represents the reason the connection was closed, as defined in RFC 6455.

The value is `NO_STATUS_RECVD` (`1005`) if the initial close frame does not include a status code. The value is `NaN` if connection was terminated abnormally.

Access only on `WEBSOCKET_CLOSE` events; otherwise, an error will occur.
- **uri: String**: The URI provided in the handshake request initiated by the client.

Access only on `WEBSOCKET_OPEN` events; otherwise, an error will occur.
