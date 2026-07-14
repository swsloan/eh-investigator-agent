---
{
  "anchor": "rtp",
  "api_area": "trigger-api",
  "doc_kind": "class",
  "events": [
    "RTP_CLOSE",
    "RTP_OPEN",
    "RTP_TICK"
  ],
  "examples": [],
  "methods": [
    "commitRecord(): void"
  ],
  "name": "RTP",
  "properties": [
    "bytes: Number",
    "callId: String",
    "drops: Number",
    "dups: Number",
    "jitter: Number",
    "l2Bytes: Number",
    "mos: Number",
    "outOfOrder: Number",
    "payloadType: String",
    "payloadTypeId: Number",
    "pkts: Number",
    "record: Object",
    "rFactor: Number",
    "ssrc: Number",
    "version: Number"
  ],
  "section": "protocol-and-network-data-classes",
  "source_url": "https://docs.extrahop.com/current/extrahop-trigger-api/",
  "source_version": "26.2"
}
---

### RTP

The RTP class enables you to store metrics and access properties on `RTP_OPEN`, `RTP_CLOSE`, and `RTP_TICK` events.

#### Events

- **RTP_CLOSE**: Runs when an RTP connection is closed.
- **RTP_OPEN**: Runs when a new RTP connection is opened.
- **RTP_TICK**: Runs periodically on RTP flows.

#### Methods

- **commitRecord(): void**: Sends a record to the configured recordstore on an

`RTP_TICK`

event. Record commits on

`RTP_OPEN`

and

`RTP_CLOSE`

events are not supported.

To view the default properties committed to the record object, see the `record` property below.

For built-in records, each unique record is committed only once, even if the `commitRecord()` method is called multiple times for the same unique record.

#### Properties

- **bytes: Number**: The number of bytes sent.

Access only on `RTP_TICK` events; otherwise, an error will occur.
- **callId: String**: The call ID associated with the SIP or SCCP flow.
- **drops: Number**: The number of dropped packets detected.

Access only on `RTP_TICK` events; otherwise, an error will occur.
- **dups: Number**: The number of duplicate packets detected.

Access only on `RTP_TICK` events; otherwise, an error will occur.
- **jitter: Number**: An estimate of the statistical variance of the data packet interarrival time.

Access only on `RTP_TICK` events; otherwise, an error will occur.
- **l2Bytes: Number**: The number of

L2

bytes.

Access only on `RTP_TICK` events; otherwise, an error will occur.
- **mos: Number**: The estimated mean opinion score for quality.

Access only on `RTP_TICK` events; otherwise, an error will occur.
- **outOfOrder: Number**: The number of out-of-order messaged detected.

Access only on `RTP_TICK` events; otherwise, an error will occur.
- **payloadType: String**: The type of RTP payload.

Access only on `RTP_TICK` events; otherwise, an error will occur.

| `payloadTypeId` | `payloadType` |
| --- | --- |
| `0` | `ITU-T G.711 PCMU Audio` |
| `3` | `GSM 6.10 Audio` |
| `4` | `ITU-T G.723.1 Audio` |
| `5` | `IMA ADPCM 32kbit Audio` |
| `6` | `IMA ADPCM 64kbit Audio` |
| `7` | `LPC Audio` |
| `8` | `ITU-T G.711 PCMA Audio` |
| `9` | `ITU-T G.722 Audio` |
| `10` | `Linear PCM Stereo Audio` |
| `11` | `Linear PCM Audio` |
| `12` | `QCELP` |
| `13` | `Comfort Noise` |
| `14` | `MPEG Audio` |
| `15` | `ITU-T G.728 Audio` |
| `16` | `IMA ADPCM 44kbit Audio` |
| `17` | `IMA ADPCM 88kbit Audio` |
| `18` | `ITU-T G.729 Audio` |
| `25` | `Sun CellB Video` |
| `26` | `JPEG Video` |
| `28` | `Xerox PARC Network Video` |
| `31` | `ITU-T H.261 Video` |
| `32` | `MPEG Video` |
| `33` | `MPEG-2 Transport Stream` |
| `34` | `ITU-T H.263-1996 Video` |
- **payloadTypeId: Number**: The numeric value of the payload type. See table under

`payloadType`

.

Access only on `RTP_TICK` events; otherwise, an error will occur.
- **pkts: Number**: The number of packets sent.

Access only on `RTP_TICK` events; otherwise, an error will occur.
- **record: Object**: The record object that can be sent to the configured recordstore through a call to

`RTP.commitRecord()`

on an

`RTP_TICK`

event.

The default record object can contain the following properties:

- `bytes`
- `callId`
- `clientIsExternal`
- `drops`
- `dups`
- `flowId`
- `jitter`
- `l2Bytes`
- `mos`
- `outOfOrder`
- `payloadType`
- `payloadTypeId`
- `pkts`
- `receiverIsExternal`
- `rFactor`
- `senderIsExternal`
- `serverIsExternal`
- `signalingFlowId` The ID of the corresponding SIP or SCCP flow, which negotiates the VoIP call streamed by the RTP flow.
- `ssrc`
- `version`

Access record objects only on `RTP_TICK` events; otherwise, an error will occur.
- **rFactor: Number**: The R factor quality metric.

Access only on `RTP_TICK` events; otherwise, an error will occur.
- **ssrc: Number**: The SSRC of sender.
- **version: Number**: The RTP version number.
