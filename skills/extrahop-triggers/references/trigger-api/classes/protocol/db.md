---
{
  "anchor": "db",
  "api_area": "trigger-api",
  "doc_kind": "class",
  "events": [
    "DB_REQUEST",
    "DB_RESPONSE"
  ],
  "examples": [
    "Example: Collect response metrics on database queries",
    "Example: Create an application container"
  ],
  "methods": [
    "commitRecord(): void"
  ],
  "name": "DB",
  "properties": [
    "appName: String",
    "correlationId: Number",
    "database: String",
    "encryptionProtocol: String",
    "error: String",
    "errors: Array of strings",
    "isDecrypted: Boolean",
    "isEncrypted: Boolean",
    "isReqAborted: Boolean",
    "isRspAborted: Boolean",
    "method: String",
    "params: Array",
    "name: String",
    "value: String | Number",
    "procedure: String",
    "processingTime: Number",
    "record: Object",
    "reqBytes: Number",
    "reqL2Bytes: Number",
    "reqPkts: Number",
    "reqRTO: Number",
    "reqSize: Number",
    "reqTimeToLastByte: Number",
    "reqZeroWnd: Number",
    "roundTripTime: Number",
    "rspBytes: Number",
    "rspL2Bytes: Number",
    "rspPkts: Number",
    "rspRTO: Number",
    "rspSize: Number",
    "rspTimeToFirstByte: Number",
    "rspTimeToLastByte: Number",
    "rspZeroWnd: Number",
    "serverVersion: String",
    "statement: String",
    "table: String",
    "user: String"
  ],
  "section": "protocol-and-network-data-classes",
  "source_url": "https://docs.extrahop.com/current/extrahop-trigger-api/",
  "source_version": "26.2"
}
---

### DB

The `DB`, or database, class enables you to store metrics and access properties on `DB_REQUEST` and `DB_RESPONSE` events.

#### Events

- **DB_REQUEST**: Runs on every database request processed by the device.
- **DB_RESPONSE**: Runs on every database response processed by the device.

#### Methods

- **commitRecord(): void**: Sends a record to the configured recordstore on a

`DB_RESPONSE`

event. Record commits on

`DB_REQUEST`

events are not supported.

To view the default properties committed to the record object, see the `record` property below.

For built-in records, each unique record is committed only once, even if the `commitRecord()` method is called multiple times for the same unique record.

#### Properties

- **appName: String**: The

client

application name, which is extracted only for MS SQL connections.
- **correlationId: Number**: The correlation ID for DB2 applications. The value is

`null`

for non-DB2 applications.
- **database: String**: The database instance. In some cases, such as when login events are encrypted, the database name is not available.
- **encryptionProtocol: String**: The protocol that the transaction is encrypted with.
- **error: String**: The detailed error messages recorded by the ExtraHop system in string format. If there are multiple errors in one response, the errors are concatenated into one string.

Access only on `DB_RESPONSE` events; otherwise, an error will occur.
- **errors: Array of strings**: The detailed error messages recorded by the ExtraHop system in array format. If there is only a single error in the response, the error is returned as an array containing one string.

Access only on `DB_RESPONSE` events; otherwise, an error will occur.
- **isDecrypted: Boolean**: The value is

`true`

if the ExtraHop system securely decrypted and analyzed the transaction. Decrypted traffic analysis can expose advanced threats that hide within encrypted traffic.
- **isEncrypted: Boolean**: The value is true if the transaction is encrypted.
- **isReqAborted: Boolean**: The value is

`true`

if the connection is closed before the DB request is complete.
- **isRspAborted: Boolean**: The value is

`true`

if the connection is closed before the DB response is complete.

Access only on `DB_RESPONSE` events; otherwise, an error will occur.
- **method: String**: The database method that correlates to the methods listed under the Database metric in the ExtraHop system.
- **params: Array**: An array of remote procedure call (

RPC

) parameters that are only available for Microsoft SQL, PostgreSQL, and DB2 databases.

The array contains each of the following parameters:

- **name: String**: The optional name of the supplied RPC parameter.
- **value: String | Number**: A text, integer, or time and date field. If the value is not a text, integer, or time and date field, the value is converted into HEX/ASCII form.

The value of the `params` property is the same when accessed on either the `DB_REQUEST` or the `DB_RESPONSE` event.
- **procedure: String**: The stored procedure name. Correlates to the procedures listed under the Database methods in the ExtraHop system.
- **processingTime: Number**: The server processing time, expressed in milliseconds (equivalent to

`rspTimeToFirstByte`

-

`reqTimeToLastByte`

). The value is

`NaN`

on malformed and aborted responses or if the timing is invalid.

Access only on `DB_RESPONSE` events; otherwise, an error will occur.
- **record: Object**: The record object that can be sent to the configured recordstore through a call to

`DB.commitRecord()`

on a

`DB_RESPONSE`

event.

The default record object can contain the following properties:

- appName
- clientIsExternal
- clientZeroWnd
- correlationId
- database
- error
- isReqAborted
- isRspAborted
- method
- procedure
- receiverIsExternal
- reqSize
- reqTimeToLastByte
- rspSize
- rspTimeToFirstByte
- rspTimeToLastByte
- processingTime
- senderIsExternal
- serverIsExternal
- serverZeroWnd
- statement
- table
- user

Access only on `DB_RESPONSE` events; otherwise, an error will occur.
- **reqBytes: Number**: The number of

L4

request bytes, excluding L4 headers.

Access only on `DB_RESPONSE` events; otherwise, an error will occur.
- **reqL2Bytes: Number**: The number of

L2

request bytes, including L2 headers.

Access only on `DB_RESPONSE` events; otherwise, an error will occur.
- **reqPkts: Number**: The number of request packets.

Access only on `DB_RESPONSE` events; otherwise, an error will occur.
- **reqRTO: Number**: The number of request

retransmission timeouts

(RTOs).

Access only on `DB_RESPONSE` events; otherwise, an error will occur.
- **reqSize: Number**: The number of L7 request bytes, excluding database protocol headers.
- **reqTimeToLastByte: Number**: The time from the first byte of the request until the last byte of the request, expressed in milliseconds. Returns

`NaN`

on malformed and aborted requests or if the timing is invalid.
- **reqZeroWnd: Number**: The number of zero windows in the request.
- **roundTripTime: Number**: The median round trip time (RTT), expressed in milliseconds.

An RTT is the time it took for a device to send a single TCP packet and receive an immediate corresponding acknowledgment (ACK) packet.

The median value is calculated by sampling the RTTs observed since the last

`DB_RESPONSE`

event ran. The value is

`NaN`

if there are no RTT samples.

Access only on `DB_RESPONSE` events; otherwise, an error will occur.
- **rspBytes: Number**: The number of

L4

response bytes, excluding L4 protocol overhead, such as ACKs, headers, and retransmissions.

Access only on `DB_RESPONSE` events; otherwise, an error will occur.
- **rspL2Bytes: Number**: The number of

L2

response bytes, including protocol overhead, such as headers.

Access only on `DB_RESPONSE` events; otherwise, an error will occur.
- **rspPkts: Number**: The number of response packets.

Access only on `DB_RESPONSE` events; otherwise, an error will occur.
- **rspRTO: Number**: The number of response

retransmission timeouts

(RTOs).

Access only on `DB_RESPONSE` events; otherwise, an error will occur.
- **rspSize: Number**: The number of L7 response bytes, excluding database protocol headers.

Access only on `DB_RESPONSE` events; otherwise, an error will occur.
- **rspTimeToFirstByte: Number**: The time from the first byte of the request until the first byte of the response, expressed in milliseconds. The value is

`NaN`

on malformed and aborted responses or if the timing is invalid.

Access only on `DB_RESPONSE` events; otherwise, an error will occur.
- **rspTimeToLastByte: Number**: The time from the first byte of the request until the last byte of the response, expressed in milliseconds. The value is

`NaN`

on malformed and aborted responses or if the timing is invalid.

Access only on `DB_RESPONSE` events; otherwise, an error will occur.
- **rspZeroWnd: Number**: The number of zero windows in the response.
- **serverVersion: String**: The MS SQL server version.
- **statement: String**: The full SQL statement, which might not be available for all database methods.
- **table: String**: The name of the database table specified in the current statement. The following databases are supported:

- `Sybase`
- `Sybase IQ`
- `MySQL`
- `PostgreSQL`
- `IBM Informix`
- `MS SQL TDS`
- `Oracle TNS`
- `DB2`

Returns an empty field if there is no table name in the request.
- **user: String**: The username, if available. In some cases, such as when login events are encrypted, the username is unavailable.

#### Trigger Examples

- [Example: Collect response metrics on database queries](#example-collect-response-metrics-on-database-queries)
- [Example: Create an application container](#example-create-an-application-container)
