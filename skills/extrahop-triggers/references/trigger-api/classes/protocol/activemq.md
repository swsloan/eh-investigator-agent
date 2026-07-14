---
{
  "anchor": "activemq",
  "api_area": "trigger-api",
  "doc_kind": "class",
  "events": [
    "ACTIVEMQ_MESSAGE"
  ],
  "examples": [],
  "methods": [
    "commitRecord(): void"
  ],
  "name": "ActiveMQ",
  "properties": [
    "correlationId: String",
    "exceptionResponse: Object | Null",
    "message: String",
    "class: String",
    "expiration: Number",
    "msg: Buffer",
    "msgFormat: String",
    "msgId: String",
    "persistent: Boolean",
    "priority: Number",
    "properties: Object",
    "queue: String",
    "receiverBytes: Number",
    "receiverIsBroker: Boolean",
    "receiverL2Bytes: Number",
    "receiverPkts: Number",
    "receiverRTO: Number",
    "receiverZeroWnd: Number",
    "record: Object",
    "redeliveryCount: Number",
    "replyTo: String",
    "roundTripTime: Number",
    "senderBytes: Number",
    "senderIsBroker: Boolean",
    "senderL2Bytes: Number",
    "senderPkts: Number",
    "senderRTO: Number",
    "senderZeroWnd: Number",
    "timestamp: Number",
    "totalMsgLength: Number"
  ],
  "section": "protocol-and-network-data-classes",
  "source_url": "https://docs.extrahop.com/current/extrahop-trigger-api/",
  "source_version": "26.2"
}
---

### ActiveMQ

The ActiveMQ class enables you to store metrics and access properties on `ACTIVEMQ_MESSAGE` events. ActiveMQ is an implementation of the Java Messaging Service (JMS).

#### Events

- **ACTIVEMQ_MESSAGE**: Runs on every JMS message processed by the device.

#### Methods

- **commitRecord(): void**: Sends a record to the configured recordstore on an

`ACTIVEMQ_MESSAGE`

event.

To view the default properties committed to the record object, see the `record` property below.

For built-in records, each unique record is committed only once, even if the `commitRecord()` method is called multiple times for the same unique record.

#### Properties

- **correlationId: String**: The JMSCorrelationID field of the message.
- **exceptionResponse: Object | Null**: The JMSException field of the message. If the command of the message is not

`ExceptionResponse`

, the value is null. The object contains the following fields:

- **message: String**: The exception response message.
- **class: String**: The subclass of the JMSException.
- **expiration: Number**: The JMSExpiration field of the message.
- **msg: Buffer**: The message body. For TEXT_MESSAGE format messages, this returns the body of the message as a UTF-8 string. For all other message formats, this returns the raw bytes.
- **msgFormat: String**: The message format. Possible values are:

- `BYTES_MESSAGE`
- `MAP_MESSAGE`
- `MESSAGE`
- `OBJECT_MESSAGE`
- `STREAM_MESSAGE`
- `TEXT_MESSAGE`
- `BLOG_MESSAGE`
- **msgId: String**: The JMSMessageID field of the message.
- **persistent: Boolean**: The value is

`true`

if the JMSDeliveryMode is PERSISTENT.
- **priority: Number**: The JMSPriority field of the message.

- 0 is the lowest priority.
- 9 is the highest priority.
- 0-4 are gradations of normal priority.
- 5-9 are gradations of expedited priority.
- **properties: Object**: Zero or more properties attached to the message. The keys are arbitrary strings and the values may be booleans, numbers, or strings.
- **queue: String**: The JMSDestination field of the message.
- **receiverBytes: Number**: The number of application-level bytes from the receiver.
- **receiverIsBroker: Boolean**: The value is

`true`

if the flow-level receiver of the message is a broker.
- **receiverL2Bytes: Number**: The number of

L2

bytes from the receiver.
- **receiverPkts: Number**: The number of packets from the receiver.
- **receiverRTO: Number**: The number of RTOs from the receiver.
- **receiverZeroWnd: Number**: The number of zero windows sent by the receiver.
- **record: Object**: The record object that can be sent to the configured recordstore through a call to

`ActiveMQ.commitRecord()`

on an

`ACTIVEMQ_MESSAGE`

event.

The default record object can contain the following properties:

- `clientIsExternal`
- `correlationId`
- `expiration`
- `msgFormat`
- `msgId`
- `persistent`
- `priority`
- `queue`
- `receiverBytes`
- `receiverIsBroker`
- `receiverIsExternal`
- `receiverL2Bytes`
- `receiverPkts`
- `receiverRTO`
- `receiverZeroWnd`
- `redeliveryCount`
- `replyTo`
- `roundTripTime`
- `senderBytes`
- `senderIsBroker`
- `senderIsExternal`
- `senderL2Bytes`
- `senderPkts`
- `senderRTO`
- `senderZeroWnd`
- `serverIsExternal`
- `timeStamp`
- `totalMsgLength`
- **redeliveryCount: Number**: The number of redeliveries.
- **replyTo: String**: The JMSReplyTo field of the message, converted to a string.
- **roundTripTime: Number**: The median round trip time (RTT), expressed in milliseconds.

An RTT is the time it took for a device to send a single TCP packet and receive an immediate corresponding acknowledgment (ACK) packet.

The median value is calculated by sampling the RTTs observed since the last

`ACTIVEMQ_MESSAGE`

event ran. The value is

`NaN`

if there are no RTT samples.
- **senderBytes: Number**: The number of application-level bytes from the sender.
- **senderIsBroker: Boolean**: The value is

`true`

if the flow-level sender of the message is a broker.
- **senderL2Bytes: Number**: The number of

L2

bytes from the sender.
- **senderPkts: Number**: The number of packets from the sender.
- **senderRTO: Number**: The number of RTOs from the sender.
- **senderZeroWnd: Number**: The number of zero windows sent by the sender.
- **timestamp: Number**: The time when the message was handed off to a provider to be sent, expressed in GMT. This is the JMSTimestamp field of the message.
- **totalMsgLength: Number**: The length of the message, expressed in bytes.
