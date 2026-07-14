---
{
  "anchor": "quic",
  "api_area": "trigger-api",
  "doc_kind": "class",
  "events": [
    "QUIC_CLOSE",
    "QUIC_OPEN"
  ],
  "examples": [],
  "methods": [
    "commitRecord(): void",
    "getClientExtensionData(extension_name | extension_id): Buffer | Null",
    "getServerExtensionData(extension_name | extension_id): Buffer | Null",
    "hasClientExtension(extension_name | extension_id): boolean",
    "hasServerExtension(extension_name | extension_id): boolean"
  ],
  "name": "QUIC",
  "properties": [
    "clientExtensionsHex: String",
    "cipherSuite: String",
    "cipherSuiteType: Number",
    "cipherSuitesHex: String",
    "cipherSuitesSupported: Array of Objects | Null",
    "name: String",
    "type: Number",
    "clientExtensions: Array | Null",
    "id: Number",
    "length: Number",
    "isPostQuantumKeyAgreement: Boolean",
    "ja4Fingerprint: String | Null",
    "ja4Server: String",
    "keyAgreement: String",
    "record: Object",
    "serverExtensions: Array | Null",
    "serverExtensionsHex: String",
    "sni: String",
    "tlsVersion: Number",
    "version: String"
  ],
  "section": "protocol-and-network-data-classes",
  "source_url": "https://docs.extrahop.com/current/extrahop-trigger-api/",
  "source_version": "26.2"
}
---

### QUIC

The `QUIC` class enables you to store metrics and access properties on `QUIC_OPEN` and `QUIC_CLOSE` events.

#### Events

- **QUIC_CLOSE**: Runs when a QUIC connection is closed.
- **QUIC_OPEN**: Runs when a QUIC connection is opened.

#### Methods

- **commitRecord(): void**: Sends a record to the configured recordstore on either a

`QUIC_OPEN`

or

`QUIC_CLOSE`

event. To view the default properties committed to the record object, see the

`record`

property below.

For built-in records, each unique record is committed only once, even if the `commitRecord()` method is called multiple times for the same unique record.
- **getClientExtensionData(extension_name | extension_id): Buffer | Null**: Returns the data for the specified extension if the extension was passed as part of the TLS

`Hello`

message from the client. Returns

`null`

if the message does not contain data.

Call only on `QUIC_OPEN` events; otherwise, an error will occur.
- **getServerExtensionData(extension_name | extension_id): Buffer | Null**: Returns data for the specified extension if the extension was passed as part of the TLS

`Hello`

message from the server. Returns

`null`

if the message does not contain data.

Call only on `QUIC_OPEN` events; otherwise, an error will occur.
- **hasClientExtension(extension_name | extension_id): boolean**: Returns

`true`

for the specified extension if the extension was passed as part of the TLS

`Hello`

message from the client.

Call only on `QUIC_OPEN` events; otherwise, an error will occur.
- **hasServerExtension(extension_name | extension_id): boolean**: Returns

`true`

for the specified extension if the extension was passed as part of the TLS

`Hello`

message from the server.

Call only on `QUIC_OPEN` events; otherwise, an error will occur.

#### Properties

- **clientExtensionsHex: String**: A hexadecimal representation of the sorted list of client extensions.

| Note: | The Generate Random Extensions And Sustain Extensibility (GREASE) values are removed from the list before encoding. |
| --- | --- |

Access only on `QUIC_OPEN` events; otherwise, an error will occur.
- **cipherSuite: String**: A string representing the cryptographic cipher suite negotiated between the server and the client.
- **cipherSuiteType: Number**: The numeric value that represents the cryptographic cipher suite negotiated between the server and the client. Possible values are defined by the IANA TLS Cipher Suite Registry.
- **cipherSuitesHex: String**: A hexadecimal representation of the cryptographic cipher suite negotiated between the server and the client.
- **cipherSuitesSupported: Array of Objects | Null**: An array of objects with the following properties that specify the cipher suites supported by the QUIC client:

- **name: String**: The name of cipher suite.
- **type: Number**: The cipher suite number.

Access only on `QUIC_OPEN` events; otherwise, an error will occur.
- **clientExtensions: Array | Null**: An array of client extension objects that contain the following properties:

- **id: Number**: The ID number of the TLS client extension.
- **length: Number**: The full length of the TLS client extension, expressed in bytes.
- **name: String**: The name of the TLS client extension, if known. Otherwise, the value indicates that the extension is unknown.

Access only on `QUIC_OPEN` events; otherwise, an error will occur.
- **isPostQuantumKeyAgreement: Boolean**: Indicates whether the TLS session was encrypted with a post-quantum cryptography (PQC) algorithm. PQC is designed to resist attacks from quantum computers.
- **ja4Fingerprint: String | Null**: The complete JA4 fingerprint for the client, which includes the following information:

- The transport layer (L4) protocol
- The TLS version
- Whether the Server Name Indicator (SNI) extension was specified
- The number of cipher suites
- The number of extensions
- The first Application Layer Protocol Negotiation (ALPN) value listed
- The truncated SHA256 hash of cipher suites
- The truncated SHA256 hash of extensions

Access only on `QUIC_OPEN` events; otherwise, an error will occur.
- **ja4Server: String**: The complete JA4 fingerprint for the server, which includes the following information:

- The transport layer (L4) protocol
- The TLS version
- The number of extensions
- The selected Application Layer Protocol Negotiation (ALPN) value
- The selected cipher suite
- The truncated SHA256 hash of extensions

Access only on `QUIC_OPEN` events; otherwise, an error will occur.
- **keyAgreement: String**: The details of the key agreement or exchange algorithm established for the TLS session. For the RSA algorithm, the property specifies the key size (

`RSA-2048`

). For the Elliptic-Curve Diffe-Hellman Ephemeral (ECDHE) algorithm, the property specifies the key-exchange group (

`ECDHE-secp256r1`

). For post-quantum cryptography (PQC) algorithms, the property specifies that the algorithm includes PQC (

`PQC-ECDHE-Kyber-768-X25519`

).
- **record: Object**: The record object that can be sent to the configured recordstore through a call to

`QUIC.commitRecord()`

on either a

`QUIC_OPEN`

or

`QUIC_CLOSE`

event.

The default record object can contain the following properties:

- `clientAddr`
- `clientIsExternal`
- `clientPort`
- `proto`
- `receiverIsExternal`
- `senderIsExternal`
- `serverAddr`
- `serverIsExternal`
- `serverPort`
- `sni`
- `version`
- `vlan`
- **serverExtensions: Array | Null**: An array of server extension objects that contain the following properties:

- **id: Number**: The ID number of the TLS server extension.
- **length: Number**: The full length of the TLS server extension, expressed in bytes.
- **name: String**: The name of the TLS server extension, if known. Otherwise, the value indicates that the extension is unknown.

Access only on `QUIC_OPEN` events; otherwise, an error will occur.
- **serverExtensionsHex: String**: A hexadecimal representation of the sorted list of server extensions.

| Note: | The Generate Random Extensions And Sustain Extensibility (GREASE) values are removed from the list before encoding. |
| --- | --- |

Access only on `QUIC_OPEN` events; otherwise, an error will occur.
- **sni: String**: The Server Name Indication (SNI), which identifies the name of the server the client is connecting to.
- **tlsVersion: Number**: The TLS protocol version with the RFC hexadecimal version number, expressed as a decimal.
- **version: String**: The version of the QUIC protocol.
