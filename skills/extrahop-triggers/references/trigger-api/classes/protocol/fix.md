---
{
  "anchor": "fix",
  "api_area": "trigger-api",
  "doc_kind": "class",
  "events": [
    "FIX_REQUEST",
    "FIX_RESPONSE"
  ],
  "examples": [],
  "methods": [
    "commitRecord(): void"
  ],
  "name": "FIX",
  "properties": [
    "fields: Array",
    "msgType: String",
    "processingTime: Number",
    "record: Object",
    "reqBytes: Number",
    "reqL2Bytes: Number",
    "reqPkts: Number",
    "reqRTO: Number",
    "reqZeroWnd: Number",
    "rspBytes: Number",
    "rspL2Bytes: Number",
    "rspPkts: Number",
    "rspRTO: Number",
    "rspZeroWnd: Number",
    "sender: String",
    "target: String",
    "version: String"
  ],
  "section": "protocol-and-network-data-classes",
  "source_url": "https://docs.extrahop.com/current/extrahop-trigger-api/",
  "source_version": "26.2"
}
---

### FIX

The FIX class enables you to store metrics and access properties on `FIX_REQUEST` and `FIX_RESPONSE` events.

#### Events

- **FIX_REQUEST**: Runs on every FIX request processed by the device.
- **FIX_RESPONSE**: Runs on every FIX response processed by the device.

| Note: | The `FIX_RESPONSE` event is matched with a request based on order ID. There is no one-to-one correlation between request and response. There might be requests without a response, and sometimes data is pushed to the client, which limits request data availability on response event. However, you can invoke the session table to solve complex scenarios such as submission order id. |
| --- | --- |

#### Methods

- **commitRecord(): void**: Sends a record to the configured recordstore on either a

`FIX_REQUEST`

or

`FIX_RESPONSE`

event.

The event determines which properties are committed to the record object. To view the default properties committed for each event see the `record` property below.

For built-in records, each unique record is committed only once, even if the `commitRecord()` method is called multiple times for the same unique record.

#### Properties

- **fields: Array**: A list of FIX fields. Because they are text-based, the key-value protocol fields are exposed as an array of objects with name and value properties containing strings. For example:

```javascript
8=FIX.4.2<SOH>9=233<SOH>35=G<SOH>34=206657...
```

translates to:

```javascript
{"BeginString": "FIX.4.2", "BodyLength": "233", "MsgType": "G", "MsgSeqNum":
"206657"}
```

Key string representation is translated, if possible. With extensions, a numeric representation is used. For example, it is not possible to determine 9178=0 (as seen in actual captures). The key is instead translated to "9178". Fields are extracted after message length and version fields are extracted all the way to the checksum (last field). The checksum is not extracted.

In the following example, the trigger `debug(JSON.stringify(FIX.fields));` shows the following fields:

```javascript
[
    {"name":"MsgType","value":"0"},
    {"name":"MsgSeqNum","value":"2"},
    {"name":"SenderCompID","value":"AA"},
    {"name":"SendingTime","value":"20140904-03:49:58.600"},
    {"name":"TargetCompID","value":"GG"}
]
```

To debug and print all FIX fields, enable debugging on the trigger and enter the following code:

```javascript
var fields = '';
for (var i = 0; i < FIX.fields.length; i++) {
fields += '"' + FIX.fields[i].name + '" : "' + FIX.fields[i].value +
'"\n';
} debug(fields);
```

The following output is display in the trigger's Debug Log:

```javascript
"MsgType" : "5"
"MsgSeqNum" : "3"
"SenderCompID" : "GRAPE"
"SendingTime" : "20140905-00:10:23.814"
"TargetCompID" : "APPLE"
```
- **msgType: String**: The value of the MessageCompID key.
- **processingTime: Number**: The server processing time, expressed in milliseconds. The value is

`NaN`

if the timing is invalid.

Access only on `FIX_RESPONSE` events; otherwise, an error will occur.
- **record: Object**: The record object that can be sent to the configured recordstore through a call to

`FIX.commitRecord()`

on either a

`FIX_REQUEST`

or

`FIX_RESPONSE`

event.

The event on which the method was called determines which properties the default record object can contain as displayed in the following table:

| `FIX_REQUEST` | `FIX_RESPONSE` |
| --- | --- |
| `clientIsExternal` | `clientIsExternal` |
| `clientZeroWnd` | `clientZeroWnd` |
| `msgType` | `msgType` |
| `receiverIsExternal` | `receiverIsExternal` |
| `reqBytes` | `rspBytes` |
| `reqL2Bytes` | `rspL2Bytes` |
| `reqPkts` | `rspPkts` |
| `reqRTO` | `rspRTO` |
| `sender` | `sender` |
| `senderIsExternal` | `senderIsExternal` |
| `serverIsExternal` | `serverIsExternal` |
| `serverZeroWnd` | `serverZeroWnd` |
| `target` | `target` |
| `version` | `version` |
- **reqBytes: Number**: The number of

L4

request bytes, excluding L4 headers.
- **reqL2Bytes: Number**: The number of

L2

request bytes, including L2 headers.
- **reqPkts: Number**: The number of request packets.
- **reqRTO: Number**: The number of request

retransmission timeouts

(RTOs).
- **reqZeroWnd: Number**: The number of zero windows in the request.
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
- **rspZeroWnd: Number**: The number of zero windows in the response.
- **sender: String**: The value of the SenderCompID key.
- **target: String**: The value of the TargetCompID key.
- **version: String**: The protocol version.
