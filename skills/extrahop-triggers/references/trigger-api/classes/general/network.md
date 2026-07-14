---
{
  "anchor": "network",
  "api_area": "trigger-api",
  "doc_kind": "class",
  "events": [],
  "examples": [
    "Example: Parse syslog over TCP with universal payload analysis",
    "Example: Record data to a session table",
    "Example: Track SOAP requests"
  ],
  "methods": [
    "metricAddCount(metric_name: String, count: Number, options: Object):void",
    "metric_name: String",
    "count: Number",
    "options: Object",
    "highPrecision: Boolean",
    "metricAddDetailCount(metric_name: String, key: String | IPAddress, count: Number, options: Object):void",
    "key: String | IPAddress",
    "metricAddDataset(metric_name: String, val: Number, options: Object):void",
    "val: Number",
    "freq: Number",
    "metricAddDetailDataset(metric_name: String, key: String | IPAddress, val: Number, options: Object):void",
    "metricAddDistinct(metric_name: String, item: Number | String | IPAddress:void",
    "item: Number | String | IPAddress",
    "metricAddDetailDistinct (metric_name: String, key: String | IPAddress, item: Number | String | IPAddress:void",
    "metricAddMax(metric_name: String, val: Number, options: Object):void",
    "metricAddDetailMax(metric_name: String, key: String | IPAddress, val: Number, options: Object):void",
    "metricAddSampleset(metric_name: String, val: Number, options: Object):void",
    "metricAddDetailSampleset(metric_name: String, key: String | IPAddress, val: Number, options: Object):void",
    "metricAddSnap(metric_name: String, count: Number, options: Object):void",
    "metricAddDetailSnap(metric_name: String, key: String | IPAddress, count: Number, options: Object):void"
  ],
  "name": "Network",
  "properties": [],
  "section": "general-purpose-classes",
  "source_url": "https://docs.extrahop.com/current/extrahop-trigger-api/",
  "source_version": "26.2"
}
---

### Network

The `Network` class enables you to add custom metrics at the global level.

#### Methods

- **metricAddCount(metric_name: String, count: Number, options: Object):void**: Creates a custom

top-level

count metric

. Commits the metric data to the specified network.

- **metric_name: String**: The name of the top-level count metric.
- **count: Number**: The increment value. Must be a non-zero, positive signed 64-bit integer. A

`NaN`

value is silently discarded.
- **options: Object**: An optional object that can contain the following property:

- **highPrecision: Boolean**: A flag that enables one-second granularity for the custom metric when set to

`true`

.
- **metricAddDetailCount(metric_name: String, key: String | IPAddress, count: Number, options: Object):void**: Creates a custom

detail

count metric

by which you can drill down. Commits the metric data to the specified network.

- **metric_name: String**: The name of the detail count metric.
- **key: String | IPAddress**: The key specified for the detail metric. A

`null`

value is silently discarded.
- **count: Number**: The increment value. Must be a non-zero, positive signed 64-bit integer. A

`NaN`

value is silently discarded.
- **options: Object**: An optional object that can contain the following property:

- **highPrecision: Boolean**: A flag that enables one-second granularity for the custom metric when set to

`true`

.
- **metricAddDataset(metric_name: String, val: Number, options: Object):void**: Creates a custom

top-level

dataset metric

. Commits the metric data to the specified network.

- **metric_name: String**: The name of the top-level dataset metric.
- **val: Number**: The observed value, such as a processing time. Must be a non-zero, positive signed 64-bit integer. A

`NaN`

value is silently discarded.
- **options: Object**: An optional object that can contain the following properties:

- **freq: Number**: An option that enables you to simultaneously record multiple occurrences of particular values in the dataset when set to the number of occurrences specified by the

`val`

parameter. If no value is specified, the default value is 1.
- **highPrecision: Boolean**: A flag that enables one-second granularity for the custom metric when set to

`true`

.
- **metricAddDetailDataset(metric_name: String, key: String | IPAddress, val: Number, options: Object):void**: Creates a custom

detail

dataset metric

by which you can drill down. Commits the metric data to the specified network.

- **metric_name: String**: The name of the detail count metric.
- **key: String | IPAddress**: The key specified for the detail metric. A

`null`

value is silently discarded.
- **val: Number**: The observed value, such as a processing time. Must be a non-zero, positive signed 64-bit integer. A

`NaN`

value is silently discarded.
- **options: Object**: An optional object that can contain the following properties:

- **freq: Number**: An option that enables you to simultaneously record multiple occurrences of particular values in the dataset when set to the number of occurrences specified by the

`val`

parameter. If no value is specified, the default value is 1.
- **highPrecision: Boolean**: A flag that enables one-second granularity for the custom metric when set to

`true`

.
- **metricAddDistinct(metric_name: String, item: Number | String | IPAddress:void**: Creates a custom

top-level

distinct count metric

. Commits the metric data to the specified network.

- **metric_name: String**: The name of the top-level distinct count metric.
- **item: Number | String | IPAddress**: The value to be placed into the set. The value is converted to a string before it is placed in the set.
- **metricAddDetailDistinct (metric_name: String, key: String | IPAddress, item: Number | String | IPAddress:void**: Creates a custom

detail

distinct count metric

by which you can drill down. Commits the metric data to the specified network.

- **metric_name: String**: The name of the detail distinct count metric.
- **key: String | IPAddress**: The key specified for the detail metric. A

`null`

value is silently discarded.
- **item: Number | String | IPAddress**: The value to be placed into the set. The value is converted to a string before it is placed in the set.
- **metricAddMax(metric_name: String, val: Number, options: Object):void**: Creates a custom

top-level

maximum metric

. Commits the metric data to the specified network.

- **metric_name: String**: The name of the top-level maximum metric.
- **val: Number**: The observed value, such as a processing time. Must be a non-zero, positive signed 64-bit integer. A

`NaN`

value is silently discarded.
- **options: Object**: An optional object that can contain the following properties:

- **highPrecision: Boolean**: A flag that enables one-second granularity for the custom metric when set to

`true`

.
- **metricAddDetailMax(metric_name: String, key: String | IPAddress, val: Number, options: Object):void**: Creates a custom

detail

maximum metric

by which you can drill down. Commits the metric data to the specified network.

- **metric_name: String**: The name of the detail maximum metric.
- **key: String | IPAddress**: The key specified for the detail metric. A

`null`

value is silently discarded.
- **val: Number**: The observed value, such as a processing time. Must be a non-zero, positive signed 64-bit integer. A

`NaN`

value is silently discarded.
- **options: Object**: An optional object that can contain the following properties:

- **highPrecision: Boolean**: A flag that enables one-second granularity for the custom metric when set to

`true`

.
- **metricAddSampleset(metric_name: String, val: Number, options: Object):void**: Creates a custom

top-level

sampleset metric

. Commits the metric data to the specified network.

- **metric_name: String**: The name of the top-level sampleset metric.
- **val: Number**: The observed value, such as a processing time. Must be a non-zero, positive signed 64-bit integer. A

`NaN`

value is silently discarded.
- **options: Object**: An optional object that can contain the following properties:

- **highPrecision: Boolean**: A flag that enables one-second granularity for the custom metric when set to

`true`

.
- **metricAddDetailSampleset(metric_name: String, key: String | IPAddress, val: Number, options: Object):void**: Creates a custom

detail

sampleset metric

by which you can drill down. Commits the metric data to the specified network.

- **metric_name: String**: The name of the detail sampleset metric.
- **key: String | IPAddress**: The key specified for the detail metric. A

`null`

value is silently discarded.
- **val: Number**: The observed value, such as a processing time. Must be a non-zero, positive signed 64-bit integer. A

`NaN`

value is silently discarded.
- **options: Object**: An optional object that can contain the following properties:

- **highPrecision: Boolean**: A flag that enables one-second granularity for the custom metric when set to

`true`

.
- **metricAddSnap(metric_name: String, count: Number, options: Object):void**: Creates a custom

top-level

snapshot metric

. Commits the metric data to the specified network.

- **metric_name: String**: The name of the top-level snapshot metric.
- **count: Number**: The observed value, such as current established connections. Must be a non-zero, positive signed 64-bit integer. A

`NaN`

value is silently discarded.
- **options: Object**: An optional object that can contain the following properties:

- **highPrecision: Boolean**: A flag that enables one-second granularity for the custom metric when set to

`true`

.
- **metricAddDetailSnap(metric_name: String, key: String | IPAddress, count: Number, options: Object):void**: Creates a custom

detail

snapshot metric

by which you can drill down. Commits the metric data to the specified network.

- **metric_name: String**: The name of the detail sampleset metric.
- **key: String | IPAddress**: The key specified for the detail metric. A

`null`

value is silently discarded.
- **count: Number**: The observed value, such as current established connections. Must be a non-zero, positive signed 64-bit integer. A

`NaN`

value is silently discarded.
- **options: Object**: An optional object that can contain the following properties:

- **highPrecision: Boolean**: A flag that enables one-second granularity for the custom metric when set to

`true`

.

#### Trigger Examples

- [Example: Parse syslog over TCP with universal payload analysis](#example-parse-syslog-over-tcp-with-universal-payload-analysis)
- [Example: Record data to a session table](#example-record-data-to-a-session-table)
- [Example: Track SOAP requests](#example-track-soap-requests)
