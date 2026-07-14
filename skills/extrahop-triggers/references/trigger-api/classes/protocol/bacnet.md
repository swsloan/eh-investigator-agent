---
{
  "anchor": "bacnet",
  "api_area": "trigger-api",
  "doc_kind": "class",
  "events": [
    "BACNET_MESSAGE"
  ],
  "examples": [],
  "methods": [
    "commitRecord(): void"
  ],
  "name": "BACnet",
  "properties": [
    "dstAddr: Buffer | Null",
    "dstNetwork: Buffer | Null",
    "hopCount: Number | Null",
    "invokeId: Number | Null",
    "pduType: String",
    "record: Object",
    "serviceChoice: Number",
    "srcAddr: Buffer | Null",
    "srcNetwork: Number | Null"
  ],
  "section": "protocol-and-network-data-classes",
  "source_url": "https://docs.extrahop.com/current/extrahop-trigger-api/",
  "source_version": "26.2"
}
---

### BACnet

The Building Automation Control Network (BACnet) class enables you to store metrics and access properties on `BACNET_MESSAGE` events.

#### Events

- **BACNET_MESSAGE**: Runs on every BACnet message processed by the device.

#### Methods

- **commitRecord(): void**: Sends a record to the configured recordstore on a

`BACNET_MESSAGE`

event. To view the default properties committed to the record object, see the record property below.

For built-in records, each unique record is committed only once, even if the `commitRecord()` method is called multiple times for the same unique record.

#### Properties

- **dstAddr: Buffer | Null**: A Buffer object containing the address of the destination device. The value is null if the Network Protocol Data Unit (NPDU) does not specify a destination address.
- **dstNetwork: Buffer | Null**: The ID of the destination network. The value is null if the NPDU does not specify a destination network.
- **hopCount: Number | Null**: A field specified in the network protocol data unit (NPDU) that tracks how many network hops the BACnet message has passed through. The value starts at

`255`

and decrements with each network hop.
- **invokeId: Number | Null**: The ID of the BACnet request message, which correlates the request with the response. The value is null if the request does not require a response.
- **pduType: String**: The application protocol data unit (APDU) type.
- **record: Object**: The record object that can be sent to the configured recordstore through a call to

`BACnet.commitRecord()`

on a

`BACNET_MESSAGE`

event.

The default record object can contain the following properties:

- `application`
- `dstAddr`
- `dstNetwork`
- `flowId`
- `hopCount`
- `invokeId`
- `pduType`
- `proto`
- `receiver`
- `receiverAddr`
- `receiverIsExternal`
- `receiverPort`
- `sender`
- `senderAddr`
- `senderIsExternal`
- `senderPort`
- `serviceChoice`
- `srcAddr`
- `srcNetwork`
- `vlan`
- **serviceChoice: Number**: The numeric identifier for the requested BACnet service.
- **srcAddr: Buffer | Null**: A

[Buffer](#buffer)

object that contains the address of the source device. The value is null if the NPDU does not specify a source address.
- **srcNetwork: Number | Null**: The ID of the source network. The value is null if the NPDU does not specify a source network.
