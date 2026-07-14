---
{
  "anchor": "application",
  "api_area": "trigger-api",
  "doc_kind": "class",
  "events": [],
  "examples": [
    "Example: Create an application container"
  ],
  "methods": [
    "commit(id: String): void",
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
    "metricAddDetailSnap(metric_name: String, key: String | IPAddress, count: Number, options: Object):void",
    "toString(): String"
  ],
  "name": "Application",
  "properties": [
    "id: String"
  ],
  "section": "general-purpose-classes",
  "source_url": "https://docs.extrahop.com/current/extrahop-trigger-api/",
  "source_version": "26.2"
}
---

### Application

The `Application` class enables you collect metrics across multiple types of network traffic to capture information with cross-tier impact. For example, if you want a unified view of all the network traffic associated with a website—from web transactions to DNS requests and responses to database transactions—you can write a trigger to create a custom application that contains all of these related metrics. The `Application` class also enables you to create custom metrics and commit the metric data to applications. Applications can only be created and defined through triggers.

#### Instance methods

The methods in this section cannot be called directly on the `Application` class. You can only call these methods on specific Application class instances. For example, the following statement is valid:

```javascript
Application("sampleApp").metricAddCount("responses", 1);
```

However, the following statement is invalid:

```javascript
Application.metricAddCount("responses", 1);
```

- **commit(id: String): void**: Creates an application, commits built-in metrics associated with the event to the application, and adds the application to any built-in or custom records committed during the event.

The application ID must be a string. For built-in application metrics, the metrics are committed only once, even if the `commit()` method is called multiple times on the same event.

The following statement creates an application named "myApp" and commits built-in metrics to the application:

```javascript
Application("myApp").commit();
```

If you plan to commit custom metrics to an application, you can create the application without calling the `commit()` method. For example, if the application does not already exist, the following statement creates the application and commits the custom metric to the application:

```javascript
Application("myApp").metricAddCount("requests", 1);
```

You can call the `Application.commit` method only on the following events:

| Metric types | Event |
| --- | --- |
| [AAA](#aaa) | `AAA_REQUEST` -and- `AAA_RESPONSE` |
| [AJP](#ajp) | `AJP_RESPONSE` |
| [CIFS](#cifs) | `CIFS_RESPONSE` |
| [DB](#db) | `DB_RESPONSE` |
| [DHCP](#dhcp) | `DHCP_REQUEST` -and- `DHCP_RESPONSE` |
| [DNS](#dns) | `DNS_REQUEST` -and- `DNS_RESPONSE` |
| [FIX](#fix) | `FIX_REQUEST` -and- `FIX_RESPONSE` |
| [FTP](#ftp) | `FTP_RESPONSE` |
| [HTTP](#http) | `HTTP_RESPONSE` |
| [IBMMQ](#ibmmq) | `IBMMQ_REQUEST` -and- `IBMMQ_RESPONSE` |
| [ICA](#ica) | `ICA_TICK` -and- `ICA_CLOSE` |
| [Kerberos](#kerberos) | `KERBEROS_REQUEST` -and- `KERBEROS_RESPONSE` |
| [LDAP](#ldap) | `LDAP_REQUEST` -and- `LDAP_RESPONSE` |
| [Memcache](#memcache) | `MEMCACHE_REQUEST` -and- `MEMCACHE_RESPONSE` |
| [Modbus](#modbus) | `MODBUS_RESPONSE` |
| [MongoDB](#mongodb) | `MONGODB_REQUEST` -and- `MONGODB_RESPONSE` |
| NAS | `CIFS_RESPONSE` -and/or- `NFS_RESPONSE` |
| [NetFlow](#netflow) | `NETFLOW_RECORD`Note that the commit will not occur if enterprise IDs are present in the NetFlow record. |
| [NFS](#nfs) | `NFS_RESPONSE` |
| [RDP](#rdp) | `RDP_TICK` |
| [Redis](#redis) | `REDIS_REQUEST` -and- `REDIS_RESPONSE` |
| [RPC](#rpc) | `RPC_REQUEST` -and- `RPC_RESPONSE` |
| [RTP](#rtp) | `RTP_TICK` |
| [RTCP](#rtcp) | `RTCP_MESSAGE` |
| [SCCP](#sccp) | `SCCP_MESSAGE` |
| [SIP](#sip) | `SIP_REQUEST` -and- `SIP_RESPONSE` |
| [SFlow](#sflow) | `SFLOW_RECORD` |
| [SMTP](#smtp) | `SMTP_RESPONSE` |
| [SSH](#ssh) | `SSH_CLOSE` -and- `SSH_TICK` |
| [SSL](#ssl) | `SSL_RECORD` -and- `SSL_CLOSE` |
| [WebSocket](#websocket) | `WEBSOCKET_OPEN`, `WEBSOCKET_CLOSE`, and `WEBSOCKET_MESSAGE` |
- **metricAddCount(metric_name: String, count: Number, options: Object):void**: Creates a custom

top-level

count metric

. Commits the metric data to the specified application.

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

by which you can drill down. Commits the metric data to the specified application.

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

. Commits the metric data to the specified application.

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

by which you can drill down. Commits the metric data to the specified application.

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

. Commits the metric data to the specified application.

- **metric_name: String**: The name of the top-level distinct count metric.
- **item: Number | String | IPAddress**: The value to be placed into the set. The value is converted to a string before it is placed in the set.
- **metricAddDetailDistinct(metric_name: String, key: String | IPAddress, item: Number | String | IPAddress:void**: Creates a custom

detail

distinct count metric

by which you can drill down. Commits the metric data to the specified application.

- **metric_name: String**: The name of the detail distinct count metric.
- **key: String | IPAddress**: The key specified for the detail metric. A

`null`

value is silently discarded.
- **item: Number | String | IPAddress**: The value to be placed into the set. The value is converted to a string before it is placed in the set.
- **metricAddMax(metric_name: String, val: Number, options: Object):void**: Creates a custom

top-level

maximum metric

. Commits the metric data to the specified application.

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

by which you can drill down. Commits the metric data to the specified application.

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

. Commits the metric data to the specified application.

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

by which you can drill down. Commits the metric data to the specified application.

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

. Commits the metric data to the specified application.

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

by which you can drill down. Commits the metric data to the specified application.

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
- **toString(): String**: Returns the Application object as a string in the following format:

```javascript
[object Application <application_id>]
```

#### Instance properties

- **id: String**: The unique ID of the application, as shown in the ExtraHop system on the page for that application.

#### Trigger examples

- [Example: Create an application container](#example-create-an-application-container)
