---
{
  "anchor": "threatintel",
  "api_area": "trigger-api",
  "doc_kind": "class",
  "events": [],
  "examples": [],
  "methods": [
    "hasIP(address: IPAddress): boolean",
    "hasDomain(domain: String): boolean",
    "hasURI(uri: String): boolean"
  ],
  "name": "ThreatIntel",
  "properties": [
    "isAvailable: boolean"
  ],
  "section": "general-purpose-classes",
  "source_url": "https://docs.extrahop.com/current/extrahop-trigger-api/",
  "source_version": "26.2"
}
---

### ThreatIntel

The `ThreatIntel` class enables you to see whether threats have been found for IP addresses, hostnames, or URIs. (ExtraHop RevealX Premium and Ultra only)

#### Methods

- **hasIP(address: IPAddress): boolean**: The value is

`true`

if the threats have been found for the specified IP address. If no intelligence information is available on the ExtraHop system, the value is

`null`

.
- **hasDomain(domain: String): boolean**: The value is

`true`

if the threats have been found for the specified domain. If no intelligence information is available on the ExtraHop system, the value is

`null`

.
- **hasURI(uri: String): boolean**: The value is

`true`

if the threats have been found for the specified URI. If no intelligence information is available on the ExtraHop system, the value is

`null`

.

#### Properties

- **isAvailable: boolean**: The value is

`true`

if threat intelligence information is available on the ExtraHop system.
