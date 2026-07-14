---
{
  "anchor": "rtcp",
  "api_area": "trigger-api",
  "doc_kind": "class",
  "events": [
    "RTCP_MESSAGE"
  ],
  "examples": [],
  "methods": [
    "commitRecord(): void"
  ],
  "name": "RTCP",
  "properties": [
    "callId: String",
    "packets: Array",
    "packetType: String",
    "APP",
    "name: String",
    "ssrc: Number",
    "value: Buffer",
    "BYE",
    "packetType: Number",
    "SR",
    "ntpTimestamp: Number",
    "reportBlocks: Array",
    "fractionLost: Number",
    "jitter: Number",
    "lastSR: Number",
    "lastSRDelay: Number",
    "packetsLost: Number",
    "seqNum: Number",
    "rtpTimestamp: Number",
    "senderOctets: Number",
    "senderPkts: Number",
    "RR",
    "SDES",
    "descriptionBlocks: Array",
    "type: Number",
    "XR",
    "xrBlocks: Array",
    "statSummary: Object",
    "beginSeq: Number",
    "devJitter: Number",
    "devTTLOrHL: Number",
    "dupPackets: Number",
    "endSeq: Number",
    "lostPackets: Number",
    "maxJitter: Number",
    "maxTTLOrHL: Number",
    "meanJitter: Number",
    "meanTTLOrHL: Number",
    "minJitter: Number",
    "minTTLOrHL: Number",
    "typeSpecific: Number",
    "voipMetrics: Object",
    "burstDensity: Number",
    "burstDuration: Number",
    "discardRate: Number",
    "endSystemDelay: Number",
    "extRFactor: Number",
    "gapDensity: Number",
    "gapDuration: Number",
    "gmin: Number",
    "jbAbsMax: Number",
    "jbMaximum: Number",
    "jbNominal: Number",
    "lossRate: Number",
    "mosCQ: Number",
    "mosLQ: Number",
    "noiseLevel: Number",
    "rerl: Number",
    "rFactor: Number",
    "roundTripDelay: Number",
    "rxConfig: Number",
    "signalLevel: Number",
    "record: Object"
  ],
  "section": "protocol-and-network-data-classes",
  "source_url": "https://docs.extrahop.com/current/extrahop-trigger-api/",
  "source_version": "26.2"
}
---

### RTCP

The RTCP class enables you to store metrics and access properties on `RTCP_MESSAGE` events.

#### Events

- **RTCP_MESSAGE**: Runs on every RTCP UDP packet processed by the device.

#### Methods

- **commitRecord(): void**: Sends a record to the configured recordstore on an

`RTCP_MESSAGE`

event.

To view the default properties committed to the record object, see the `record` property below.

For built-in records, each unique record is committed only once, even if the `commitRecord()` method is called multiple times for the same unique record.

#### Properties

- **callId: String**: The Call ID for associating with a

SIP

flow.
- **packets: Array**: An array of RTCP packet objects where each object represents a packet and contains a packetType field. Each object has different fields based on the message type, as described below.

- **packetType: String**: The type of packet. If the packet type is not recognizable, then the

`packetType`

will be "Unknown N" where N is the

RTP

control packet type value.

| Value | Type | Name |
| --- | --- | --- |
| `194` | `SMPTETC` | `SMPTE time-code mapping` |
| `195` | `IJ` | `Extended inter-arrival jitter report` |
| `200` | `SR` | `sender report` |
| `201` | `RR` | `receiver report` |
| `202` | `SDES` | `source description` |
| `203` | `BYE` | `goodbye` |
| `204` | `APP` | `application-defined` |
| `205` | `RTPFB` | `Generic RTP Feedback` |
| `206` | `PSFB` | `Payload-specific` |
| `207` | `XR` | `extended report` |
| `208` | `AVB` | `AVB RTCP packet` |
| `209` | `RSI` | `Receiver Summary Information` |
| `210` | `TOKEN` | `Port Mapping` |
| `211` | `IDMS` | `IDMS Settings` |

The following list describes the fields for each type of packet object:

- **APP**: - **name: String**: The name chosen by the person defining the set of APP packets to be unique. Interpreted as four case-sensitive ASCII characters.
- **ssrc: Number**: The SSRC of the sender.
- **value: Buffer**: The optional application-dependent data.
- **BYE**: - **packetType: Number**: Contains the number 203 to identify this as an RTCP BYE packet.
- **SR**: - **ntpTimestamp: Number**: The NTP timestamp, converted to milliseconds since the epoch (January 1, 1970).
- **reportBlocks: Array**: An array of report objects which contain:

- **fractionLost: Number**: The 8-bit number indicating the number of packets lost divided by the number of packets expected.
- **jitter: Number**: An estimate of the statistical variance of the RTP data packet interarrival time, expressed in milliseconds.
- **lastSR: Number**: The middle 32 bits of the ntp_Timestamp received as part of the most recent RTCP sender report (SR) packet from the source SSRC. If no SR has been received yet, this field is set to zero.
- **lastSRDelay: Number**: The delay between receiving the last SR packet from the source SSRC and sending this reception block, expressed in units of 1/65536 seconds. If no SR packet has been received yet, this field is set to zero.
- **packetsLost: Number**: The total number of RTP data packets from the source SSRC that have been lost since the beginning of reception.
- **seqNum: Number**: The highest sequence number received from the source SSRC.
- **ssrc: Number**: The SSRC of the sender.
- **rtpTimestamp: Number**: The RTP timestamp, converted to milliseconds since the epoch (January 1, 1970).
- **senderOctets: Number**: The sender octet count.
- **senderPkts: Number**: The sender packet count.
- **RR**: - **reportBlocks: Array**: An array of report objects which contain:

- **fractionLost: Number**: The 8-bit number indicating the number of packets last divided by the number of packets expected.
- **jitter: Number**: An estimate of the statistical variance of the RTP data packet interarrival, expressed in milliseconds.
- **lastSR: Number**: The middle 32 bits of the ntp_Timestamp received as part of the most recent RTCP sender report (SR) packet from the source SSRC. If no SR has been received yet, this field is set to zero.
- **lastSRDelay: Number**: The delay between receiving the last SR packet from the source SSRC and sending this reception report block, expressed in units of 1/65536 seconds. If no SR packet has been received yet, this field is set to zero.
- **packetsLost: Number**: The total number of RTP data packets from the source SSRC that have been lost since the beginning of reception.
- **seqNum: Number**: The highest sequence number received from the source SSRC.
- **ssrc: Number**: The SSRC of the sender.
- **ssrc: Number**: The SSRC of the sender.
- **SDES**: - **descriptionBlocks: Array**: An array of objects that contain:

- **type: Number**: The SDES type.

| SDES Type | Abbrev. | Name |
| --- | --- | --- |
| `0` | `END` | `end of SDES list` |
| `1` | `CNAME` | `canonical name` |
| `2` | `NAME` | `user name` |
| `3` | `EMAIL` | `user's electronic mail address` |
| `4` | `PHONE` | `user's phone number` |
| `5` | `LOC` | `geographic user location` |
| `6` | `TOOL` | `name of application or tool` |
| `7` | `NOTE` | `notice about the source` |
| `8` | `PRIV` | `private extensions` |
| `9` | `H323-C ADDR` | `H.323 callable address` |
| `10` | `APSI` | `Application Specific Identifier` |
- **value: Buffer**: A buffer containing the text portion of the SDES packet.
- **ssrc: Number**: The SSRC of the sender.
- **XR**: - **ssrc: Number**: The SSRC of the sender.
- **xrBlocks: Array**: An array of report blocks which contain:

- **statSummary: Object**: Type 6 only. The

`statSummary`

object contains the following properties:

- **beginSeq: Number**: The beginning sequence number for the interval.
- **devJitter: Number**: The standard deviation of the relative transit time between each two packet series in the sequence interval.
- **devTTLOrHL: Number**: The standard deviation of TTL or Hop Limit values of data packets in the sequence number range.
- **dupPackets: Number**: The number of duplicate packets in the sequence number interval.
- **endSeq: Number**: The ending sequence number for the interval.
- **lostPackets: Number**: The number of lost packets in the sequence number interval.
- **maxJitter: Number**: The maximum relative transmit time between two packets in the sequence interval, expressed in milliseconds.
- **maxTTLOrHL: Number**: The maximum TTL or Hop Limit value of data packets in the sequence number range.
- **meanJitter: Number**: The mean relative transit time between two packet series in the sequence interval, rounded to the nearest value expressible as an RTP timestamp, expressed in milliseconds.
- **meanTTLOrHL: Number**: The mean TTL or Hop Limit value of data packets in the sequence number range.
- **minJitter: Number**: The minimum relative transmit time between two packets in the sequence interval, expressed in milliseconds.
- **minTTLOrHL: Number**: The minimum TTL or Hop Limit value of data packets in the sequence number range.
- **ssrc: Number**: The SSRC of the sender.
- **type: Number**: The XR block type.

| Block Type | Name |
| --- | --- |
| `1` | `Loss RTE Report Block` |
| `2` | `Duplicate RLE Report Block` |
| `3` | `Packet Receipt Times Report Block` |
| `4` | `Receiver Reference Time Report Block` |
| `5` | `DLRR Report Block` |
| `6` | `Statistics Summary Report Block` |
| `7` | `VoIP Metrics Report Block` |
| `8` | `RTCP XP` |
| `9` | `Texas Instruments Extended VoIP Quality Block` |
| `10` | `Post-repair Loss RLE Report Block` |
| `11` | `Multicast Acquisition Report Block` |
| `12` | `IBMS Report Block` |
| `13` | `ECN Summary Report` |
| `14` | `Measurement Information Block` |
| `15` | `Packet Delay Variation Metrics Block` |
| `16` | `Delay Metrics Block` |
| `17` | `Burst/Gap Loss Summary Statistics Block` |
| `18` | `Burst/Gap Discard Summary Statistics Block` |
| `19` | `Frame Impairment Statistics Summary` |
| `20` | `Burst/Gap Loss Metrics Block` |
| `21` | `Burst/Gap Discard Metrics Block` |
| `22` | `MPEG2 Transport Stream PSI-Independent` `Decodability Statistics Metrics Block` |
| `23` | `De-Jitter Buffer Metrics Block` |
| `24` | `Discard Count Metrics Block` |
| `25` | `DRLE (Discard RLE Report)` |
| `26` | `BDR (Bytes Discarded Report)` |
| `27` | `RFISD (RTP Flows Initial Synchronization Delay)` |
| `28` | `RFSO (RTP Flows Synchronization Offset Metrics Block)` |
| `29` | `MOS Metrics Block` |
| `30` | `LCB (Loss Concealment Metrics Block)` |
| `31` | `CSB (Concealed Seconds Metrics Block)` |
| `32` | `MPEG2 Transport Stream PSI Decodability Statistics Block` |
- **typeSpecific: Number**: The contents of this field depend on the block type.
- **value: Buffer**: The contents of this field depend on the block type.
- **voipMetrics: Object**: Type 7 only. The

`voipMetrics`

object contains the following properties:

- **burstDensity: Number**: The fraction of RTP data packets within burst periods since the beginning of reception that were either lost or discarded.
- **burstDuration: Number**: The mean duration, expressed in milliseconds, of the burst periods that have occurred since the beginning of reception.
- **discardRate: Number**: The fraction of RTP data packets from the source that have been discarded since the beginning of reception, due to late or early arrival, under-run or overflow at the receiving jitter buffer.
- **endSystemDelay: Number**: The most recently estimated end system delay, expressed in milliseconds.
- **extRFactor: Number**: The external R factor quality metric. A value of 127 indicates this parameter is unavailable.
- **gapDensity: Number**: The fraction of RTP data packets within inter-burst gaps since the beginning of reception that were either lost or discarded.
- **gapDuration: Number**: The mean duration of the gap periods that have occurred since the beginning of reception, expressed in milliseconds.
- **gmin: Number**: The gap threshold.
- **jbAbsMax: Number**: The absolute maximum delay, expressed in milliseconds, that the adaptive jitter buffer can reach under worst case conditions.
- **jbMaximum: Number**: The current maximum jitter buffer delay, which corresponds to the earliest arriving packet that would not be discarded, expressed in milliseconds.
- **jbNominal: Number**: The current nominal jitter buffer delay, which corresponds to the nominal jitter buffer delay for packets that arrive exactly on time, expressed in milliseconds.
- **lossRate: Number**: The fraction of RTP data packets from the source lost since the beginning of reception.
- **mosCQ: Number**: The estimated mean opinion score for conversational quality (MOS-CQ). A value of 127 indicates this parameter is unavailable.
- **mosLQ: Number**: The estimated mean opinion score for listening quality (MOS-LQ). A value of 127 indicates this parameter is unavailable.
- **noiseLevel: Number**: The noise level, expressed in decibels.
- **rerl: Number**: The residual echo return loss value, expressed in decibels.
- **rFactor: Number**: The R factor quality metric. A value of 127 indicates this parameter is unavailable.
- **roundTripDelay: Number**: The most recently calculated round trip time (RTT) between RTP interfaces, expressed in milliseconds.
- **rxConfig: Number**: The receiver configuration byte.
- **signalLevel: Number**: The voice signal relative level, expressed in decibels.
- **ssrc: Number**: The SSRC of the sender.
- **record: Object**: The record object that can be sent to the configured recordstore through a call to

`RTCP.commitRecord()`

on an

`RTCP_MESSAGE`

event.

The default record object can contain the following properties:

- `callId`
- `clientIsExternal`
- `cName`
- `flowId`
- `receiverIsExternal`
- `senderIsExternal`
- `serverIsExternal`
- `signalingFlowId` The ID of the corresponding SIP or SCCP flow, which negotiates the VoIP call monitored by the RTCP flow.
