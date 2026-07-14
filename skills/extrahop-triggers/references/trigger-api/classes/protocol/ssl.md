---
{
  "anchor": "ssl",
  "api_area": "trigger-api",
  "doc_kind": "class",
  "events": [
    "SSL_ALERT",
    "SSL_CLOSE",
    "SSL_HEARTBEAT",
    "SSL_OPEN",
    "SSL_PAYLOAD",
    "SSL_RECORD",
    "SSL_RENEGOTIATE"
  ],
  "examples": [],
  "methods": [
    "addApplication(name: String): void",
    "commitRecord(): void",
    "getClientExtensionData(extension_name | extension_id): Buffer | Null",
    "getServerExtensionData(extension_name | extension_id): Buffer | Null",
    "hasClientExtension(extension_name | extension_id): boolean",
    "hasServerExtension(extension_name | extension_id): boolean"
  ],
  "name": "SSL",
  "properties": [
    "alertCode: Number",
    "alertCodeName: String",
    "alertLevel: Number",
    "certificate: SSLCert",
    "authorityInfoAccess: Object",
    "location: String",
    "method: String",
    "authorityKeyIdentifier: String | Null",
    "basicConstraints: Object",
    "ca: Boolean",
    "pathlen: Number",
    "certificatePolicies: Array of Strings",
    "crlDistributionPoints: Array of Strings",
    "crlIssuer: Array of Strings",
    "distPoint: Array of Strings",
    "reasons: Array of Strings",
    "extensionOIDs: Array of Strings",
    "extendedKeyUsage: Array of Strings",
    "fingerprint: String",
    "fingerprintSHA256: String",
    "getExtensionDataByOID(extension_oid): Buffer",
    "inhibitAnyPolicy: Number",
    "isSelfSigned: Boolean",
    "issuer: String",
    "issuerAlternativeNames: Array of Strings",
    "issuerDistinguishedName: Object",
    "commonName: String",
    "country: Array of Strings",
    "emailAddress: String",
    "organization: Array of Strings",
    "organizationalUnit: Array of Strings",
    "locality: Array of Strings",
    "stateOrProvince: Array of Strings",
    "keySize: Number",
    "keyUsage: Array of Strings",
    "notAfter: Number",
    "notBefore: Number",
    "nsComment: String",
    "ocspNoCheck: Boolean",
    "payload: Buffer",
    "policyConstraints: Object",
    "requireExplicitPolicy: Number",
    "inhibitPolicyMapping: Number",
    "policyMappings: Array of Objects",
    "issuerDomainPolicy: String",
    "subjectDomainPolicy: String",
    "publicKeyCurveName: String",
    "publicKeyExponent: String | Null",
    "publicKeyHasExplicitCurve: Boolean | Null",
    "publicKeyModulus: String | Null",
    "serial: String | Null",
    "signatureAlgorithm: String | Null",
    "subject: String",
    "subjectAlternativeNames: Array",
    "subjectDistinguishedName: Object",
    "subjectKeyIdentifier: String",
    "certificates: Array of Objects",
    "cipherSuite: String",
    "cipherSuitesHex: String",
    "cipherSuitesSupported: Array of Objects | Null",
    "name: String",
    "type: Number",
    "cipherSuiteType: Number",
    "clientBytes: Number",
    "clientCertificate: SSLCert",
    "issuer: String | Null",
    "clientCertificates: Array of Objects",
    "clientCertificateRequested: Boolean",
    "clientExtensions: Array | Null",
    "id: Number",
    "length: Number",
    "clientExtensionsHex: String",
    "clientHelloVersion: Number",
    "clientL2Bytes: Number",
    "clientPkts: Number",
    "clientSessionId: String",
    "clientZeroWnd: Number",
    "contentType: String",
    "ecPointFormatsHex: String",
    "encryptionProtocol: String",
    "handshakeTime: Number",
    "heartbeatPayloadLength: Number",
    "heartbeatType: Number",
    "host: String | Null",
    "isAborted: Boolean",
    "isCompressed: Boolean",
    "isDecrypted: Boolean",
    "isEncrypted: Boolean",
    "isPostQuantumKeyAgreement: Boolean",
    "isResumed: Boolean",
    "isStartTLS: Boolean",
    "isV2ClientHello: Boolean",
    "isWeakCipherSuite: Boolean",
    "ja3Text: String | Null",
    "ja3Hash: String | Null",
    "ja3sText: String | Null",
    "ja3sHash: String | Null",
    "ja4Fingerprint: String | Null",
    "ja4Server: String",
    "ja4X509: String",
    "keyAgreement: String",
    "privateKeyId: String | Null",
    "record: Object",
    "recordLength: Number",
    "recordType: Number",
    "roundTripTime: Number",
    "serverExtensions: Array | Null",
    "serverExtensionsHex: String",
    "serverBytes: Number",
    "serverHelloVersion: Number",
    "serverL2Bytes: Number",
    "serverPkts: Number",
    "serverSessionId: String",
    "serverZeroWnd: Number",
    "startTLSProtocol: String | Null",
    "supportedGroupsHex: String",
    "version: Number"
  ],
  "section": "protocol-and-network-data-classes",
  "source_url": "https://docs.extrahop.com/current/extrahop-trigger-api/",
  "source_version": "26.2"
}
---

### SSL

The `SSL` class enables you to store metrics and access properties on `SSL_OPEN`, `SSL_CLOSE`, `SSL_ALERT`, `SSL_RECORD`, `SSL_HEARTBEAT`, and `SSL_RENEGOTIATE` events.

#### Events

- **SSL_ALERT**: Runs when an TLS alert record is exchanged.
- **SSL_CLOSE**: Runs when the TLS connection is shut down.
- **SSL_HEARTBEAT**: Runs when an TLS heartbeat record is exchanged.
- **SSL_OPEN**: Runs when the TLS connection is first established.
- **SSL_PAYLOAD**: Runs when the decrypted TLS payload matches the criteria configured in the associated trigger.

Depending on the flow, the payload can be found in the following properties:

- `Flow.payload1`
- `Flow.payload2`
- `Flow.client.payload`
- `Flow.server.payload`
- `Flow.sender.payload`
- `Flow.receiver.payload`

Additional payload options are available when you create a trigger that runs on this event. See [Advanced trigger options](#advanced-trigger-options) for more information.
- **SSL_RECORD**: Runs when an TLS record is exchanged.
- **SSL_RENEGOTIATE**: Runs on TLS renegotiation.

#### Methods

- **addApplication(name: String): void**: Associates an TLS session with the named application to collect TLS metric data about the session. For example, you might call

`SSL.addApplication()`

to associate TLS certificate data in an application.

After an TLS session is associated with an application, that pairing is permanent for the lifetime of the session.

Call only on `SSL_OPEN` events; otherwise, an error will occur.
- **commitRecord(): void**: Sends a record to the configured recordstore only on

`SSL_ALERT`

,

`SSL_CLOSE`

,

`SSL_HEARTBEAT`

,

`SSL_OPEN`

, or

`SSL_RENEGOTIATE`

events. Record commits on

`SSL_PAYLOAD`

and

`SSL_RECORD`

events are not supported.

To view the default properties committed to the record object, see the `record` property below.

For built-in records, each unique record is committed only once, even if the `commitRecord()` method is called multiple times for the same unique record.
- **getClientExtensionData(extension_name | extension_id): Buffer | Null**: Returns the data for the specified extension if the extension was passed as part of the

`Hello`

message from the client. Returns

`null`

if the message does not contain data.

Call only on `SSL_OPEN` and `SSL_RENEGOTIATE` events; otherwise, an error will occur.
- **getServerExtensionData(extension_name | extension_id): Buffer | Null**: Returns data for the specified extension if the extension was passed as part of the

`Hello`

message from the server. Returns

`null`

if the message does not contain data.

Call only on `SSL_OPEN` and `SSL_RENEGOTIATE` events; otherwise, an error will occur.
- **hasClientExtension(extension_name | extension_id): boolean**: Returns

`true`

for the specified extension if the extension was passed as part of the

`Hello`

message from the client.

Call only on `SSL_OPEN` and `SSL_RENEGOTIATE` events; otherwise, an error will occur.
- **hasServerExtension(extension_name | extension_id): boolean**: Returns

`true`

for the specified extension if the extension was passed as part of the

`Hello`

message from the server.

Call only on `SSL_OPEN` and `SSL_RENEGOTIATE` events; otherwise, an error will occur.

The following table provides a list of known TLS extensions.

| ID | Name |
| --- | --- |
| `0` | `server_name` |
| `1` | `max_fragment_length` |
| `2` | `client_certificate_url` |
| `3` | `trusted_ca_keys` |
| `4` | `truncated_hmac` |
| `5` | `status_request` |
| `6` | `user_mapping` |
| `7` | `client_authz` |
| `8` | `server_authz` |
| `9` | `cert_type` |
| `10` | `supported_groups` |
| `11` | `ec_point_formats` |
| `12` | `srp` |
| `13` | `signature_algorithms` |
| `14` | `use_srtp` |
| `15` | `heartbeat` |
| `16` | `application_layer_protocol_negotiation` |
| `17` | `status_request_v2` |
| `18` | `signed_certificate_timestamp` |
| `19` | `client_certificate_type` |
| `20` | `server_certificate_type` |
| `27` | `compress_certificate` |
| `28` | `record_size_limit` |
| `29` | `pwd_protect` |
| `30` | `pwd_clear` |
| `31` | `password_salt` |
| `35` | `session_ticket` |
| `41` | `pre_shared_key` |
| `42` | `early_data` |
| `43` | `supported_versions` |
| `44` | `cookie` |
| `45` | `psk_key_exchange_modes` |
| `47` | `certificate_authorities` |
| `48` | `oid_filters` |
| `49` | `post_handshake_auth` |
| `50` | `signature_algorithms_cert` |
| `51` | `key_share` |
| `65281` | `renegotiation_info` |
| `65486` | `encrypted_server_name` |

The following extensions are sent out by applications to test whether servers can handle unknown extensions. For more information about these extensions, see [Applying GREASE to TLS Extensibility](https://tools.ietf.org/html/draft-davidben-tls-grease-01).

- `2570`
- `6682`
- `10794`
- `14906`
- `19018`
- `23130`
- `27242`
- `31354`
- `35466`
- `39578`
- `43690`
- `47802`
- `51914`
- `56026`
- `60138`
- `64250`

#### Properties

- **alertCode: Number**: The numeric representation of the TLS alert. The following table displays the possible TLS alerts, which are defined in the

`AlertDescription`

data structure in RFC 2246:

| Alert | Number |
| --- | --- |
| `close_notify` | `0` |
| `unexpected_message` | `10` |
| `bad_record_mac` | `20` |
| `decryption_failed` | `21` |
| `record_overflow` | `22` |
| `decompression_failure` | `30` |
| `handshake_failure` | `40` |
| `bad_certificate` | `42` |
| `unsupported_certificate` | `43` |
| `certificate_revoked` | `44` |
| `certificate_expired` | `45` |
| `certificate_unknown` | `46` |
| `illegal_parameter` | `47` |
| `unknown_ca` | `48` |
| `access_denied` | `49` |
| `decode_error` | `50` |
| `decrypt_error` | `51` |
| `export_restriction` | `60` |
| `protocol_version` | `70` |
| `insufficient_security` | `71` |
| `internal_error` | `80` |
| `user_canceled` | `90` |
| `no_renegotiation` | `100` |

If the session is opaque, the value is `SSL.ALERT_CODE_UNKNOWN (null)`.

Access only on `SSL_ALERT` events; otherwise, an error will occur.
- **alertCodeName: String**: The name of the TLS alert associated with the alert code. See the

`alertCode`

property for alert names associated with alert codes. The value is

`null`

if no name is available for the associated alert code.

Access only on `SSL_ALERT` events; otherwise, an error will occur.
- **alertLevel: Number**: The numeric representation of the TLS alert level. The following possible alert levels are defined in the

`AlertLevel`

data structure in RFC 2246:

- `warning (1)`
- `fatal (2)`

If the session is opaque, the value is `SSL.ALERT_LEVEL_UNKNOWN (null)`.

Access only on `SSL_ALERT` events; otherwise, an error will occur.
- **certificate: SSLCert**: The TLS server certificate object associated with the communication. Each object contains the following properties:

- **authorityInfoAccess: Object**: An object that contains information from the Authority Information Access extension, which specifies information about the certificate authority (CA). The object contains the following fields:

- **location: String**: The URL of the Online Certificate Status Protocol (OCSP) Responder that can verify whether the certificate is valid.
- **method: String**: The OID of the method that the certificate issuer can be accessed with.
- **authorityKeyIdentifier: String | Null**: The identifier for the public key of the certificate authority (CA), expressed as an octet string.

| Note: | This field does not contain the authority certification issuer or serial number. |
| --- | --- |
- **basicConstraints: Object**: An object that contains information from the Basic Constraints extension, which specifies the type of certificate subject. The object contains the following fields:

- **ca: Boolean**: Indicates whether the subject of the certificate is a CA.
- **pathlen: Number**: The maximum number of certificates that can appear in the certificate chain after this certificate.
- **certificatePolicies: Array of Strings**: An array of OIDs for the policies specified in the Certificate Policies extension. Qualifiers are not included in this array.
- **crlDistributionPoints: Array of Strings**: An array of objects that contain information about servers that host certificate revocation lists (CRLs) for the server certificate. The servers are specified in the CRL distribution point (CDP) extension. Each object contains the following fields:

- **crlIssuer: Array of Strings**: An array of locations where the certificate of the CRL issuer can be retrieved.
- **distPoint: Array of Strings**: An array of locations where the CRL can be retrieved.
- **reasons: Array of Strings**: An array of reason codes that indicate the reasons that the certificate could be revoked by the CRL distribution point.
- **extensionOIDs: Array of Strings**: An array of OIDs for the X509 extensions specified in the certificate.
- **extendedKeyUsage: Array of Strings**: An array of uses for the public key of the server certificate specified in the Extended Key Usage extension. The array can contain the following strings:

- `serverAuth`
- `clientAuth`
- `emailProtection`
- `codeSigning`
- `OCSPSigning`
- `timeStamping`
- `anyExtendedKeyUsage`
- `nsSGC`
- **fingerprint: String**: The hexadecimal representation of the SHA-1 hash of the certificate. The string contains no delimiters, as shown in the following example:

```javascript
55F30E6D49E19145CF680E8B7E3DC8FC7041DC81
```

The SHA-1 certificate hash appears in the server certificate dialog box of most browsers.
- **fingerprintSHA256: String**: The hexadecimal representation of the SHA-256 hash of the certificate. The string contains no delimiters, as shown in the following example:

```javascript
468C6C84DB844821C9CCB0983C78D1CC05327119B894B5CA1C6A1318784D3675
```

The SHA-256 certificate hash appears in the server certificate dialog box of most browsers.
- **getExtensionDataByOID(extension_oid): Buffer**: Method that returns a buffer object containing the value of the specified extension, expressed as an octet string. Returns null if the OID does not exist or the server certificate does not contain the extension.
- **inhibitAnyPolicy: Number**: The number specified in the Inhibit anyPolicy extension, which limits the number of certificates that the anyPolicy extension is applied to. The number specifies how many additional, non-self-issued certificates in the chain are affected by the anyPolicy extension.
- **isSelfSigned: Boolean**: The value is

`true`

if the server certificate is self-signed.
- **issuer: String**: The common name of the server certificate issuer. The value is

`null`

if the issuer is not available.
- **issuerAlternativeNames: Array of Strings**: An array of Issuer Alternative Names (IANs) specified in the server certificate.
- **issuerDistinguishedName: Object**: An object that contains information about the distinguished name of the certificate issuer. Each object contains the following properties:

- **commonName: String**: The common name (CN).
- **country: Array of Strings**: The country name (C).
- **emailAddress: String**: The email address.
- **organization: Array of Strings**: The organization name (O).
- **organizationalUnit: Array of Strings**: The organizational unit name (OU).
- **locality: Array of Strings**: The locality name (L).
- **stateOrProvince: Array of Strings**: The state or province name (ST).
- **keySize: Number**: The key size of the server certificate.
- **keyUsage: Array of Strings**: An array of uses for the public key of the server certificate specified in the Key Usage extension. The array can contain the following strings:

- `digitalSignature`
- `nonRepudiation`
- `keyEncipherment`
- `dataEncipherment`
- `keyAgreement`
- `keyCertSign`
- `cRLSign`
- `encipherOnly`
- `decipherOnly`
- **notAfter: Number**: The expiration time of the server certificate, expressed in UTC.
- **notBefore: Number**: The start time of the server certificate, expressed in UTC. The server certificate is not valid before this time.
- **nsComment: String**: The comment specified in the Netscape Comment extension. This comment is sometimes displayed in browsers when users view the server certificate.
- **ocspNoCheck: Boolean**: Indicates whether the signing certificate can be trusted without verification from the OCSP responder.
- **payload: Buffer**: The

[Buffer](#buffer)

object that contains the raw payload bytes of the server certificate.
- **policyConstraints: Object**: An object that contains information from the Policy Constraints extension, which specifies validation constraints for CA certificates.

- **requireExplicitPolicy: Number**: Specifies the maximum number of adjacent certificates in the chain that do not need to specify an explicit policy.
- **inhibitPolicyMapping: Number**: Specifies the maximum number of adjacent certificates in the certificate chain before policy mappings are ignored.
- **policyMappings: Array of Objects**: An array of objects that contains information from the Policy Mappings extension, which indicates policies that are equivalent to each other. Each object contains the following fields.

- **issuerDomainPolicy: String**: The OID of the issuer policy.
- **subjectDomainPolicy: String**: The OID of the subject policy.
- **publicKeyCurveName: String**: The name of the standard elliptic curve that the cryptography of the public key is based on. This value is determined by the OID or explicit curve parameters specified in the certificate.
- **publicKeyExponent: String | Null**: A string hex representation of the public key exponent. The string is shown in the client certificate dialog box of most browsers, but without spaces.
- **publicKeyHasExplicitCurve: Boolean | Null**: Indicates whether the certificate specifies explicit parameters for the elliptic curve of the public key.
- **publicKeyModulus: String | Null**: A string hex representation of the public key modulus. The string is shown in the client certificate dialog box of most browsers, but without space, such as

`010001`
- **serial: String | Null**: The serial number assigned to the certificate by the Certificate Authority (CA).
- **signatureAlgorithm: String | Null**: The algorithm applied to sign the server certificate. The following table displays some of the possible values:

| RFC | Algorithm |
| --- | --- |
| `RFC 3279` | `md2WithRSAEncryption` `md5WithRSAEncryption` `sha1WithRSAEncryption` |
| `RFC 4055` | `sha224WithRSAEncryption` `sha256WithRSAEncryption` \ `sha384WithRSAEncryption` `sha512WithRSAEncryption` |
| `RFC 4491` | `id-GostR3411-94-with-Gost3410-94` `id-GostR3411-94-with-Gost3410-2001` |
- **subject: String**: The subject common name (CN) of the server certificate.
- **subjectAlternativeNames: Array**: An array of strings that correspond to Subject Alternative Names (SANs) included in the server certificate. Supported SANs are DNS names, email addresses, URIs, and IP addresses.
- **subjectDistinguishedName: Object**: An object that contains information about the distinguished name of the certificate subject. Each object contains the following properties:

- **commonName: String**: The common name (CN).
- **country: Array of Strings**: The country name (C).
- **emailAddress: String**: The email address.
- **organization: Array of Strings**: The organization name (O).
- **organizationalUnit: Array of Strings**: The organizational unit name (OU).
- **locality: Array of Strings**: The locality name (L).
- **stateOrProvince: Array of Strings**: The state or province name (ST).
- **subjectKeyIdentifier: String**: The identifier for the public key of the certificate subject, expressed as an octet string.
- **certificates: Array of Objects**: An array of certificate objects for each intermediate TLS certificate. The end-entity certificate, also known as the leaf certificate, is the first object in the array; this object is also returned by the

`certificate`

property.
- **cipherSuite: String**: A string representing the cryptographic cipher suite negotiated between the server and the client.
- **cipherSuitesHex: String**: A hexadecimal representation of the cryptographic cipher suite negotiated between the server and the client.
- **cipherSuitesSupported: Array of Objects | Null**: An array of objects with the following properties that specify the cipher suites supported by the TLS client:

- **name: String**: The name of cipher suite.
- **type: Number**: The cipher suite number.

Access only on `SSL_OPEN` or `SSL_RENEGOTIATE` events; otherwise, an error will occur.
- **cipherSuiteType: Number**: The numeric value that represents the cryptographic cipher suite negotiated between the server and the client. Possible values are defined by the IANA TLS Cipher Suite Registry.
- **clientBytes: Number**: The total number of bytes sent by the client since the last

`SSL_RECORD`

event ran. Note that this property does not return the total number of bytes for the entire SSL session.

Access only on `SSL_RECORD` or `SSL_CLOSE` events; otherwise, an error will occur.
- **clientCertificate: SSLCert**: The TLS client certificate object associated with the communication. Each object contains the following properties:

- **authorityInfoAccess: Object**: An object that contains information from the Authority Information Access extension, which specifies information about the certificate authority (CA). The object contains the following fields:

- **location: String**: The URL of the Online Certificate Status Protocol (OCSP) Responder that can verify whether the certificate is valid.
- **method: String**: The OID of the method that the certificate issuer can be accessed with.
- **authorityKeyIdentifier: String | Null**: The identifier for the public key of the certificate authority (CA), expressed as an octet string.

| Note: | This field does not contain the authority certification issuer or serial number. |
| --- | --- |
- **basicConstraints: Object**: An object that contains information from the Basic Constraints extension, which specifies the type of certificate subject. The object contains the following fields:

- **ca: Boolean**: Indicates whether the subject of the certificate is a CA.
- **pathlen: Number**: The maximum number of certificates that can appear in the certificate chain after this certificate.
- **certificatePolicies: Array of Strings**: An array of OIDs for the policies specified in the Certificate Policies extension. Qualifiers are not included in this array.
- **crlDistributionPoints: Array of Strings**: An array of objects that contain information about servers that host certificate revocation lists (CRLs) for the client certificate. The servers are specified in the CRL distribution point (CDP) extension. Each object contains the following fields:

- **crlIssuer: Array of Strings**: An array of locations where the certificate of the CRL issuer can be retrieved.
- **distPoint: Array of Strings**: An array of locations where the CRL can be retrieved.
- **reasons: Array of Strings**: An array of reason codes that indicate the reasons that the certificate could be revoked by the CRL distribution point.
- **extensionOIDs: Array of Strings**: An array of OIDs for the X509 extensions specified in the client certificate.
- **extendedKeyUsage: Array of Strings**: An array of uses for the public key of the client certificate specified in the Extended Key Usage extension. The array can contain the following strings:

- `serverAuth`
- `clientAuth`
- `emailProtection`
- `codeSigning`
- `OCSPSigning`
- `timeStamping`
- `anyExtendedKeyUsage`
- `nsSGC`
- **fingerprint: String**: The hexadecimal representation of the SHA-1 hash of the client certificate. The string contains no delimiters, as shown in the following example:

```javascript
55F30E6D49E19145CF680E8B7E3DC8FC7041DC81
```
- **fingerprintSHA256: String**: The hexadecimal representation of the SHA-256 hash of the client certificate. The string contains no delimiters, as shown in the following example:

```javascript
468C6C84DB844821C9CCB0983C78D1CC05327119B894B5CA1C6A1318784D3675
```
- **getExtensionDataByOID(extension_oid): Buffer**: Method that returns a buffer object containing the value of the specified extension, expressed as an octet string. Returns null if the OID does not exist or the client certificate does not contain the extension.
- **keySize: Number**: The key size of the client certificate.
- **keyUsage: Array of Strings**: An array of uses for the public key of the client certificate specified in the Key Usage extension. The array can contain the following strings:

- `digitalSignature`
- `nonRepudiation`
- `keyEncipherment`
- `dataEncipherment`
- `keyAgreement`
- `keyCertSign`
- `cRLSign`
- `encipherOnly`
- `decipherOnly`
- **inhibitAnyPolicy: Number**: The number specified in the Inhibit anyPolicy extension, which limits the number of certificates that the anyPolicy extension is applied to. The number specifies how many additional, non-self-issued certificates in the chain are affected by the anyPolicy extension.
- **isSelfSigned: Boolean**: The value is

`true`

if the client certificate is self-signed.
- **issuer: String | Null**: The common name of the client certificate issuer. The value is

`null`

if the issuer is not available.
- **issuerDistinguishedName: Object**: An object that contains information about the distinguished name of the certificate issuer. Each object contains the following properties:

- **commonName: String**: The common name (CN).
- **country: Array of Strings**: The country name (C).
- **emailAddress: String**: The email address.
- **organization: Array of Strings**: The organization name (O).
- **organizationalUnit: Array of Strings**: The organizational unit name (OU).
- **locality: Array of Strings**: The locality name (L).
- **stateOrProvince: Array of Strings**: The state or province name (ST).
- **issuerAlternativeNames: Array of Strings**: An array of Issuer Alternative Names (IANs) specified in the client certificate.
- **notAfter: Number**: The expiration time of the client certificate, expressed in UTC.
- **notBefore: Number**: The start time of the client certificate, expressed in UTC. The client certificate is not valid before this time.
- **nsComment: String**: The comment specified in the Netscape Comment extension. This comment is sometimes displayed in browsers when users view the client certificate.
- **ocspNoCheck: Boolean**: Indicates whether the signing certificate can be trusted without verification from the OCSP responder.
- **payload: Buffer**: The

[Buffer](#buffer)

object that contains the raw payload bytes of the client certificate.
- **policyConstraints: Object**: An object that contains information from the Policy Constraints extension, which specifies validation constraints for CA certificates.

- **requireExplicitPolicy: Number**: Specifies the maximum number of adjacent certificates in the chain that do not need to specify an explicit policy.
- **inhibitPolicyMapping: Number**: Specifies the maximum number of adjacent certificates in the certificate chain before policy mappings are ignored.
- **publicKeyCurveName: String**: The name of the standard elliptic curve that the cryptography of the public key is based on. This value is determined by the OID or explicit curve parameters specified in the certificate.
- **publicKeyExponent: String | Null**: A string hex representation of the public key exponent.
- **publicKeyHasExplicitCurve: Boolean | Null**: Indicates whether the certificate specifies explicit parameters for the elliptic curve of the public key.
- **publicKeyModulus: String | Null**: A string hex representation of the public key modulus, such as

`010001`

.
- **policyMappings: Array of Objects**: An array of objects that contains information from the Policy Mappings extension, which indicates policies that are equivalent to each other. Each object contains the following fields.

- **issuerDomainPolicy: String**: The OID of the issuer policy.
- **subjectDomainPolicy: String**: The OID of the subject policy.
- **signatureAlgorithm: String | Null**: The algorithm applied to sign the client certificate. The following table displays some of the possible values:

| RFC | Algorithm |
| --- | --- |
| `RFC 3279` | `md2WithRSAEncryption` `md5WithRSAEncryption` `sha1WithRSAEncryption` |
| `RFC 4055` | `sha224WithRSAEncryption` `sha256WithRSAEncryption` `sha384WithRSAEncryption` `sha512WithRSAEncryption` |
| `RFC 4491` | `id-GostR3411-94-with-Gost3410-94` `id-GostR3411-94-with-Gost3410-2001` |
- **subject: String**: The subject common name (CN) of the client certificate.
- **subjectAlternativeNames: Array**: An array of strings that correspond to Subject Alternative Names (SANs) included in the client certificate. Supported SANs are DNS names, email addresses, URIs, and IP addresses.
- **subjectDistinguishedName: Object**: An object that contains information about the distinguished name of the certificate subject. Each object contains the following properties:

- **commonName: String**: The common name (CN).
- **country: Array of Strings**: The country name (C).
- **emailAddress: String**: The email address.
- **organization: Array of Strings**: The organization name (O).
- **organizationalUnit: Array of Strings**: The organizational unit name (OU).
- **locality: Array of Strings**: The locality name (L).
- **stateOrProvince: Array of Strings**: The state or province name (ST).
- **subjectKeyIdentifier: String**: The identifier for the public key of the client certificate subject, expressed as an octet string.
- **clientCertificates: Array of Objects**: An array of certificate objects for each intermediate TLS client certificate. The end-entity certificate, also known as the leaf certificate, is the first object in the array; this object is also returned by the

`clientCertificate`

property.
- **clientCertificateRequested: Boolean**: The value is

`true`

if the TLS server requested a client certificate.

Access only on `SSL_OPEN`, `SSL_ALERT`, or `SSL_RENEGOTIATE` events; otherwise, an error will occur.
- **clientExtensions: Array | Null**: An array of client extension objects that contain the following properties:

- **id: Number**: The ID number of the TLS client extension.
- **length: Number**: The full length of the TLS client extension, expressed in bytes.

| Note: | An extension might be truncated if the length exceeds the maximum size. The default is 512 bytes. Truncation has occurred if the value of this property is smaller than the buffer returned by the `getClientExtensionData()` method. |
| --- | --- |
- **name: String**: The name of the TLS client extension, if known. Otherwise, the value indicates that the extension is unknown. See the table of known TLS extensions in the

[Methods section](#methods-273)

.

Access only on `SSL_OPEN` or `SSL_RENEGOTIATE` events; otherwise, an error will occur.
- **clientExtensionsHex: String**: A hexadecimal representation of the sorted list of client extensions.

| Note: | The Generate Random Extensions And Sustain Extensibility (GREASE) values are removed from the list before encoding. |
| --- | --- |

Access only on `SSL_OPEN` and `SSL_RENEGOTIATE` events; otherwise, an error will occur.
- **clientHelloVersion: Number**: The version of TLS specified by the client in the client hello packet.
- **clientL2Bytes: Number**: The total number of

L2

client bytes observed since the last

`SSL_RECORD`

event ran. Note that this property does not return the total number of bytes for the entire SSL session.

Access only on `SSL_RECORD` or `SSL_CLOSE` events; otherwise, an error will occur.
- **clientPkts: Number**: The total number of packets sent by the client since the last

`SSL_RECORD`

event ran. Note that this property does not return the total number of packets for the entire SSL session.

Access only on `SSL_RECORD` or `SSL_CLOSE` events; otherwise, an error will occur.
- **clientSessionId: String**: The client session ID as a byte array encoded as a string.
- **clientZeroWnd: Number**: The total number of zero windows sent by the client since the last

`SSL_RECORD`

event ran. Note that this property does not return the total number of zero windows for the entire SSL session.

Access only on `SSL_RECORD` or `SSL_CLOSE` events; otherwise, an error will occur.
- **contentType: String**: The content type for the current record.

Access only on `SSL_RECORD` events; otherwise, an error will occur.
- **ecPointFormatsHex: String**: A hexadecimal representation of the elliptic-curve point formats that the client can parse.

Access only on `SSL_OPEN` and `SSL_RENEGOTIATE` events; otherwise, an error will occur.
- **encryptionProtocol: String**: The TLS protocol version that the transaction is encrypted with.
- **handshakeTime: Number**: The amount of time required to negotiate the TLS connection, expressed in milliseconds. Specifically, the amount of time between when the client sends a

`ClientHello`

message and the server sends

`ChangeCipherSpec`

values as specified in RFC 2246.

Access only on `SSL_OPEN` or `SSL_RENEGOTIATE` events; otherwise, an error will occur.
- **heartbeatPayloadLength: Number**: The value of the payload length field of the HeartbeatMessage data structure as specified in RFC 6520.

Access only on `SSL_HEARTBEAT` events; otherwise, an error will occur.
- **heartbeatType: Number**: The numeric representation of the HeartbeatMessageType field of the HeartbeartMessage data structure as specified in RFC 6520. Valid values are

`SSL.HEARTBEAT_TYPE_REQUEST (1)`

,

`SSL.HEARTBEAT_TYPE_RESPONSE (2)`

, or

`SSL.HEARTBEAT_TYPE_UNKNOWN (255)`

.

Access only on `SSL_HEARTBEAT` events; otherwise, an error will occur.
- **host: String | Null**: The TLS Server Name Indication (SNI), if available.

Access only on `SSL_OPEN` or `SSL_RENEGOTIATE` events; otherwise, an error will occur.
- **isAborted: Boolean**: The value is

`true`

if the TLS session is aborted.

Access only on `SSL_CLOSE`, `SSL_OPEN`, and `SSL_RENEGOTIATE` events; otherwise, an error will occur.
- **isCompressed: Boolean**: The value is

`true`

if the TLS record is compressed.
- **isDecrypted: Boolean**: The value is

`true`

if the ExtraHop system securely decrypted and analyzed the transaction. Decrypted traffic analysis can expose advanced threats that hide within encrypted traffic.
- **isEncrypted: Boolean**: The value is

`true`

if the TLS connection is encrypted.
- **isPostQuantumKeyAgreement: Boolean**: Indicates whether the TLS session was encrypted with a post-quantum cryptography (PQC) algorithm. PQC is designed to resist attacks from quantum computers.
- **isResumed: Boolean**: The value is

`true`

if the connection is resumed from an existing TLS session and is not a new TLS session.

Access only on `SSL_OPEN`, `SSL_CLOSE`, `SSL_ALERT`, `SSL_HEARTBEAT`, or `SSL_RENEGOTIATE` events; otherwise, an error will occur.
- **isStartTLS: Boolean**: The value is

`true`

if negotiation of the TLS session was initiated by the STARTTLS mechanism of the protocol.

Access only on `SSL_OPEN`, `SSL_CLOSE`, `SSL_ALERT`, `SSL_HEARTBEAT`, or `SSL_RENEGOTIATE` events; otherwise, an error will occur.
- **isV2ClientHello: Boolean**: The value is

`true`

if the Hello record corresponds to SSLv2.
- **isWeakCipherSuite: Boolean**: The value is

`true`

if the cipher suite encrypting the TLS session is considered weak. NULL, anonymous, and EXPORT cipher suites are considered weak, as are suites that encrypt with CBC, DES, 3DES, MD5, or RC4.

Access only on `SSL_OPEN`, `SSL_CLOSE`, `SSL_ALERT`, `SSL_HEARTBEAT`, or `SSL_RENEGOTIATE` events; otherwise, an error will occur.
- **ja3Text: String | Null**: The complete JA3 string for the client, including the client hello TLS version, accepted ciphers, SSL extensions, elliptic curves, and elliptic curve formats.
- **ja3Hash: String | Null**: The MD5 hash of the JA3 string for the client.
- **ja3sText: String | Null**: The complete JA3S string for the server, including the server hello SSL version, accepted ciphers, and TLS extensions.
- **ja3sHash: String | Null**: The MD5 hash of the JA3S string for the server.
- **ja4Fingerprint: String | Null**: The complete JA4 fingerprint for the client, which includes the following information:

- The transport layer (L4) protocol
- The TLS version
- Whether the Server Name Indicator (SNI) extension was specified
- The number of cipher suites
- The number of extensions
- The first Application Layer Protocol Negotiation (ALPN) value listed
- The truncated SHA256 hash of cipher suites
- The truncated SHA256 hash of extensions

Access only on `SSL_OPEN` or `SSL_RENEGOTIATE` events; otherwise, an error will occur.
- **ja4Server: String**: The complete JA4 fingerprint for the server, which includes the following information:

- The transport layer (L4) protocol
- The TLS version
- The number of extensions
- The selected Application Layer Protocol Negotiation (ALPN) value
- The selected cipher suite
- The truncated SHA256 hash of extensions

Access only on `SSL_OPEN` or `SSL_RENEGOTIATE` events; otherwise, an error will occur.
- **ja4X509: String**: The JA4X fingerprint for the TLS server certificate, which includes SHA-256 hashes of the following information:

- The Relative Distinguished Names (RDN) of the certificate issuer
- The RDNs of the certificate subject
- The certificate extensions
- **keyAgreement: String**: The details of the key agreement or exchange algorithm established for the TLS session. For the RSA algorithm, the property specifies the key size (

`RSA-2048`

). For the Elliptic-Curve Diffe-Hellman Ephemeral (ECDHE) algorithm, the property specifies the key-exchange group (

`ECDHE-secp256r1`

). For post-quantum cryptography (PQC) algorithms, the property specifies that the algorithm includes PQC (

`PQC-ECDHE-Kyber-768-X25519`

).
- **privateKeyId: String | Null**: The string ID associated with the private key if the ExtraHop system is decrypting TLS traffic. The value is

`null`

if the ExtraHop system is not decrypting SSL traffic.

To find the private key ID in the Administration settings, click Capture from the System Configuration section, click SSL Decryption, and then click a certificate. The pop-up window displays all identifiers for the certificate.
- **record: Object**: The record object that can be sent to the configured recordstore through a call to

`SSL.commitRecord()`

on either an

`SSL_OPEN`

,

`SSL_CLOSE`

,

`SSL_ALERT`

,

`SSL_HEARTBEAT`

, or

`SSL_RENEGOTIATE`

event.

The event on which the method was called determines which properties the default record object can contain as displayed in the following table:

| Event | Available properties |
| --- | --- |
| `SSL_ALERT` | `alertCode` `alertLevel` `certificateFingerprint` `certificateIsSelfSigned` `certificateIssuer` `certificateKeySize` `certificateNotAfter` `certificateNotBefore` `certificateSignatureAlgorithm` `certificateSubject` `cipherSuite` `clientAddr` `clientBytes` `clientCertificateRequested` `clientIsExternal` `clientL2Bytes` `clientPkts` `clientPort` `clientRTO` `clientZeroWnd` `isCompressed` `isWeakCipherSuite` `proto` `receiverIsExternal` `reqBytes` `reqL2Bytes` `reqPkts` `reqRTO` `rspBytes` `rspL2Bytes` `rspPkts` `rspRTO` `senderIsExternal` `serverAddr` `serverBytes` `serverIsExternal` `serverL2Bytes` `serverPkts` `serverPort` `serverRTO` `serverZeroWnd` `version` |
| `SSL_CLOSE` | `certificateIsSelfSigned` `certificateIssuer` `certificateFingerprint` `certificateKeySize` `certificateNotAfter` `certificateNotBefore` `certificateSignatureAlgorithm` `certificateSubject` `cipherSuite` `clientAddr` `clientBytes` `clientIsExternal` `clientL2Bytes` `clientPkts` `clientPort` `clientRTO` `clientZeroWnd` `isAborted` `isCompressed` `isWeakCipherSuite` `proto` `receiverIsExternal` `reqBytes` `reqPkts` `reqL2Bytes` `reqRTO` `rspBytes` `rspL2Bytes` `rspPkts` `rspRTO` `senderIsExternal` `serverAddr` `serverBytes` `serverIsExternal` `serverL2Bytes` `serverPkts` `serverPort` `serverRTO` `serverZeroWnd` `version` |
| `SSL_HEARTBEAT` | `certificateFingerprint` `certificateIssuer` `certificateKeySize` `certificateNotAfter` `certificateNotBefore` `certificateSignatureAlgorithm` `certificateSubject` `cipherSuite` `clientIsExternal` `clientZeroWnd` `heartbeatPayloadLength` `heartbeatType` `isCompressed` `receiverIsExternal` `senderIsExternal` `serverIsExternal` `serverZeroWnd` `version` |
| `SSL_OPEN` | `certificateFingerprint` `certificateIsSelfSigned` `certificateIssuer` `certificateKeySize` `certificateNotAfter` `certificateNotBefore` `certificateSignatureAlgorithm` `certificateSubject` `certificateSubjectAlternativeNames` `cipherSuite` `clientAddr` `clientAlpn` `clientBytes` `clientCertificateRequested` `clientIsExternal` `clientL2Bytes` `clientPkts` `clientPort` `clientRTO` `clientZeroWnd` `handshakeTime` `host` `isAborted` `isCompressed` `isPostQuantumKeyAgreement` `isRenegotiate` `isWeakCipherSuite` `ja3Hash` `ja3sHash` `ja4Fingerprint` `keyAgreement` `proto` `receiverIsExternal` `reqBytes` `reqL2Bytes` `reqPkts` `reqRTO` `rspBytes` `rspL2Bytes` `rspPkts` `rspRTO` `senderIsExternal` `serverAddr` `serverAlpn` `serverBytes` `serverIsExternal` `serverL2Bytes` `serverPkts` `serverPort` `serverRTO` `serverZeroWnd` `version` |
| `SSL_RENEGOTIATE`Note:The `SSL_OPEN` record format is applied to records committed on this event. | `certificateFingerprint` `certificateKeySize` `certificateNotAfter` `certificateNotBefore` `certificateSignatureAlgorithm` `certificateSubject` `cipherSuite` `clientAlpn` `clientIsExternal` `handshakeTime` `host` `isAborted` `isCompressed` `receiverIsExternal` `senderIsExternal` `serverAlpn` `serverIsExternal` `version` |
| Note: | The `SSL_OPEN` record format is applied to records committed on this event. |
- **recordLength: Number**: The value of the length field of the

`TLSPlaintext`

,

`TLSCompressed`

, and

`TLSCiphertext`

data structures as specified in RFC 5246.

Access only on `SSL_RECORD`, `SSL_ALERT`, or `SSL_HEARTBEAT` events; otherwise, an error will occur.
- **recordType: Number**: The numeric representation of the type field of the

`TLSPlaintext`

,

`TLSCompressed`

, and

`TLSCiphertext`

data structures as specified in RFC 5246.

Access only on `SSL_RECORD`, `SSL_ALERT`, and `SSL_HEARTBEAT` events; otherwise, an error will occur.
- **roundTripTime: Number**: The median round trip time (RTT), expressed in milliseconds.

An RTT is the time it took for a device to send a single TCP packet and receive an immediate corresponding acknowledgment (ACK) packet.

The median value is calculated by sampling the RTTs observed since the last

`SSL_ALERT`

,

`SSL_CLOSE`

,

`SSL_HEARTBEAT`

,

`SSL_OPEN`

,

`SSL_PAYLOAD`

,

`SSL_RECORD`

, or

`SSL_RENEGOTIATE`

event ran. The value is

`NaN`

if there are no RTT samples.

Access only on `SSL_RECORD` or `SSL_CLOSE` events; otherwise, an error will occur.
- **serverExtensions: Array | Null**: An array of server extension objects that contain the following properties:

- **id: Number**: The ID number of the TLS server extension.
- **length: Number**: The full length of the TLS server extension, expressed in bytes.

| Note: | An extension might be truncated if the length exceeds the maximum size. The default is 512 bytes. Truncation has occurred if the value of this property is smaller than the buffer returned by the `getClientExtensionData()` method. |
| --- | --- |
- **name: String**: The name of the TLS server extension, if known. Otherwise, the value indicates that the extension is unknown. See the table of known TLS extensions in the

[Methods section](#methods-273)

.

Access only on `SSL_OPEN` or `SSL_RENEGOTIATE` events; otherwise, an error will occur.
- **serverExtensionsHex: String**: A hexadecimal representation of the sorted list of server extensions.

| Note: | The Generate Random Extensions And Sustain Extensibility (GREASE) values are removed from the list before encoding. |
| --- | --- |

Access only on `SSL_OPEN` and `SSL_RENEGOTIATE` events; otherwise, an error will occur.
- **serverBytes: Number**: The total number of bytes sent by the server since the last

`SSL_RECORD`

event ran. Note that this property does not return the total number of bytes for the entire SSL session.

Access only on `SSL_RECORD` or `SSL_CLOSE` events; otherwise, an error will occur.
- **serverHelloVersion: Number**: The version of TLS specified by the server in the server hello packet.
- **serverL2Bytes: Number**: The total number of

L2

server bytes observed since the last

`SSL_RECORD`

event ran.Note that this property does not return the total number of bytes for the entire SSL session.

Access only on `SSL_RECORD` or `SSL_CLOSE` events; otherwise, an error will occur.
- **serverPkts: Number**: The total number of packets sent by the server since the last

`SSL_RECORD`

event ran. Note that this property does not return the total number of packets for the entire SSL session.

Access only on `SSL_RECORD` or `SSL_CLOSE` events; otherwise, an error will occur.
- **serverSessionId: String**: The server session ID byte array, encoded as a string.
- **serverZeroWnd: Number**: The total number of zero windows sent by the server since the last

`SSL_RECORD`

event ran. Note that this property does not return the total number of zero windows for the entire SSL session.

Access only on `SSL_RECORD` or `SSL_CLOSE` events; otherwise, an error will occur.
- **startTLSProtocol: String | Null**: The protocol from which the client sent a STARTTLS command.
- **supportedGroupsHex: String**: A hexadecimal representation of the elliptic-curve Diffie-Hellman (ECDH) groups that the client supports.

Access only on `SSL_OPEN` and `SSL_RENEGOTIATE` events; otherwise, an error will occur.
- **version: Number**: The TLS protocol version with the RFC hexadecimal version number, expressed as a decimal.

| Version | Hex | Decimal |
| --- | --- | --- |
| `SSLv2` | `0x200` | `2` |
| `SSLv3` | `0x300` | `768` |
| `TLS 1.0` | `0x301` | `769` |
| `TLS 1.1` | `0x302` | `770` |
| `TLS 1.2` | `0x303` | `771` |
| `TLS 1.3` | `0x304` | `772` |
