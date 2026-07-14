---
{
  "anchor": "cdp",
  "api_area": "trigger-api",
  "doc_kind": "class",
  "events": [
    "CDP_FRAME"
  ],
  "examples": [],
  "methods": [],
  "name": "CDP",
  "properties": [
    "destination: String",
    "checksum: Number",
    "source: Device",
    "ttl: Number",
    "tlvs: Array of Objects",
    "type: Number",
    "value: Buffer",
    "version: Number"
  ],
  "section": "protocol-and-network-data-classes",
  "source_url": "https://docs.extrahop.com/current/extrahop-trigger-api/",
  "source_version": "26.2"
}
---

### CDP

Cisco Discovery Protocol (CDP) is a proprietary protocol that enables connected Cisco devices to send information to each other. The `CDP` class enables you to access properties on `CDP_FRAME` events.

#### Events

- **CDP_FRAME**: Runs on every CDP frame processed by the device.

#### Properties

- **destination: String**: The destination MAC address. The most common destination is

`01:00:0c:cc:cc:cc`

, indicating a multicast address.
- **checksum: Number**: The CDP checksum.
- **source: Device**: The device sending the CDP frame.
- **ttl: Number**: The time to live, expressed in seconds. This is the length of time during which the information in this frame is valid, starting with when the information is received.
- **tlvs: Array of Objects**: An array containing each type, length, value (TLV) field. A TLV field contains information such as the device ID, address, and platform. Each field is an object with the following properties:

- **type: Number**: The type of TLV.
- **value: Buffer**: The value of the TLV.
- **version: Number**: The CDP protocol version.
