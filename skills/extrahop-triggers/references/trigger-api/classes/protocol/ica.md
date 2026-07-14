---
{
  "anchor": "ica",
  "api_area": "trigger-api",
  "doc_kind": "class",
  "events": [
    "ICA_AUTH",
    "ICA_CLOSE",
    "ICA_OPEN",
    "ICA_TICK"
  ],
  "examples": [],
  "methods": [
    "commitRecord(): void"
  ],
  "name": "ICA",
  "properties": [
    "application: String",
    "authDomain: String",
    "channels: Array",
    "name: String",
    "description: String",
    "clientBytes: Number",
    "serverBytes: Number",
    "clientMachine: String",
    "clientCGPMsgCount: Number",
    "clientLatency: Number",
    "clientL2Bytes: Number",
    "clientMsgCount: Number",
    "clientPkts: Number",
    "clientRTO: Number",
    "clientZeroWnd: Number",
    "clientType: String",
    "clipboardData: Buffer",
    "clipboardDataType: String",
    "frameCutDuration: Number",
    "frameSendDuration: Number",
    "host: String",
    "isAborted: Boolean",
    "isCleanShutdown: Boolean",
    "isClientDiskRead: Boolean",
    "isClientDiskWrite: Boolean",
    "isEncrypted: Boolean",
    "isSharedSession: Boolean",
    "launchParams: String",
    "loadTime: Number",
    "loginTime: Number",
    "networkLatency: Number",
    "payload: Buffer",
    "printerName: String",
    "program: String",
    "record: Object",
    "resource: String",
    "resourceOffset: Number",
    "roundTripTime: Number",
    "serverCGPMsgCount: Number",
    "serverL2Bytes: Number",
    "serverMsgCount: Number",
    "serverPkts: Number",
    "serverRTO: Number",
    "serverZeroWnd: Number",
    "tickChannel: String",
    "user: String"
  ],
  "section": "protocol-and-network-data-classes",
  "source_url": "https://docs.extrahop.com/current/extrahop-trigger-api/",
  "source_version": "26.2"
}
---

### ICA

The ICA class enables you to store metrics and access properties on `ICA_OPEN`, `ICA_AUTH`, `ICA_TICK`, and `ICA_CLOSE` events.

#### Events

- **ICA_AUTH**: Runs when the ICA authentication is complete.
- **ICA_CLOSE**: Runs when the ICA session is closed.
- **ICA_OPEN**: Runs immediately after the ICA application is initially loaded.
- **ICA_TICK**: Runs periodically while the user interacts with the ICA application.

After the `ICA_OPEN` event has run at least once, the `ICA_TICK` event is run any time latency is reported and returned by the `clientLatency` or `networkLatency` properties described below.

#### Methods

- **commitRecord(): void**: Sends a record to the configured recordstore on either an

`ICA_OPEN`

,

`ICA_TICK`

, or

`ICA_CLOSE`

event. Record commits on

`ICA_AUTH`

events are not supported.

The event determines which properties are committed to the record object. To view the default properties committed for each event, see the `record` property below.

For built-in records, each unique record is committed only once, even if the `commitRecord()` method is called multiple times for the same unique record.

#### Properties

- **application: String**: The name of the application being launched.
- **authDomain: String**: The Windows authentication domain to which the user belongs.
- **channels: Array**: An array of objects containing information about virtual channels observed since the last

`ICA_TICK`

event.

Access only on `ICA_TICK`events; otherwise, an error will occur.

Each object contains the following properties:

- **name: String**: The name of the virtual channel.
- **description: String**: The friendly description of the channel name.
- **clientBytes: Number**: The total number of bytes sent by the

client

for the channel since the last

`ICA_TICK`

event ran.
- **serverBytes: Number**: The total number of bytes sent by the server for the channel since the last

`ICA_TICK`

event ran.
- **clientMachine: String**: The name of the

client

machine. The name is displayed by the ICA client and is typically the hostname of the client machine.
- **clientBytes: Number**: The total number of bytes sent by the client since the last

`ICA_TICK`

event ran. Note that this property does not return the total number of bytes for the entire ICA session.

Access only on `ICA_CLOSE` or `ICA_TICK` events; otherwise, an error will occur.
- **clientCGPMsgCount: Number**: The number of client CGP messages since the last

`ICA_TICK`

event.

Access only on `ICA_TICK` events; otherwise, an error will occur.
- **clientLatency: Number**: The latency of the

client

, expressed in milliseconds, as reported by the End User Experience Management (EUEM) beacon.

Client latency is reported when a packet from the client on the EUEM channel reports the result of a single ICA round trip measurement.

Access only on `ICA_TICK` events; otherwise, an error will occur.
- **clientL2Bytes: Number**: The total number of

L2

client bytes observed since the last

`ICA_TICK`

event ran. Note that this property does not return the total number of bytes for the entire ICA session.

Access only on `ICA_CLOSE` or `ICA_TICK` events; otherwise, an error will occur.
- **clientMsgCount: Number**: The number of client messages since the last

`ICA_TICK`

event.

Access only on `ICA_TICK` events; otherwise, an error will occur.
- **clientPkts: Number**: The total number of packets sent by the client since the last

`ICA_TICK`

event ran. Note that this property does not return the total number of packets for the entire ICA session.

Access only on `ICA_CLOSE` or `ICA_TICK` events; otherwise, an error will occur.
- **clientRTO: Number**: The total number of client

retransmission timeouts

(RTOs) observed since the last

`ICA_TICK`

event ran. Note that this property does not return the total number of client RTOs for the entire ICA session.

Access only on `ICA_CLOSE` or `ICA_TICK` events; otherwise, an error will occur.
- **clientZeroWnd: Number**: The total number of zero windows sent by the client since the last

`ICA_TICK`

event ran. Note that this property does not return the total number of zero windows for the entire ICA session.

Access only on `ICA_CLOSE` or `ICA_TICK` events; otherwise, an error will occur.
- **clientType: String**: The type of ICA client, which is the user-agent equivalent to ICA.
- **clipboardData: Buffer**: A

[Buffer](#buffer)

object containing raw data from the clipboard transfer.

The value is `null` if the `ICA_TICK` event did not result from a clipboard data transfer, or if the channel specified by the `tickChannel` property is not a clipboard channel.

The maximum number of bytes in the buffer is specified by the Clipboard Bytes to Buffer field when the trigger was configured through the ExtraHop system. The default maximum object size is 1024 bytes. For more information, see the [Advanced trigger options](#advanced-trigger-options).

To determine the direction of the clipboard data transfer, access this property through `Flow.sender`, `Flow.receiver`, `Flow.client`, or `Flow.server`.

Access only on `ICA_TICK` events; otherwise, an error will occur.
- **clipboardDataType: String**: The type of data on the clipboard transfer. The following clipboard types are supported:

- `TEXT`
- `BITMAP`
- `METAFILEPICT`
- `SYMLINK`
- `DIF`
- `TIFF`
- `OEMTEXT`
- `DIB`
- `PALLETTE`
- `PENDATA`
- `RIFF`
- `WAVE`
- `UNICODETEXT`
- `EHNMETAFILE`
- `OWNERDISPLAY`
- `DSPTEXT`
- `DSPBITMAP`
- `DSPMETAFILEPICT`
- `DSPENHMETAFILE`

The value is `null` if the `ICA_TICK` event did not result from a clipboard data transfer, or if the channel specified by the `tickChannel` property is not a clipboard channel.

Access only on `ICA_TICK` events; otherwise, an error will occur.
- **frameCutDuration: Number**: The frame cut duration, as reported by the EUEM beacon.

Access only on `ICA_TICK` events; otherwise, an error will occur.
- **frameSendDuration: Number**: The frame send duration, as reported by the EUEM beacon.

Access only on `ICA_TICK` events; otherwise, an error will occur.
- **host: String**: The host name of the Citrix server.
- **isAborted: Boolean**: The value is

`true`

if the application fails to launch successfully.

Access only on `ICA_CLOSE` events; otherwise, an error will occur.
- **isCleanShutdown: Boolean**: The value is

`true`

if the application shuts down cleanly.

Access only on `ICA_CLOSE` events; otherwise, an error will occur.
- **isClientDiskRead: Boolean**: The value is

`true`

if a file was read from the client disk to the Citrix server. The value is

`null`

if the command is not a file operation, or if the channel specified by the

`tickChannel`

property is not a file channel.

Access only on `ICA_TICK` events; otherwise, an error will occur.
- **isClientDiskWrite: Boolean**: The value is

`true`

if a file was written from the Citrix server to the client disk. The value is

`null`

if the command is not a file operation, or if the channel specified by the

`tickChannel`

property is not a file channel.

Access only on `ICA_TICK` events; otherwise, an error will occur.
- **isEncrypted: Boolean**: The value is

`true`

if the application is encrypted with RC5 encryption.
- **isSharedSession: Boolean**: The value is

`true`

if the application is launched over an existing connection.
- **launchParams: String**: The string that represents the parameters.
- **loadTime: Number**: The load time of the given application, expressed in milliseconds.

| Note: | The load time is recorded only for the initial application load. The ExtraHop system does not measure load time for applications launched over existing sessions and instead reports the initial load time on subsequent application loads. Choose `ICA.isSharedSession` to distinguish between initial and subsequent application loads. |
| --- | --- |
- **loginTime: Number**: The user login time, expressed in milliseconds.

Access only on `ICA_OPEN`, `ICA_CLOSE`, or `ICA_TICK` events; otherwise, an error will occur.

| Note: | The login time is recorded only for the initial application load. The ExtraHop system does not measure login time for applications launched over existing sessions and instead reports the initial login time on subsequent application loads. Choose `ICA.isSharedSession` to distinguish between initial and subsequent application loads. |
| --- | --- |
- **networkLatency: Number**: The current latency advertised by the

client

, expressed in milliseconds.

Network latency is reported when a specific ICA packet from the client contains latency information.

Access only on `ICA_TICK` events; otherwise, an error will occur.
- **payload: Buffer**: The

[Buffer](#buffer)

object that contains the raw payload bytes of the file that was read or written on the event.

The buffer contains the `N` first bytes of the payload, where `N` is the number of payload bytes specified by the Bytes to Buffer field when the trigger was configured through the ExtraHop WebUI. The default number of bytes is 2048. For more information, see [Advanced trigger options](#advanced-trigger-options).

The value is `null` if the channel specified by the `tickChannel` property is not a file channel.

Access only on `ICA_TICK` events; otherwise, an error will occur.
- **printerName: String**: The name of the printer driver.

Access only on `ICA_TICK` events; otherwise, an error will occur.
- **program: String**: The name of the program, or application, that is being launched.
- **record: Object**: The record object that can be sent to the configured recordstore through a call to

`ICA.commitRecord()`

on either an

`ICA_OPEN`

,

`ICA_TICK`

, or

`ICA_CLOSE`

event.

The event on which the method was called determines which properties the default record object can contain as displayed in the following table:

| `ICA_CLOSE` | `ICA_OPEN` | `ICA_TICK` |
| --- | --- | --- |
| `authDomain` | `authDomain` | `authDomain` |
| `clientBytes` | `clientIsExternal` | `clientIsExternal` |
| `clientIsExternal` | `clientMachine` | `clientBytes` |
| `clientL2Bytes` | `clientType` | `clientCGPMsgCount` |
| `clientMachine` | `clientZeroWnd` | `clientL2Bytes` |
| `clientPkts` | `host` | `clientLatency` |
| `clientRTO` | `isEncrypted` | `clientMachine` |
| `clientType` | `isSharedSession` | `clientMsgCount` |
| `clientZeroWnd` | `launchParams` | `clientPkts` |
| `host` | `loadTime` | `clientRTO` |
| `isAborted` | `loginTime` | `clientType` |
| `isCleanShutdown` | `program` | `clientZeroWnd` |
| `isEncypted` | `receiverIsExternal` | `frameCutDuration` |
| `isSharedSession` | `senderIsExternal` | `frameSendDuration` |
| `launchParams` | `serverIsExternal` | `host` |
| `loadTime` | `serverZeroWnd` | `isClientDiskRead` |
| `loginTime` | `user` | `isClientDiskWrite` |
| `program` |  | `isEncrypted` |
| `receiverIsExternal` |  | `isSharedSession` |
| `roundTripTime` |  | `launchParams` |
| `senderIsExternal` |  | `loadTime` |
| `serverBytes` |  | `loginTime` |
| `serverIsExternal` |  | `networkLatency` |
| `serverL2Bytes` |  | `program` |
| `serverPkts` |  | `receiverIsExternal` |
| `serverRTO` |  | `resource` |
| `serverZeroWnd` |  | `roundTripTime` |
| `user` |  | `senderIsExternal` |
|  |  | `serverBytes` |
|  |  | `serverCGPMsgCount` |
|  |  | `serverIsExternal` |
|  |  | `serverL2Bytes` |
|  |  | `serverMsgCount` |
|  |  | `serverPkts` |
|  |  | `serverRTO` |
|  |  | `serverZeroWnd` |
|  |  | `tickChannel` |
|  |  | `user` |

Access the record object only on `ICA_OPEN`, `ICA_CLOSE`, and `ICA_TICK` events; otherwise, an error will occur.
- **resource: String**: The path of the file that was read or written on the event, if known. The value is

`null`

if the channel specified by the

`tickChannel`

property is not a file channel.

Access only on `ICA_TICK` events; otherwise, an error will occur.
- **resourceOffset: Number**: The offset of the file that was read or written on the event, if known. The value is

`null`

if the channel specified by the

`tickChannel`

property is not a file channel.

Access only on `ICA_TICK` events; otherwise, an error will occur.
- **roundTripTime: Number**: The median round trip time (RTT), expressed in milliseconds.

An RTT is the time it took for a device to send a single TCP packet and receive an immediate corresponding acknowledgment (ACK) packet.

The median value is calculated by sampling the RTTs observed since the last

`ICA_CLOSE`

or

`ICA_TICK`

event ran. The value is

`NaN`

if there are no RTT samples.

Access only on `ICA_CLOSE` or `ICA_TICK` events; otherwise, an error will occur.
- **serverBytes: Number**: The total number of bytes sent by the client since the last

`ICA_TICK`

event ran. Note that this property does not return the total number of bytes for the entire ICA session.

Access only on `ICA_CLOSE` or `ICA_TICK` events; otherwise, an error will occur.
- **serverCGPMsgCount: Number**: The number of CGP server messages since the last

`ICA_TICK`

event.

Access only on `ICA_TICK` events; otherwise, an error will occur.
- **serverL2Bytes: Number**: The total number of

L2

server bytes observed since the last

`ICA_TICK`

event ran. Note that this property does not return the total number of bytes for the entire ICA session.

Access only on `ICA_CLOSE` or `ICA_TICK` events; otherwise, an error will occur.
- **serverMsgCount: Number**: The number of server messages since the last

`ICA_TICK`

event.

Access only on `ICA_TICK` events; otherwise, an error will occur.
- **serverPkts: Number**: The total number of packets sent by the server since the last

`ICA_TICK`

event ran. Note that this property does not return the total number of packets for the entire ICA session.

Access only on `ICA_CLOSE` or `ICA_TICK` events; otherwise, an error will occur.
- **serverRTO: Number**: The total number of server

retransmission timeouts

(RTOs) observed since the last

`ICA_TICK`

event ran. Note that this property does not return the total number of server RTOs for the entire ICA session.

Access only on `ICA_CLOSE` or `ICA_TICK` events; otherwise, an error will occur.
- **serverZeroWnd: Number**: The total number of zero windows sent by the server since the last

`ICA_TICK`

event ran. Note that this property does not return the total number of zero windows for the entire ICA session.

Access only on `ICA_CLOSE` or `ICA_TICK` events; otherwise, an error will occur.
- **tickChannel: String**: The name of the virtual channel that resulted in the current

`ICA_TICK`

event. The following channels are supported:

CTXCLI: Clipboard

CTXCDM: File

CTXEUE: End user experience monitoring

Access only on `ICA_TICK` events; otherwise, an error will occur.
- **user: String**: The name of the user, if available.
