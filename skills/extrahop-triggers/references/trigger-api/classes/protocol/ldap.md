---
{
  "anchor": "ldap",
  "api_area": "trigger-api",
  "doc_kind": "class",
  "events": [
    "LDAP_REQUEST",
    "LDAP_RESPONSE"
  ],
  "examples": [],
  "methods": [
    "commitRecord(): void"
  ],
  "name": "LDAP",
  "properties": [
    "bindDN: String",
    "controls: Array of Objects",
    "controlType: String",
    "criticality: Boolean",
    "controlValue: Buffer",
    "dn: String",
    "encryptionProtocol: String",
    "error: String",
    "errorDetail: String",
    "isEncrypted: Boolean",
    "isDecrypted: Boolean",
    "isPasswordEmpty: Boolean",
    "isSigned: Boolean",
    "method: String",
    "msgId: Number",
    "msgSize: Number",
    "processingTime: Number",
    "record: Object",
    "reqBytes: Number",
    "reqL2Bytes: Number",
    "reqPkts: Number",
    "reqRTO: Number",
    "reqZeroWnd: Number",
    "roundTripTime: Number",
    "rspBytes: Number",
    "rspL2Bytes: Number",
    "rspPkts: Number",
    "rspRTO: Number",
    "rspZeroWnd: Number",
    "saslMechanism: String",
    "searchAttributes: Array",
    "searchFilter: String",
    "searchResults: Array of Objects",
    "type: String",
    "values: Array of Buffers",
    "searchScope: String"
  ],
  "section": "protocol-and-network-data-classes",
  "source_url": "https://docs.extrahop.com/current/extrahop-trigger-api/",
  "source_version": "26.2"
}
---

### LDAP

The `LDAP` class enables you to store metrics and access properties on `LDAP_REQUEST` and `LDAP_RESPONSE` events.

#### Events

- **LDAP_REQUEST**: Runs on every LDAP request processed by the device.
- **LDAP_RESPONSE**: Runs on every LDAP response processed by the device.

#### Methods

- **commitRecord(): void**: Sends a record to the configured recordstore on either an

`LDAP_REQUEST`

or

`LDAP_RESPONSE`

event.

The event determines which properties are committed to the record object. To view the default properties committed for each event, see the `record` property below.

For built-in records, each unique record is committed only once, even if the `commitRecord()` method is called multiple times for the same unique record.

#### Properties

- **bindDN: String**: The bind DN of the LDAP request.

Access only on `LDAP_REQUEST` events; otherwise, an error will occur.
- **controls: Array of Objects**: An array of objects containing the LDAP controls of the LDAP request. Each object contains the following properties:

- **controlType: String**: The OID of the LDAP control.
- **criticality: Boolean**: Indicates whether the control is required. If

`criticality`

is set to

`true`

, the server should process the control or fail the operation.
- **controlValue: Buffer**: The optional control value, which specifies additional information about how the control should be processed.

Access only on `LDAP_REQUEST` events; otherwise, an error will occur.
- **dn: String**: The LDAP distinguished name (DN). If no DN is set,

`<ROOT>`

will be returned instead.
- **encryptionProtocol: String**: The protocol that the transaction is encrypted with.
- **error: String**: The LDAP short error string as defined in the

protocol

(for example, noSuchObject).

Access only on `LDAP_RESPONSE` events; otherwise, an error will occur.

| Result Code | Result String |
| --- | --- |
| `1` | `operationsError` |
| `2` | `protocolError` |
| `3` | `timeLimitExceeded` |
| `4` | `sizeLimitExceeded` |
| `7` | `authMethodNotSupported` |
| `8` | `strongerAuthRequired` |
| `11` | `adminLimitExceeded` |
| `12` | `unavailableCriticalExtension` |
| `13` | `confidentialityRequired` |
| `16` | `noSuchAttribute` |
| `17` | `undefinedAttributeType` |
| `18` | `inappropriateMatching` |
| `19` | `constraintViolation` |
| `20` | `attributeOrValueExists` |
| `21` | `invalidAttributeSyntax` |
| `32` | `NoSuchObject` |
| `33` | `aliasProblem` |
| `34` | `invalidDNSSyntax` |
| `36` | `aliasDeferencingProblem` |
| `48` | `inappropriateAuthentication` |
| `49` | `invalidCredentials` |
| `50` | `insufficientAccessRights` |
| `51` | `busy` |
| `52` | `unavailable` |
| `53` | `unwillingToPerform` |
| `54` | `loopDetect` |
| `64` | `namingViolation` |
| `65` | `objectClassViolation` |
| `66` | `notAllowedOnNonLeaf` |
| `67` | `notAllowedOnRDN` |
| `68` | `entryAlreadyExists` |
| `69` | `objectClassModsProhibited` |
| `71` | `affectsMultipleDSAs` |
| `80` | `other` |
- **errorDetail: String**: The LDAP error detail, if available for the error type. For example, "protocolError : historical protocol version requested, use LDAPv3 instead."

Access only on `LDAP_RESPONSE` events; otherwise, an error will occur.
- **isEncrypted: Boolean**: The value is true if the transaction is encrypted with TLS.
- **isDecrypted: Boolean**: The value is

`true`

if the ExtraHop system securely decrypted and analyzed the transaction. Decrypted traffic analysis can expose advanced threats that hide within encrypted traffic.
- **isPasswordEmpty: Boolean**: The value is

`true`

if the request does not specify a password for authentication.

Access only on `LDAP_REQUEST` events; otherwise, an error will occur.
- **isSigned: Boolean**: The value is

`true`

if the LDAP transaction has been signed by the source machine.
- **method: String**: The LDAP method.
- **msgId: Number**: The LDAP message ID, which correlates LDAP requests and responses.
- **msgSize: Number**: The size of the LDAP message, expressed in bytes.
- **processingTime: Number**: The server processing time, expressed in milliseconds. The value is

`NaN`

on malformed and aborted responses, if the timing is invalid, or if the timing is not available. Available for the following:

- `BindRequest`
- `SearchRequest`
- `ModifyRequest`
- `AddRequest`
- `DelRequest`
- `ModifyDNRequest`
- `CompareRequest`
- `ExtendedRequest`

Applies only to `LDAP_RESPONSE` events.
- **record: Object**: The record object that can be sent to the configured recordstore through a call to

`LDAP.commitRecord()`

on either an

`LDAP_REQUEST`

or

`LDAP_RESPONSE`

event.

The event on which the method was called determines which properties the default record object can contain as displayed in the following table:

| `LDAP_REQUEST` | `LDAP_RESPONSE` |
| --- | --- |
| `bindDN` | `clientIsExternal` |
| `clientIsExternal` | `clientZeroWnd` |
| `clientZeroWnd` | `dn` |
| `dn` | `error` |
| `isSigned` | `isSigned` |
| `method` | `errorDetail` |
| `msgSize` | `method` |
| `receiverIsExternal` | `msgSize` |
| `reqBytes` | `processingTime` |
| `reqL2Bytes` | `receiverIsExternal` |
| `reqPkts` | `roundTripTime` |
| `reqRTO` | `rspBytes` |
| `saslMechanism` | `rspL2Bytes` |
| `searchFilter` | `rspPkts` |
| `searchScope` | `rspRTO` |
| `senderIsExternal` | `saslMechanism` |
| `serverIsExternal` | `senderIsExternal` |
| `serverZeroWnd` | `serverIsExternal` |
|  | `serverZeroWnd` |
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
- **roundTripTime: Number**: The median round trip time (RTT), expressed in milliseconds.

An RTT is the time it took for a device to send a single TCP packet and receive an immediate corresponding acknowledgment (ACK) packet.

The median value is calculated by sampling the RTTs observed since the last

`LDAP_REQUEST`

or

`LDAP_RESPONSE`

event ran. The value is

`NaN`

if there are no RTT samples.
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
- **saslMechanism: String**: The string that defines the SASL mechanism that identifies and authenticates a user to a server.
- **searchAttributes: Array**: The attributes to return from objects that match the filter criteria.

Access only on `LDAP_REQUEST` events; otherwise, an error will occur.
- **searchFilter: String**: The mechanism to allow certain entries in the subtree and exclude others.

Access only on `LDAP_REQUEST` events; otherwise, an error will occur.
- **searchResults: Array of Objects**: An array of objects containing the search results returned in an LDAP response. Each object contains the following properties:

- **type: String**: The type of search result.
- **values: Array of Buffers**: An array of Buffer objects containing the search result values.

Access only on `LDAP_REQUEST` events; otherwise, an error will occur.
- **searchScope: String**: The depth of a search within the search base.

Access only on `LDAP_REQUEST` events; otherwise, an error will occur.
