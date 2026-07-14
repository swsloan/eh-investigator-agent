---
{
  "anchor": "ntlm",
  "api_area": "trigger-api",
  "doc_kind": "class",
  "events": [
    "NTLM_MESSAGE"
  ],
  "examples": [],
  "methods": [
    "commitRecord(): void"
  ],
  "name": "NTLM",
  "properties": [
    "containsMIC: Boolean",
    "challenge: String",
    "domain: String",
    "flags: Number",
    "msgType: String",
    "ntlm2RspAVPairs: Array",
    "record: Object",
    "rspVersion: String",
    "user: String",
    "windowsVersion: String",
    "workstation: String"
  ],
  "section": "protocol-and-network-data-classes",
  "source_url": "https://docs.extrahop.com/current/extrahop-trigger-api/",
  "source_version": "26.2"
}
---

### NTLM

The `NTLM` class enables you to store metrics and access properties on `NTLM_MESSAGE` events.

#### Events

- **NTLM_MESSAGE**: Runs on every NTLM message processed by the device.

#### Methods

- **commitRecord(): void**: Sends a record to the configured recordstore on an

`NTLM_MESSAGE`

event.

To view the default properties committed to the record object, see the `record` property below.

For built-in records, each unique record is committed only once, even if the `commitRecord()` method is called multiple times for the same unique record.

#### Properties

- **containsMIC: Boolean**: The value is true if the message includes a Message Integrity Code (MIC) that ensures that the message has not been tampered with.
- **challenge: String**: The hexadecimal-encoded challenge hash string.
- **domain: String**: The client domain name included in the challenge hash calculation.
- **flags: Number**: The bitwise OR of the NTLM negotiate flags. For more information, see the

[NTLM documentation](https://docs.microsoft.com/en-us/openspecs/windows_protocols/ms-nlmp/99d90ff4-957f-4c8a-80e4-5bfe5a9a9832)

on the Microsoft website.
- **msgType: String**: The type of NTLM message. The following message types are valid:

- `NTLM_AUTH`
- `NTLM_CHALLENGE`
- `NTLM_NEGOTIATE`
- **ntlm2RspAVPairs: Array**: An array of objects that contain NTLM attribute-value pairs. For more information, see the

[NTLM documentation](https://docs.microsoft.com/en-us/openspecs/windows_protocols/ms-nlmp/83f5e789-660d-4781-8491-5f8c6641f75e)

on the Microsoft website.
- **record: Object**: The record object that can be sent to the configured recordstore through a call to

`NTLM.commitRecord()`

on a

`NTLM_MESSAGE`

event.

The default record object can contain the following properties:

- `challenge`
- `clientIsExternal`
- `domain`
- `flags`
- `l7proto`
- `msgType`
- `proto`
- `receiverAddr`
- `receiverIsExternal`
- `receiverPort`
- `senderAddr`
- `senderIsExternal`
- `senderPort`
- `serverIsExternal`
- `user`
- `windowsVersion`
- `workstation`
- **rspVersion: String**: The version of NTLM implemented in the NTLM_AUTH response. The value is

`null`

for non-authentication messages. The following versions are valid:

- `LM`
- `NTLMv1`
- `NTLMv2`
- **user: String**: The client username included in the challenge hash calculation.
- **windowsVersion: String**: The version of Windows running on the client included in the challenge hash calculation.
- **workstation: String**: The name of the client workstation included in the challenge hash calculation.
