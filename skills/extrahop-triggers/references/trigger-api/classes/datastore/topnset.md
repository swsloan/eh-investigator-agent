---
{
  "anchor": "topnset",
  "api_area": "trigger-api",
  "doc_kind": "class",
  "events": [],
  "examples": [],
  "methods": [
    "findEntries(key: IPAddress | String | Object): Array",
    "findKeys(key: IPAddress | String | Object): Array",
    "lookup(key: IPAddress | String | Object): *"
  ],
  "name": "Topnset",
  "properties": [
    "entries: Array",
    "type: String",
    "value: *"
  ],
  "section": "datastore-classes",
  "source_url": "https://docs.extrahop.com/current/extrahop-trigger-api/",
  "source_version": "26.2"
}
---

### Topnset

The `Topnset` class represents a collection of metrics grouped by a key such as a URI or a client IP address.

For custom metrics, keys in the

topnset

corresponds to the keys passed into

`metricAddDetail*()`

methods. Key values can be a number, string,

[Dataset](#dataset)

,

[Sampleset](#sampleset)

, or another topnset.

#### Methods

- **findEntries(key: IPAddress | String | Object): Array**: Returns all entries with matching keys.
- **findKeys(key: IPAddress | String | Object): Array**: Returns all matching keys.
- **lookup(key: IPAddress | String | Object): ***: Look up an item in the topnset and retrieves the first matching entry.

#### Properties

- **entries: Array**: An array of the topnset entries. The array contains at most

`N`

objects with key and value properties where

`N`

is currently set to 1000.

Keys in the `entries` array adhere to the following structure, or key pattern:

- **type: String**: The type of the topnset key. The following key types are supported:

- `int`
- `string`
- `device_id`
- `ipaddr`
- `addr_pair`
- `ether`
- **value: ***: The key value, which varies depending on the key type.

- For `int` , `string` , and `device_id` keys, the value is a number, string, and device ID, respectively.
- For `ipaddr` keys, the value is an object containing the following properties:
  - `addr`
  - `proto`
  - `port`
  - `device_id`
  - `origin`
- For `addr_pair` keys, the value is an object containing the following properties:
  - `addr1`
  - `addr2`
  - `port1`
  - `port2`
  - `proto`
- For `ether` keys, the value is an object containing the following properties:
  - `ethertype`
  - `hwaddr`
