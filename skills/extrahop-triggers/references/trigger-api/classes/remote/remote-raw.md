---
{
  "anchor": "remoteraw",
  "api_area": "trigger-api",
  "doc_kind": "class",
  "events": [],
  "examples": [],
  "methods": [
    "send",
    "Syntax:",
    "Parameters:",
    "name: String",
    "data: String",
    "Return Values:",
    "Examples"
  ],
  "name": "Remote.Raw",
  "properties": [],
  "section": "open-data-stream-classes",
  "source_url": "https://docs.extrahop.com/current/extrahop-trigger-api/",
  "source_version": "26.2"
}
---

### Remote.Raw

The `Remote.Raw` class enables you to submit raw data to a Raw open data stream (ODS) target through a TCP or UDP port.

You must first configure a raw ODS target from the Administration settings, which requires system and access administration privileges. For configuration information, see the [Open Data Streams](https://docs.extrahop.com/26.2/open-data-streams) section in the [Sensor Administration Guide](https://docs.extrahop.com/26.2/eh-admin-ui-guide).

| Note: | If the Gzip feature is enabled for the raw data stream in the Administration settings, the Remote.Raw class will automatically compress the data with Gzip. |
| --- | --- |

#### Methods

- **send**: Sends raw data to a Raw open data stream (ODS) target through a TCP or UDP port.

- **Syntax:**: ```javascript
Remote.Raw.send("data")
```

```javascript
Remote.Raw("name").send("data")
```
- **Parameters:**: - **name: String**: The name of the ODS target that requests are sent to. If this field is not specified, the name is set to

`default`

.
- **data: String**: The JavaScript string representing the bytes to send.
- **Return Values:**: None
- **Examples**: ```javascript
Remote.Raw.send("data over the wire");
```

```javascript
Remote.Raw("my-target").send("extra data for my-target");
```
