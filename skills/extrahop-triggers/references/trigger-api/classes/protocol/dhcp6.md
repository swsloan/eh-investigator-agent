---
{
  "anchor": "dhcp6",
  "api_area": "trigger-api",
  "doc_kind": "class",
  "events": [
    "DHCP6_REQUEST",
    "DHCP6_RESPONSE"
  ],
  "examples": [],
  "methods": [
    "commitRecord(): void",
    "getOption(optionCode: Number): Object",
    "code: Number",
    "name: String",
    "payload: Number | String"
  ],
  "name": "DHCP6",
  "properties": [
    "error: String",
    "ja4DHCP6: String",
    "msgType: String",
    "options: Array of Objects",
    "code: Number",
    "name: String",
    "payload: Number | String",
    "record: Object",
    "txId: Number"
  ],
  "section": "protocol-and-network-data-classes",
  "source_url": "https://docs.extrahop.com/current/extrahop-trigger-api/",
  "source_version": "26.2"
}
---

### DHCP6

The `DHCP6` class enables you to store metrics and access properties on `DHCP6_REQUEST` and `DHCP6_RESPONSE` events.

#### Events

- **DHCP6_REQUEST**: Runs on every DHCP6 request processed by the device.
- **DHCP6_RESPONSE**: Runs on every DHCP6 response processed by the device.

#### Methods

- **commitRecord(): void**: Sends a record to the configured recordstore on either a

`DHCP6_REQUEST`

or

`DHCP6_RESPONSE`

event.

The event determines which properties are committed to the record object. To view the default properties committed on each event, see the `record` property below.

For built-in records, each unique record is committed only once, even if the `commitRecord()` method is called multiple times for the same unique record.
- **getOption(optionCode: Number): Object**: Accepts a DHCP6 option code integer as input and returns a DHCP6 option object. Each object contains the following properties:

- **code: Number**: The DHCP6 option code.
- **name: String**: The DHCP6 option name.
- **payload: Number | String**: The type of payload returned will be whatever the type is for that specific option, such as an IP address, an array of IP addresses, or a buffer object.

Returns `null` if the specified option code is not present in the message.

#### Properties

- **error: String**: The error message returned by the server. The value is

`null`

if there is no error.

Access only on `DHCP6_RESPONSE` events; otherwise, an error will occur.
- **ja4DHCP6: String**: The JA4D6 fingerprint for the device that sent the DHCP6 request or response, which includes the message type code, the length of the Client DHCP unique identifier (DUID), whether the device has an IPv6 address, whether the device is requesting the server to update its domain, DHCP options, and the parameter request list.
- **msgType: String**: The DHCP6 message type. The following message types are supported:

- `SOLICIT`
- `ADVERTISE`
- `REQUEST`
- `CONFIRM`
- `RENEW`
- `REBIND`
- `REPLY`
- `RELEASE`
- `DECLINE`
- `RECONFIGURE`
- `INFORMATION-REQUEST`
- `RELAY-FORW`
- `RELAY-REPL`
- `LEASEQUERY`
- `LEASEQUERY-REPLY`
- `LEASEQUERY-DONE`
- `LEASEQUERY-DATA`
- `RECONFIGURE-REQUEST`
- `RECONFIGURE-REPLY`
- `DHCPV4-QUERY`
- `DHCPV4-RESPONSE`
- `ACTIVELEASEQUERY`
- `STARTTLS`
- **options: Array of Objects**: An array of objects that contain the DHCP6 options specified in the request or response. Each object contains the following properties:

- **code: Number**: The DHCP6 option code.

- **name: String**: The DHCP6 option name.
- **payload: Number | String**: The type of payload returned will be whatever the type is for that specific option, such as an IP address, an array of IP addresses, or a buffer object. IP addresses will be parsed into an array, but if the number of bytes is not divisible by 4 the payload will instead be returned as a buffer.
- **record: Object**: The record object that can be sent to the configured recordstore through a call to

`DHCP6.commitRecord()`

on either a

`DHCP6_REQUEST`

or

`DHCP6_RESPONSE`

event.

The event on which the method was called determines which properties the default record object can contain, as displayed in the following table:

| DHCP6_REQUEST | DHCP6_RESPONSE |
| --- | --- |
| `application` | `application` |
| `flowId` | `flowId` |
| `client` | `client` |
| `clientAddr` | `clientAddr` |
| `clientPort` | `clientPort` |
| `server` | `server` |
| `serverAddr` | `serverAddr` |
| `serverPort` | `serverPort` |
| `vlan` | `vlan` |
| `senderIsExternal` | `senderIsExternal` |
| `receiverIsExternal` | `receiverIsExternal` |
| `clientIsExternal` | `clientIsExternal` |
| `serverIsExternal` | `serverIsExternal` |
| `msgType` | `msgType` |
| `txId` | `txId` |
|  | `error` |
- **txId: Number**: The ID of the DHCP6 transaction.
