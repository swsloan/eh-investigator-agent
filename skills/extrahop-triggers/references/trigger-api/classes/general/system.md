---
{
  "anchor": "system",
  "api_area": "trigger-api",
  "doc_kind": "class",
  "events": [],
  "examples": [],
  "methods": [],
  "name": "System",
  "properties": [
    "uuid: String",
    "ipaddr: IPAddress",
    "hostname: String",
    "version: String"
  ],
  "section": "general-purpose-classes",
  "source_url": "https://docs.extrahop.com/current/extrahop-trigger-api/",
  "source_version": "26.2"
}
---

### System

The `System` class enables you to retrieve information about the sensor or console on which a trigger is running. This information in useful in environments with multiple sensors.

#### Properties

- **uuid: String**: The universally unique identifier (UUID) of the

sensor

or

console

.
- **ipaddr: IPAddress**: The

[IPAddress](#ipaddress)

object of the primary management interface (Interface 1) on the sensor.
- **hostname: String**: The hostname for the

sensor

or

console

configured in the Administration settings.
- **version: String**: The firmware version running on the

sensor

or

console

.
