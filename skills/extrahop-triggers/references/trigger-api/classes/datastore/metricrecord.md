---
{
  "anchor": "metricrecord",
  "api_area": "trigger-api",
  "doc_kind": "class",
  "events": [
    "METRIC_RECORD_COMMIT"
  ],
  "examples": [
    "Example: Matching topnset keys",
    "Example: Add metrics to the metric cycle store"
  ],
  "methods": [],
  "name": "MetricRecord",
  "properties": [
    "fields: Object",
    "id: String",
    "object: Object",
    "time: Number"
  ],
  "section": "datastore-classes",
  "source_url": "https://docs.extrahop.com/current/extrahop-trigger-api/",
  "source_version": "26.2"
}
---

### MetricRecord

The `MetricRecord` class enables you to access to the current set of metrics on `METRIC_RECORD_COMMIT` events.

#### Events

- **METRIC_RECORD_COMMIT**: Runs when a metric record is committed to the datastore and provides access to various metric properties.

Additional datastore options are available when you create a trigger that runs on this event. See [Advanced trigger options](#advanced-trigger-options) for more information.

| Note: | You cannot assign triggers that run only on this event to specific devices or device groups. Triggers that run on this event will run whenever this event occurs. |
| --- | --- |

#### Properties

- **fields: Object**: An object containing metric values. The properties are the field names and the values can be numbers,

Topnset

,

Dataset

or

Sampleset

.
- **id: String**: The metric type, such as

`extrahop.device.http_server`

.
- **object: Object**: The object the metric applies to. For device, application, or VLAN alerts, this property contains a

[Device](#device)

object, an

[Application](#application)

object, or a

[VLAN](#vlan)

instance, respectively. For capture metrics, such as

`extrahop.capture.net`

, the property contains a

[Network](#network)

object. The following example code stores the ID of an application in a variable:

```javascript
var app_id = MetricRecord.object.id;
```

| Note: | The example code above always generates the following warning in the trigger editor:Property 'id' does not exist on type 'Device \| Application \| VLAN \| Network'. ts(2339) [2, 33] Property 'id' does not exist on type 'Network'.The warning indicates that assigning the trigger to a network is not supported. You can ignore this warning when the trigger is assigned to an application. |
| --- | --- |
- **time: Number**: The publish time of the metric record.

#### Trigger Examples

- [Example: Matching topnset keys](#example-matching-topnset-keys)
- [Example: Add metrics to the metric cycle store](#example-add-metrics-to-the-metric-cycle-store)
