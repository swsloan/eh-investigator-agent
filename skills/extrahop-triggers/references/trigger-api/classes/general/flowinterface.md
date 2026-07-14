---
{
  "anchor": "flowinterface",
  "api_area": "trigger-api",
  "doc_kind": "class",
  "events": [],
  "examples": [],
  "methods": [
    "FlowInterface(id: string)",
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
    "metricAddDetailDistinct(metric_name: String, key: String | IPAddress, item: Number | String | IPAddress:void",
    "metricAddMax(metric_name: String, val: Number, options: Object):void",
    "metricAddDetailMax(metric_name: String, key: String | IPAddress, val: Number, options: Object):void",
    "metricAddSampleset(metric_name: String, val: Number, options: Object):void",
    "metricAddDetailSampleset(metric_name: String, key: String | IPAddress, val: Number, options: Object):void",
    "metricAddSnap(metric_name: String, count: Number, options: Object):void",
    "metricAddDetailSnap(metric_name: String, key: String | IPAddress, count: Number, options: Object):void"
  ],
  "name": "FlowInterface",
  "properties": [
    "id: String",
    "number: Number"
  ],
  "section": "general-purpose-classes",
  "source_url": "https://docs.extrahop.com/current/extrahop-trigger-api/",
  "source_version": "26.2"
}
---

### FlowInterface

The `FlowInterface` class enables you to retrieve flow interface attributes and to add custom metrics at the interface level.

#### Methods

- **FlowInterface(id: string)**: A constructor for the FlowInterface object that accepts a flow interface ID. An error occurs if the flow interface ID does not exist on the ExtraHop system.

#### Instance methods

The methods in this section enable you to create custom metrics on a flow interface. The methods are present only on instances of the [NetFlow](#netflow) class. For example, the following statement collects metrics from NetFlow traffic on the ingress interface:

```javascript
NetFlow.ingressInterface.metricAddCount("slow_rsp", 1);
```

However, you can call the FlowInterface method as a static method on `NETFLOW_RECORD` events. For example, the following statement collects metrics from NetFlow traffic on both the ingress and egress interfaces:

```javascript
FlowInterface.metricAddCount("slow_rsp", 1);
```

- **metricAddCount(metric_name: String, count: Number, options: Object):void**: Creates a custom

top-level

count metric

. Commits the metric data to the specified flow interface.

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

by which you can drill down. Commits the metric data to the specified flow interface.

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

. Commits the metric data to the specified flow interface.

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

by which you can drill down. Commits the metric data to the specified flow interface.

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

. Commits the metric data to the specified flow interface.

- **metric_name: String**: The name of the top-level distinct count metric.
- **item: Number | String | IPAddress**: The value to be placed into the set. The value is converted to a string before it is placed in the set.
- **metricAddDetailDistinct(metric_name: String, key: String | IPAddress, item: Number | String | IPAddress:void**: Creates a custom

detail

distinct count metric

by which you can drill down. Commits the metric data to the specified flow interface.

- **metric_name: String**: The name of the detail distinct count metric.
- **key: String | IPAddress**: The key specified for the detail metric. A

`null`

value is silently discarded.
- **item: Number | String | IPAddress**: The value to be placed into the set. The value is converted to a string before it is placed in the set.
- **metricAddMax(metric_name: String, val: Number, options: Object):void**: Creates a custom

top-level

maximum metric

. Commits the metric data to the specified flow interface.

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

by which you can drill down. Commits the metric data to the specified flow interface.

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

. Commits the metric data to the specified flow interface.

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

by which you can drill down. Commits the metric data to the specified flow interface.

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

. Commits the metric data to the specified flow interface.

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

by which you can drill down. Commits the metric data to the specified flow interface.

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

#### Instance properties

- **id: String**: A string that uniquely identifies the flow interface.
- **number: Number**: The flow interface number reported by the NetFlow record.
