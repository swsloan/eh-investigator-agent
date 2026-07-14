---
{
  "anchor": "memcache",
  "api_area": "trigger-api",
  "doc_kind": "class",
  "events": [
    "MEMCACHE_REQUEST",
    "MEMCACHE_RESPONSE"
  ],
  "examples": [
    "Example: Record Memcache hits and misses",
    "Example: Parse memcache keys"
  ],
  "methods": [
    "commitRecord(): void"
  ],
  "name": "Memcache",
  "properties": [
    "accessTime: Number",
    "error: String",
    "hits: Array",
    "key: String | null",
    "size: Number",
    "isBinaryProtocol: Boolean",
    "isNoReply: Boolean",
    "isRspImplicit: Boolean",
    "method: String",
    "misses: Array",
    "record: Object",
    "reqBytes: Number",
    "reqKeys: Array",
    "reqL2Bytes: Number",
    "reqPkts: Number",
    "reqRTO: Number",
    "reqSize: Number",
    "reqZeroWnd: Number",
    "roundTripTime: Number",
    "rspBytes: Number",
    "rspL2Bytes: Number",
    "rspPkts: Number",
    "rspRTO: Number",
    "rspZeroWnd: Number",
    "statusCode: String",
    "vbucket: Number"
  ],
  "section": "protocol-and-network-data-classes",
  "source_url": "https://docs.extrahop.com/current/extrahop-trigger-api/",
  "source_version": "26.2"
}
---

### Memcache

The Memcache class enables you to store metrics and access properties on `MEMCACHE_REQUEST` and `MEMCACHE_RESPONSE` events.

#### Events

- **MEMCACHE_REQUEST**: Runs on every memcache request processed by the device.
- **MEMCACHE_RESPONSE**: Runs on every memcache response processed by the device.

#### Methods

- **commitRecord(): void**: Sends a record to the configured recordstore on either a

`MEMCACHE_REQUEST`

or

`MEMCACHE_RESPONSE`

event.

The event determines which properties are committed to the record object. To view the default properties committed for each event, see the `record` property below.

For built-in records, each unique record is committed only once, even if the `commitRecord()` method is called multiple times for the same unique record.

#### Properties

- **accessTime: Number**: The access time, expressed in milliseconds. Available only if the first key that was requested produced a hit.

Access only on `MEMCACHE_RESPONSE` events; otherwise, an error will occur.
- **error: String**: The detailed error message recorded by the ExtraHop system.

Access only on `MEMCACHE_RESPONSE` events; otherwise, an error will occur.
- **hits: Array**: An array of objects containing the Memcache key and key size.

Access only on `MEMCACHE_RESPONSE` events; otherwise, an error will occur.

- **key: String | null**: The Memcache key for which this was a hit, if available.
- **size: Number**: The size of the value returned for the key, expressed in bytes.
- **isBinaryProtocol: Boolean**: The value is

`true`

if the request/response corresponds to the binary version of the memcache protocol.
- **isNoReply: Boolean**: The value is

`true`

if the request has the "noreply" keyword and therefore should never receive a response (text protocol only).

Access only on `MEMCACHE_REQUEST` events; otherwise, an error will occur.
- **isRspImplicit: Boolean**: The value is

`true`

if the response was implied by a subsequent response from the server (binary protocol only).

Access only on `MEMCACHE_RESPONSE` events; otherwise, an error will occur.
- **method: String**: The Memcache method as recorded in Metrics section of the ExtraHop system.
- **misses: Array**: An array of objects containing the Memcache key.

Access only on `MEMCACHE_RESPONSE` events; otherwise, an error will occur.

- **key: String | null**: The Memcache key for which this was a miss, if available.
- **record: Object**: The record object that can be sent to the configured recordstore through a call to

`Memcache.commitRecord()`

on either a

`MEMCACHE_REQUEST`

or

`MEMCACHE_RESPONSE`

event.

The event on which the method was called determines which properties the default record object can contain as displayed in the following table:

| `MEMCACHE_REQUEST` | `MEMCACHE_RESPONSE` |
| --- | --- |
| `clientIsExternal` | `accessTime` |
| `clientZeroWnd` | `clientIsExternal` |
| `isBinaryProtocol` | `clientZeroWnd` |
| `isNoReply` | `error` |
| `method` | `hits` |
| `receiverIsExternal` | `isBinaryProtocol` |
| `reqBytes` | `isRspImplicit` |
| `reqL2Bytes` | `method` |
| `reqPkts` | `misses` |
| `reqRTO` | `receiverIsExternal` |
| `reqSize` | `roundTripTime` |
| `senderIsExternal` | `rspBytes` |
| `serverIsExternal` | `rspL2Bytes` |
| `serverZeroWnd` | `rspPkts` |
| `vbucket` | `rspRTO` |
|  | `senderIsExternal` |
|  | `serverIsExternal` |
|  | `serverZeroWnd` |
|  | `statusCode` |
|  | `vbucket` |
- **reqBytes: Number**: The number of

L4

request bytes, excluding L4 headers.
- **reqKeys: Array**: An array containing the Memcache key strings sent with the request.

The value of the `reqKeys` property is the same when accessed on either the `MEMCACHE_REQUEST` or the `MEMCACHE_RESPONSE` event.
- **reqL2Bytes: Number**: The number of

L2

request bytes, including L2 headers.
- **reqPkts: Number**: The number of request packets.
- **reqRTO: Number**: The number of request

retransmission timeouts

(RTOs).

Access only on `MEMCACHE_REQUEST` events; otherwise, an error will occur.
- **reqSize: Number**: The number of L7 request bytes, excluding Memcache headers. The value is

`NaN`

for requests with no payload, such as GET and DELETE.
- **reqZeroWnd: Number**: The number of zero windows in the request.
- **roundTripTime: Number**: The median round trip time (RTT), expressed in milliseconds.

An RTT is the time it took for a device to send a single TCP packet and receive an immediate corresponding acknowledgment (ACK) packet.

The median value is calculated by sampling the RTTs observed since the last

`MEMCACHE_REQUEST`

or

`MEMCACHE_RESPONSE`

event ran. The value is

`NaN`

if there are no RTT samples.
- **rspBytes: Number**: The number of

L4

response bytes, excluding L4 protocol overhead, such as ACKs, headers, and retransmissions.
- **rspL2Bytes: Number**: The number of

L2

response bytes, including protocol overhead, such as headers.
- **rspPkts: Number**: The number of response packets.
- **rspRTO: Number**: The number of response

retransmission timeouts

(RTOs).

Access only on `MEMCACHE_RESPONSE` events; otherwise, an error will occur.
- **rspZeroWnd: Number**: The number of zero windows in the response.
- **statusCode: String**: The Memcache status code. For the binary protocol, the ExtraHop system metrics prepend the method to status codes other than

`NO_ERROR`

, but the statusCode property does not. Refer to the examples for code that matches the behavior of the ExtraHop system metrics.

Access only on `MEMCACHE_RESPONSE` events; otherwise, an error will occur.
- **vbucket: Number**: The Memcache vbucket, if available (binary protocol only).

#### Trigger Examples

- [Example: Record Memcache hits and misses](#example-record-memcache-hits-and-misses)
- [Example: Parse memcache keys](#example-parse-memcache-keys)
