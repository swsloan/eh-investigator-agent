---
{
  "anchor": "sdp",
  "api_area": "trigger-api",
  "doc_kind": "class",
  "events": [],
  "examples": [],
  "methods": [],
  "name": "SDP",
  "properties": [
    "mediaDescriptions: Array",
    "attributes: Array of Strings",
    "bandwidth: Array of Strings",
    "connectionInfo: String",
    "description: String",
    "encryptionKey: String",
    "mediaTitle: String",
    "sessionDescription: Object",
    "email: String",
    "origin: String",
    "phoneNumber: String",
    "sessionInfo: String",
    "sessionName: String",
    "timezoneAdjustments: String",
    "uri: String",
    "version: String",
    "timeDescriptions: Array",
    "repeatTime: String",
    "time: String"
  ],
  "section": "protocol-and-network-data-classes",
  "source_url": "https://docs.extrahop.com/current/extrahop-trigger-api/",
  "source_version": "26.2"
}
---

### SDP

The SDP class enables you to access properties on `SIP_REQUEST` and `SIP_RESPONSE` events.

The

`SIP_REQUEST`

and

`SIP_RESPONSE`

events are defined in the

[SIP](#sip)

section.

#### Properties

- **mediaDescriptions: Array**: An array of objects that contain the following fields:

- **attributes: Array of Strings**: The optional session attributes.
- **bandwidth: Array of Strings**: The optional proposed bandwidth type and bandwidth to be consumed by the session or media.
- **connectionInfo: String**: The connection data, including network type, address type and connection adddress. May also contain optional sub-fields, depending on the address type.
- **description: String**: The session description which may contain one or more media descriptions. Each media description consists of media, port and transport protocol fields.
- **encryptionKey: String**: The optional encryption method and key for the session.
- **mediaTitle: String**: The title of the media stream.
- **sessionDescription: Object**: An object that contains the following fields:

- **attributes: Array of Strings**: The optional session attributes.
- **bandwidth: Array of Strings**: The optional proposed bandwidth type and bandwidth to be consumed by the session or media.
- **connectionInfo: String**: The connection data, including network type, address type and connection address. May also contain optional sub-fields, depending on the address type.
- **email: String**: The optional email address. If present, this can contain multiple email addresses.
- **encryptionKey: String**: The optional encryption method and key for the session.
- **origin: String**: The originator of the session, including username, address of the user's host, a session identifier, and a version number.
- **phoneNumber: String**: The optional phone number. If present, this can contain multiple phone numbers.
- **sessionInfo: String**: The session description.
- **sessionName: String**: The session name.
- **timezoneAdjustments: String**: The adjustment time and offset for a scheduled session.
- **uri: String**: The optional URI intended to provide more information about the session.
- **version: String**: The version number. This should be 0.
- **timeDescriptions: Array**: An array of objects that contain the following fields:

- **repeatTime: String**: The session repeat time, including interval, active duration, and offsets from start time.
- **time: String**: The start time and stop times for a session.
