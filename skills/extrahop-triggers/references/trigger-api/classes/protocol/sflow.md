---
{
  "anchor": "sflow",
  "api_area": "trigger-api",
  "doc_kind": "class",
  "events": [
    "SFLOW_RECORD"
  ],
  "examples": [],
  "methods": [
    "commitRecord(): void"
  ],
  "name": "SFlow",
  "properties": [
    "deltaBytes: Number",
    "dscp: Number",
    "dscpName: String",
    "egressInterface: FlowInterface",
    "format: String",
    "headerData: Buffer",
    "ingressInterface: FlowInterface",
    "ipPrecedence: Number",
    "ipproto: String",
    "network: FlowNetwork",
    "id: String",
    "ipaddr: IPAddress",
    "record: Object",
    "tcpFlagNames: Array",
    "tcpFlags: Number",
    "tos: Number"
  ],
  "section": "protocol-and-network-data-classes",
  "source_url": "https://docs.extrahop.com/current/extrahop-trigger-api/",
  "source_version": "26.2"
}
---

### SFlow

The `SFlow` class object enables you to store metrics and access properties on `SFLOW_RECORD` events. sFlow is a sampling technology for monitoring traffic in data networks. sFlow samples every nth packet and sends it to the collector whereas NetFlow sends data from every flow to the collector. The primary difference between sFlow and NetFlow is that sFlow is network layer independent and can sample anything.

#### Events

- **SFLOW_RECORD**: Runs upon receipt of an SFlow sample exported from a flow network.

#### Methods

- **commitRecord(): void**: Sends a flow record object to the configured recordstore on an

`SFLOW_RECORD`

event.

To view the default properties committed to the record object, see the record property below.

For built-in records, each unique record is committed only once, even if `SFlow.commitRecord()` is called multiple times for the same unique record.

#### Properties

- **deltaBytes: Number**: The number of L3 bytes in the flow packet.
- **dscp: Number**: The number representing the last differentiated services code point (DSCP) value of the flow packet.
- **dscpName: String**: The name associated with the DSCP value transmitted by a device in the flow. The following table displays well-known DSCP names:

| Number | Name |
| --- | --- |
| `8` | `CS1` |
| `10` | `AF11` |
| `12` | `AF12` |
| `14` | `AF13` |
| `16` | `CS2` |
| `18` | `AF21` |
| `20` | `AF22` |
| `22` | `AF23` |
| `24` | `CS3` |
| `26` | `AF31` |
| `28` | `AF32` |
| `30` | `AF33` |
| `32` | `CS4` |
| `34` | `AF41` |
| `36` | `AF42` |
| `38` | `AF43` |
| `40` | `CS5` |
| `44` | `VA` |
| `46` | `EF` |
| `48` | `CS6` |
| `56` | `CS7` |
- **egressInterface: FlowInterface**: The

[FlowInterface](#flowinterface)

object that identifies the output interface.
- **format: String**: The format of the SFlow record. Valid value is "sFlow v5".
- **headerData: Buffer**: The

[Buffer](#buffer)

object containing the raw bytes of the entire flow packet header.
- **ingressInterface: FlowInterface**: The

[FlowInterface](#flowinterface)

object that identifies the input interface.
- **ipPrecedence: Number**: The value of the IP precedence field associated with the DSCP of the flow packet.
- **ipproto: String**: The IP protocol associated with the flow, such as TCP or UDP.
- **network: FlowNetwork**: Returns a

[FlowNetwork](#flownetwork)

object that identifies the exporter and contains the following properties:

- **id: String**: The identifier of the FlowNetwork.
- **ipaddr: IPAddress**: The IP address of the FlowNetwork.
- **record: Object**: The flow record object that can be sent to the configured recordstore through a call to

`SFlow.commitRecord()`

on an

`SFLOW_RECORD`

event.

The default record object can contain the following properties:

- `clientIsExternal`
- `deltaBytes`
- `dscpName`
- `egressInterface`
- `format`
- `ingressInterface`
- `ipPrecedence`
- `ipproto`
- `network`
- `networkAddr`
- `receiverIsExternal`
- `senderIsExternal`
- `serverIsExternal`
- `tcpFlagName`
- `tcpFlags`
- **tcpFlagNames: Array**: A string array of TCP flag names, such as

`SYN`

or

`ACK`

, found in the flow packets.
- **tcpFlags: Number**: The bitwise

`OR`

of all TCP flags set on the flow.
- **tos: Number**: The type of service (ToS) number defined in the IP header.
