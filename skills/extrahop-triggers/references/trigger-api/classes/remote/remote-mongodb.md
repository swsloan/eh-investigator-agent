---
{
  "anchor": "remotemongodb",
  "api_area": "trigger-api",
  "doc_kind": "class",
  "events": [],
  "examples": [
    "Example: Parse syslog over TCP with universal payload analysis"
  ],
  "methods": [
    "insert",
    "Syntax:",
    "Parameters:",
    "name: String",
    "collection: String",
    "document: Object",
    "Return Values:",
    "Examples:",
    "remove",
    "justOnce: Boolean",
    "update",
    "update: Object",
    "options:",
    "upsert: Boolean",
    "multi: Boolean"
  ],
  "name": "Remote.MongoDB",
  "properties": [],
  "section": "open-data-stream-classes",
  "source_url": "https://docs.extrahop.com/current/extrahop-trigger-api/",
  "source_version": "26.2"
}
---

### Remote.MongoDB

The `Remote.MongoDB` class enables you to insert, remove, and update MongoDB document collections through a MongoDB open data stream (ODS).

You must first configure a MongoDB ODS target from the Administration settings, which requires system and access administration privileges. For configuration information, see the [Open Data Streams](https://docs.extrahop.com/26.2/open-data-streams) section in the [Sensor Administration Guide](https://docs.extrahop.com/26.2/eh-admin-ui-guide).

#### Methods

- **insert**: Inserts a document or array of documents into a collection, and handles both add and modify operations.

- **Syntax:**: ```javascript
Remote.MongoDB.insert("db.collection", document);
```

```javascript
Remote.MongoDB("name").insert("db.collection", document);
```
- **Parameters:**: - **name: String**: The name of the ODS target that requests are sent to. If this field is not specified, the name is set to

`default`

.
- **collection: String**: The name of a group of MongoDB documents.
- **document: Object**: The JSON-formatted document to insert into the collection.
- **Return Values:**: Returns

`true`

if the request is queued, otherwise returns

`false`

.
- **Examples:**: ```javascript
Remote.MongoDB.insert('sessions.sess_www',
   { 
   'session_id': "100",
   'path': "/index.html",
   'host': "www.extrahop.com",
   'status': "500",
   'src_ip': "10.10.1.120",
   'dst_ip': "10.10.1.100"
   }
);
var x = Remote.MongoDB.insert('test.tbc', {example: 1});
if (x) {
   Network.metricAddCount('perf_trigger_success', 1);
} 
else {
   Network.metricAddCount('perf_trigger_error', 1);
}
```

Refer to [http://docs.mongodb.org/manual/reference/method/db.collection.insert/#db.collection.insert](http://docs.mongodb.org/manual/reference/method/db.collection.insert/#db.collection.insert) for more information.
- **remove**: Removes documents from a collection.

- **Syntax:**: ```javascript
Remote.MongoDB.remove("collection", document, justOnce);
```

```javascript
Remote.MongoDB("name").remove("collection", document, justOnce]);
```
- **Parameters:**: - **name: String**: The optional name of the host specified when you configured the open data stream in the Administration settings. If no host is specified, the value is the default host.
- **collection: String**: The name of a group of MongoDB documents.
- **document: Object**: The JSON-formatted document to remove from the collection.
- **justOnce: Boolean**: An optional boolean parameter that limits the removal to just one document. Set to

`true`

to limit the deletion. The default value is

`false`

.
- **Return Values:**: Returns

`true`

if the request is queued, otherwise returns

`false`

.
- **Examples:**: ```javascript
var x = Remote.MongoDB.remove('test.tbc', {qty: 100000}, false);
if (x) {
   Network.metricAddCount('perf_trigger_success', 1);
} 
else {
   Network.metricAddCount('perf_trigger_error', 1);
}
```

Refer to [http://docs.mongodb.org/manual/reference/method/db.collection.remove/#db.collection.remove](http://docs.mongodb.org/manual/reference/method/db.collection.remove/#db.collection.remove) for more information.
- **update**: Modifies an existing document or documents in a collection.

- **Syntax:**: ```javascript
Remote.MongoDB.update("collection", document, update, {"upsert":true,
"multi":true});
```

```javascript
Remote.MongoDB("name").update("collection", document, update,
{"upsert":true, "multi":true});
```
- **Parameters:**: - **collection: String**: The name of a group of MongoDB documents.
- **document: Object**: The JSON-formatted document that specifies which documents to update or insert, if upsert option is set to true.
- **update: Object**: The JSON-formatted document that specifies how to update the specified documents.
- **name: String**: The name of the host specified when you configured the open data stream in the Administration settings. If no host was specified, the value is the default host.
- **options:**: Optional flags that indicate the following additional update options:

- **upsert: Boolean**: An optional boolean parameter that creates a new document when no document matches the query data. Set to

`true`

to create a new document. The default value is

`false`

.
- **multi: Boolean**: An optional boolean parameter that updates all documents that match the query data. Set to

`true`

to update multiple documents. The default value is

`false`

, which updates only the first document returned.
- **Return Values:**: The value is

`true`

if the request is queued, otherwise returns

`FALSE`

.
- **Examples:**: ```javascript
var x = Remote.MongoDB.update('test.tbc', {_id: 1}, {$set: {example:2}},
{'upsert':true, 'multi':false} );
if (x) {
   Network.metricAddCount('perf_trigger_success', 1);
} 
else {
   Network.metricAddCount('perf_trigger_error', 1);
}
```

Refer to [http://docs.mongodb.org/manual/reference/method/db.collection.update/#db.collection.update](http://docs.mongodb.org/manual/reference/method/db.collection.update/#db.collection.update) for more information.

#### Trigger Examples

- [Example: Parse syslog over TCP with universal payload analysis](#example-parse-syslog-over-tcp-with-universal-payload-analysis)
