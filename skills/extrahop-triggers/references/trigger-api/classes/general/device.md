---
{
  "anchor": "device",
  "api_area": "trigger-api",
  "doc_kind": "class",
  "events": [],
  "examples": [
    "Example: Monitor SMB actions on devices",
    "Example: Track 500-level HTTP responses by customer ID and URI",
    "Example: Collect response metrics on database queries",
    "Example: Send discovered device data to a remote syslog server",
    "Example: Access HTTP header attributes",
    "Example: Record Memcache hits and misses",
    "Example: Parse memcache keys",
    "Example: Parse custom PoS messages with universal payload analysis",
    "Example: Add metrics to the metric cycle store"
  ],
  "methods": [
    "Device(id: String)",
    "lookupByIP(addr: IPAddress | String, vlan: Number): Device",
    "addr: IPAddress | String",
    "vlan: number",
    "lookupByMAC(addr: String, vlan: Number): Device",
    "addr: String",
    "vlan: Number",
    "toString(): String",
    "equals(device: Device): Boolean",
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
  "name": "Device",
  "properties": [
    "cdpName: String",
    "dhcpName: String",
    "discoverTime: Number",
    "dnsNames: Array",
    "hasTrigger: Boolean",
    "hwaddr: String",
    "id: String",
    "ipaddrs: Array",
    "isGateway: Boolean",
    "isL3: Boolean",
    "netbiosName: String",
    "vlanId: Number"
  ],
  "section": "general-purpose-classes",
  "source_url": "https://docs.extrahop.com/current/extrahop-trigger-api/",
  "source_version": "26.2"
}
---

### Device

The `Device` class enables you to retrieve device attributes and add custom metrics at the device level.

#### Methods

- **Device(id: String)**: Constructor for the Device object that accepts one parameter, which is a unique 16-character string ID.

If supplied with an ID from an existing Device object, the constructor creates a copy of that object with all of the object properties, as shown in the following example:

```javascript
myDevice = new Device(Flow.server.device.id);
debug("myDevice MAC: " + myDevice.hwaddr);
```

Metrics committed to a Device object through a `metricAdd*` function are persisted to the datastore
- **lookupByIP(addr: IPAddress | String, vlan: Number): Device**: Returns the L3 device that matches the specified IP address and VLAN ID. Returns

`null`

if no match is found.

- **addr: IPAddress | String**: The IP address for the device. The IP address can be specified as an

[IPAddress](#ipaddress)

object or as a string.
- **vlan: number**: The VLAN ID for the device. Returns a default value of

`0`

if a VLAN ID is not provided or if the value of the

`devices_across_vlans`

settings is set to

`true`

in the

[running configuration file](https://docs.extrahop.com/26.2/eh-admin-ui-guide/#running-config)

.
- **lookupByMAC(addr: String, vlan: Number): Device**: Returns the L2 device that matches the specified MAC address and VLAN ID. Returns

`null`

if no match is found.

- **addr: String**: The MAC address for the device.
- **vlan: Number**: The VLAN ID for the device. Returns a default value of

`0`

if a VLAN ID is not provided or if the value of the

`devices_across_vlans`

settings is set to

`true`

in the

[running configuration file](https://docs.extrahop.com/26.2/eh-admin-ui-guide/#running-config)

.
- **toString(): String**: Returns the Device object as a string in the following format:

```javascript
[object Device <discovery_id>]
```

#### Instance methods

The methods described in this section are present only on instances of the Device class. The majority of the methods enable you to create device-level custom metrics, as shown in the following example:

```javascript
Flow.server.device.metricAddCount("slow_rsp", 1);
```

| Note: | A device might sometimes act as a client and sometimes as a server on a flow. Call a method as `Device.metricAdd*` to collect data for both device roles. Call a method as `Flow.client.device.metricAdd*` to collect data only for the client role, regardless of whether the trigger is assigned to the client or the server. Call a method as `Flow.server.device.metricAdd*` to collect data only for the server role, regardless of whether the trigger is assigned to the client or the server. |
| --- | --- |

- **equals(device: Device): Boolean**: Performs an equality test between Device objects, where

`device`

is the object to be compared against.
- **metricAddCount(metric_name: String, count: Number, options: Object):void**: Creates a custom

top-level

count metric

. Commits the metric data to the specified device.

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

by which you can drill down. Commits the metric data to the specified device.

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

. Commits the metric data to the specified device.

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

by which you can drill down. Commits the metric data to the specified device.

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

. Commits the metric data to the specified device.

- **metric_name: String**: The name of the top-level distinct count metric.
- **item: Number | String | IPAddress**: The value to be placed into the set. The value is converted to a string before it is placed in the set.
- **metricAddDetailDistinct(metric_name: String, key: String | IPAddress, item: Number | String | IPAddress:void**: Creates a custom

detail

distinct count metric

by which you can drill down. Commits the metric data to the specified device.

- **metric_name: String**: The name of the detail distinct count metric.
- **key: String | IPAddress**: The key specified for the detail metric. A

`null`

value is silently discarded.
- **item: Number | String | IPAddress**: The value to be placed into the set. The value is converted to a string before it is placed in the set.
- **metricAddMax(metric_name: String, val: Number, options: Object):void**: Creates a custom

top-level

maximum metric

. Commits the metric data to the specified device.

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

by which you can drill down. Commits the metric data to the specified device.

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

. Commits the metric data to the specified device.

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

by which you can drill down. Commits the metric data to the specified device.

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

. Commits the metric data to the specified device.

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

by which you can drill down. Commits the metric data to the specified device.

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

The following properties enable you to retrieve device attributes and are present only on instances of the Device class.

- **cdpName: String**: The CDP name associated with the device, if present.
- **dhcpName: String**: The

DHCP

name associated with the device, if present.
- **discoverTime: Number**: The last time the capture process discovered the device (not the original discovery time), expressed in milliseconds since the epoch (January 1, 1970). Previously discovered devices can be rediscovered by the capture process if they become idle and later become active again, or if the capture process is restarted.

To direct a trigger to run only on the initial discovery of a device, see the `NEW_DEVICE` event discussed in the [Discover](#discover) class.
- **dnsNames: Array**: An array of strings listing the DNS names associated with the device, if present.
- **hasTrigger: Boolean**: The value is

`true`

if a trigger assigned to the Device object is currently running.

If the trigger is running on an event associated with a [Flow](#flow) object, the `hasTrigger` property value is `true` on at least one of the Device objects in the flow.

The `hasTrigger` property is useful to distinguish device roles. For example, if a trigger is assigned to a group of proxy servers, you can easily determine whether a device is acting as the client or the server, rather than checking for IP addresses or device IDs, such as in the following example:

```javascript
//Event: HTTP_REQUEST
if (Flow.server.device.hasTrigger) {
    // Incoming request
} else {
    // Outgoing request
}
```
- **hwaddr: String**: The MAC address of the device, if present.
- **id: String**: The 16-character unique ID of the device, as shown in the ExtraHop system on the page for that device.
- **ipaddrs: Array**: An array of

[IPAddress](#ipaddress)

objects representing the device's known IP addresses. For

L3

devices, the array always contains one IPAddress.
- **isGateway: Boolean**: The value is

`true`

if the device is a gateway.
- **isL3: Boolean**: The value is

`true`

if the device is an

L3

child device.

| Important: | If you have not enabled the ExtraHop system to [discover devices by IP address](https://docs.extrahop.com/26.2/discover-by-ip), the isL3 property is always set to False because the system does not make a distinction between L3 child and L2 parent devices. |
| --- | --- |
- **netbiosName: String**: The NetBIOS name associated with the device, if present.
- **vlanId: Number**: The VLAN ID for the device.

#### Trigger Examples

- [Example: Monitor SMB actions on devices](#example-monitor-smb-actions-on-devices)
- [Example: Track 500-level HTTP responses by customer ID and URI](#example-track-500-level-http-responses-by-customer-id-and-uri)
- [Example: Collect response metrics on database queries](#example-collect-response-metrics-on-database-queries)
- [Example: Send discovered device data to a remote syslog server](#example-send-discovered-device-data-to-a-remote-syslog-server)
- [Example: Access HTTP header attributes](#example-access-http-header-attributes)
- [Example: Record Memcache hits and misses](#example-record-memcache-hits-and-misses)
- [Example: Parse memcache keys](#example-parse-memcache-keys)
- [Example: Parse custom PoS messages with universal payload analysis](#example-parse-custom-pos-messages-with-universal-payload-analysis)
- [Example: Add metrics to the metric cycle store](#example-add-metrics-to-the-metric-cycle-store)
