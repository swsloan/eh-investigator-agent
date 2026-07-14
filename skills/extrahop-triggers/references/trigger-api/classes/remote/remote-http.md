---
{
  "anchor": "remotehttp",
  "api_area": "trigger-api",
  "doc_kind": "class",
  "events": [],
  "examples": [
    "Example: Send data to Elasticsearch with Remote.HTTP",
    "Example: Send data to Azure with Remote.HTTP"
  ],
  "methods": [
    "delete",
    "Syntax:",
    "Parameters:",
    "name: String",
    "options: Object",
    "path: String",
    "headers: Object",
    "payload: String | Buffer",
    "Return Values:",
    "get",
    "enableResponseEvent: Boolean",
    "context: Object | String | Number | Boolean | null",
    "patch",
    "post",
    "put",
    "request",
    "method: String",
    "Return values:"
  ],
  "name": "Remote.HTTP",
  "properties": [],
  "section": "open-data-stream-classes",
  "source_url": "https://docs.extrahop.com/current/extrahop-trigger-api/",
  "source_version": "26.2"
}
---

### Remote.HTTP

The `Remote.HTTP` class enables you to submit HTTP request data to an HTTP open data stream (ODS) target and provides access to HTTP REST API endpoints.

You must first configure an HTTP ODS target from the Administration settings, which requires system and access administration privileges. For configuration information, see the [Open Data Streams](https://docs.extrahop.com/26.2/open-data-streams) section in the [Sensor Administration Guide](https://docs.extrahop.com/26.2/eh-admin-ui-guide).

#### Methods

- **delete**: Submits an HTTP REST delete request to a configured HTTP open data stream.

- **Syntax:**: ```javascript
Remote.HTTP("name").delete({path: "path", headers: {header: "header"},
payload: "payload"})
```

```javascript
Remote.HTTP.delete({path: "path", headers: {header: "header"}, payload: "payload"})
```
- **Parameters:**: - **name: String**: The name of the ODS target that requests are sent to. If this field is not specified, the name is set to

`default`

.
- **options: Object**: The options object has the following properties:

- **path: String**: The string specifying the request path.
- **headers: Object**: The optional object specifying the request headers. The following headers are restricted and will result in an error if specified:

- `Connection`
- `Authorization`
- `Proxy-Connection`
- `Content-Length`
- `X-Forwarded-For`
- `Transfer-Encoding`

| Note: | Authorization headers must be specified by either a built-in authentication method, such as Amazon Web Services, or through the Additional HTTP Header field in the Open Data Streams configuration window in the Administration settings. |
| --- | --- |

Headers configured in a trigger take precedence over an entry in the Additional HTTP Header field, which is located in the Open Data Streams configuration window in the Administration settings. For example, if the Additional HTTP Header field specifies `Content-Type: text/plain`, but a trigger script on the same ODS target specifies `Content-Type: application/json`, then `Content-Type: application/json` is included in the HTTP request.

You can compress the outgoing HTTP requests with the Content- Encoding header.

```javascript
'Content-Encoding': 'gzip'
```

The following values are supported for this compression header:

- `gzip`
- `deflate`
- **payload: String | Buffer**: The optional string or Buffer specifying the request payload.
- **Return Values:**: Returns

`true`

if the request is queued, otherwise returns

`false`

.
- **get**: Submits an HTTP REST get request to a configured HTTP open data stream.

- **Syntax:**: ```javascript
Remote.HTTP("name").get({path: "path", headers: {header: "header"},
payload: "payload", enableResponseEvent: "enableResponseEvent", context: "context"})
```

```javascript
Remote.HTTP.get({path: "path", headers: {header: "header"}, payload: "payload", enableResponseEvent: "enableResponseEvent", context: "context"})
```
- **Parameters:**: - **name: String**: The name of the ODS target that requests are sent to. If this field is not specified, the name is set to

`default`

.
- **options: Object**: The options object has the following properties:

- **path: String**: The string specifying the request path.
- **headers: Object**: The optional object specifying the request headers. The following headers are restricted and will result in an error if specified:

- `Connection`
- `Authorization`
- `Proxy-Connection`
- `Content-Length`
- `X-Forwarded-For`
- `Transfer-Encoding`

| Note: | Authorization headers must be specified by either a built-in authentication method, such as Amazon Web Services, or through the Additional HTTP Header field in the Open Data Streams configuration window in the Administration settings. |
| --- | --- |

Headers configured in a trigger take precedence over an entry in the Additional HTTP Header field, which is located in the Open Data Streams configuration window in the Administration settings. For example, if the Additional HTTP Header field specifies `Content-Type: text/plain`, but a trigger script on the same ODS target specifies `Content-Type: application/json`, then `Content-Type: application/json` is included in the HTTP request.

You can compress the outgoing HTTP requests with the Content- Encoding header.

```javascript
'Content-Encoding': 'gzip'
```

The following values are supported for this compression header:

- `gzip`
- `deflate`
- **payload: String | Buffer**: The optional string or Buffer specifying the request payload.
- **enableResponseEvent: Boolean**: Enables a trigger to run on the HTTP response that is sent by the ODS target by creating a REMOTE_RESPONSE event.

| Important: | Processing a large number of HTTP responses can affect trigger performance and efficiency. We recommend that you enable this option only if necessary. |
| --- | --- |
- **context: Object | String | Number | Boolean | null**: An optional object that is sent to the trigger that is running on the HTTP response from the ODS target. You can access information stored in the object by specifying the

`Remote.response.context`

property.
- **Return Values:**: Returns

`true`

if the request is queued, otherwise returns

`false`

.
- **patch**: Submits an HTTP REST patch request to a configured HTTP open data stream.

- **Syntax:**: ```javascript
Remote.HTTP("name").patch({path: "path", headers: {header: "header"},
payload: "payload", enableResponseEvent: "enableResponseEvent", context: "context"})
```

```javascript
Remote.HTTP.patch({path: "path", headers: {header: "header"}, payload: "payload", enableResponseEvent: "enableResponseEvent", context: "context"})
```
- **Parameters:**: - **name: String**: The name of the ODS target that requests are sent to. If this field is not specified, the name is set to

`default`

.
- **options: Object**: The options object has the following properties:

- **path: String**: The string specifying the request path.
- **headers: Object**: The optional object specifying the request headers. The following headers are restricted and will result in an error if specified:

- `Connection`
- `Authorization`
- `Proxy-Connection`
- `Content-Length`
- `X-Forwarded-For`
- `Transfer-Encoding`

| Note: | Authorization headers must be specified by either a built-in authentication method, such as Amazon Web Services, or through the Additional HTTP Header field in the Open Data Streams configuration window in the Administration settings. |
| --- | --- |

Headers configured in a trigger take precedence over an entry in the Additional HTTP Header field, which is located in the Open Data Streams configuration window in the Administration settings. For example, if the Additional HTTP Header field specifies `Content-Type: text/plain`, but a trigger script on the same ODS target specifies `Content-Type: application/json`, then `Content-Type: application/json` is included in the HTTP request.

You can compress the outgoing HTTP requests with the Content- Encoding header.

```javascript
'Content-Encoding': 'gzip'
```

The following values are supported for this compression header:

- `gzip`
- `deflate`
- **payload: String | Buffer**: The optional string or Buffer specifying the request payload.
- **enableResponseEvent: Boolean**: Enables a trigger to run on the HTTP response that is sent by the ODS target by creating a REMOTE_RESPONSE event.

| Important: | Processing a large number of HTTP responses can affect trigger performance and efficiency. We recommend that you enable this option only if necessary. |
| --- | --- |
- **context: Object | String | Number | Boolean | null**: An optional object that is sent to the trigger that is running on the HTTP response from the ODS target. You can access information stored in the object by specifying the

`Remote.response.context`

property.
- **Return Values:**: Returns

`true`

if the request is queued, otherwise returns

`false`

.
- **post**: Submits an HTTP REST post request to a configured HTTP open data stream.

- **Syntax:**: ```javascript
Remote.HTTP("name").post({path: "path", headers: {header: "header"},
payload: "payload", enableResponseEvent: "enableResponseEvent", context: "context"})
```

```javascript
Remote.HTTP.post({path: "path", headers: {header: "header"}, payload: "payload", enableResponseEvent: "enableResponseEvent", context: "context"})
```
- **Parameters:**: - **name: String**: The name of the ODS target that requests are sent to. If this field is not specified, the name is set to

`default`

.
- **options: Object**: The options object has the following properties:

- **path: String**: The string specifying the request path.
- **headers: Object**: The optional object specifying the request headers. The following headers are restricted and will result in an error if specified:

- `Connection`
- `Authorization`
- `Proxy-Connection`
- `Content-Length`
- `X-Forwarded-For`
- `Transfer-Encoding`

| Note: | Authorization headers must be specified by either a built-in authentication method, such as Amazon Web Services, or through the Additional HTTP Header field in the Open Data Streams configuration window in the Administration settings. |
| --- | --- |

Headers configured in a trigger take precedence over an entry in the Additional HTTP Header field, which is located in the Open Data Streams configuration window in the Administration settings. For example, if the Additional HTTP Header field specifies `Content-Type: text/plain`, but a trigger script on the same ODS target specifies `Content-Type: application/json`, then `Content-Type: application/json` is included in the HTTP request.

You can compress the outgoing HTTP requests with the Content- Encoding header.

```javascript
'Content-Encoding': 'gzip'
```

The following values are supported for this compression header:

- `gzip`
- `deflate`
- **payload: String | Buffer**: The optional string or Buffer specifying the request payload.
- **enableResponseEvent: Boolean**: Enables a trigger to run on the HTTP response that is sent by the ODS target by creating a REMOTE_RESPONSE event.

| Important: | Processing a large number of HTTP responses can affect trigger performance and efficiency. We recommend that you enable this option only if necessary. |
| --- | --- |
- **context: Object | String | Number | Boolean | null**: An optional object that is sent to the trigger that is running on the HTTP response from the ODS target. You can access information stored in the object by specifying the

`Remote.response.context`

property.
- **Return Values:**: Returns

`true`

if the request is queued, otherwise returns

`false`

.
- **put**: Submits an HTTP REST put request to a configured HTTP open data stream.

- **Syntax:**: ```javascript
Remote.HTTP("name").put({path: "path", headers: {header: "header"},
payload: "payload", enableResponseEvent: "enableResponseEvent", context: "context"})
```

```javascript
Remote.HTTP.put({path: "path", headers: {header: "header"}, payload: "payload", enableResponseEvent: "enableResponseEvent", context: "context"})
```
- **Parameters:**: - **name: String**: The name of the ODS target that requests are sent to. If this field is not specified, the name is set to

`default`

.
- **options: Object**: The options object has the following properties:

- **path: String**: The string specifying the request path.
- **headers: Object**: The optional object specifying the request headers. The following headers are restricted and will result in an error if specified:

- `Connection`
- `Authorization`
- `Proxy-Connection`
- `Content-Length`
- `X-Forwarded-For`
- `Transfer-Encoding`

| Note: | Authorization headers must be specified by either a built-in authentication method, such as Amazon Web Services, or through the Additional HTTP Header field in the Open Data Streams configuration window in the Administration settings. |
| --- | --- |

Headers configured in a trigger take precedence over an entry in the Additional HTTP Header field, which is located in the Open Data Streams configuration window in the Administration settings. For example, if the Additional HTTP Header field specifies `Content-Type: text/plain`, but a trigger script on the same ODS target specifies `Content-Type: application/json`, then `Content-Type: application/json` is included in the HTTP request.

You can compress the outgoing HTTP requests with the Content- Encoding header.

```javascript
'Content-Encoding': 'gzip'
```

The following values are supported for this compression header:

- `gzip`
- `deflate`
- **payload: String | Buffer**: The optional string or Buffer specifying the request payload.
- **enableResponseEvent: Boolean**: Enables a trigger to run on the HTTP response that is sent by the ODS target by creating a REMOTE_RESPONSE event.

| Important: | Processing a large number of HTTP responses can affect trigger performance and efficiency. We recommend that you enable this option only if necessary. |
| --- | --- |
- **context: Object | String | Number | Boolean | null**: An optional object that is sent to the trigger that is running on the HTTP response from the ODS target. You can access information stored in the object by specifying the

`Remote.response.context`

property.
- **Return Values:**: Returns

`true`

if the request is queued, otherwise returns

`false`

.
- **request**: Submits an HTTP REST request to a configured HTTP open data stream.

- **Syntax:**: ```javascript
Remote.HTTP("name").request("method", {path: "path", headers: {header: "header"},
payload: "payload", enableResponseEvent: "enableResponseEvent", context: "context"})
```

```javascript
Remote.HTTP.request("method", {path: "path", headers: {header: "header"},
payload: "payload", enableResponseEvent: "enableResponseEvent", context: "context"})
```
- **Parameters:**: - **name: String**: The name of the ODS target that requests are sent to. If this field is not specified, the name is set to

`default`

.
- **method: String**: String that specifies the HTTP method.

- `GET`
- `HEAD`
- `POST`
- `PUT`
- `DELETE`
- `TRACE`
- `OPTIONS`
- `CONNECT`
- `PATCH`
- **options: Object**: The options object has the following properties:

- **path: String**: The string specifying the request path.
- **headers: Object**: The optional object specifying the request headers. The following headers are restricted and will result in an error if specified:

- `Connection`
- `Authorization`
- `Proxy-Connection`
- `Content-Length`
- `X-Forwarded-For`
- `Transfer-Encoding`

| Note: | Authorization headers must be specified by either a built-in authentication method, such as Amazon Web Services, or through the Additional HTTP Header field in the Open Data Streams configuration window in the Administration settings. |
| --- | --- |

Headers configured in a trigger take precedence over an entry in the Additional HTTP Header field, which is located in the Open Data Streams configuration window in the Administration settings. For example, if the Additional HTTP Header field specifies `Content-Type: text/plain`, but a trigger script on the same ODS target specifies `Content-Type: application/json`, then `Content-Type: application/json` is included in the HTTP request.

You can compress the outgoing HTTP requests with the Content- Encoding header.

```javascript
'Content-Encoding': 'gzip'
```

The following values are supported for this compression header:

- `gzip`
- `deflate`
- **payload: String | Buffer**: The optional string or Buffer specifying the request payload.
- **enableResponseEvent: Boolean**: Enables a trigger to run on the HTTP response that is sent by the ODS target by creating a REMOTE_RESPONSE event.

| Important: | Processing a large number of HTTP responses can affect trigger performance and efficiency. We recommend that you enable this option only if necessary. |
| --- | --- |
- **context: Object | String | Number | Boolean | null**: An optional object that is sent to the trigger that is running on the HTTP response from the ODS target. You can access information stored in the object by specifying the

`Remote.response.context`

property.
- **Return Values:**: Returns

`true`

if the request is queued, otherwise returns

`false`

.

#### Helper methods

The following helper methods are available for common HTTP methods.

- `Remote.HTTP.delete`
- `Remote.HTTP.get`
- `Remote.HTTP.patch`
- `Remote.HTTP.post`
- `Remote.HTTP.put`

- **Syntax:**: ```javascript
Remote.HTTP("name").delete({path: "path", headers: {header: "header"},
payload: "payload", enableResponseEvent: "enableResponseEvent", context: "context"})
```

```javascript
Remote.HTTP.delete({path: "path", headers: {header: "header"}, payload: "payload", enableResponseEvent: "enableResponseEvent", context: "context"})
```

```javascript
Remote.HTTP("name").get({path: "path", headers: {header: "header"},
payload: "payload", enableResponseEvent: "enableResponseEvent", context: "context"})
```

```javascript
Remote.HTTP.get({path: "path", headers: {header: "header"}, payload: "payload", enableResponseEvent: "enableResponseEvent", context: "context"})
```

```javascript
Remote.HTTP("name").patch({path: "path", headers: {header: "header"},
payload: "payload", enableResponseEvent: "enableResponseEvent", context: "context"})
```

```javascript
Remote.HTTP.patch({path: "path", headers: {header: "header"}, payload: "payload", enableResponseEvent: "enableResponseEvent", context: "context"})
```

```javascript
Remote.HTTP("name").post({path: "path", headers: {header: "header"},
payload: "payload", enableResponseEvent: "enableResponseEvent", context: "context"})
```

```javascript
Remote.HTTP.post({path: "path", headers: {header: "header"}, payload: "payload", enableResponseEvent: "enableResponseEvent", context: "context"})
```

```javascript
Remote.HTTP("name").put({path: "path", headers: {header: "header"},
payload: "payload", enableResponseEvent: "enableResponseEvent", context: "context"})
```

```javascript
Remote.HTTP.put({path: "path", headers: {header: "header"}, payload: "payload", enableResponseEvent: "enableResponseEvent", context: "context"})
```
- **Return values:**: Returns

`true`

if the request is queued, otherwise returns

`false`

.

#### Examples

- **HTTP GET**: The following example will issue an HTTP GET request to the HTTP configuration called "my_destination" and a path that is the URI, including query string variables, that you want the request to be sent to.

```javascript
Remote.HTTP("my_destination").get( { path: "/?example=example1&example2=my_data" } );
```
- **HTTP POST**: The following example will issue an HTTP POST request to the HTTP configuration called "my_destination", the path that is the URI you want the request to be sent to and a payload. The payload can be data similar to what an HTTP

client

would send, a JSON blob, XML, or whatever else you want to send.

```javascript
Remote.HTTP("my_destination").post( { path: "/", payload: "data I want to
send" } );
```
- **Custom HTTP Headers**: The following example defines a Javascript object with keys to represent the header names and their corresponding values and provide that in a call as the value for the headers key.

```javascript
var my_json = { example: "my_data", example1: 42, example2: false };
var headers = { "Content-Type": "application/json" };
Remote.HTTP("my_destination").post( { path: "/", headers: headers, payload:
JSON.stringify(my_json) });
```

#### Trigger Examples

- [Example: Send data to Elasticsearch with Remote.HTTP](#example-send-data-to-elasticsearch-with-remotehttp)
- [Example: Send data to Azure with Remote.HTTP](#example-send-data-to-azure-with-remotehttp)
