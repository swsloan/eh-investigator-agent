---
{
  "anchor": "wsman",
  "api_area": "trigger-api",
  "doc_kind": "class",
  "events": [
    "WSMAN_REQUEST",
    "WSMAN_RESPONSE"
  ],
  "examples": [],
  "methods": [
    "commitRecord():void"
  ],
  "name": "WSMAN",
  "properties": [
    "commandLine: String | Null",
    "encryptionProtocol: String",
    "isEncrypted: Boolean",
    "isDecrypted: Boolean",
    "operationId: String",
    "payload: Buffer",
    "record: Object",
    "reqAction: String",
    "reqCommand: String | null",
    "reqResourceURI: String",
    "rspAction: String",
    "rspResourceURI: String",
    "sequenceId: String",
    "user: String"
  ],
  "section": "protocol-and-network-data-classes",
  "source_url": "https://docs.extrahop.com/current/extrahop-trigger-api/",
  "source_version": "26.2"
}
---

### WSMAN

The `WSMAN` class enables you to store metrics and access properties on `WSMAN_REQUEST` and `WSMAN_RESPONSE` events. Web Services-Management (WSMAN) and the Microsoft implementation Windows Remote Management (WinRM) are protocols that enable devices to exchange management information on a network.

#### Events

- **WSMAN_REQUEST**: Runs on every

`WSMAN_REQUEST`

processed by the device.
- **WSMAN_RESPONSE**: Runs on every

`WSMAN_RESPONSE`

processed by the device.

#### Methods

- **commitRecord():void**: Sends a record to the configured recordstore on either a

`WSMAN_REQUEST`

or

`WSMAN_RESPONSE`

event. To view the default properties committed on each event, see the record property below.

If the `commitRecord()` method is called on an `WSMAN_REQUEST` event, the record is not created until the `WSMAN_RESPONSE` event runs. If the `commitRecord()` method is called on both the `WSMAN_REQUEST` and the corresponding `WSMAN_RESPONSE`, only one record is created for request and response, even if the `commitRecord()` method is called multiple times on the same trigger events.

#### Properties

- **commandLine: String | Null**: The full command line specified in the WSMAN request. If the WSMAN request did not specify a command line, the value is

`null`

.

| Note: | If the command was sent through the PowerShell Remoting Protocol (PSRP), the command line is derived by analyzing related request properties and might not reflect the exact text of the command. |
| --- | --- |
- **encryptionProtocol: String**: The protocol that the transaction is encrypted with.
- **isEncrypted: Boolean**: The value is

`true`

if the transaction is over secure HTTP.
- **isDecrypted: Boolean**: The value is

`true`

if the ExtraHop system securely decrypted and analyzed the transaction. Decrypted traffic analysis can expose advanced threats that hide within encrypted traffic.
- **operationId: String**: The unique identifier of the operation.
- **payload: Buffer**: A buffer object containing the XML message envelope. Messages longer than the maximum size are truncated. The maximum size is configured in the WSMAN profile in the running config. The following running config example changes the maximum message size from its default of 1024 bytes to 4096:

```javascript
"capture": {
    "app_proto": {
        "wsman": {
            "payload_max_size": 4096
        }
    }
}
```
- **record: Object**: The record object that can be sent to the configured recordstore through a call to

`WSMAN.commitRecord()`

.

The default record object can contain the following properties:

- `clientAddr`
- `clientIsExternal`
- `clientPort`
- `serverAddr`
- `serverPort`
- `proto`
- `timestamp`
- `user`
- `vlan`
- `operationId`
- `receiverIsExternal`
- `reqAction`
- `reqResourceURI`
- `rspAction`
- `rspResourceURI`
- `senderIsExternal`
- `sequenceId`
- `serverIsExternal`

Access the record object only on `WSMAN_RESPONSE` events; otherwise, an error will occur.
- **reqAction: String**: The action requested by the client to be performed by the resource specified in the resourceURI.

Access only on `WSMAN_REQUEST` events; otherwise, an error will occur.
- **reqCommand: String | null**: The command specified in the request. If no command is specified, the value is

`null`

.
- **reqResourceURI: String**: The Uniform Resource Identifier (URI) of the resource that performs an action.
- **rspAction: String**: The server response to the action requested by the client.

Access only on `WSMAN_RESPONSE` events; otherwise, an error will occur.
- **rspResourceURI: String**: The Uniform Resource Identifier (URI) of the resource that performs an action.
- **sequenceId: String**: The string representation of a 64-bit integer that identifies a message in an operation.
- **user: String**: The username of the account that sent the request.
