---
{
  "anchor": "kerberos",
  "api_area": "trigger-api",
  "doc_kind": "class",
  "events": [
    "KERBEROS_REQUEST",
    "KERBEROS_RESPONSE"
  ],
  "examples": [],
  "methods": [
    "commitRecord(): void"
  ],
  "name": "Kerberos",
  "properties": [
    "addresses: Array of Objects",
    "apOptions: Object",
    "clientPrincipalName: String",
    "cNames: Array of Strings",
    "cNameType: String",
    "cRealm: String",
    "eData: Buffer",
    "error: String",
    "from: String",
    "isAccountPrivileged: Boolean",
    "kdcOptions: Object",
    "msgType: String",
    "paData: Array of Objects",
    "processingTime: Number",
    "realm: String",
    "record: Object",
    "reqETypes: Array of Numbers",
    "reqETypeNames: Array of Strings",
    "reqZeroWnd: Number",
    "rspZeroWnd: Number",
    "serverPrincipalName: String",
    "sNames: Array of Strings",
    "sNameType: String",
    "ticket: Object",
    "till: String"
  ],
  "section": "protocol-and-network-data-classes",
  "source_url": "https://docs.extrahop.com/current/extrahop-trigger-api/",
  "source_version": "26.2"
}
---

### Kerberos

The Kerberos class enables you to store metrics and access properties on `KERBEROS_REQUEST` and `KERBEROS_RESPONSE` events.

#### Events

- **KERBEROS_REQUEST**: Runs on every Kerberos AS-REQ and TGS-REQ message type processed by the device.
- **KERBEROS_RESPONSE**: Runs on every Kerberos AS-REP and TGS-REP message type processed by the device.

#### Methods

- **commitRecord(): void**: Sends a record to the configured recordstore on either a

`KERBEROS_REQUEST`

or

`KERBEROS_RESPONSE`

event.

The event determines which properties are committed to the record object. To view the default properties committed for each event, see the `record` property below.

For built-in records, each unique record is committed only once, even if the `commitRecord()` method is called multiple times for the same unique record.

#### Properties

- **addresses: Array of Objects**: The addresses from which the requested ticket is valid.

Access only on `KERBEROS_REQUEST` events; otherwise, an error will occur.
- **apOptions: Object**: An object containing boolean values for each option flag in AP_REQ messages.

Access only on `KERBEROS_REQUEST` events; otherwise, an error will occur.
- **clientPrincipalName: String**: The client principal name.
- **cNames: Array of Strings**: The name portions of the principal identifier.
- **cNameType: String**: The type for the cNames field.
- **cRealm: String**: The client realm.
- **eData: Buffer**: Additional information about the error returned in the response.

Access only on `KERBEROS_RESPONSE` events; otherwise, an error will occur.
- **error: String**: The error returned.

Access only on `KERBEROS_RESPONSE` events; otherwise, an error will occur.
- **from: String**: In AS_REQ and TGS_REQ message types, the time when the requested ticket is to be postdated to.

Access only on `KERBEROS_REQUEST` events; otherwise, an error will occur.
- **isAccountPrivileged: Boolean**: The value is true if the account specified in the

`clientPrincipalName`

property is privileged.
- **kdcOptions: Object**: An object containing boolean values for each option flag in AS_REQ and TGS_REQ messages.

Access only on `KERBEROS_REQUEST` events; otherwise, an error will occur.
- **msgType: String**: The message type. Possible values are:

- `AP_REP`
- `AP_REQ`
- `AS_REP`
- `AS_REQAUTHENTICATOR`
- `ENC_AS_REP_PART`
- `ENC_KRB_CRED_PART`
- `ENC_KRB_PRIV_PART`
- `ENC_P_REP_PART`
- `ENC_TGS_REP_PART`
- `ENC_TICKET_PART`
- `KRB_CRED`
- `KRB_ERROR`
- `KRB_PRIV`
- `KRB_SAFE`
- `TGS_REP`
- `TGS_REQ`
- `TICKET`
- **paData: Array of Objects**: The pre-authentication data.
- **processingTime: Number**: The processing time, expressed in milliseconds.

Access only on `KERBEROS_RESPONSE` events; otherwise, an error will occur.
- **realm: String**: The server realm. In an AS_REQ message type, this is the client realm.
- **record: Object**: The record object that can be sent to the configured recordstore through a call to

`Kerberos.commitRecord()`

on either a

`KERBEROS_REQUEST`

or

`KERBEROS_RESPONSE`

event.

The event on which the method was called determines which properties the default record object can contain as displayed in the following table:

| `KERBEROS_REQUEST` | `KERBEROS_RESPONSE` |
| --- | --- |
| `clientIsExternal` | `clientIsExternal` |
| `cNames` | `cNames` |
| `cNameType` | `cNameType` |
| `cRealm` | `cRealm` |
| `clientZeroWnd` | `clientZeroWnd` |
| `encryptedTicketLength` | `encryptedTicketLength` |
| `eType` | `error` |
| `from` | `msgType` |
| `isAccountPrivileged` | `isAccountPrivileged` |
| `msgType` | `processingTime` |
| `realm` | `realm` |
| `receiverIsExternal` | `receiverIsExternal` |
| `reqBytes` | `roundTripTime` |
| `reqL2Bytes` | `rspBytes` |
| `reqPkts` | `rspL2Bytes` |
| `reqRTO` | `rspPkts` |
| `senderIsExternal` | `rspRTO` |
| `serverZeroWnd` | `senderIsExternal` |
| `sNames` | `serverIsExternal` |
| `sNameType` | `sNames` |
| `ticketETypeName` | `sNameType` |
| `till` | `ticketETypeName` |
|  | `serverZeroWnd` |
- **reqETypes: Array of Numbers**: An array of numbers that correspond to preferred encryption methods.

| Encryption method | Number |
| --- | --- |
| `ntlm-hash` | `-150` |
| `aes256-cts-hmac-sha1-96-plain` | `-149` |
| `aes128-cts-hmac-sha1-96-plain` | `-148` |
| `rc4-plain-exp` | `-141` |
| `rc4-plain` | `-140` |
| `rc4-plain-old-exp` | `-136` |
| `rc4-hmac-old-exp` | `-135` |
| `rc4-plain-old` | `-134` |
| `rcr-hmac-old` | `-133` |
| `des-plain` | `-132` |
| `rc4-sha` | `-131` |
| `rc4-lm` | `-130` |
| `rc4-plain2` | `-129` |
| `rc4-md4` | `-128` |
| `null` | `0` |
| `des-cbc-crc` | `1` |
| `des-cbc-md4` | `2` |
| `des-cbc-md5` | `3` |
| `des3-cbc-md5` | `5` |
| `des3-cbc-sha1` | `7` |
| `dsaWithSHA1-CmsOID` | `9` |
| `md5WithRSAEncryption-CmsOID` | `10` |
| `sha1WithRSAEncryption-CmsOID` | `11` |
| `rc2CBC-EnvOID` | `12` |
| `rsaEncryption-EnvOID` | `13` |
| `rsaES-OAEP-ENV-OID` | `14` |
| `des-ede3-cbc-Env-OID` | `15` |
| `des3-cbc-sha1-kd` | `16` |
| `aes128-cts-hmac-sha1-96` | `17` |
| `aes256-cts-hmac-sha1-96` | `18` |
| `aes128-cts-hmac-sha256-128` | `19` |
| `aes256-cts-hmac-sha384-192` | `20` |
| `rc4-hmac` | `23` |
| `rc4-hmac-exp` | `24` |
| `camellia128-cts-cmac` | `25` |
| `camellia256-cts-cmac` | `26` |
| `subkey-keymaterial` | `65` |
- **reqETypeNames: Array of Strings**: An array of the preferred encryption methods.
- **reqZeroWnd: Number**: The number of zero windows in the request.
- **rspZeroWnd: Number**: The number of zero windows in the response.
- **serverPrincipalName: String**: The server principal name (SPN).
- **sNames: Array of Strings**: The name portions of the server principal identifier.
- **sNameType: String**: The type for the sNames field.
- **ticket: Object**: A newly generated ticket in an AP_REP message or a ticket to authenticate the client to the server in an AP_REQ message.
- **till: String**: The expiration date requested by the client in a ticket request.

Access only on `KERBEROS_REQUEST` events; otherwise, an error will occur.
