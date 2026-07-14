---
{
  "anchor": "socks",
  "api_area": "trigger-api",
  "doc_kind": "class",
  "events": [
    "SOCKS_REQUEST",
    "SOCKS_RESPONSE"
  ],
  "examples": [],
  "methods": [
    "commitRecord(): void"
  ],
  "name": "SOCKS",
  "properties": [
    "authResult: Number",
    "authType: Number",
    "command: Number",
    "record: Object",
    "requestAddress: IPAddress",
    "requestPort: Number",
    "responseAddress: IPAddress",
    "responsePort: Number",
    "result: Number",
    "username: String",
    "version: Number"
  ],
  "section": "protocol-and-network-data-classes",
  "source_url": "https://docs.extrahop.com/current/extrahop-trigger-api/",
  "source_version": "26.2"
}
---

### SOCKS

The SOCKet Secure (SOCKS) class enables you to store metrics and access properties on `SOCKS_REQUEST` and `SOCKS_RESPONSE` events.

#### Events

- **SOCKS_REQUEST**: Runs on every SOCKS message processed by the device.
- **SOCKS_RESPONSE**: Runs on every SOCKS message processed by the device.

#### Methods

- **commitRecord(): void**: Sends a record to the configured recordstore on a

`SOCKS_RESPONSE`

event. Record commits on

`SOCKS_REQUEST`

events are not supported. To view the default properties committed to the record object, see the record property below.

For built-in records, each unique record is committed only once, even if the `commitRecord()` method is called multiple times for the same unique record.

#### Properties

- **authResult: Number**: Indicates whether authentication was successful. The following values are valid.

| Value | Description |
| --- | --- |
| `0` | Succeeded |
| `1` | Failed |

| Note: | If the protocol is SOCKS4, the value is always `0` because SOCKS4 does not support authentication. |
| --- | --- |
- **authType: Number**: The authentication method that was negotiated between the server and the client.
- **command: Number**: The numeric code for the SOCKS command that the client requested. The following command codes are valid.

| Code | Description |
| --- | --- |
| `1` | Connect TCP stream |
| `2` | Bind TCP port |
| `3` | Associate UDP port |
- **record: Object**: The record object that can be sent to the configured recordstore through a call to

`SOCKS.commitRecord()`

on an

`SOCKS_RESPONSE`

event.

- `application`
- `authResult`
- `authType`
- `client`
- `clientAddr`
- `clientIsExternal`
- `clientPort`
- `command`
- `flowId`
- `requestAddress`
- `requestPort`
- `responseAddress`
- `responsePort`
- `result`
- `server`
- `serverAddr`
- `serverIsExternal`
- `serverPort`
- `username`
- `version`
- `vlan`

Access the record object only on `SOCKS_RESPONSE` events; otherwise, an error will occur.
- **requestAddress: IPAddress**: The

[IPAddress](#ipaddress)

object for the address specified by the client in the request.
- **requestPort: Number**: The port number specified by the client in the request.
- **responseAddress: IPAddress**: The

[IPAddress](#ipaddress)

object for the address specified by the server in the response.
- **responsePort: Number**: The port number specified by the server in the response.
- **result: Number**: The status code specified by the server in the response.
- **username: String**: The name of the user specified by the client for authentication.
- **version: Number**: The SOCKS protocol version.
