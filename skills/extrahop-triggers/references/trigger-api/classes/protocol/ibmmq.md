---
{
  "anchor": "ibmmq",
  "api_area": "trigger-api",
  "doc_kind": "class",
  "events": [
    "IBMMQ_REQUEST",
    "IBMMQ_RESPONSE"
  ],
  "examples": [
    "Example: Collect IBMMQ metrics"
  ],
  "methods": [
    "commitRecord(): void"
  ],
  "name": "IBMMQ",
  "properties": [
    "channel: String",
    "conversationId: Number",
    "correlationId: String",
    "error: String",
    "method: String",
    "msg: Buffer",
    "msgFormat: String",
    "msgId: String",
    "pcfError: String",
    "pcfMethod: String",
    "pcfWarning: String",
    "putAppName: String",
    "queue: String",
    "queueMgr: String",
    "record: Object",
    "reqBytes: Number",
    "reqL2Bytes: Number",
    "reqPkts: Number",
    "reqRTO: Number",
    "reqZeroWnd: Number",
    "resolvedQueue: String",
    "resolvedQueueMgr: String",
    "rfh: Array of Strings",
    "roundTripTime: Number",
    "rspBytes: Number",
    "rspL2Bytes: Number",
    "rspPkts: Number",
    "rspRTO: Number",
    "rspZeroWnd: Number",
    "totalMsgLength: Number",
    "warning: String"
  ],
  "section": "protocol-and-network-data-classes",
  "source_url": "https://docs.extrahop.com/current/extrahop-trigger-api/",
  "source_version": "26.2"
}
---

### IBMMQ

The IBMMQ class enables you to store metrics and access properties on `IBMMQ_REQUEST` and `IBMMQ_RESPONSE` events.

| Note: | The IBMMQ protocol supports EBCDIC encoding. |
| --- | --- |

#### Events

- **IBMMQ_REQUEST**: Runs on every IBMMQ request processed by the device.
- **IBMMQ_RESPONSE**: Runs on every IBMMQ response processed by the device.

#### Methods

- **commitRecord(): void**: Sends a record to the configured recordstore on either an

`IBMMQ_REQUEST`

or

`IBMMQ_RESPONSE`

event.

The event determines which properties are committed to the record object. To view the default properties committed for each event, see the `record` property below.

For built-in records, each unique record is committed only once, even if the `commitRecord()` method is called multiple times for the same unique record.

#### Properties

- **channel: String**: The communication channel name.
- **conversationId: Number**: The identifier for the MQ conversation.
- **correlationId: String**: The IBMMQ correlation ID.
- **error: String**: The error string that corresponds to the error code on the wire.
- **method: String**: The wire protocol request or response method name.

The following ExtraHop method names differ from the Wireshark method names:

| ExtraHop | Wireshark |
| --- | --- |
| `ASYNC_MSG_V7` | `ASYNC_MESSAGE` |
| `MQCLOSEv7` | `SOCKET_ACTION` |
| `MQGETv7` | `REQUEST_MSGS` |
| `MQGETv7_REPLY` | `NOTIFICATION` |
- **msg: Buffer**: A

[Buffer](#buffer)

object containing MQPUT, MQPUT1, MQGET_REPLY, ASYNC_MSG_V7, and MESSAGE_DATA messages.

Queue messages that are greater than 32K might be broken into more than one segment. A trigger is run for each segment and only the first segment has a non-null message.

Buffer data can be converted to a printable string through the `toString()` function or formatted through unpack commands.
- **msgFormat: String**: The message format.
- **msgId: String**: The IBMMQ message ID.
- **pcfError: String**: The error string that corresponds to the error code on the wire for the programmable command formats (PCF) channel.
- **pcfMethod: String**: The wire protocol request or response method name for the programmable command formats (PCF) channel.
- **pcfWarning: String**: The warning string that corresponds to the warning string on the wire for the programmable command formats (PCF) channel.
- **putAppName: String**: The application name associated with the MQPUT message.
- **queue: String**: The local queue name. The value is

`null`

if there is no

`MQOPEN`

,

`MQOPEN_REPLY`

,

`MQSP1(Open)`

, or

`MQSP1_REPLY`

message.
- **queueMgr: String**: The local queue manager. The value is

`null`

if there is no

`INITIAL_DATA`

message at the start of the connection.
- **record: Object**: The record object that can be sent to the configured recordstore through a call to

`IBMMQ.commitRecord()`

on either an

`IBMMQ_REQUEST`

or

`IBMMQ_RESPONSE`

event.

The event on which the method was called determines which properties the default record object can contain as displayed in the following table:

| IBMMQ_REQUEST | IBMMQ_RESPONSE |
| --- | --- |
| channel | channel |
| clientIsExternal | clientIsExternal |
| clientZeroWnd | clientZeroWnd |
| correlationId | correlationId |
| msgId | error |
| method | msgId |
| msgFormat | method |
| msgSize | msgFormat |
| queue | msgSize |
| queueMgr | queue |
| receiverIsExternal | queueMgr |
| reqBytes | receiverIsExternal |
| reqL2Bytes | resolvedQueue |
| reqPkts | resolvedQueueMgr |
| reqRTO | roundTripTime |
| resolvedQueue | rspBytes |
| resolvedQueueMgr | rspL2Bytes |
| senderIsExternal | rspPkts |
| serverIsExternal | rspRTO |
| serverZeroWnd | senderIsExternal |
|  | serverIsExternal |
|  | serverZeroWnd |
|  | warning |
- **reqBytes: Number**: The number of application-level request bytes.
- **reqL2Bytes: Number**: The number of

L2

request bytes.
- **reqPkts: Number**: The number of request packets.
- **reqRTO: Number**: The number of request

retransmission timeouts

(RTOs).
- **reqZeroWnd: Number**: The number of zero windows in the request.
- **resolvedQueue: String**: The resolved queue name from

`MQGET_REPLY`

,

`MQPUT_REPLY`

, or

`MQPUT1_REPLY`

messages. If the queue is remote, the value is different than the value returned by

`IBMMQ.queue`

.
- **resolvedQueueMgr: String**: The resolved queue manager from

`MQGET_REPLY`

,

`MQPUT_REPLY`

, or

`MQPUT1_REPLY`

. If the queue is remote, the value is different than the value returned by

`IBMMQ.queueMgr`

.
- **rfh: Array of Strings**: An array of strings located in the optional rules and formatting header (RFH). If there is no RFH header or the header is empty, the array is empty.
- **roundTripTime: Number**: The median round trip time (RTT), expressed in milliseconds.

An RTT is the time it took for a device to send a single TCP packet and receive an immediate corresponding acknowledgment (ACK) packet.

The median value is calculated by sampling the RTTs observed since the last

`IBMMQ_REQUEST`

or

`IBMMQ_RESPONSE`

event ran. The value is

`NaN`

if there are no RTT samples.
- **rspBytes: Number**: The number of application-level response bytes.
- **rspL2Bytes: Number**: The number of

L2

response bytes.
- **rspPkts: Number**: The number of request packets.
- **rspRTO: Number**: The number of response

retransmission timeouts

(RTOs).
- **rspZeroWnd: Number**: The number of zero windows in the response.
- **totalMsgLength: Number**: The total length of the message, expressed in bytes.
- **warning: String**: The warning string that corresponds to the warning string on the wire.

#### Trigger Examples

- [Example: Collect IBMMQ metrics](#example-collect-ibmmq-metrics)
