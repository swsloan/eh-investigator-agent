---
{
  "anchor": "remote",
  "api_area": "trigger-api",
  "doc_kind": "class",
  "events": [
    "REMOTE_RESPONSE"
  ],
  "examples": [],
  "methods": [],
  "name": "Remote",
  "properties": [
    "response: Object",
    "statusCode: Number",
    "body: Buffer",
    "headers: Object",
    "context: Object | String | Number | Boolean | null"
  ],
  "section": "open-data-stream-classes",
  "source_url": "https://docs.extrahop.com/current/extrahop-trigger-api/",
  "source_version": "26.2"
}
---

### Remote

The `Remote` class enables you to send data to a third-party syslog, database, or server through an open data stream (ODS) and access responses returned by HTTP ODS targets.

#### Events

- **REMOTE_RESPONSE**: Runs when the ExtraHop system receives a response from an HTTP ODS target.

| Note: | A trigger runs on the REMOTE_RESPONSE event only if the trigger created the ODS request that caused the response. |
| --- | --- |

#### Properties

- **response: Object**: An object that contains information from the HTTP response returned by the ODS target. The response object has the following properties:

- **statusCode: Number**: The status code returned by the ODS target.
- **body: Buffer**: The body of the HTTP response sent by the ODS target.
- **headers: Object**: An object that contains the headers of the HTTP response sent by the ODS target. If the response contains multiple headers with the same name, the value for the header is an array. For example, if

`Set-Cookie`

is specified multiple times in the response, you can access the first cookie by specifying

`Remote.response.headers["Set-Cookie"][0]`

.
- **context: Object | String | Number | Boolean | null**: The context information specified in the Remote.HTTP

`context`

parameter when the ODS request was sent. For more information see

[Remote.HTTP](#remotehttp)

.
