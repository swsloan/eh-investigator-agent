---
{
  "anchor": "tcp",
  "api_area": "trigger-api",
  "doc_kind": "class",
  "events": [
    "TCP_CLOSE",
    "TCP_OPEN",
    "TCP_PAYLOAD"
  ],
  "examples": [],
  "methods": [
    "getOption(kind: Number): Object | Null"
  ],
  "name": "TCP",
  "properties": [
    "handshakeTime: Number",
    "hasECNEcho: Boolean",
    "hasECNEcho1: Boolean",
    "hasECNEcho2: Boolean",
    "initRcvWndSize: Number",
    "initRcvWndSize1: Number",
    "initRcvWndSize2: Number",
    "initSeqNum: Number",
    "initSeqNum1: Number",
    "initSeqNum2: Number",
    "isAborted: Boolean",
    "isExpired: Boolean",
    "isReset: Boolean",
    "nagleDelay: Number",
    "nagleDelay1: Number",
    "options: Array",
    "options1: Array",
    "options2: Array",
    "overlapSegments: Number",
    "overlapSegments1: Number",
    "overlapSegments2: Number",
    "rcvWndThrottle: Number",
    "rcvWndThrottle1: Number",
    "rcvWndThrottle2: Number",
    "retransBytes: Number",
    "retransBytes1: Number",
    "retransBytes2: Number",
    "zeroWnd: Number",
    "zeroWnd1: Number",
    "zeroWnd2: Number"
  ],
  "section": "protocol-and-network-data-classes",
  "source_url": "https://docs.extrahop.com/current/extrahop-trigger-api/",
  "source_version": "26.2"
}
---

### TCP

The `TCP` class enables you to access properties and retrieve metrics from TCP events and from `FLOW_TICK` and `FLOW_TURN` events.

The

`FLOW_TICK`

and

`FLOW_TURN`

events are defined in the

[Flow](#flow)

section.

#### Events

- **TCP_CLOSE**: Runs when the TCP connection is shut down by being closed, expired or aborted.
- **TCP_OPEN**: Runs when the TCP connection is first fully established.

The `FLOW_CLASSIFY` event runs after the `TCP_OPEN` event to determine the L7 protocol of the TCP flow.

| Note: | If a TCP connection stalls for a long period of time, the TCP_OPEN event runs again when the connection resumes. The following TCP properties and methods are null when the event runs for a resumed connection:`getOption` `handshakeTime` `hasECNEcho` `hasECNEcho1` `hasECNEcho2` `initRcvWndSize` `initRcvWndSize1` `initRcvWndSize2` `initSeqNum` `initSeqNum1` `initSeqNum2` `options` `options1` `options2` |
| --- | --- |
- **TCP_PAYLOAD**: Runs when the payload matches the criteria configured in the associated trigger.

Depending on the [Flow](#flow), the TCP payload can be found in the following properties:

- `Flow.client.payload`
- `Flow.payload1`
- `Flow.payload2`
- `Flow.receiver.payload`
- `Flow.sender.payload`
- `Flow.server.payload`

| Important: | To enable a trigger to run on `TCP_PAYLOAD` events, you must specify one or both of the following [advanced trigger options](#advanced-trigger-options):Client Bytes to Buffer Server Bytes to Buffer |
| --- | --- |

| Tip: | Running a trigger on all `TCP_PAYLOAD` events might affect system performance. We recommend that you limit the events that the trigger runs on by specifying one or both of the following [advanced trigger options](#advanced-trigger-options):Client Port Range Server Port Range |
| --- | --- |

Additional payload options are available when you create a trigger that runs on this event. See [Advanced trigger options](#advanced-trigger-options) for more information.

#### Methods

- **getOption(kind: Number): Object | Null**: Returns a TCP option object that matches the specified option kind. For a list of valid option kinds, see

[TCP options](#tcp-options)

. Specify the TCP client or the TCP server in the syntax—for example,

`TCP.client.getOption(1)`

or

`TCP.server.getOption(1)`

.

Applies only to `TCP_OPEN` events.

#### Properties

- **handshakeTime: Number**: The amount of time required to negotiate the TCP connection, expressed in milliseconds.

Access only on `TCP_OPEN` events; otherwise, an error will occur.
- **hasECNEcho: Boolean**: The value is

`true`

if the ECN flag is set on a device during the three-way handshake. Specify the TCP client or the TCP server in the syntax—for example,

`TCP.client.hasECNEcho`

or

`TCP.server.hasECNEcho`

.

Access only on `TCP_OPEN` events; otherwise, an error will occur.
- **hasECNEcho1: Boolean**: The value is

`true`

if the ECN flag is set during the three-way handshake associated with one of two devices in the connection; the other device is represented by

`hasECNEcho2`

. The device represented by

`hasECNEcho1`

remains consistent for the connection.

Access only on `TCP_OPEN` events; otherwise, an error will occur.
- **hasECNEcho2: Boolean**: The value is

`true`

if the ECN flag is set during the three-way handshake associated with one of two devices in the connection; the other device is represented by

`hasECNEcho1`

. The device represented by

`hasECNEcho2`

remains consistent for the connection.

Access only on `TCP_OPEN` events; otherwise, an error will occur.
- **initRcvWndSize: Number**: The initial size of the TCP sliding window on a device negotiated during the three-way handshake. Specify the TCP client or the TCP server in the syntax—for example,

`TCP.client.initRcvWndSize`

or

`TCP.server.initRcvWndSize`

.

Access only on `TCP_OPEN` events; otherwise, an error will occur.
- **initRcvWndSize1: Number**: The initial size of the TCP sliding window negotiated during the three-way handshake associated with one of two devices in the connection; the other device is represented by

`initRcvWndSize2`

. The device represented by

`initRcvWndSize1`

remains consistent for the connection.

Access only on `TCP_OPEN` events; otherwise, an error will occur.
- **initRcvWndSize2: Number**: The initial size of the TCP sliding window negotiated during the three-way handshake associated with one of two devices in the connection; the other device is represented by

`initRcvWndSize1`

. The device represented by

`initRcvWndSize2`

remains consistent for the connection.

Access only on `TCP_OPEN` events; otherwise, an error will occur.
- **initSeqNum: Number**: The initial sequence number sent from a device during the three-way handshake. Specify the TCP client or the TCP server in the syntax—for example,

`TCP.client.initSeqNum`

or

`TCP.server.initSeqNum`

.

Access only on `TCP_OPEN` events; otherwise, an error will occur.
- **initSeqNum1: Number**: The initial sequence number during the three-way handshake associated with one of two devices in the connection; the other device is represented by

`initSeqNum2`

. The device represented by

`initSeqNum1`

remains consistent for the connection.

Access only on `TCP_OPEN` events; otherwise, an error will occur.
- **initSeqNum2: Number**: The initial sequence number during the three-way handshake associated with one of two devices in the connection; the other device is represented by

`initSeqNum1`

. The device represented by

`initSeqNum2`

remains consistent for the connection.

Access only on `TCP_OPEN` events; otherwise, an error will occur.
- **isAborted: Boolean**: The value is

`true`

if a TCP flow has been aborted through a TCP reset (RST) before the connection is shut down. The flow can be aborted by a device. If applicable, specify the device role in the syntax—for example,

`TCP.client.isAborted`

or

`TCP.server.isAborted`

.

This condition may be detected in any TCP event and in any impacted L7 events (for example, `HTTP_REQUEST` or `DB_RESPONSE`).

| Note: | An L4 abort occurs when a TCP connection is closed with a RST instead of a graceful shutdown. An L7 response abort occurs when a connection closes while in the middle of a response. This can be due to a RST, a graceful FIN shutdown, or an expiration. An L7 request abort occurs when a connection closes in the middle of a request. This can also be due to a RST, a graceful FIN shutdown, or an expiration. |
| --- | --- |
- **isExpired: Boolean**: The value is

`true`

if the TCP connection expired at the time of the event. If applicable, specify TCP client or the TCP server in the syntax—for example,

`TCP.client.isExpired`

or

`TCP.server.isExpired`

.

Access only on `TCP_CLOSE` events; otherwise, an error will occur.
- **isReset: Boolean**: The value is

`true`

if a TCP reset (RST) was seen while the connection was in the process of being shut down.
- **nagleDelay: Number**: The number of Nagle delays associated with a device in the flow. Specify the TCP client or the TCP server in the syntax—for example,

`TCP.client.nagleDelay`

or

`TCP.server.nagleDelay`

.

Access only on `FLOW_TICK` and `FLOW_TURN` events; otherwise, an error will occur.
- **nagleDelay1: Number**: The number of Nagle delays associated with one of two devices in the flow; the other device is represented by

`nagleDelay1`

. The device represented by

`nagleDelay2`

remains consistent for the connection.

Access only on `FLOW_TICK` and `FLOW_TURN` events; otherwise, an error will occur.
- **nagleDelay1: Number**: The number of Nagle delays associated with one of two devices in the flow; the other device is represented by

`nagleDelay2`

. The device represented by

`nagleDelay1`

remains consistent for the connection.

Access only on `FLOW_TICK` and `FLOW_TURN` events; otherwise, an error will occur.
- **options: Array**: An array of objects representing the TCP options of a device in the initial handshake packets. Specify the TCP

client

or the TCP server in the syntax—for example,

`TCP.client.options`

or

`TCP.server.options`

. For more information, see the TCP options section below.

Access only on `TCP_OPEN` events; otherwise, an error will occur.
- **options1: Array**: An array of options representing the TCP options in the initial handshake packets associated with one of two devices in the connection; the other device is represented by

`options2`

. The device represented by

`options1`

remains consistent for the connection. For more information, For more information, see the TCP options section below.

Access only on `TCP_OPEN` events; otherwise, an error will occur.
- **options2: Array**: An array of options representing the TCP options in the initial handshake packets associated with one of two devices in the connection; the other device is represented by

`options1`

. The device represented by

`options2`

remains consistent for the connection. For more information, For more information, see the TCP options section below.

Access only on `TCP_OPEN` events; otherwise, an error will occur.
- **overlapSegments: Number**: The number of non-identical TCP segments, transmitted by a device in the flow, where two or more TCP segments contain data for the same part of the flow. Specify the TCP client or the TCP server in the syntax—for example,

`TCP.client.overlapSegments`

or

`TCP.server.overlapSegments`

.

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
- **rcvWndThrottle: Number**: The number of receive window throttles sent from a device in the flow. Specify the TCP client or the TCP server in the syntax—for example,

`TCP.client.rcvWndThrottle`

or

`TCP.server.rcvWndThrottle`

.

Access only on `FLOW_TICK` and `FLOW_TURN` events; otherwise, an error will occur.
- **rcvWndThrottle1: Number**: The number of receive window throttles sent from one of two devices in the flow; the other device is represented by

`rcvWndThrottle2`

. The device represented by

`rcvWndThrottle1`

remains consistent for the connection.

Access only on `FLOW_TICK` or `FLOW_TURN` events; otherwise, an error will occur.
- **rcvWndThrottle2: Number**: The number of receive window throttles sent from one of two devices in the flow; the other device is represented by

`rcvWndThrottle1`

. The device represented by

`rcvWndThrottle2`

remains consistent for the connection.

Access only on `FLOW_TICK` or `FLOW_TURN` events; otherwise, an error will occur.
- **retransBytes: Number**: The number of bytes retransmitted over TCP by a client or server device in the flow. Specify the TCP client or the TCP server in the syntax—for example,

`TCP.client.retransBytes`

or

`TCP.server.retransBytes`

.

Access only on `FLOW_TICK` or `FLOW_TURN` events; otherwise, an error will occur.
- **retransBytes1: Number**: The number of bytes retransmitted over TCP by one of two devices in the flow; the other device is represented by

`retransBytes2`

. The device represented by

`retransBytes1`

remains consistent for the connection.

Access only on `FLOW_TICK` or `FLOW_TURN` events; otherwise, an error will occur.
- **retransBytes2: Number**: The number of bytes retransmitted over TCP by one of two devices in the flow; the other device is represented by

`retransBytes1`

. The device represented by

`retransBytes2`

remains consistent for the connection.

Access only on `FLOW_TICK` or `FLOW_TURN` events; otherwise, an error will occur.
- **zeroWnd: Number**: The number of zero windows sent from a device in the flow. Specify the TCP client or the TCP server in the syntax—for example,

`TCP.client.zeroWnd`

or

`TCP.server.zeroWnd`

.

Access only on `FLOW_TICK` and `FLOW_TURN` events; otherwise, an error will occur.
- **zeroWnd1: Number**: The number of zero windows sent from one of two devices in the flow; the other device is represented by

`zeroWnd2`

. The device represented by

`zeroWnd1`

remains consistent for the connection.

Access only on `FLOW_TICK` and `FLOW_TURN` events; otherwise, an error will occur.
- **zeroWnd2: Number**: The number of zero windows sent from one of two devices in the flow; the other device is represented by

`zeroWnd1`

. The device represented by

`zeroWnd2`

remains consistent for the connection.

Access only on `FLOW_TICK` and `FLOW_TURN` events; otherwise, an error will occur.

#### TCP options

All TCP Options objects have the following properties:

- **kind:Number**: The TCP option kind number.

| Kind Number | Meaning |
| --- | --- |
| `0` | `End of Option List` |
| `1` | `No-Operation` |
| `2` | `Maximum Segment Size` |
| `3` | `Window Scale` |
| `4` | `SACK Permitted` |
| `5` | `SACK` |
| `6` | `Echo (obsoleted by option 8)` |
| `7` | `Echo Reply (obsoleted by option 8)` |
| `8` | `Timestamps` |
| `9` | `Partial Order Connection Permitted (obsolete)` |
| `10` | `Partial Order Service Profile (obsolete)` |
| `11` | `CC (obsolete)` |
| `12` | `CC.NEW (obsolete)` |
| `13` | `CC.ECHO (obsolete)` |
| `14` | `TCP Alternate Checksum Request (obsolete)` |
| `15` | `TCP Alternate Checksum Data (obsolete)` |
| `16` | `Skeeter` |
| `17` | `Bubba` |
| `18` | `Trailer Checksum Option` |
| `19` | `MD5 Signature Option (obsoleted by option 29)` |
| `20` | `SCPS Capabilities` |
| `21` | `Selective Negative acknowledgments` |
| `22` | `Record Boundaries` |
| `23` | `Corruption experienced` |
| `24` | `SNAP` |
| `25` | `Unassigned (released 2000-12-18)` |
| `26` | `TCP Compression Filter` |
| `27` | `Quick-Start Response` |
| `28` | `User Timeout Option (also, other known authorized use)` |
| `29` | `TCP Authentication Option (TCP-AO)` |
| `30` | `Multipath TCP (MPTCP)` |
| `31` | `Reserved (known authorized used without proper IANA assignment)` |
| `32` | `Reserved (known authorized used without proper IANA assignment)` |
| `33` | `Reserved (known authorized used without proper IANA assignment)` |
| `34` | `TCP Fast Open Cookie` |
| `35-75` | `Reserved` |
| `76` | `Reserved (known authorized used without proper IANA assignment)` |
| `77` | `Reserved (known authorized used without proper IANA assignment)` |
| `78` | `Reserved (known authorized used without proper IANA assignment)` |
| `79-252` | `Reserved` |
| `253` | `RFC3692-style Experiment 1 (also improperly used for shipping products)` |
| `254` | `RFC3692-style Experiment 2 (also improperly used for shipping products)` |
- **name: String**: The name of the TCP option.

The following list contains the names of common TCP options and their specific properties:

- **Maximum Segment Size (name 'mss', option kind 2)**: - **value: Number**: The maximum segment size.
- **Window Scale (name 'wscale', kind 3)**: - **value: Number**: The window scale factor.
- **Selective acknowledgment Permitted (name 'sack-permitted', kind 4)**: No additional properties. Its presence indicates that the selective acknowledgment option was included in the SYN.
- **Timestamp (name 'timestamp', kind 8)**: - **tsval: Number**: The TSVal field for the option.
- **tsecr: Number**: The TSecr field for the option.
- **Quickstart Response (name 'quickstart-rsp', kind 27)**: - **rate-request: Number**: The requested rate for transport, expressed in bytes per second.
- **ttl-diff: Number**: The TTLDif.
- **qs-nonce: Number**: The QS Nonce.
- **Akamai Address (name 'akamai-addr', kind 28)**: - **value: IPAddr**: The IP Address of the Akamai server.
- **User Timeout (name 'user-timeout', kind 28)**: - **value: Number**: The user timeout.
- **Authentication (name 'tcp-ao', kind 29)**: - **keyId property: Number**: The key id for the key in use.
- **rNextKeyId: Number**: The key id for the "receive next" key id.
- **mac: Buffer**: The message authentication code.
- **Multipath (name 'mptcp', kind 30)**: - **value: Buffer**: The multipath value.

| Note: | The Akamai address and user timeout options are differentiated by the length of the option. |
| --- | --- |

The following is an example of TCP options:

```javascript
if (TCP.client.options != null) {
   
   var optMSS = TCP.client.getOption(2)

   if (optMSS && (optMSS.value > 1460)) {
       Network.metricAddCount('large_mss', 1);
       Network.metricAddDetailCount('large_mss_by_client_ip',
                                    Flow.client.ipaddr + " " + optMSS.value, 1);
   }

}
```
