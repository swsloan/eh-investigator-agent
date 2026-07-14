---
{
  "anchor": "ntp",
  "api_area": "trigger-api",
  "doc_kind": "class",
  "events": [
    "NTP_MESSAGE"
  ],
  "examples": [],
  "methods": [
    "commitRecord(): void"
  ],
  "name": "NTP",
  "properties": [
    "flags: Number",
    "leapIndicator: Number",
    "mode: Number",
    "modeName: String",
    "originTimestamp: Number",
    "payload: Buffer",
    "poll: Number",
    "precision: Number",
    "receiveTimestamp: Number",
    "record: Object",
    "referenceId: Number",
    "referenceIdCode: String | Null",
    "referenceTimestamp: Number",
    "rootDelay: Number",
    "rootDispersion: Number",
    "stratum: Number",
    "transmitTimestamp: Number",
    "version: Number"
  ],
  "section": "protocol-and-network-data-classes",
  "source_url": "https://docs.extrahop.com/current/extrahop-trigger-api/",
  "source_version": "26.2"
}
---

### NTP

The Network Time Protocol (NTP) class enables you to store metrics and access properties on `NTP_MESSAGE` events.

#### Events

- **NTP_MESSAGE**: Runs on every NTP message processed by the device.

#### Methods

- **commitRecord(): void**: Sends a record to the configured recordstore on an

`NTP_MESSAGE`

event. To view the default properties committed to the record object, see the

`record`

property below.

For built-in records, each unique record is committed only once, even if the `commitRecord()` method is called multiple times for the same unique record.

#### Properties

- **flags: Number**: The decimal representation of the byte that contains information about the NTP flags. The leap indicator is contained in the first two bits of the byte, the NTP version is contained in the next three bits, and the NTP protocol operation mode is contained in the last three bits.
- **leapIndicator: Number**: Indicates whether an extra second will be added to or removed from the last minute of the day on the system clock. The following values are valid:

| Value | Description |
| --- | --- |
| `0` | An extra second will not be added or removed. |
| `1` | An extra second will be added to the last minute of the day. The last minute will have 61 seconds. |
| `2` | An extra second will be removed from the last minute of the day. The last minute will have 59 seconds. |
| `3` | Unknown. Clocks are not currently synchronized. |
- **mode: Number**: The numeric ID of the NTP protocol operation mode.
- **modeName: String**: The name of the NTP protocol operation mode. The following values are valid:

| Value | Numeric ID |
| --- | --- |
| `reserved` | 0 |
| `symmetric active` | 1 |
| `symmetric passive` | 2 |
| `client` | 3 |
| `server` | 4 |
| `broadcast` | 5 |
| `NTP control message` | 6 |
| `reserved for private use` | 7 |
- **originTimestamp: Number**: The local time of the client when the client sent the request to the server, expressed in fractional seconds since the NTP epoch.
- **payload: Buffer**: The

[Buffer](#buffer)

object that contains the raw payload bytes of the NTP message.
- **poll: Number**: The maximum amount of time the system waits between NTP messages, expressed in fractional seconds.
- **precision: Number**: The precision of the system clock, expressed in fractional seconds.
- **receiveTimestamp: Number**: The local time of the server when the server received the request from the client, expressed in fractional seconds since the NTP epoch.
- **record: Object**: The record object that can be sent to the configured recordstore through a call to

`NTP.commitRecord()`

on an

`NTP_MESSAGE`

event.

The default record object can contain the following properties:

- `application`
- `extensionCount`
- `flowId`
- `modeName`
- `originTimestamp`
- `poll`
- `precision`
- `receiver`
- `receiverAddr`
- `receiverIsExternal`
- `receiverPort`
- `receiveTimestamp`
- `referenceId`
- `referenceIdCode`
- `referenceTimestamp`
- `rootDelay`
- `stratum`
- `sender`
- `senderAddr`
- `senderIsExternal`
- `senderPort`
- `transmitTimestamp`
- `version`
- `vlan`
- **referenceId: Number**: The numerical ID of the server or reference clock.
- **referenceIdCode: String | Null**: The string ID of the server or reference clock.
- **referenceTimestamp: Number**: The last time the system clock was set or corrected, expressed in fractional seconds since the NTP epoch.
- **rootDelay: Number**: The round-trip time delay to the reference clock, expressed in seconds.
- **rootDispersion: Number**: The maximum error relative to the reference clock, expressed in seconds.
- **stratum: Number**: The NTP stratum of the system clock.
- **transmitTimestamp: Number**: The local time of the server when the server sent the response to the client, expressed in fractional seconds since the NTP epoch.
- **version: Number**: The version of the NTP protocol.
