---
{
  "anchor": "discover",
  "api_area": "trigger-api",
  "doc_kind": "class",
  "events": [
    "NEW_APPLICATION",
    "NEW_DEVICE"
  ],
  "examples": [
    "Example: Send discovered device data to a remote syslog server"
  ],
  "methods": [],
  "name": "Discover",
  "properties": [
    "application: Application",
    "device: Device"
  ],
  "section": "general-purpose-classes",
  "source_url": "https://docs.extrahop.com/current/extrahop-trigger-api/",
  "source_version": "26.2"
}
---

### Discover

The `Discover` class enables you to retrieve information about newly discovered devices and applications.

#### Events

- **NEW_APPLICATION**: Runs when an application is first discovered. This event consumes capture resources.

| Note: | You cannot assign triggers that run only on this event to specific devices or device groups. Triggers that run on this event will run whenever this event occurs. |
| --- | --- |
- **NEW_DEVICE**: Runs when activity is first observed on a device. This event consumes capture resources.

| Note: | You cannot assign triggers that run only on this event to specific devices or device groups. Triggers that run on this event will run whenever this event occurs. |
| --- | --- |

#### Properties

- **application: Application**: A newly discovered application.

Applies only to `NEW_APPLICATION` events.
- **device: Device**: A newly discovered device.

Applies only to `NEW_DEVICE` events.

| Note: | You cannot specify this property as a participant in the `commitDetection()` function. |
| --- | --- |

#### Trigger Examples

- [Example: Send discovered device data to a remote syslog server](#example-send-discovered-device-data-to-a-remote-syslog-server)
