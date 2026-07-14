---
{
  "anchor": "rpc",
  "api_area": "trigger-api",
  "doc_kind": "class",
  "events": [
    "RPC_REQUEST",
    "RPC_RESPONSE"
  ],
  "examples": [],
  "methods": [
    "commitRecord(): void"
  ],
  "name": "RPC",
  "properties": [
    "authType: String",
    "commandLine: String | Null",
    "encryptionProtocol: String",
    "interface: String",
    "interfaceGUID: String",
    "isEncrypted: Boolean",
    "isDecrypted: Boolean",
    "isNDR64: Boolean | null",
    "operation: String",
    "opnum: Number",
    "payload: Buffer | null",
    "pduType: String",
    "record: Object",
    "registryKey: String | Null",
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
    "sessionId: Number",
    "serviceName: String | Null",
    "user: String"
  ],
  "section": "protocol-and-network-data-classes",
  "source_url": "https://docs.extrahop.com/current/extrahop-trigger-api/",
  "source_version": "26.2"
}
---

### RPC

The `RPC` class enables you to store metrics and access properties from Microsoft Remote Procedure Call (MSRPC) activity on `RPC_REQUEST` and `RPC_RESPONSE` events.

#### Events

- **RPC_REQUEST**: Runs on every RPC request processed by the device.
- **RPC_RESPONSE**: Runs on every RPC response processed by the device.

#### Methods

- **commitRecord(): void**: Sends a record to the configured recordstore on an

`RPC_REQUEST`

or

`RPC_RESPONSE`

event.

To view the default properties committed to the record object, see the `record` property below.

For built-in records, each unique record is committed only once, even if the `commitRecord()` method is called multiple times for the same unique record.

#### Properties

- **authType: String**: The security type negotiated by the client and server. The following types are valid:

- `DIGEST`
- `DPA`
- `GSS_KERBEROS`
- `GSS_SCHANNEL`
- `KRB5`
- `MSN`
- `MQ`
- `NONE`
- `NTLMSSP`
- `SEC_CHAN`
- `SPNEGO`

Access only on `RPC_RESPONSE` events; otherwise, an error will occur.
- **commandLine: String | Null**: The full command line specified in the RPC request for the following operations:

| Interface | Operation |
| --- | --- |
| `Service Control Manager` | `RCreateServiceW` `RCreateServiceA` `RCreateServiceWOW64A` `RCreateServiceWOW64W` `RCreateWowService` |
| `IWbemServices` | `ExecMethod` `ExecMethodAsync` If the method is `Win32_Service:Create`, the `commandLine` property is the value specified in the `PathName` parameter. If the method is `Win32_Process:Create`, the `commandLine` property is the value specified in the `CommandLine` parameter. For all other methods, the `commandLine` property is `null`. |
| `IDispatch` | `Invoke` |
| `ITaskSchedulerService` | `RegisterTask` |

If the operation is not included in the table above, or the request did not specify a command line, the value is `null`.
- **encryptionProtocol: String**: The protocol that the transaction is encrypted with.
- **interface: String**: The name of the RPC interface, such as

`drsuapi`

and

`epmapper`

.
- **interfaceGUID: String**: The GUID of the RPC interface. The format of the GUID includes hyphens, as shown in the following example:

```javascript
367abb81-9844-35f2-ad32-98f038001004
```
- **isEncrypted: Boolean**: The value is true if the payload is encrypted.
- **isDecrypted: Boolean**: The value is

`true`

if the ExtraHop system securely decrypted and analyzed the transaction. Decrypted traffic analysis can expose advanced threats that hide within encrypted traffic.
- **isNDR64: Boolean | null**: Indicates whether the request or response was transmitted with the NDR64 transfer syntax. If the

`pduType`

property is not request or response, the value is

`null`

.
- **operation: String**: The name of the RPC operation, such as

`DRSGetNCChanges`

and

`ept_map`

.
- **opnum: Number**: The opnum of the RPC operation. The opnum is the numerical ID of the RPC operation.
- **payload: Buffer | null**: The

[Buffer](#buffer)

object containing the body of the request or response. If the

`pduType`

property is not request or response, the value is null.
- **pduType: String**: The PDU type, which indicates the purpose of the RPC message. The following values are valid:

- `ack`
- `alter_context`
- `alter_context_resp`
- `auth`
- `bind`
- `bind_ack`
- `bind_nak`
- `cancel_ack`
- `cl_cancel`
- `co_cancel`
- `fack`
- `fault`
- `nocall`
- `orphaned`
- `ping`
- `response`
- `request`
- `reject`
- `shutdown`
- `working`
- **record: Object**: The record object that can be sent to the configured recordstore through a call to

`RPC.commitRecord()`

on an

`RPC_REQUEST`

or

`RPC_RESPONSE`

event.

The default record object can contain the following properties:

- `clientAddr`
- `clientBytes`
- `clientIsExternal`
- `clientL2Bytes`
- `clientPkts`
- `clientPort`
- `clientRTO`
- `clientZeroWnd`
- `interface`
- `operation`
- `proto`
- `receiverIsExternal`
- `roundTripTime`
- `senderIsExternal`
- `serverAddr`
- `serverBytes`
- `serverIsExternal`
- `serverL2Bytes`
- `serverPkts`
- `serverPort`
- `serverRTO`
- `serverZeroWnd`
- `user`
- **registryKey: String | Null**: The Windows registry key specified in the RPC request for the following operations:

| Interface | Operation |
| --- | --- |
| `WinReg` | `BaseRegCloseKey` `BaseRegCreateKey` `BaseRegOpenKey` `BaseRegQueryValue` `BaseRegSetValue` |

If the operation is not included in the table above, or the request did not specify a registry key, the value is `null`.
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
- **reqZeroWnd: Number**: The number of zero windows in the request.
- **roundTripTime: Number**: The median TCP round trip time (RTT), expressed in milliseconds.

An RTT is the time it took for a device to send a single TCP packet and receive an immediate corresponding acknowledgment (ACK) packet.

The median value is calculated by sampling the RTTs observed since the last

`RPC_REQUEST`

or

`RPC_RESPONSE`

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
- **rspZeroWnd: Number**: The number of zero windows in the response.
- **sessionId: Number**: The ID of the associated SMB session.
- **serviceName: String | Null**: The name of the Windows service specified in the RPC request for the following operations:

| Interface | Operation |
| --- | --- |
| `Service Control Manager` | `RCreateServiceW` `RCreateServiceA` `RCreateServiceWOW64A` `RCreateServiceWOW64W` |

If the operation is not included in the table above, or the request did not specify a service, the value is `null`.
- **user: String**: The user name, if available. In some cases, such as when login events are encrypted, the user name is not available.
