---
{
  "anchor": "dhcp",
  "api_area": "trigger-api",
  "doc_kind": "class",
  "events": [
    "DHCP_REQUEST",
    "DHCP_RESPONSE"
  ],
  "examples": [],
  "methods": [
    "commitRecord(): void",
    "getOption(optionCode: Number): Object",
    "code: Number",
    "name: String",
    "payload: Number | String"
  ],
  "name": "DHCP",
  "properties": [
    "chaddr: String",
    "clientReqDelay: Number",
    "error: String",
    "gwAddr: IPAddress",
    "htype: Number",
    "ja4DHCP: String",
    "msgType: String",
    "offeredAddr: IPAddress",
    "options: Array of Objects",
    "code: Number",
    "name: String",
    "payload: Number | String",
    "paramReqList: String",
    "processingTime: Number",
    "record: Object",
    "reqBytes: Number",
    "reqL2Bytes: Number",
    "reqPkts: Number",
    "rspBytes: Number",
    "rspL2Bytes: Number",
    "rspPkts: Number",
    "txId: Number",
    "vendor: String"
  ],
  "section": "protocol-and-network-data-classes",
  "source_url": "https://docs.extrahop.com/current/extrahop-trigger-api/",
  "source_version": "26.2"
}
---

### DHCP

The DHCP class enables you to store metrics and access properties on `DHCP_REQUEST` and `DHCP_RESPONSE` events.

#### Events

- **DHCP_REQUEST**: Runs on every DHCP request processed by the device.
- **DHCP_RESPONSE**: Runs on every DHCP response processed by the device.

#### Methods

- **commitRecord(): void**: Sends a record to the configured recordstore on either a

`DHCP_REQUEST`

or

`DHCP_RESPONSE`

event.

The event determines which properties are committed to the record object. To view the default properties committed on each event, see the `record` property below.

For built-in records, each unique record is committed only once, even if the `commitRecord()` method is called multiple times for the same unique record.
- **getOption(optionCode: Number): Object**: Accepts a DHCP option code integer as input and returns an object containing the following fields:

- **code: Number**: The DHCP option code.
- **name: String**: The DHCP option name.
- **payload: Number | String**: The type of payload returned will be whatever the type is for that specific option, such as an IP address, an array of IP addresses, or a buffer object.

Returns `null` if the specified option code is not present in the message.

#### Properties

- **chaddr: String**: The client hardware address of the DHCP client.
- **clientReqDelay: Number**: The time elapsed before the

client

attempts to acquire or renew a DHCP lease, expressed in seconds.

Access only on `DHCP_REQUEST` events; otherwise, an error will occur.
- **error: String**: The error message associated with option code 56. The value is

`null`

if there is no error.

Access only on `DHCP_RESPONSE` events; otherwise, an error will occur.
- **gwAddr: IPAddress**: The IP address through which routers relay request and response messages.
- **htype: Number**: The hardware type code.
- **ja4DHCP: String**: The JA4D fingerprint for the device that sent the DHCP request or response, which includes the message type code, maximum message size, whether the device has an IP address and domain name, DHCP options, and parameter request list.
- **msgType: String**: The DHCP message type. Supported message types are:

- `DHCPDISCOVER`
- `DHCPOFFER`
- `DHCPREQUEST`
- `DHCPDECLINE`
- `DHCPACK`
- `DHCPNAK`
- `DHCPRELEASE`
- `DHCPINFORM`
- `DHCPFORCERENEW`
- `DHCPLEASEQUERY`
- `DHCPLEASEUNASSIGNED`
- `DHCPLEASEUNKNOWN`
- `DHCPLEASEACTIVE`
- `DHCPBULKLEASEQUERY`
- `DHCPLEASEQUERYDONE`
- **offeredAddr: IPAddress**: The IP address the DHCP server is offering or assigning to the

client

.

Access only on `DHCP_RESPONSE` events; otherwise, an error will occur.
- **options: Array of Objects**: An array of objects with each object containing the following fields:

- **code: Number**: The DHCP option code.
- **name: String**: The DHCP option name.
- **payload: Number | String**: The type of payload returned will be whatever the type is for that specific option, such as an IP address, an array of IP addresses, or a buffer object. IP addresses will be parsed into an array but if the number of bytes is not divisible by 4, it will instead be returned as a buffer.
- **paramReqList: String**: A comma-separated list of numbers that represents the DHCP options requested from the server by the client. For a complete list of DHCP options, see

[https://www.iana.org/assignments/bootp-dhcp-parameters/bootp-dhcp-parameters.xhtml.](https://www.iana.org/assignments/bootp-dhcp-parameters/bootp-dhcp-parameters.xhtml)
- **processingTime: Number**: The process time, expressed in milliseconds. The value is

`NaN`

on malformed and aborted responses or if the timing is invalid.

Access only on `DHCP_RESPONSE` events; otherwise, an error will occur.
- **record: Object**: The record object that can be sent to the configured recordstore through a call to

`DHCP.commitRecord()`

on either a

`DHCP_REQUEST`

or

`DHCP_RESPONSE`

event.

The event on which the method was called determines which properties the default record object can contain as displayed in the following table:

| `DHCP_REQUEST` | `DHCP_RESPONSE` |
| --- | --- |
| `clientIsExternal` | `clientIsExternal` |
| `clientReqDelay` | `error` |
| `gwAddr` | `gwAddr` |
| `htype` | `htype` |
| `msgType` | `msgType` |
| `receiverIsExternal` | `offeredAddr` |
| `reqBytes` | `processingTime` |
| `reqL2Bytes` | `rspBytes` |
| `reqPkts` | `rspL2Bytes` |
| `senderIsExternal` | `rspPkts` |
| `serverIsExternal` | `receiverIsExternal` |
| `txId` | `senderIsExternal` |
|  | `serverIsExternal` |
|  | `txId` |
- **reqBytes: Number**: The number of

L4

request bytes, excluding L4 headers.

Access only on `DHCP_RESPONSE` events; otherwise, an error will occur.
- **reqL2Bytes: Number**: The number of

L2

request bytes, including L2 headers.

Access only on `DHCP_RESPONSE` events; otherwise, an error will occur.
- **reqPkts: Number**: The number of request packets.

Access only on `DHCP_RESPONSE` events; otherwise, an error will occur.
- **rspBytes: Number**: The number of

L4

response bytes, excluding L4 protocol overhead, such as ACKs, headers, and retransmissions.

Access only on `DHCP_RESPONSE` events; otherwise, an error will occur.
- **rspL2Bytes: Number**: The number of

L2

response bytes, including protocol overhead, such as headers.

Access only on `DHCP_RESPONSE` events; otherwise, an error will occur.
- **rspPkts: Number**: The number of response packets.

Access only on `DHCP_RESPONSE` events; otherwise, an error will occur.
- **txId: Number**: The transaction ID.
- **vendor: String**: The Vendor Class Identifier (VCI) that specifies the vendor running on the client or server.
