---
{
  "anchor": "flow",
  "api_area": "trigger-api",
  "doc_kind": "class",
  "events": [
    "FLOW_CLASSIFY",
    "FLOW_DETACH",
    "FLOW_RECORD",
    "FLOW_TICK",
    "FLOW_TURN"
  ],
  "examples": [
    "Example: Monitor SMB actions on devices",
    "Example: Track 500-level HTTP responses by customer ID and URI",
    "Example: Parse custom PoS messages with universal payload analysis",
    "Example: Parse syslog over TCP with universal payload analysis",
    "Example: Parse NTP with universal payload analysis",
    "Example: Track SOAP requests"
  ],
  "methods": [
    "addApplication(name: String, turnTiming: Boolean): void",
    "captureStart(name: String, options: Object): String",
    "name: String",
    "options: Object",
    "maxBytes: Number",
    "maxBytesLookback: Number",
    "maxDurationMSec: Number",
    "maxPackets: Number",
    "maxPacketsLookback: Number",
    "captureStop(): Boolean",
    "commitRecord1(): void",
    "commitRecord2(): void",
    "findCustomDevice(deviceID: String): Device",
    "getApplications(): String"
  ],
  "name": "Flow",
  "properties": [
    "age: Number",
    "bytes1: Number",
    "bytes2: Number",
    "customDevices1: Array",
    "customDevices2: Array",
    "device1: Device",
    "equals: Boolean",
    "device2: Device",
    "dscp1: Number",
    "dscp2: Number",
    "dscpBytes1: Array",
    "dscpBytes2: Array",
    "dscpName1: String",
    "dscpName2: String",
    "dscpPkts1: Array",
    "dscpPkts2: Array",
    "fragPkts1: Number",
    "fragPkts2: Number",
    "id: String",
    "ipaddr: IPAddress",
    "ipproto: String",
    "ipver: String",
    "isAborted: Boolean",
    "isExpired: Boolean",
    "isShutdown: Boolean",
    "ja4LatencyClient: String",
    "ja4LatencyServer: String",
    "ja4TCPClient: String",
    "ja4TCPServer: String",
    "l2Bytes1: Number",
    "l2Bytes2: Number",
    "l7proto: String",
    "nagleDelay1: Number",
    "nagleDelay2: Number",
    "overlapFragPkts1: Number",
    "overlapFragPkts2: Number",
    "overlapSegments1: Number",
    "overlapSegments2: Number",
    "payload1: Buffer",
    "payload2: Buffer",
    "pkts1: Number",
    "pkts2: Number",
    "port1: Number",
    "port2: Number",
    "rcvWndThrottle1: Number",
    "rcvWndThrottle2: Number",
    "record1: Object",
    "record2: Object",
    "roundTripTime: Number",
    "rto1: Number",
    "rto2: Number",
    "store: Object",
    "tcpOrigin: IPAddress | Null",
    "vlan: Number",
    "vxlanVNI: Number",
    "zeroWnd1: Number",
    "zeroWnd2: Number"
  ],
  "section": "general-purpose-classes",
  "source_url": "https://docs.extrahop.com/current/extrahop-trigger-api/",
  "source_version": "26.2"
}
---

### Flow

Flow refers to a conversation between two endpoints over a protocol such as TCP, UDP or ICMP. The `Flow` class provides access to elements of these conversations, such as endpoint IP addresses and age of the flow. The Flow class also contains a flow store designed to pass objects from request to response on the same flow.

| Note: | You can apply the Flow class on most L7 protocol events, but it is not supported on session or datastore events. |
| --- | --- |

#### Events

If a flow is associated with an ExtraHop-monitored L7 protocol, events that correlate to the protocol will run in addition to flow events. For example, a flow associated with HTTP will also run the `HTTP_REQUEST` and `HTTP_RESPONSE` events.

- **FLOW_CLASSIFY**: Runs whenever the ExtraHop system initially classifies a flow as being associated with a specific protocol.

| Note: | For TCP flows, the `FLOW_CLASSIFY` event runs after the `TCP_OPEN` event. |
| --- | --- |

Through a combination of L7 payload analysis, observation of TCP handshakes, and port number-based heuristics, the `FLOW_CLASSIFY` event identifies the L7 protocol and the device roles for the endpoints in a flow such as client/server or sender/receiver.

The nature of a flow can change over its lifetime, for example, tunneling over HTTP or switching from SMTP to SMTP-TLS. In these cases, `FLOW_CLASSIFY` runs again after the protocol change.

The `FLOW_CLASSIFY` event is useful for initiating an action on a flow based on the earliest knowledge of flow information such as the L7 protocol, client/server IP addresses, or sender/receiver ports.

Common actions initiated upon `FLOW_CLASSIFY` include starting a packet capture through the `captureStart()` method or associating the flow with an application container through the `addApplication()` method.

Additional options are available when you create a trigger that runs on this event. By default, `FLOW_CLASSIFY` does not run upon flow expiration; however, you can configure a trigger to do so in order to accumulate metrics for flows that were not classified before expiring. See [Advanced trigger options](#advanced-trigger-options) for more information.
- **FLOW_DETACH**: Runs when the parser has encountered an unexpected error or has run out of memory and stops following the flow. In addition, a low quality data feed with missing packets can cause the parser to detach.

The `FLOW_DETACH` event is useful for detecting malicious content sent by clients and servers. The following is an example of how a trigger can detect bad DNS responses upon `FLOW_DETACH` events:

```javascript
if (event == "FLOW_DETACH" && Flow.l7proto== "DNS") {
    Flow.addApplication("Malformed DNS");
}
```
- **FLOW_RECORD**: Enables you to record information about a flow at timed intervals. After

`FLOW_CLASSIFY`

has run, the

`FLOW_RECORD`

event will run every

`N`

seconds and whenever a flow closes. The default value for

`N`

, known as the publish interval, is 30 minutes; the minimum value is 60 seconds. You can set the publish interval in the Administration settings.
- **FLOW_TICK**: Enables you to record information about a flow per amount of data or per turn. The

`FLOW_TICK`

event will run on every

`FLOW_TURN`

or every 128 packets, whichever occurs first. Also,

L2

data is reset on every

`FLOW_TICK`

event which enables you to add data together at each tick. If counting throughput, collect data from

`FLOW_TICK`

events which provide more complete metrics than

`FLOW_TURN`

.

`FLOW_TICK` provides a means to periodically check for certain conditions on the flow, such as zero windows and Nagle delays, and then take an action, such as initiating a packet capture or sending a syslog message.

The following is an example of `FLOW_TICK`:

```javascript
log("RTT " + Flow.roundTripTime);
Remote.Syslog.info(
  " eh_event=FLOW_TICK" +
  " ClientIP="+Flow.client.ipaddr+
  " ServerIP="+Flow.server.ipaddr+
  " ServerPort="+Flow.server.port+
  " ServerName="+Flow.server.device.dnsNames[0]+
  " RTT="+Flow.roundTripTime);
```
- **FLOW_TURN**: Runs on every TCP or UDP turn. A turn represents one full cycle of a

client

transferring request data followed by a server transferring a response.

`FLOW_TURN` also exposes a [Turn](#turn) object.

#### Endpoints

Flow refers to a conversation between two endpoints over a protocol; an endpoint can be one of the following components:

- `client`
- `server`
- `sender`
- `receiver`

The methods and properties described in this section are called or accessed for a specified endpoint on the flow. For example, to access the `device` property from an HTTP client, the syntax is `Flow.client.device`.

The endpoint that you specify depends on the events associated with the trigger. For example, the `ACTIVEMQ_MESSAGE` event only supports sender and receiver endpoints. The following table displays a list of events that can be associated with a flow and the endpoints supported for each event:

| Event | Client / Server | Sender / Receiver |
| --- | --- | --- |
| `AAA_REQUEST` | yes | yes |
| `AAA_RESPONSE` | yes | yes |
| `AJP_REQUEST` | yes | yes |
| `AJP_RESPONSE` | yes | yes |
| `ACTIVEMQ_MESSAGE` | no | yes |
| `CIFS_REQUEST` | yes | yes |
| `CIFS_RESPONSE` | yes | yes |
| `DB_REQUEST` | yes | yes |
| `DB_RESPONSE` | yes | yes |
| `DHCP_REQUEST` | yes | yes |
| `DHCP_RESPONSE` | yes | yes |
| `DICOM_REQUEST` | yes | yes |
| `DICOM_RESPONSE` | yes | yes |
| `DNS_REQUEST` | yes | yes |
| `DNS_RESPONSE` | yes | yes |
| `FIX_REQUEST` | yes | yes |
| `FIX_RESPONSE` | yes | yes |
| `FLOW_CLASSIFY` | yes | no |
| `FLOW_DETACH` | yes | no |
| `FLOW_RECORD` | yes | no |
| `FLOW_TICK` | yes | no |
| `FLOW_TURN` | yes | no |
| `FTP_REQUEST` | yes | yes |
| `FTP_RESPONSE` | yes | yes |
| `HL7_REQUEST` | yes | yes |
| `HL7_RESPONSE` | yes | yes |
| `HTTP_REQUEST` | yes | yes |
| `HTTP_RESPONSE` | yes | yes |
| `IBMMQ_REQUEST` | yes | yes |
| `IBMMQ_RESPONSE` | yes | yes |
| `ICA_AUTH` | yes | no |
| `ICA_CLOSE` | yes | no |
| `ICA_OPEN` | yes | no |
| `ICA_TICK` | yes | no |
| `ICMP_MESSAGE` | no | yes |
| `KERBEROS_REQUEST` | yes | yes |
| `KERBEROS_RESPONSE` | yes | yes |
| `LDAP_REQUEST` | yes | yes |
| `LDAP_RESPONSE` | yes | yes |
| `MEMCACHE_REQUEST` | yes | yes |
| `MEMCACHE_RESPONSE` | yes | yes |
| `MODBUS_REQUEST` | yes | yes |
| `MODBUS_RESPONSE` | yes | yes |
| `MONGODB_REQUEST` | yes | yes |
| `MONGODB_RESPONSE` | yes | yes |
| `MSMQ_MESSAGE` | no | yes |
| `NFS_REQUEST` | yes | yes |
| `NFS_RESPONSE` | yes | yes |
| `POP3_REQUEST` | yes | yes |
| `POP3_RESPONSE` | yes | yes |
| `REDIS_REQUEST` | yes | yes |
| `REDIS_RESPONSE` | yes | yes |
| `RDP_CLOSE` | yes | no |
| `RDP_OPEN` | yes | no |
| `RDP_TICK` | yes | no |
| `RTCP_MESSAGE` | no | yes |
| `RTP_CLOSE` | no | yes |
| `RTP_OPEN` | no | yes |
| `RTP_TICK` | no | yes |
| `SCCP_MESSAGE` | no | yes |
| `SIP_REQUEST` | yes | yes |
| `SIP_RESPONSE` | yes | yes |
| `SMPP_REQUEST` | yes | yes |
| `SMPP_RESPONSE` | yes | yes |
| `SMTP_REQUEST` | yes | yes |
| `SMTP_RESPONSE` | yes | yes |
| `SSL_ALERT` | yes | yes |
| `SSL_CLOSE` | yes | no |
| `SSL_HEARTBEAT` | yes | yes |
| `SSL_OPEN` | yes | no |
| `SSL_PAYLOAD` | yes | yes |
| `SSL_RECORD` | yes | yes |
| `SSL_RENEGOTIATE` | yes | no |
| `TCP_CLOSE` | yes | no |
| `TCP_OPEN` | yes | no |
| `TCP_PAYLOAD` | yes | yes |
| `UDP_PAYLOAD` | yes | yes |
| `TELNET_MESSAGE` | yes | yes |
| `WEBSOCKET_OPEN` | yes | no |
| `WEBSOCKET_CLOSE` | yes | no |
| `WEBSOCKET_MESSAGE` | yes | yes |

- **Endpoint methods**: - **commitRecord(): void**: Sends a record to the configured recordstore on a

`FLOW_RECORD`

event. Record commits are not supported on

`FLOW_CLASSIFY`

,

`FLOW_DETACH`

,

`FLOW_TICK`

, or

`FLOW_TURN`

events.

On a flow, traffic moves in each direction between two endpoints. The `commitRecord()` method only records flow details in one direction, such as from the client to the server. To record details about the entire flow you must call `commitRecord()` twice, once for each direction, and specify the endpoint in the syntax—for example, `Flow.client.commitRecord()` and `Flow.server.commitRecord()`.

For built-in records, each unique record is committed only once, even if the `commitRecord()` method is called multiple times for the same unique record.

To view the default properties committed to the record object, see the `record` property below.

- **Endpoint properties**: - **bytes: Number**: The number of

L4

payload bytes transmitted by a device. Specify the device role in the syntax—for example,

`Flow.client.bytes`

or

`Flow.receiver.bytes`

.

Access only on `FLOW_TICK`, `FLOW_TURN`, or `FLOW_RECORD` events; otherwise, an error will occur.
- **customDevices: Array**: An array of custom devices in the flow. Specify the device role in the syntax—for example,

`Flow.client.customDevices`

or

`Flow.receiver.customDevices`

.
- **device: Device**: The

[Device](#device)

object associated with a device. Specify the device role in the syntax. For example, to access the MAC address of the

client

device, specify

`Flow.client.device.hwaddr`

.

- **equals: Boolean**: Performs an equality test between

[Device](#device)

objects.
- **dscp: Number**: The number representing the last differentiated services code point (DSCP) value of the flow packet.

Specify the device role in the syntax—for example, `Flow.client.dscp` or `Flow.server.dscp`.
- **dscpBytes: Array**: An array that contains the number of

L2

bytes for a specific Differentiated Services Code Point (DSCP) value transmitted by a device in the flow. Specify the device role in the syntax—for example,

`Flow.client.dscpBytes`

or

`Flow.server.dscpBytes`

.

The value is zero for each entry that has no bytes of the specific DSCP since the last `FLOW_TICK` event.

Access only on `FLOW_TICK` or `FLOW_TURN` events; otherwise, an error will occur.
- **dscpName1: String**: The name associated with the DSCP value transmitted by device1 in the flow. The following table displays well-known DSCP names:

| Number | Name |
| --- | --- |
| 8 | `CS1` |
| 10 | `AF11` |
| 12 | `AF12` |
| 14 | `AF13` |
| 16 | `CS2` |
| 18 | `AF21` |
| 20 | `AF22` |
| 22 | `AF23` |
| 24 | `CS3` |
| 26 | `AF31` |
| 28 | `AF32` |
| 30 | `AF33` |
| 32 | `CS4` |
| 34 | `AF41` |
| 36 | `AF42` |
| 38 | `AF43` |
| 40 | `CS5` |
| 44 | `VA` |
| 46 | `EF` |
| 48 | `CS6` |
| 56 | `CS7` |
- **dscpName2: String**: The name associated with the DSCP value transmitted by device2 in the flow. The following table displays well-known DSCP names:

| Number | Name |
| --- | --- |
| 8 | `CS1` |
| 10 | `AF11` |
| 12 | `AF12` |
| 14 | `AF13` |
| 16 | `CS2` |
| 18 | `AF21` |
| 20 | `AF22` |
| 22 | `AF23` |
| 24 | `CS3` |
| 26 | `AF31` |
| 28 | `AF32` |
| 30 | `AF33` |
| 32 | `CS4` |
| 34 | `AF41` |
| 36 | `AF42` |
| 38 | `AF43` |
| 40 | `CS5` |
| 44 | `VA` |
| 46 | `EF` |
| 48 | `CS6` |
| 56 | `CS7` |
- **dscpPkts: Array**: An array that contains the number of

L2

packets for a given Differentiated Services Code Point (DSCP) value transmitted by a device in the flow. Specify the device role in the syntax—for example,

`Flow.client.dscpPkts`

or

`Flow.server.dscpPkts`

.

The value is zero for each entry that has no packets of the specific DSCP since the last `FLOW_TICK` event.

Applies only to `FLOW_TICK` or `FLOW_TURN` events.
- **fragPkts: Number**: The number of packets resulting from IP fragmentation transmitted by a client or server device in the flow. Specify the device role in the syntax—for example,

`Flow.client.fragPkts`

or

`Flow.server.fragPkts`

.

Access only on `FLOW_TICK` or `FLOW_TURN` events; otherwise, an error will occur.
- **ipaddr1: IPAddress**: The

[IPAddress](#ipaddress)

object associated with device1 in the flow.

- **equals: Boolean**: Performs an equality test between

[IPAddress](#ipaddress)

objects.
- **ipaddr2: IPAddress**: The

[IPAddress](#ipaddress)

object associated with device2 in the flow.

- **equals: Boolean**: Performs an equality test between

[IPAddress](#ipaddress)

objects.
- **isAborted: Boolean**: The value is

`true`

if a TCP flow has been aborted through a TCP reset (RST). The flow can be aborted by a device. If applicable, specify the device role in the syntax—for example,

`Flow.client.isAborted`

or

`Flow.receiver.isAborted`

.

This condition may be detected in the `TCP_CLOSE` event and in any impacted L7 events (for example, `HTTP_REQUEST` or `DB_RESPONSE`).

| Note: | An L4 abort occurs when a TCP connection is closed with a RST instead of a graceful shutdown. An L7 response abort occurs when a connection closes while in the middle of a response. This can be due to a RST, a graceful FIN shutdown, or an expiration. An L7 request abort occurs when a connection closes in the middle of a request. This can also be due to a RST, a graceful FIN shutdown, or an expiration. |
| --- | --- |
- **isShutdown: Boolean**: The value is

`true`

if the device initiated the shutdown of the TCP connection. Specify the device role in the syntax—for example,

`Flow.client.isShutdown`

or

`Flow.receiver.isShutdown`

.
- **l2Bytes: Number**: The number of

L2

bytes, including the ethernet headers, transmitted by a device in the flow. Specify the device role in the syntax—for example,

`Flow.client.l2Bytes`

or

`Flow.server.l2Bytes`

.

Access only on `FLOW_TICK` or `FLOW_TURN` events; otherwise, an error will occur.
- **nagleDelay: Number**: The number of Nagle delays associated with a device in the flow. Specify the device role in the syntax—for example,

`Flow.client.nagleDelay`

or

`Flow.server.nagleDelay`

.

Access only on `FLOW_TICK` or `FLOW_TURN` events; otherwise, an error will occur.
- **offender: Object**: Returns an offender participant object for a device in the flow. Specify this property in the

`commitDetection()`

function to identify the device in the flow as the offender in a detection, as shown in the following code example:

```javascript
commitDetection('exampledetection', {
    participants: [Flow.client.offender, Flow.server.victim],
```
- **overlapFragPkts: Number**: The number of non-identical IP fragment packets with overlapping data transmitted by a device in the flow. Specify the device role in the syntax—for example,

`Flow.client.overlapFragPkts`

or

`Flow.server.overlapFragPkts`

.

Access only on `FLOW_TICK` or `FLOW_TURN` events; otherwise, an error will occur.
- **overlapSegments: Number**: The number of non-identical TCP segments, transmitted by a device in the flow, where two or more TCP segments contain data for the same part of the flow. Specify the device role in the syntax—for example,

`Flow.client.overlapSegments`

or

`Flow.server.overlapSegments`

.

Access only on `FLOW_TICK` or `FLOW_TURN` events; otherwise, an error will occur.
- **payload: Buffer**: The payload

[Buffer](#buffer)

associated with a device in the flow. Specify the device role in the syntax—for example,

`Flow.client.payload`

or

`Flow.receiver.payload`

.

Access only on `TCP_PAYLOAD`, `UDP_PAYLOAD`, or `SSL_PAYLOAD` events; otherwise, an error will occur.
- **pkts: Number**: The number of packets transmitted by a device in the flow. Specify the device role in the syntax—for example,

`Flow.client.pkts`

or

`Flow.server.pkts`

.

Access only on `FLOW_TICK`, `FLOW_TURN`, or `FLOW_RECORD` events; otherwise, an error will occur.
- **port: Number**: The port number associated with a device in the flow. Specify the device role in the syntax—for example,

`Flow.client.port`

or

`Flow.receiver.port`

.
- **rcvWndThrottle: Number**: The number of receive window throttles sent from a device in the flow. Specify the device role in the syntax—for example,

`Flow.client.rcvWndThrottle`

or

`Flow.server.rcvWndThrottle`

.

Access only on `FLOW_TICK` or `FLOW_TURN` events; otherwise, an error will occur.
- **record: Object**: The record object that can be sent to the configured recordstore through a call to

`Flow.commitRecord()`

on a

`FLOW_RECORD`

event. The record object represents data from a single direction on the flow.

The default record object can contain the following properties:

- `age`
- `bytes (L3)` Note:This property represents the total number of bytes that were transmitted by the flow at the time that the FLOW_RECORD event ran. The FLOW_RECORD event runs several times over the course of each flow, so the value will increase every time the event runs.
- `clientIsExternal`
- `dscpName`
- `first`
- `firstPayloadBytes` A hexadecimal representation of the first 16 payload bytes in the flow.
- `last`
- `pkts`
- `proto`
- `receiverAddr`
- `receiverIsExternal`
- `receiverPort`
- `roundTripTime` The most recent round trip time (RTT) in this flow. An RTT is the time it took for a device to send a packet and receive an immediate acknowledgment (ACK).
- `senderAddr`
- `senderIsExternal`
- `senderPort`
- `serverIsExternal`
- `tcpFlags`

Specify the device role in the syntax—for example, `Flow.client.record` or `Flow.server.record`.

Access the record object only on `FLOW_RECORD` events; otherwise, an error will occur.
- **rto: Number**: The number of

retransmission timeouts

(RTOs) associated with a device in the flow. Specify the device role in the syntax—for example,

`Flow.client.rto`

or

`Flow.server.rto`

.

Access only on `FLOW_TICK` or `FLOW_TURN` events; otherwise, an error will occur.
- **victim: Object**: Returns an victim participant object for a device in the flow. Specify this property in the

`commitDetection()`

function to identify the device in the flow as the victim in a detection, as shown in the following code example:

```javascript
commitDetection('exampledetection', {
    participants: [Flow.client.offender, Flow.server.victim],
```
- **totalL2Bytes**: The number of L2 bytes sent by a device during the flow. Specify the device role in the syntax—for example,

`Flow.client.totalL2Bytes`

or

`Flow.server.totalL2Bytes`

.
- **totalL2Bytes1: Number**: The number of L2 bytes sent during the flow by device1.
- **totalL2Bytes2: Number**: The number of L2 bytes sent during the flow by device2.
- **zeroWnd: Number**: The number of zero windows sent from a device in the flow. Specify the device role in the syntax—for example,

`Flow.client.zeroWnd`

or

`Flow.server.zeroWnd`

.

Access only on `FLOW_TICK` or `FLOW_TURN` events; otherwise, an error will occur.

#### Methods

- **addApplication(name: String, turnTiming: Boolean): void**: Creates an application with the specified name and collects L2-L4 metrics from the flow. The application can be viewed in the ExtraHop system and the metrics are displayed on an L4 page in the application. A flow can be associated with one or more applications at a given instant; the L2-L4 metrics collected by each application will be the same.

Calling `Flow.addApplication(name)` on a `FLOW_CLASSIFY` event is common on unsupported protocols. For flows on supported protocols with L7 trigger events, it is recommended to call the `Application(name).commit()` method, which collects a larger set of protocol metrics.

The optional `turnTiming` flag is set to false by default. If set to true, the ExtraHop system collects additional turn timing metrics for the flow. If this flag is omitted, no turn timing metrics are recorded for the application on the associated flow. Turn timing analysis analyzes L4 behavior in order to infer L7 processing times when the monitored protocol follows a client-request, server-response pattern and in which the client sends the first message. "Banner" protocols (where the server sends the first message) and protocols where data flows in both directions concurrently are not recommended for turn timing analysis.
- **captureStart(name: String, options: Object): String**: Initiates a Precision Packet Capture (PPCAP) for the flow and returns a unique identifier of the packet capture in the format of a decimal number as a string. Returns

`null`

if the packet capture fails to start.

- **name: String**: The name of the packet capture file.

- The maximum length is 256 characters
- A separate capture is created for each flow.
- Capture files with the same name are differentiated by timestamps.
- **options: Object**: The options contained in the capture object. Omit any of the options to indicate unlimited size for that option. All options apply to the entire flow except the "lookback" options which apply only to the part of the flow before the trigger event that started the packet capture.

- **maxBytes: Number**: The total maximum number of bytes.
- **maxBytesLookback: Number**: The total maximum number of bytes from the lookback buffer. The lookback buffer refers to packets captured before the call to

`Flow.captureStart()`

.
- **maxDurationMSec: Number**: The maximum duration of the packet capture, expressed in milliseconds.
- **maxPackets: Number**: The total maximum number of packets. The maximum value might be exceeded if the

[trigger load](https://docs.extrahop.com/26.2/system-health-overview/#trigger-load)

is heavy.
- **maxPacketsLookback: Number**: The maximum number of packets from the lookback buffer. The lookback buffer refers to packets captured before the call to

`Flow.captureStart()`

.

The following is an example of `Flow.captureStart()`:

```javascript
// EVENT: HTTP_REQUEST
// capture facebook HTTP traffic flows
if (HTTP.uri.indexOf("www.facebook.com") !== -1) {
   var name = "facebook-" + HTTP.uri;
   //packet capture options: capture 20 packets, up to 10 from the lookback buffer
   var opts = {
      maxPackets: 20,
      maxPacketsLookback: 10
   };
   Flow.captureStart(name, opts);
}
```

| Note: | The `Flow.captureStart()` function call requires that you have a license for precision packet capture. You can specify the number of bytes per packet (snaplen) you want to capture when configuring the trigger in the ExtraHop system. This option is available only on some events. See [Advanced trigger options](#advanced-trigger-options) for more information. On ExtraHop Performance systems, captured files are available in the Administration settings. On RevealX systems, captured files are available from the Packets page in the ExtraHop system. On ExtraHop Performance systems, if the precision packet capture disk is full, no new captures are recorded until the user deletes the files manually. On Reveal systems, older packet captures are deleted when the precision packet capture disk becomes full to enable the system to continue recording new packet captures. The maximum file name string length is 256 characters. If the name exceeds 256 characters, it will be truncated and a warning message will be visible in the debug log, but the trigger will continue to execute. The capture file size is the whichever maximum is reached first between the `maxPackets` and `maxBytes` options. The size of the capture lookback buffer is whichever maximum is reached first between the `maxPacketsLookback` and `maxBytesLookback` options. Each passed `max*` parameter will capture up to the next packet boundary. If the packet capture was already started on the current flow, `Flow.captureStart()` calls result in a warning visible in the debug log, but the trigger will continue to run. There is a maximum of 128 concurrent packet captures in the system. If that limit is reached, subsequent calls to `Flow.captureStart()` will generate a warning visible in the debug log, but the trigger will continue to execute. |
| --- | --- |
- **captureStop(): Boolean**: Stops a packet capture that is in progress on the current flow.
- **commitRecord1(): void**: Sends a record to the configured recordstore that represents data sent from

`device1`

in a single direction on the flow.

You can call this method only on `FLOW_RECORD` events, and each unique record is committed only once for built-in records.

To view the properties committed to the record object, see the `record` property below.
- **commitRecord2(): void**: Sends a record to the configured recordstore that represents data sent from

`device2`

in a single direction on the flow.

You can call this method only on `FLOW_RECORD` events, and each unique record is committed only once for built-in records.

To view the properties committed to the record object, see the `record` property below.
- **findCustomDevice(deviceID: String): Device**: Returns a single

[Device](#device)

object that corresponds to the specified deviceID parameter if the device is located on either side of the flow. Returns

`null`

if no corresponding device is found.
- **getApplications(): String**: Retrieves all applications associated with the flow.

#### Properties

The Flow object properties and methods discussed in this section are available to every L7 trigger event associated with the flow.

By default, the ExtraHop system uses loosely-initiated protocol classification, so it will try to classify flows even after the connection was initiated. Loose initiation can be turned off for ports that do not always carry the protocol traffic (for example, the wildcard port 0). For such flows, `device1`, `port1`, and `ipaddr1` represent the device with the numerically lower IP address and `device2`, `port2`, and `ipaddr2` represent the device with the numerically higher IP address.

- **age: Number**: The time elapsed since the flow was initiated, expressed in seconds.
- **bytes1: Number**: The number of

L4

payload bytes transmitted by one of two devices in the flow; the other device is represented by

`bytes2`

. The device represented by

`bytes1`

remains consistent for the flow.

Access only on `FLOW_TICK`, `FLOW_TURN`, or `FLOW_RECORD` events; otherwise, an error will occur.
- **bytes2: Number**: The number of

L4

payload bytes transmitted by one of two devices in the flow; the other device is represented by

`bytes1`

. The device represented by

`bytes2`

remains consistent for the flow.

Access only on `FLOW_TICK`, `FLOW_TURN`, or `FLOW_RECORD` events; otherwise, an error will occur.
- **customDevices1: Array**: An array of custom

[Device](#device)

objects on a flow. Custom devices on the other side of the flow are available by accessing

`customDevices2`

. The device represented by

`customDevices1`

remains consistent for the flow.
- **customDevices2: Array**: An array of custom

[Device](#device)

objects on a flow. Custom devices on the other side of the flow are available by accessing

`customDevices1`

. The device represented by

`customDevices2`

remains consistent for the flow.
- **device1: Device**: The

[Device](#device)

object associated with one of two devices in the flow; the other device is represented by

`device2`

. The device represented by

`device1`

remains consistent for the flow. For example,

`Flow.device1.hwaddr`

accesses the MAC addresses of this device in the flow.

- **equals: Boolean**: Performs an equality test between

[Device](#device)

objects.
- **device2: Device**: The

[Device](#device)

object associated with one of two devices in the flow; the other device is represented by

`device1`

. The device represented by

`device2`

remains consistent for the flow. For example,

`Flow.device2.hwaddr`

accesses the MAC addresses of this device in the flow.

- **equals: Boolean**: Performs an equality test between

[Device](#device)

objects.
- **dscp1: Number**: The number representing the last Differentiated Services Code Point (DSCP) value transmitted by one of two devices in the flow; the other device is represented by

`dscp2`

. The device represented by

`dscp1`

remains consistent for the flow.
- **dscp2: Number**: The lnumber representing the last Differentiated Services Code Point (DSCP) value transmitted by one of two devices in the flow; the other device is represented by

`dscp1`

. The device represented by

`dscp2`

remains consistent for the flow.
- **dscpBytes1: Array**: An array that contains the number of

L2

bytes for a specific Differentiated Services Code Point (DSCP) value transmitted by one of two devices in the flow; the other device is represented by

`dscpBytes2`

. The device represented by

`dscpBytes1`

remains consistent for the flow.

The value is zero for each entry that has no bytes of the specific DSCP since the last `FLOW_TICK` event.

Access only on `FLOW_TICK` or `FLOW_TURN` events; otherwise, an error will occur.
- **dscpBytes2: Array**: An array that contains the number of

L2

bytes for a specific Differentiated Services Code Point (DSCP) value transmitted by one of two devices in the flow; the other device is represented by

`dscpBytes1`

. The device represented by

`dscpBytes2`

remains consistent for the flow.

The value is zero for each entry that has no bytes of the specific DSCP since the last `FLOW_TICK` event.

Access only on `FLOW_TICK` or `FLOW_TURN` events; otherwise, an error will occur.
- **dscpName1: String**: The name associated with the DSCP value transmitted by one of two devices in the flow; the other device is represented by

`dscpName2`

. The device represented by

`dscpName1`

remains consistent for the flow.

See the `dscpName` property in the [Endpoints](#endpoints) section for a list of supported DSCP code names.
- **dscpName2: String**: The name associated with the DSCP value transmitted by one of two devices in the flow; the other device is represented by

`dscpName1`

. The device represented by

`dscpName2`

remains consistent for the flow.

See the `dscpName` property in the [Endpoints](#endpoints) section for a list of supported DSCP code names.
- **dscpPkts1: Array**: An array that contains the number of

L2

packets for a given Differentiated Services Code Point (DSCP) value transmitted by one of two devices in the flow; the other device is represented by

`dscpPkts2`

. The device represented by

`dscpPkts1`

remains consistent for the flow.

The value is zero for each entry that has no packets of the specific DSCP since the last `FLOW_TICK` event.

Access only on `FLOW_TICK` or `FLOW_TURN` events; otherwise, an error will occur.
- **dscpPkts2: Array**: An array that contains the number of

L2

packets for a given Differentiated Services Code Point (DSCP) value transmitted by one of two devices in the flow; the other device is represented by

`dscpPkts1`

. The device represented by

`dscpPkts2`

remains consistent for the flow.

The value is zero for each entry that has no packets of the specific DSCP since the last `FLOW_TICK` event.

Access only on `FLOW_TICK` or `FLOW_TURN` events; otherwise, an error will occur.
- **fragPkts1: Number**: The number of packets resulting from IP fragmentation transmitted by one of two devices in the flow; the other device is represented by

`fragPkts2`

. The device represented by

`fragPkts1`

remains consistent for the flow.

Access only on `FLOW_TICK` or `FLOW_TURN` events; otherwise, an error will occur.
- **fragPkts2: Number**: The number of packets resulting from IP fragmentation transmitted by one of two devices in the flow; the other device is represented by

`fragPkts1`

. The device represented by

`fragPkts2`

remains consistent for the flow.

Access only on `FLOW_TICK` or `FLOW_TURN` events; otherwise, an error will occur.
- **id: String**: The unique identifier of a Flow record.
- **ipaddr: IPAddress**: The

[IPAddress](#ipaddress)

object associated with a device in the flow. Specify the device role in the syntax—for example,

`Flow.client.ipaddr`

or

`Flow.receiver.ipaddr`

.

- **equals: Boolean**: Performs an equality test between

[IPAddress](#ipaddress)

objects.
- **ipproto: String**: The IP protocol associated with the flow, such as TCP or UDP.
- **ipver: String**: The IP version associated with the flow, such as IPv4 or IPv6.
- **isAborted: Boolean**: The value is

`true`

if a TCP flow has been aborted through a TCP reset (RST). The flow can be aborted by a device. If applicable, specify the device role in the syntax—for example,

`Flow.client.isAborted`

or

`Flow.receiver.isAborted`

.

This condition may be detected in the `TCP_CLOSE` event and in any impacted L7 events (for example, `HTTP_REQUEST` or `DB_RESPONSE`).

| Note: | An L4 abort occurs when a TCP connection is closed with a RST instead of a graceful shutdown. An L7 response abort occurs when a connection closes while in the middle of a response. This can be due to a RST, a graceful FIN shutdown, or an expiration. An L7 request abort occurs when a connection closes in the middle of a request. This can also be due to a RST, a graceful FIN shutdown, or an expiration. |
| --- | --- |
- **isExpired: Boolean**: The value is

`true`

if the flow expired at the time of the event.
- **isShutdown: Boolean**: The value is

`true`

if the device initiated the shutdown of the TCP connection. Specify the device role in the syntax—for example,

`Flow.client.isShutdown`

or

`Flow.receiver.isShutdown`

.
- **ja4LatencyClient: String**: The JA4L latency fingerprint for the client, which includes the time it took for the client to send the SYN packet, the time-to-live (TTL) of the packet, and the one way latency of the client L7 application protocol negotiation.
- **ja4LatencyServer: String**: The JA4LS latency fingerprint for the server, which includes the time it took for the server to send the SYN-ACK packet, the time-to-live (TTL) of the packet, and the one way latency of the server L7 application protocol negotiation.
- **ja4TCPClient: String**: The JA4T fingerprint for the client that sent the TCP request, which includes the window size, TCP options, maximum segment size (MSS), and window scale.

Access only on `TCP_OPEN` events; otherwise, an error will occur.
- **ja4TCPServer: String**: The JA4TS fingerprint for the response sent by the TCP server, which includes the window size, TCP options, maximum segment size (MSS), and window scale.

Access only on `TCP_OPEN` events; otherwise, an error will occur.
- **l2Bytes1: Number**: The number of

L2

bytes, including the ethernet headers, transmitted by one of two devices in the flow; the other device is represented by

`l2Bytes2`

. The device represented by

`l2Bytes1`

remains consistent for the flow.

Access only on `FLOW_TICK` or `FLOW_TURN` events; otherwise, an error will occur.
- **l2Bytes2: Number**: The number of

L2

bytes, including the ethernet headers, transmitted by one of two devices in the flow; the other device is represented by

`l2Bytes1`

. The device represented by

`l2Bytes2`

remains consistent for the flow.

Access only on `FLOW_TICK` or `FLOW_TURN` events; otherwise, an error will occur.
- **l7proto: String**: The L7 protocol associated with the flow. For known protocols, the property returns a string representing the protocol name, such as

HTTP

, DHCP,

Memcache

. For lesser-known protocols, the property returns a string formatted as

`ipproto:port`

—

`tcp:13724`

or

`udp:11258`

For custom protocol names, the property returns a string representing the name set through the Protocol Classification section in the Administration settings.

This property is not valid during `TCP_OPEN` events.
- **nagleDelay1: Number**: The number of Nagle delays associated with one of two devices in the flow; the other device is represented by

`nagleDelay2`

. The device represented by

`nagleDelay1`

remains consistent for the flow.

Access only on `FLOW_TICK` or `FLOW_TURN` events; otherwise, an error will occur.
- **nagleDelay2: Number**: The number of Nagle delays associated with one of two devices in the flow; the other device is represented by

`nagleDelay1`

. The device represented by

`nagleDelay2`

remains consistent for the flow.

Access only on `FLOW_TICK` or `FLOW_TURN` events; otherwise, an error will occur.
- **overlapFragPkts1: Number**: The number of non-identical IP fragment packets transmitted by one of two devices in the flow; the other device is represented by

`overlapFragPkts2`

. The device represented by

`overlapFragPkts1`

remains consistent for the flow.

Access only on `FLOW_TICK` or `FLOW_TURN` events; otherwise, an error will occur.
- **overlapFragPkts2: Number**: The number of non-identical IP fragment packets transmitted by one of two devices in the flow; the other device is represented by

`overlapFragPkts1`

. The device represented by

`overlapFragPkts2`

remains consistent for the flow.

Access only on `FLOW_TICK` or `FLOW_TURN` events; otherwise, an error will occur.
- **overlapSegments1: Number**: The number of non-identical TCP segments where two or more segments contain data for the same part of the flow. The TCP segments are transmitted by one of two devices in the flow; the other device is represented by

`overlapSegments2`

. The device represented by

`overlapSegments1`

remains consistent for the flow.

Access only on `FLOW_TICK` or `FLOW_TURN` events; otherwise, an error will occur.
- **overlapSegments2: Number**: The number of non-identical TCP segments where two or more segments contain data for the same part of the flow. The TCP segments are transmitted by one of two devices in the flow; the other device is represented by

`overlapSegments1`

. The device represented by

`overlapSegments2`

remains consistent for the flow.

Access only on `FLOW_TICK` or `FLOW_TURN` events; otherwise, an error will occur.
- **payload1: Buffer**: The payload

[Buffer](#buffer)

associated with one of two devices in the flow; the other device is represented by

`payload2`

. The device represented by

`payload1`

remains consistent for the flow.

Access only on `TCP_PAYLOAD`, `UDP_PAYLOAD`, and `SSL_PAYLOAD` events; otherwise, an error will occur.
- **payload2: Buffer**: The payload

[Buffer](#buffer)

associated with one of two devices in the flow; the other device is represented by

`payload1`

. The device represented by

`payload2`

remains consistent for the flow.

Access only on `TCP_PAYLOAD`, `UDP_PAYLOAD`, or `SSL_PAYLOAD` events; otherwise, an error will occur.
- **pkts1: Number**: The number of packets transmitted by one of two devices in the flow; the other device is represented by

`pkts2`

. The device represented by

`pkts1`

remains consistent for the flow.

Access only on `FLOW_TICK`, `FLOW_TURN`, or `FLOW_RECORD` events; otherwise, an error will occur.
- **pkts2: Number**: The number of packets transmitted by one of two devices in the flow; the other device is represented by

`pkts1`

. The device represented by

`pkts2`

remains consistent for the flow.

Access only on `FLOW_TICK`, `FLOW_TURN`, or `FLOW_RECORD` events; otherwise, an error will occur.
- **port1: Number**: The port number associated with one of two devices in a flow; the other device is represented by

`port2`

. The device represented by

`port1`

remains consistent for the flow.
- **port2: Number**: The port number associated with one of two devices in a flow; the other device is represented by

`port1`

. The device represented by

`port2`

remains consistent for the flow.
- **rcvWndThrottle1: Number**: The number of receive window throttles sent from one of two devices in the flow; the other device is represented by

`rcvWndThrottle2`

. The device represented by

`rcvWndThrottle1`

remains consistent for the flow.

Access only on `FLOW_TICK` or `FLOW_TURN` events; otherwise, an error will occur.
- **rcvWndThrottle2: Number**: The number of receive window throttles sent from one of two devices in the flow; the other device is represented by

`rcvWndThrottle1`

. The device represented by

`rcvWndThrottle2`

remains consistent for the flow.

Access only on `FLOW_TICK` or `FLOW_TURN` events; otherwise, an error will occur.
- **record1: Object**: The record object that can be sent to the configured recordstore through a call to

`Flow.commitRecord1()`

on a

`FLOW_RECORD`

event.

The object represents traffic sent in a single direction from one of two devices in the flow; the other device is represented by the `record2` property. The device represented by the `record1` property remains consistent for the flow.

Access the record object only on `FLOW_RECORD` events; otherwise, an error will occur.

The default record object can contain the following properties:

- `age`
- `bytes (L3)`
- `clientIsExternal`
- `dscpName`
- `first`
- `last`
- `pkts`
- `proto`
- `receiverAddr`
- `receiverIsExternal`
- `receiverPort`
- `roundTripTime` The most recent round trip time (RTT) observed in the flow. An RTT is the time it took for a device to send a single TCP packet and receive an immediate corresponding acknowledgment (ACK) packet.
- `senderAddr`
- `senderIsExternal`
- `senderPort`
- `serverIsExternal`
- `tcpOrigin` This record field is included only if the record represents traffic sent from a client or sender device.
- `tcpFlags`
- **record2: Object**: The record object that can be sent to the configured recordstore through a call to

`Flow.commitRecord2()`

on a

`FLOW_RECORD`

event.

The object represents traffic sent in a single direction from one of two devices in the flow; the other device is represented by the `record1` property. The device represented by the `record2` property remains consistent for the flow.

Access the record object only on `FLOW_RECORD` events; otherwise, an error will occur.

The default record object can contain the following properties:

- `age`
- `bytes (L3)`
- `clientIsExternal`
- `dscpName`
- `first`
- `last`
- `pkts`
- `proto`
- `receiverAddr`
- `receiverIsExternal`
- `receiverPort`
- `roundTripTime` The most recent round trip time (RTT) observed in the flow. An RTT is the time it took for a device to send a single TCP packet and receive an immediate corresponding acknowledgment (ACK) packet.
- `senderAddr`
- `senderIsExternal`
- `senderPort`
- `serverIsExternal`
- `tcpOrigin` This record field is included only if the record represents traffic sent from a client or sender device.
- `tcpFlags`
- **roundTripTime: Number**: The median round trip time (RTT) observed since the last

`FLOW_TICK`

event ran, expressed in milliseconds.

An RTT is the time it took for a device to send a single TCP packet and receive an immediate corresponding acknowledgment (ACK) packet.

The value is

`NaN`

if there are no RTT samples.

Access only on `FLOW_TICK` or `FLOW_TURN` events; otherwise, an error will occur.
- **rto1: Number**: The number of

retransmission timeouts

(RTOs) associated with one of two devices in the flow; the other device is represented by

`rto2`

. The device represented by

`rto1`

remains consistent for the flow.

Access only on `FLOW_TICK` or `FLOW_TURN` events; otherwise, an error will occur.
- **rto2: Number**: The number of

retransmission timeouts

(RTOs) associated with one of two devices in the flow; the other device is represented by

`rto1`

. The device represented by

`rto2`

remains consistent for the flow.

Access only on `FLOW_TICK` or `FLOW_TURN` events; otherwise, an error will occur.
- **store: Object**: The flow store is designed to pass objects from request to response on the same flow. The

`store`

object is an instance of an empty JavaScript object. Objects can be attached to the store as properties by defining the property key and property value. For example:

```javascript
Flow.store.myobject = "myvalue";
```

For events that occur on the same flow, you can apply the flow store instead of the session table to share information. For example:

```javascript
// request 
Flow.store.userAgent = HTTP.userAgent;  

// response 
var userAgent = Flow.store.userAgent;
```

| Important: | Flow store values persist across all requests and responses carried on that flow. When working with the flow store, it is a best practice to set the flow store variable to `null` when its value should not be conveyed to the next request or response. This practice has the added benefit of conserving flow store memory. |
| --- | --- |

Most flow store triggers should have a structure similar to the following example:

```javascript
if (event === 'DB_REQUEST') {
                 if (DB.statement) {
                 Flow.store.stmt = DB.statement; 
} else {
                 Flow.store.stmt = null; 
} 
} 
else if (event === 'DB_RESPONSE') {
        var stmt = Flow.store.stmt;
        Flow.store.stmt = null;
        if (stmt) {
                 // Do something with 'stmt';   
                 // for example, commit a metric  
        } 
}
```

| Note: | Because DHCP requests often occur on different flows than corresponding DHCP responses, we recommend that you combine DHCP request and response information by storing DHCP transaction IDs in the session table. For example, the following trigger code creates a metric that tracks how many DHCP discover messages received a corresponding DHCP offer message:if (event === 'DHCP_REQUEST'){ var opts = { expire: 30 }; Session.add(DHCP.txId.toString(), DHCP.msgType, opts); } else if (event === 'DHCP_RESPONSE'){ var reqMsgType = Session.lookup(DHCP.txId.toString()); if (reqMsgType && DHCP.msgType === 'DHCPOFFER') { Device.metricAddCount('dhcp-discover-offer', 1); } } |
| --- | --- |
- **tcpOrigin: IPAddress | Null**: The original IP address of the client or sender if specified by a network proxy in TCP option 28.
- **vlan: Number**: The VLAN number associated with the flow. If no VLAN tag is present, this value is set to

`0`

.
- **vxlanVNI: Number**: The VXLAN Network Identifier number associated with the flow. If no VXLAN tag is present, this value is set to

`NaN`

.
- **zeroWnd1: Number**: The number of zero windows associated with one of two devices in the flow; the other device is represented by

`zeroWnd2`

. The device represented by

`zeroWnd1`

remains consistent for the flow.

Access only on `FLOW_TICK` or `FLOW_TURN` events; otherwise, an error will occur.
- **zeroWnd2: Number**: The number of zero windows associated with one of two devices in the flow; the other device is represented by

`zeroWnd1`

. The device represented by

`zeroWnd2`

remains consistent for the flow.

Access only on `FLOW_TICK` or `FLOW_TURN` events; otherwise, an error will occur.

#### Trigger Examples

- [Example: Monitor SMB actions on devices](#example-monitor-smb-actions-on-devices)
- [Example: Track 500-level HTTP responses by customer ID and URI](#example-track-500-level-http-responses-by-customer-id-and-uri)
- [Example: Parse custom PoS messages with universal payload analysis](#example-parse-custom-pos-messages-with-universal-payload-analysis)
- [Example: Parse syslog over TCP with universal payload analysis](#example-parse-syslog-over-tcp-with-universal-payload-analysis)
- [Example: Parse NTP with universal payload analysis](#example-parse-ntp-with-universal-payload-analysis)
- [Example: Track SOAP requests](#example-track-soap-requests)
