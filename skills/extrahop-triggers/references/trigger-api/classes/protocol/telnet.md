---
{
  "anchor": "telnet",
  "api_area": "trigger-api",
  "doc_kind": "class",
  "events": [
    "TELNET_MESSAGE"
  ],
  "examples": [],
  "methods": [
    "commitRecord(): void"
  ],
  "name": "Telnet",
  "properties": [
    "command: String",
    "line: String",
    "option: String",
    "optionData: Buffer",
    "record: Object",
    "receiverBytes: Number",
    "receiverL2Bytes: Number",
    "receiverPkts: Number",
    "receiverRTO: Number",
    "receiverZeroWnd: Number",
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

### Telnet

The `Telnet` class enables you to store metrics and access properties on `TELNET_MESSAGE` events.

#### Events

- **TELNET_MESSAGE**: Runs on a telnet command or line of data from the telnet

client

or server.

#### Methods

- **commitRecord(): void**: Sends a record to the configured recordstore on an

`TELNET_MESSAGE`

event.

To view the default properties committed to the record object, see the `record` property below.

For built-in records, each unique record is committed only once, even if the `commitRecord()` method is called multiple times for the same unique record.

#### Properties

- **command: String**: The command type. The value is

`null`

if the event was run due to a line of data being sent.

The following values are valid:

- `Abort`
- `Abort Output`
- `Are You There`
- `Break`
- `Data Mark`
- `DO`
- `DON'T`
- `End of File`
- `End of Record`
- `Erase Character`
- `Erase Line`
- `Go Ahead`
- `Interrupt Process`
- `NOP`
- `SB`
- `SE`
- `Suspend`
- `WILL`
- `WON'T`
- **line: String**: A line of the data sent by the

client

or server. Terminal escape sequences and special characters are filtered out. Cursor movement and line editing are not simulated except for backspace characters.
- **option: String**: The option being negotiated. The value is

`null`

if the option is invalid. The following values are valid:

- `3270-REGIME`
- `AARD`
- `ATCP`
- `AUTHENTICATION`
- `BM`
- `CHARSET`
- `COM-PORT-OPTION`
- `DET`
- `ECHO`
- `ENCRYPT`
- `END-OF-RECORD`
- `ENVIRON`
- `EXPOPL`
- `EXTEND-ASCII`
- `FORWARD-X`
- `GMCP`
- `KERMIT`
- `LINEMODE`
- `LOGOUT`
- `NAOCRD`
- `NAOFFD`
- `NAOHTD`
- `NAOHTS`
- `NAOL`
- `NAOLFD`
- `NAOP`
- `NAOVTD`
- `NAOVTS`
- `NAWS`
- `NEW-ENVIRON`
- `OUTMRK`
- `PRAGMA-HEARTBEAT`
- `PRAGMA-LOGON`
- `RCTE`
- `RECONNECT`
- `REMOTE-SERIAL-PORT`
- `SEND-LOCATION`
- `SEND-URL`
- `SSPI-LOGON`
- `STATUS`
- `SUPDUP`
- `SUPDUP-OUTPUT`
- `SUPPRESS-GO-AHEAD`
- `TERMINAL-SPEED`
- `TERMINAL-TYPE`
- `TIMING-MARK`
- `TN3270E`
- `TOGGLE-FLOW-CONTROL`
- `TRANSMIT-BINARY`
- `TTYLOC`
- `TUID`
- `X-DISPLAY-LOCATION`
- `X.3-PAD`
- `XAUTH`
- **optionData: Buffer**: For option subnegotiations (the SB command), the raw, option-specific data sent. The value is

`null`

if the command is not SB.
- **record: Object**: The record object that can be sent to the configured recordstore through a call to

`Telnet.commitRecord()`

on an

`TELNET_MESSAGE`

event.

The default record object can contain the following properties:

- `clientIsExternal`
- `command`
- `option`
- `receiverBytes`
- `receiverIsExternal`
- `receiverL2Bytes`
- `recieverPkts`
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
- **receiverBytes: Number**: The number of application-level bytes from the receiver.
- **receiverL2Bytes: Number**: The number of

L2

bytes from the receiver.
- **receiverPkts: Number**: The number of packets from the receiver.
- **receiverRTO: Number**: The number of

retransmission timeouts

(RTOs) from the receiver.
- **receiverZeroWnd: Number**: The number of zero windows sent by the receiver.
- **roundTripTime: Number**: The median round trip time (RTT), expressed in milliseconds.

An RTT is the time it took for a device to send a single TCP packet and receive an immediate corresponding acknowledgment (ACK) packet.

The median value is calculated by sampling the RTTs observed since the last

`TELNET_MESSAGE`

event ran. The value is

`NaN`

if there are no RTT samples.
- **senderBytes: Number**: The number of application-level bytes from the sender.
- **senderL2Bytes: Number**: The number of

L2

bytes from the sender.
- **senderPkts: Number**: The number of packets from the sender.
- **senderRTO: Number**: The number of

retransmission timeouts

(RTOs) from the sender.
- **senderZeroWnd: Number**: The number of zero windows sent by the sender.
