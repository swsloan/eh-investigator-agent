---
{
  "anchor": "externaldata",
  "api_area": "trigger-api",
  "doc_kind": "class",
  "events": [
    "EXTERNAL_DATA"
  ],
  "examples": [],
  "methods": [],
  "name": "ExternalData",
  "properties": [
    "body: String",
    "type: String"
  ],
  "section": "general-purpose-classes",
  "source_url": "https://docs.extrahop.com/current/extrahop-trigger-api/",
  "source_version": "26.2"
}
---

### ExternalData

The `ExternalData` class enables you to retrieve data sent from external sources to the Trigger API through the ExtraHop REST API.

#### Events

- **EXTERNAL_DATA**: Runs every time data is sent to the ExtraHop system through the

[POST triggers/externaldata](https://docs.extrahop.com/26.2/rx360-rest-api/#trigger)

operation.

#### Properties

- **body: String**: The external data sent to the trigger.
- **type: String**: An identifier that describes the data sent to the trigger. The type is defined when the data is sent to the ExtraHop REST API.
