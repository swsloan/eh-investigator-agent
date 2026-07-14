---
{
  "anchor": "alertrecord",
  "api_area": "trigger-api",
  "doc_kind": "class",
  "events": [
    "ALERT_RECORD_COMMIT"
  ],
  "examples": [],
  "methods": [],
  "name": "AlertRecord",
  "properties": [
    "description: String",
    "id: String",
    "name: String",
    "object: Object",
    "time: Number",
    "severityName: String",
    "severityLevel: Number"
  ],
  "section": "datastore-classes",
  "source_url": "https://docs.extrahop.com/current/extrahop-trigger-api/",
  "source_version": "26.2"
}
---

### AlertRecord

The AlertRecord class enables you to access alert information on `ALERT_RECORD_COMMIT` events.

#### Events

- **ALERT_RECORD_COMMIT**: Runs when an alert occurs. Provides access to information about the alert.

Additional datastore options are available when you create a trigger that runs on this event. See [Advanced trigger options](#advanced-trigger-options) for more information.

| Note: | You cannot assign triggers that run only on this event to specific devices or device groups. Triggers that run on this event will run whenever this event occurs. |
| --- | --- |

| Important: | This event runs only if the NPM module is enabled on the ExtraHop system. If your user account has not been granted NPM module access, you cannot configure a trigger to run on this event. |
| --- | --- |

#### Properties

- **description: String**: The description of the alert as it appears in the ExtraHop system.
- **id: String**: The ID of the alert record. Alert record IDs are named according to the following format:

```javascript
extrahop.<object>.<alert_type>
```

`<object>` is the type of object that the alert applies to. For network objects, the `<object>` value is capture. If the alert is for a detail topnset metric, the `<alert_type>` is `alert_detail`; otherwise, the `<alert_type>` is `alert`. The following alert record IDs are valid:

- `extrahop.capture.alert`
- `extrahop.capture.alert_detail`
- `extrahop.device.alert`
- `extrahop.device.alert_detail`
- `extrahop.application.alert`
- `extrahop.application.alert_detail`
- `extrahop.flow_network.alert`
- `extrahop.flow_network.alert_detail`
- `extrahop.flow_interface.alert`
- `extrahop.flow_interface.alert_detail`

| Note: | You can restrict the trigger to only run for specified alert record types. Type a comma-separated list of alert record IDs in the Metric types field of the Advanced trigger options. |
| --- | --- |
- **name: String**: The name of the alert.
- **object: Object**: The object the alert applies to. For device, application, capture, flow interface, or flow network alerts, this property will contain a

[Device](#device)

,

[Application](#application)

,

[Network](#network)

,

[FlowInterface](#flowinterface)

, or

[FlowNetwork](#flownetwork)

object, respectively.
- **time: Number**: The time that the alert record will be published with.
- **severityName: String**: The name of the alert severity level. The following severity levels are supported:

| Value | Description |
| --- | --- |
| `emerg` | Emergency |
| `alert` | Alert |
| `crit` | Critical |
| `err` | Error |
| `warn` | Warning |
| `notice` | Notice |
| `info` | Info |
| `debug` | Debug |
- **severityLevel: Number**: The numeric alert severity level. The following severity levels are supported:

| Value | Description |
| --- | --- |
| `0` | Emergency |
| `1` | Alert |
| `2` | Critical |
| `3` | Error |
| `4` | Warning |
| `5` | Notice |
| `6` | Info |
| `7` | Debug |
