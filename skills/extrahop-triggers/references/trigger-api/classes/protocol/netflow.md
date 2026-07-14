---
{
  "anchor": "netflow",
  "api_area": "trigger-api",
  "doc_kind": "class",
  "events": [
    "NETFLOW_RECORD"
  ],
  "examples": [],
  "methods": [
    "findField(field: Number, enterpriseId: Number): String | Number | IPAddress | Buffer | Boolean",
    "hasField(field: Number): Boolean"
  ],
  "name": "NetFlow",
  "properties": [
    "age: Number",
    "deltaBytes: Number",
    "deltaPkts: Number",
    "dscp: Number",
    "dscpName: String",
    "egressInterface: FlowInterface",
    "fields: Array",
    "fieldID: Number",
    "enterpriseID: Number",
    "first: Number",
    "format: String",
    "ingressInterface: FlowInterface",
    "ipPrecedence: Number",
    "ipproto: String",
    "last: Number",
    "network: FlowNetwork",
    "id: String",
    "ipaddr: IPAddress",
    "nextHop: IPAddress",
    "observationDomain: Number",
    "receiver: Object",
    "asn: Number",
    "prefixLength: Number",
    "port: Number",
    "record: Object",
    "sender: Object",
    "tcpFlagNames: Array",
    "tcpFlags: Number",
    "templateId: Number",
    "tos: Number"
  ],
  "section": "protocol-and-network-data-classes",
  "source_url": "https://docs.extrahop.com/current/extrahop-trigger-api/",
  "source_version": "26.2"
}
---

### NetFlow

The `NetFlow` class object enables you to store metrics and access properties on `NETFLOW_RECORD` events.

#### Events

- **NETFLOW_RECORD**: Runs upon receipt of a flow record from a flow network.

#### Methods

- **findField(field: Number, enterpriseId: Number): String | Number | IPAddress | Buffer | Boolean**: Searches the NetFlow record and returns the specified field. Returns a null value if the field is not in the record. If the optional

`enterpriseId`

argument is included, the specified field is returned only if the enterprise ID is a match, otherwise the method returns a null value.
- **hasField(field: Number): Boolean**: Determines whether the specified field is in the NetFlow record.

#### Properties

- **age: Number**: The amount of time elapsed, expressed in seconds, between the

`first`

and

`last`

property values reported in the NetFlow record.
- **deltaBytes: Number**: The number of

L3

bytes in the flow since the last

`NETFLOW_RECORD`

event.
- **deltaPkts: Number**: The number of packets in the flow since the last

`NETFLOW_RECORD`

event.
- **dscp: Number**: The number representing the last differentiated services code point (DSCP) value of the flow packet.
- **dscpName: String**: The name associated with the DSCP value of the flow packet. The following table displays well-known DSCP names:

| Number | Name |
| --- | --- |
| 8 | CS1 |
| 10 | AF11 |
| 12 | AF12 |
| 14 | AF13 |
| 16 | CS2 |
| 18 | AF21 |
| 20 | AF22 |
| 22 | AF23 |
| 24 | CS3 |
| 26 | AF31 |
| 28 | AF32 |
| 30 | AF33 |
| 32 | CS4 |
| 34 | AF41 |
| 36 | AF42 |
| 38 | AF43 |
| 40 | CS5 |
| 44 | VA |
| 46 | EF |
| 48 | CS6 |
| 56 | CS7 |
- **egressInterface: FlowInterface**: The

[FlowInterface](#flowinterface)

object that identifies the output device.
- **fields: Array**: An array of objects that contain information fields found in the flow packets. Each object can contain the following properties:

- **fieldID: Number**: The ID number that represents the field type.
- **enterpriseID: Number**: The ID number that represents enterprise-specific information.
- **first: Number**: The amount of time elapsed, expressed in milliseconds, since the epoch of the first packet in the flow.
- **format: String**: The format of the NetFlow record. Valid values are

`NetFlow v5`

,

`NetFlow v9`

, and

`IPFIX`

.
- **ingressInterface: FlowInterface**: The

[FlowInterface](#flowinterface)

object that identifies the input device.
- **ipPrecedence: Number**: The value of the IP precedence field associated with the DSCP of the flow packet.
- **ipproto: String**: The IP protocol associated with the flow, such as TCP or UDP.
- **last: Number**: The amount of time elapsed, expressed in milliseconds, since the epoch of the last packet in the flow.
- **network: FlowNetwork**: An object that identifies the

[FlowNetwork](#flownetwork)

and contains the following properties:

- **id: String**: The identifier of the FlowNetwork.
- **ipaddr: IPAddress**: The IP address of the FlowNetwork.
- **nextHop: IPAddress**: The IP address of the next hop router.
- **observationDomain: Number**: The ID of the observation domain for the template.
- **receiver: Object**: An object that identifies the receiver and contains the following properties:

- **asn: Number**: The autonomous system number (ASN) of the destination device.
- **ipaddr: IPAddress**: The IP address of the destination device.
- **prefixLength: Number**: The number of bits in the prefix of the destination address.
- **port: Number**: The TCP or UDP port number of the destination device.
- **record: Object**: The default record object for the

`NetFlow`

class.

| Important: | There is no `NetFlow.commitRecord()` method. However, you can send the default record object to the configured recordstore with the global `commitRecord()` function. For example, the following code sends the default record object to a record type named `custom_netflow_record`:commitRecord("custom_netflow_record", NetFlow.record) |
| --- | --- |

The default record object can contain the following properties:

- age
- clientIsExternal
- dscpName
- deltaBytes
- deltaPkts
- egressInterface
- first
- format
- ingressInterface
- last
- network
- networkAddr
- nextHop
- proto
- receiverAddr
- receiverAsn
- receiverIsExternal
- receiverPort
- receiverPrefixLength
- senderAddr
- senderAsn
- senderIsExternal
- serverIsExternal
- senderPort
- senderPrefixLength
- tcpFlagName
- tcpFlags
- **sender: Object**: An object that identifies the sender and contains the following properties:

- **asn: Number**: The autonomous system number (ASN) of the source device.
- **ipaddr: IPAddress**: The IP address of the source device.
- **prefixLength: Number**: The number of bits in the prefix of the source address.
- **port: Number**: The TCP or UDP port number of the source device.
- **tcpFlagNames: Array**: A string array of TCP flag names, such as SYN or ACK, found in the flow packets.
- **tcpFlags: Number**: The bitwise OR of all TCP flags set on the flow.
- **templateId: Number**: The ID of the template that is referred to by the record. Template IDs are applicable only to IPFIX and NetFlow v9 records.
- **tos: Number**: The type of service (ToS) number defined in the IP header.
