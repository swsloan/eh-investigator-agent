---
{
  "anchor": "session",
  "api_area": "trigger-api",
  "doc_kind": "class",
  "events": [
    "SESSION_EXPIRE",
    "TIMER_30SEC"
  ],
  "examples": [
    "Example: Record data to a session table"
  ],
  "methods": [
    "add(key: String, value*, options: Object): *",
    "getOptions(key: String): Object",
    "increment(key: String, count: Number): Number | null",
    "lookup(key: String): *",
    "modify(key: String, value: *, options: Object): *",
    "remove(key: String): *",
    "replace(key: String, value: *, options: Object): *"
  ],
  "name": "Session",
  "properties": [
    "expiredKeys: Array",
    "age: Number",
    "name: String",
    "value: Number | String | IPAddress | Boolean | Device"
  ],
  "section": "general-purpose-classes",
  "source_url": "https://docs.extrahop.com/current/extrahop-trigger-api/",
  "source_version": "26.2"
}
---

### Session

The `Session` class provides access to the session table. It is designed to support coordination across multiple independently executing triggers. The session table's global state means any changes by a trigger or external process become visible to all other users of the session table. Because the session table is in-memory, changes are not saved when you restart the ExtraHop system or the capture process.

Here are some important things to know about session tables:

- The session table supports ordinary JavaScript values, enabling you to add JS objects to the table.
- Session table entries can be evicted when the table grows too large or when the configured expiration is reached.
- Because the session table on a sensor is not shared with the console , the values in the session table are not shared with other connected sensors .
- The ExtraHop Open Data Context API exposes the session table via the management network, enabling coordination with external processes through the memcache protocol.

#### Events

The Session class is not limited only to the `SESSION_EXPIRE` event. You can apply the Session class to any ExtraHop event.

- **SESSION_EXPIRE**: Runs periodically (in approximately 30 second increments) as long as the session table is in use. When the

`SESSION_EXPIRE`

event fires, keys that have expired in the previous 30 second interval are available through the

`Session.expiredKeys`

property.

The `SESSION_EXPIRE` event is not associated with any particular flow, so triggers on `SESSION_EXPIRE` events cannot commit device metrics through `Device.metricAdd*()` methods or `Flow.client.device.metricAdd*()` methods. To commit device metrics on this event, you must add [Device](#device) objects to the session table through the `Device()` instance method.

| Note: | You cannot assign triggers that run only on this event to specific devices or device groups. Triggers that run on this event will run whenever this event occurs. |
| --- | --- |
- **TIMER_30SEC**: Runs exactly every 30 seconds. This event enables you to perform periodic processing, such as regularly accessing session table entries added through the

[Open Data Context API](https://docs.extrahop.com/26.2/import-external-data-odcapi)

.

| Note: | You can apply any trigger class to the TIMER_30SEC event. |
| --- | --- |

| Note: | You cannot assign triggers that run only on this event to specific devices or device groups. Triggers that run on this event will run whenever this event occurs. |
| --- | --- |

#### Methods

- **add(key: String, value*, options: Object): ***: Adds the specified key in the session table. If the key is present, the corresponding value is returned without modifying the key entry in the table. If the key is not present, a new entry is created for the key and value, and the new value is returned.

You can configure an optional [Options](#options) object for the specified key.
- **getOptions(key: String): Object**: Returns the

[Options](#options)

object for the specified key. You configure options during calls to

`Session.add()`

,

`Session.modify()`

, or

`Session.replace()`

.
- **increment(key: String, count: Number): Number | null**: Looks up the specified key and increments the key value by the specified number. The default value of the optional count parameter is 1. Returns the new key value if the call is successful. Returns

`null`

if the lookup fails. Returns an error if the key value is not a number.
- **lookup(key: String): ***: Looks up the specified key in the session table and returns the corresponding value. Returns

`null`

if the key is not present.
- **modify(key: String, value: *, options: Object): ***: Modifies the specified key value, if the key is present in the session table, and returns the previous value. If the key is not present, no new entry is created.

If changes to the optional [Options](#options) object are included, the key options are updated. and old options are merged with new ones. If the `expire` option is modified, the expiration timer is reset.
- **remove(key: String): ***: Removes the entry for the given key and returns the associated value.
- **replace(key: String, value: *, options: Object): ***: Updates the entry associated with the given key. If the key is present, update the value and return the previous value. If the key is not present, add the entry and return the previous value (null).

If changes to the optional [Options](#options) object are included, the key options are updated, and old options are merged with new ones. If the `expire` option is provided, the expiration timer is reset.

#### Options

- **expire: Number**: The duration after which eviction occurrs, expressed in seconds. If the value is

`null`

or

`undefined`

, the entry is evicted only when the session table grows too large.
- **notify: Boolean**: Indicates whether the key is available on

`SESSION_EXPIRE`

events. The default value is false.
- **priority: String**: Priority level that determines which entries to evict if the session table grows too large. Valid values are

`PRIORITY_LOW`

,

`PRIORITY_NORMAL`

, and

`PRIORITY_HIGH`

. The default value is

`PRIORITY_NORMAL`

.

#### Constants

- **PRIORITY_LOW: Number**: The numeric representation of the lowest priority level. The value is 0. Priority levels determine the order that entries are removed from the session table if the table grows too large.
- **PRIORITY_NORMAL: Number**: The numeric representation of the default priority level. The value is 1. Priority levels determine the order that entries are removed from the session table if the table grows too large.
- **PRIORITY_HIGH: Number**: The numeric representation of the highest priority level. The value is 2. Priority levels determine the order that entries are removed from the session table if the table grows too large.

#### Properties

- **expiredKeys: Array**: An array of objects with the following properties:

- **age: Number**: The age of the expired object, expressed in milliseconds. Age is the amount of time elapsed between when the object in the session table was added or the expire option of the object was modified, and the

`SESSION_EXPIRE`

event. The age determines whether the key was evicted or expired.
- **name: String**: The key of the expired object.
- **value: Number | String | IPAddress | Boolean | Device**: The value of the entry in the session table.

Expired keys include keys that were evicted because the table grew too large.

The `expiredKeys` property can be accessed only on `SESSION_EXPIRE` events; otherwise, an error will occur.

#### Trigger Examples

- [Example: Record data to a session table](#example-record-data-to-a-session-table)
