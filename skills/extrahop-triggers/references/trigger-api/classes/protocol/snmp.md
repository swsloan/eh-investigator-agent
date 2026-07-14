---
{
  "anchor": "snmp",
  "api_area": "trigger-api",
  "doc_kind": "class",
  "events": [
    "SNMP_REQUEST",
    "SNMP_RESPONSE",
    "SNMP_MESSAGE"
  ],
  "examples": [],
  "methods": [
    "commitRecord(): void"
  ],
  "name": "SNMP",
  "properties": [
    "error: String",
    "community: String",
    "payload: Buffer",
    "pduType: String",
    "record: Object",
    "version: String"
  ],
  "section": "protocol-and-network-data-classes",
  "source_url": "https://docs.extrahop.com/current/extrahop-trigger-api/",
  "source_version": "26.2"
}
---

### SNMP

The SNMP class enables you to store metrics and access properties on `SNMP_REQUEST`, `SNMP_RESPONSE`, and `SNMP_MESSAGE` events.

#### Events

- **SNMP_REQUEST**: Runs on every SNMP request processed by the device.
- **SNMP_RESPONSE**: Runs on every SNMP response processed by the device.

- **SNMP_MESSAGE**: Runs on SNMP messages that do not adhere to typical request and response behavior. Neither the

`SNMP_REQUEST`

event nor the

`SNMP_RESPONSE`

event runs on these messages. These messages include requests sent from a server to a client and responses sent from a client to a server. These messages also include SNMP traps, which are messages sent from the server that do not prompt a response.

#### Methods

- **commitRecord(): void**: Sends a record to the configured recordstore on an

`SNMP_REQUEST`

,

`SNMP_RESPONSE`

, or

`SNMP_MESSAGE`

event. To view the default properties committed to the record object, see the record property below.

If the `commitRecord()` method is called on an `SNMP_REQUEST` event, the record is not created until the `SNMP_RESPONSE` event runs. If the `commitRecord()` method is called on both the `SNMP_REQUEST` and the corresponding `SNMP_RESPONSE`, only one record is created for request and response, even if the `commitRecord()` method is called multiple times on the same trigger events.

#### Properties

- **error: String**: The SNMP error message.
- **community: String**: The SNMP community string.
- **payload: Buffer**: The Buffer object that contains the raw payload bytes of the event transaction. The buffer contains the first 1024 bytes of the payload.
- **pduType: String**: The protocol data unit (PDU) type.
- **record: Object**: The record object that can be sent to the configured recordstore through a call to SNMP.commitRecord() on either an

`SNMP_REQUEST`

,

`SNMP_RESPONSE`

, or

`SNMP_MESSAGE`

event.

The event on which the method was called determines which properties the default record object can contain as displayed in the following table:

| `SNMP_REQUEST` | `SNMP_RESPONSE` | `SNMP_MESSAGE` |
| --- | --- | --- |
| `client` | `client` | `community` |
| `clientAddr` | `clientAddr` | `error` |
| `clientIsExternal` | `clientIsExternal` | `flowId` |
| `clientPort` | `clientPort` | `pduType` |
| `community` | `community` | `receiver` |
| `flowId` | `error` | `receiverAddr` |
| `pduType` | `flowId` | `receiverPort` |
| `server` | `pduType` | `receiverIsExternal` |
| `serverAddr` | `server` | `sender` |
| `serverIsExternal` | `serverAddr` | `senderAddr` |
| `serverPort` | `serverIsExternal` | `senderPort` |
| `version` | `serverPort` | `senderIsExternal` |
| `vlan` | `version` | `version` |
|  | `vlan` | `vlan` |
- **version: String**: The version of SNMP protocol.
