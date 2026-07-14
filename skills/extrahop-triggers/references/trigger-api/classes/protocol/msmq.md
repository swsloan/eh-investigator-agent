---
{
  "anchor": "msmq",
  "api_area": "trigger-api",
  "doc_kind": "class",
  "events": [
    "MSMQ_MESSAGE"
  ],
  "examples": [],
  "methods": [
    "commitRecord(): void"
  ],
  "name": "MSMQ",
  "properties": [
    "adminQueue: String",
    "correlationId: Buffer",
    "dstQueueMgr: String",
    "isEncrypted: Boolean",
    "label: String",
    "msgClass: String",
    "msgId: Number",
    "payload: Buffer",
    "priority: Number",
    "queue: String",
    "receiverBytes: Number",
    "receiverL2Bytes: Number",
    "receiverPkts: Number",
    "receiverRTO: Number",
    "receiverZeroWnd: Number",
    "record: Object",
    "responseQueue: String",
    "roundTripTime: Number",
    "senderBytes: Number",
    "senderL2Bytes: Number",
    "senderPkts: Number",
    "senderRTO: Number",
    "senderZeroWnd: Number",
    "srcQueueMgr: String"
  ],
  "section": "protocol-and-network-data-classes",
  "source_url": "https://docs.extrahop.com/current/extrahop-trigger-api/",
  "source_version": "26.2"
}
---

### MSMQ

The MSMQ class enables you to store metrics and access properties on `MSMQ_MESSAGE` events.

#### Events

- **MSMQ_MESSAGE**: Runs on every MSMQ user message processed by the device.

#### Methods

- **commitRecord(): void**: Sends a record to the configured recordstore on an

`MSMQ_MESSAGE`

event.

To view the default properties committed to the record object, see the `record` property below.

For built-in records, each unique record is committed only once, even if the `commitRecord()` method is called multiple times for the same unique record.

#### Properties

- **adminQueue: String**: The name of the administration queue of the message.
- **correlationId: Buffer**: The application-generated correlation ID of the message.
- **dstQueueMgr: String**: The destination message broker of the message.
- **isEncrypted: Boolean**: The value is

`true`

if the payload is encrypted.
- **label: String**: The label or description of the message.
- **msgClass: String**: The message class of the message. The following values are valid:

- `MQMSG_CLASS_NORMAL`
- `MQMSG_CLASS_ACK_REACH_QUEUE`
- `MQMSG_CLASS_NACK_ACCESS_DENIED`
- `MQMSG_CLASS_NACK_BAD_DST_Q`
- `MQMSG_CLASS_NACK_BAD_ENCRYPTION`
- `MQMSG_CLASS_NACK_BAD_SIGNATURE`
- `MQMSG_CLASS_NACK_COULD_NOT_ENCRYPT`
- `MQMSG_CLASS_NACK_HOP_COUNT_EXCEEDED`
- `MQMSG_CLASS_NACK_NOT_TRANSACTIONAL_MSG`
- `MQMSG_CLASS_NACK_NOT_TRANSACTIONAL_Q`
- `MQMSG_CLASS_NACK_PURGED`
- `MQMSG_CLASS_NACK_Q_EXCEEDED_QUOTA`
- `MQMSG_CLASS_NACK_REACH_QUEUE_TIMEOUT`
- `MQMSG_CLASS_NACK_SOURCE_COMPUTER_GUID_CHANGED`
- `MQMSG_CLASS_NACK_UNSUPPORTED_CRYPTO_PROVIDER`
- `MQMSG_CLASS_ACK_RECEIVE`
- `MQMSG_CLASS_NACK_Q_DELETED`
- `MQMSG_CLASS_NACK_Q_PURGED`
- `MQMSG_CLASS_NACK_RECEIVE_TIMEOUT`
- `MQMSG_CLASS_NACK_RECEIVE_TIMEOUT_AT_SENDER`
- `MQMSG_CLASS_REPORT`
- **msgId: Number**: The MSMQ message id of the message.
- **payload: Buffer**: The body of the MSMQ message.
- **priority: Number**: The priority of the message. This can be a number between 0 and 7.
- **queue: String**: The name of the destination queue of the message.
- **receiverBytes: Number**: The number of

L4

receiver bytes.
- **receiverL2Bytes: Number**: The number of

L2

receiver bytes.
- **receiverPkts: Number**: The number of receiver packets.
- **receiverRTO: Number**: The number of

retransmission timeouts

(RTOs) from the receiver.
- **receiverZeroWnd: Number**: The number of zero windows sent by the receiver.
- **record: Object**: The record object that can be sent to the configured recordstore through a call to

`MSMQ.commitRecord()`

on an

`MSMQ_MESSAGE`

event.

The default record object can contain the following properties:

- `adminQueue`
- `clientIsExternal`
- `dstQueueMgr`
- `isEncrypted`
- `label`
- `msgClass`
- `msgId`
- `priority`
- `queue`
- `receiverBytes`
- `receiverIsExternal`
- `receiverL2Bytes`
- `receiverPkts`
- `receiverRTO`
- `receiverZeroWnd`
- `responseQueue`
- `roundTripTime`
- `senderBytes`
- `senderIsExternal`
- `serverIsExternal`
- `senderL2Bytes`
- `senderPkts`
- `senderRTO`
- `serverZeroWnd`
- `srcQueueMgr`
- **responseQueue: String**: The name of the response queue of the message.
- **roundTripTime: Number**: The median round trip time (RTT), expressed in milliseconds.

An RTT is the time it took for a device to send a single TCP packet and receive an immediate corresponding acknowledgment (ACK) packet.

The median value is calculated by sampling the RTTs observed since the last

`MSMQ_MESSAGE`

event ran. The value is

`NaN`

if there are no RTT samples.
- **senderBytes: Number**: The number of sender

L4

bytes.
- **senderL2Bytes: Number**: The number of sender

L2

bytes.
- **senderPkts: Number**: The number of sender packets.
- **senderRTO: Number**: The number of

retransmission timeouts

(RTOs) from the sender.
- **senderZeroWnd: Number**: The number of zero windows sent by the sender.
- **srcQueueMgr: String**: The source message broker of the message.
