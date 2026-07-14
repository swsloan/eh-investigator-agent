---
{
  "anchor": "sccp",
  "api_area": "trigger-api",
  "doc_kind": "class",
  "events": [
    "SCCP_MESSAGE"
  ],
  "examples": [],
  "methods": [
    "commitRecord(): void"
  ],
  "name": "SCCP",
  "properties": [
    "callId: String",
    "callInfo: Object",
    "callReference: Number",
    "callType: Number",
    "calledPartyName: String",
    "calledPartyNumber: String",
    "callingPartyName: String",
    "callingPartyNumber: String",
    "lineInstance: Number",
    "callStats: Object",
    "reportedBytesIn: Number",
    "reportedBytesOut: Number",
    "reportedJitter: Number",
    "reportedLatency: Number",
    "reportedPktsIn: Number",
    "reportedPktsLost: Number",
    "reportedPktsOut: Number",
    "msgType: String",
    "receiverBytes: Number",
    "receiverL2Bytes: Number",
    "receiverPkts: Number",
    "receiverRTO: Number",
    "receiverZeroWnd: Number",
    "record: Object",
    "roundTripTime: Number",
    "senderBytes: Number",
    "senderL2Bytes: Number",
    "senderPkts: Number",
    "senderRTO: Number",
    "senderZeroWnd: Number"
  ],
  "section": "protocol-and-network-data-classes",
  "source_url": "https://docs.extrahop.com/current/extrahop-trigger-api/",
  "source_version": "26.2"
}
---

### SCCP

Skinny Client Control Protocol (SCCP) is a Cisco proprietary protocol for communicating with VoIP devices. The `SCCP` class enables you to store metrics and access properties on `SCCP_MESSAGE` events.

#### Events

- **SCCP_MESSAGE**: Runs on every SCCP message processed by the device.

#### Methods

- **commitRecord(): void**: Sends a record to the configured recordstore on an

`SCCP_MESSAGE`

event.

To view the default properties committed to the record object, see the `record` property below.

For built-in records, each unique record is committed only once, even if the `commitRecord()` method is called multiple times for the same unique record.

#### Properties

- **callId: String**: The call ID associated with the

RTP

flow.
- **callInfo: Object**: An object containing information about the current SCCP called. The object contains the following fields:

- **callReference: Number**: The unique identifier of the call.
- **callType: Number**: The ID of the call type.

| ID | Call Type |
| --- | --- |
| `1` | `Inbound` |
| `2` | `Outbound` |
| `3` | `Forward` |
- **calledPartyName: String**: The name of the recipient of the call.
- **calledPartyNumber: String**: The phone number of the recipient of the call.
- **callingPartyName: String**: The name of the caller.
- **callingPartyNumber: String**: The phone number of the caller.
- **lineInstance: Number**: The unique identifier of the line.
- **callStats: Object**: An object containing statistics for the SCCP call, as reported and calculated by the client. The object contains the following fields:

- **reportedBytesIn: Number**: The number of

L7

bytes received.
- **reportedBytesOut: Number**: The number of

L7

bytes sent.
- **reportedJitter: Number**: The level of packet jitter, or variation in latency, during the call.
- **reportedLatency: Number**: The level of packet latency, expressed in milliseconds, during the call.
- **reportedPktsIn: Number**: The number of packets received.
- **reportedPktsLost: Number**: The number of packets lost during the call.
- **reportedPktsOut: Number**: The number of packets sent.
- **msgType: String**: The decoded SCCP message type.
- **receiverBytes: Number**: The number of

L4

bytes from the receiver.
- **receiverL2Bytes: Number**: The number of

L2

bytes from the receiver.
- **receiverPkts: Number**: The number of packets from the receiver.
- **receiverRTO: Number**: The number of

retransmission timeouts

(RTOs) from the receiver.
- **receiverZeroWnd: Number**: The number of zero windows from the receiver.
- **record: Object**: The record object that can be sent to the configured recordstore through a call to

`SCCP.commitRecord()`

on an

`SCCP_MESSAGE`

event.

The default record object can contain the following properties:

- `clientIsExternal`
- `msgType`
- `receiverBytes`
- `receiverIsExternal`
- `receiverL2Bytes`
- `receiverPkts`
- `receiverRTO`
- `receiverZeroWnd`
- `roundTripTime`
- `senderBytes`
- `senderIsExternal`
- `senderL2Bytes`
- `senderPkts`
- `senderRTO`
- `senderZeroWnd`
- `serverIsExternal`
- **roundTripTime: Number**: The median round trip time (RTT), expressed in milliseconds.

An RTT is the time it took for a device to send a single TCP packet and receive an immediate corresponding acknowledgment (ACK) packet.

The median value is calculated by sampling the RTTs observed since the last

`SCCP_MESSAGE`

event ran. The value is

`NaN`

if there are no RTT samples.
- **senderBytes: Number**: The number of

L4

bytes from the sender.
- **senderL2Bytes: Number**: The number of

L2

bytes from the sender.
- **senderPkts: Number**: The number of packets from the sender.
- **senderRTO: Number**: The number of

retransmission timeouts

(RTOs) from the sender.
- **senderZeroWnd: Number**: The number of zero windows from the sender.
