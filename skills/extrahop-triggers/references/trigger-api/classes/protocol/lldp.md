---
{
  "anchor": "lldp",
  "api_area": "trigger-api",
  "doc_kind": "class",
  "events": [
    "LLDP_FRAME"
  ],
  "examples": [],
  "methods": [],
  "name": "LLDP",
  "properties": [
    "chassisId: Buffer",
    "chassisIdSubtype: Number",
    "destination: String",
    "optTLVs: Array",
    "customSubtype: Number",
    "isCustom: Boolean",
    "oui: Number",
    "type: Number",
    "value: String",
    "portId: Buffer",
    "portIdSubtype: Number",
    "source: Device",
    "ttl: Number"
  ],
  "section": "protocol-and-network-data-classes",
  "source_url": "https://docs.extrahop.com/current/extrahop-trigger-api/",
  "source_version": "26.2"
}
---

### LLDP

The LLDP class enables you to access properties on `LLDP_FRAME` events.

#### Events

- **LLDP_FRAME**: Runs on every LLDP frame processed by the device.

#### Properties

- **chassisId: Buffer**: The chassis ID, obtained from the chassisId data field, or type-length-value (TLV).
- **chassisIdSubtype: Number**: The chassis ID subtype, obtained from the chassisID TLV.
- **destination: String**: The destination MAC address. The destination MAC address. The most common destinations are

`01-80-C2-00-00-00`

,

`01-80-C2-00-00-03`

and

`01-80-C2-00-00-0E`

, indicating multicast addresses.
- **optTLVs: Array**: An array containing the optional TLVs. Each TLV is an object with the following properties:

- **customSubtype: Number**: The subtype of an organizationally specific TLV.
- **isCustom: Boolean**: Returns true if the object is an organizationally specific TLV.
- **oui: Number**: The organizationally unique identifier for organizationally specific TLVs.
- **type: Number**: The type of TLV.
- **value: String**: The value of the TLV.
- **portId: Buffer**: The port ID, obtained from the portId TLV.
- **portIdSubtype: Number**: The port ID subtype, obtained from the portId TLV.
- **source: Device**: The device sending the LLDP frame.
- **ttl: Number**: The time to live, expressed in seconds. This is the length of time during which the information in this frame is valid, starting with when the information is received.
