---
{
  "anchor": "metriccycle",
  "api_area": "trigger-api",
  "doc_kind": "class",
  "events": [
    "METRIC_CYCLE_BEGIN",
    "METRIC_CYCLE_END"
  ],
  "examples": [
    "Example: Add metrics to the metric cycle store"
  ],
  "methods": [],
  "name": "MetricCycle",
  "properties": [
    "id: String",
    "interval: Object",
    "store: Object"
  ],
  "section": "datastore-classes",
  "source_url": "https://docs.extrahop.com/current/extrahop-trigger-api/",
  "source_version": "26.2"
}
---

### MetricCycle

The `MetricCycle` class represents an interval during which metrics are published. The MetricCycle class is valid on `METRIC_CYCLE_BEGIN`, `METRIC_CYCLE_END`, and `METRIC_RECORD_COMMIT` events.

The `METRIC_RECORD_COMMIT` event is defined in the [MetricRecord](#metricrecord) section.

#### Events

- **METRIC_CYCLE_BEGIN**: Runs when a metric interval begins.

| Note: | You cannot assign triggers that run only on this event to specific devices or device groups. Triggers that run on this event will run whenever this event occurs. |
| --- | --- |
- **METRIC_CYCLE_END**: Runs when a metric interval ends.

| Note: | You cannot assign triggers that run only on this event to specific devices or device groups. Triggers that run on this event will run whenever this event occurs. |
| --- | --- |

Additional datastore options are available when you create a trigger that runs on either of these events. See [Advanced trigger options](#advanced-trigger-options) for more information.

#### Properties

- **id: String**: A string representing the metric cycle. The only possible value is

`30sec`

.
- **interval: Object**: An object containing from and until properties, expressed in milliseconds since the epoch.
- **store: Object**: An object that retains information across all the

`METRIC_RECORD_COMMIT`

events that occur during a metric cycle, that is, from the

`METRIC_CYCLE_BEGIN`

event to the

`METRIC_CYCLE_END`

event. This object is analogous to the

`Flow.store`

object. The

`store`

object is shared among triggers for

`METRIC_* events`

. It is cleared at the end of a metric cycle.

#### Trigger Examples

- [Example: Add metrics to the metric cycle store](#example-add-metrics-to-the-metric-cycle-store)
