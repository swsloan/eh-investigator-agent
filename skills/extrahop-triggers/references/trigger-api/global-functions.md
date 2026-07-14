---
{
  "api_area": "trigger-api",
  "doc_kind": "reference_section",
  "name": "Global functions",
  "section": "global-functions",
  "source_url": "https://docs.extrahop.com/current/extrahop-trigger-api/",
  "source_version": "26.2"
}
---

## Global functions

Global functions can be called on any event.

- **cache(key: String, valueFn: () => Any): Any**: Caches the specified parameters in a table to enable efficient lookup and return of large data sets.

- **key: String**: An identifier that indicates the location of the cached value. A key must be unique within a trigger.
- **valueFn: () => Any**: A zero-argument function that returns a non-null value.

In the following example, the `cache()` method is called with large amounts of data hard-coded into the trigger script:

```javascript
let storeLookup = cache("storesByNumber", () => ({
    1 : "Newark",
    2 : "Paul",
    3 : "Newark",
    4 : "St Paul"// 620 lines omitted
}));

var storeCity;
var query = HTTP.parseQuery(HTTP.query);

if (query.storeCode) {
   storeCity = storeLookup[parseInt(query.storeCode)];
}
```

In the following example, a list of known user agents in a JBoss trigger is normalized before it is compared with the observed user agent. The trigger converts the list to lowercase and trims excess whitespace, and then caches the entries.

```javascript
function jbossUserAgents() {
    return [
        // Add your own user agents here, followed by a comma
        "Gecko-like (Edge 14.0; Windows 10; Silverlight or similar)",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_10_5) AppleWebKit/537.36 
         (KHTML, like Gecko) Chrome/51.0.2704.79 Safari/537.36",
        "Mozilla/5.0 (Android)"
    ].map(ua => ua.trim().toLowerCase());
}

var badUserAgents = cache("badUserAgents", jbossUserAgents);
```
- **commitDetection(type: String, options: Object)**: Generates a detection on the ExtraHop system.

- **type: String**: A user-defined type for the definition, such as

`brute_force_attack`

. You can

[tune detections](https://docs.extrahop.com/26.2/detections-manage)

to hide multiple detections with the same type. The string can only contain letters, numbers, and underscores.
- **options: Object**: An object that specifies the following properties for the detection:

- **title: String**: A user-defined title that identifies the detection.
- **description: String**: A description of the detection.
- **riskScore: Number | null**: An optional number between 1 and 99 that represents the risk score of the detection.
- **participants: Array of Objects**: An optional array of participant objects associated with the detection. Specify each participant as the offender or victim property of a Flow endpoint object. For example, the following code specifies the client in the flow as the offender and the server as the victim:

```javascript
commitDetection('exampledetection', {
     participants: [Flow.client.offender, Flow.server.victim],
```

The following participant objects are valid:

- `Flow.client.offender`
- `Flow.client.victim`
- `Flow.server.offender`
- `Flow.server.victim`
- `Flow.sender.offender`
- `Flow.sender.victim`
- `Flow.receiver.offender`
- `Flow.receiver.victim`
- **identityKey: String | null**: A unique identifier that enables ongoing detections. If multiple detections with the same identity key and detection type are generated within the time period specified by the

`identityTtl`

property, the detections are consolidated into a single ongoing detection.

| Note: | If a sensor is generating a large number of detections with unique identity keys, the sensor might fail to consolidate some ongoing detections. However, the sensor will not generate more than 250 individual detections for a trigger in a day. |
| --- | --- |
- **identityTtl: String**: The amount of time after a detection is generated that duplicate detections are consolidated into an ongoing detection.

After a detection is generated, if another detection with the same identity key and detection type is generated within the specified time period, the two detections are consolidated into a single ongoing detection. Each time a detection is consolidated into an ongoing detection, the time period is reset, and the detection does not end until the time period expires. For example, if `identityTtl` is set to `day`, and four duplicate detections are each generated 12 hours apart, the ongoing detection spans three days. The following time periods are valid:

- `hour`
- `day`
- `week`

The default time period is `hour`.
- **commitRecord(id: String, record: Object): void**: Sends a custom record object to the configured recordstore.

- **id: String**: The ID of the record type to be created. The ID cannot begin with a tilde (~).
- **record: Object**: An object containing a list of property and value pairs to be sent to the configured recordstore as a custom record.

The following properties are automatically added to records and are not represented on the objects returned by the built-in record accessors, such as `HTTP.record`:

- `ex`
- `flowID`
- `client`
- `clientAddr`
- `clientPort`
- `receiver`
- `receiverAddr`
- `receiverPort`
- `sender`
- `senderAddr`
- `senderPort`
- `server`
- `serverAddr`
- `serverPort`
- `timestamp`
- `vlan`

For example, to access the `flowID` property in an HTTP record, you would include `HTTP.record.Flow.id` in your statement.

| Important: | To avoid unexpected data in the record or an exception when the method is called, the property names listed above cannot be specified as a property name in custom records.In addition, a property name in custom records cannot contain any of the following characters: `.` Period `:` Colon `[` Square bracket `]` Square bracket |
| --- | --- |

In the following example, the two property and value pairs that have been added to the `record` variable are committed to a custom record by the `commitRecord()` function:

```javascript
var record = {
   'field1': myfield1,
   'field2': myfield2
};
commitRecord('record_type_id', record);
```

On most events, you can commit a built-in record that contains default properties. For example, a built-in record such as the `HTTP.record` object can be the basis for a custom record.

The following example code commits a custom record that includes all of the built-in metrics from the `HTTP.record` object and an additional metric from the `HTTP.headers` property:

```javascript
var record = Object.assign(
   {'server': HTTP.headers.server},
   HTTP.record
); 
commitRecord('custom-http-record', record);
```

You can access a built-in record object on the following events:

| Class | Events |
| --- | --- |
| [AAA](#aaa) | `AAA_REQUEST` `AAA_RESPONSE` |
| [ActiveMQ](#activemq) | `ACTIVEMQ_MESSAGE` |
| [AJP](#ajp) | `AJP_RESPONSE` |
| [CIFS](#cifs) | `CIFS_RESPONSE` |
| [DB](#db) | `DB_RESPONSE` |
| [DHCP](#dhcp) | `DHCP_REQUEST``DHCP_RESPONSE` |
| [DICOM](#dicom) | `DICOM_REQUEST``DICOM_RESPONSE` |
| [DNS](#dns) | `DNS_REQUEST``DNS_RESPONSE` |
| [FIX](#fix) | `FIX_REQUEST``FIX_RESPONSE` |
| [Flow](#flow) | `FLOW_RECORD` |
| [FTP](#ftp) | `FTP_RESPONSE` |
| [HL7](#hl7) | `HL7_RESPONSE` |
| [HTTP](#http) | `HTTP_RESPONSE` |
| [IBMMQ](#ibmmq) | `IBMMQ_REQUEST``IBMMQ_RESPONSE` |
| [ICA](#ica) | `ICA_OPEN``ICA_CLOSE` `ICA_TICK` |
| [ICMP](#icmp) | `ICMP_MESSAGE` |
| [Kerberos](#kerberos) | `KERBEROS_REQUEST``KERBEROS_RESPONSE` |
| [LDAP](#ldap) | `LDAP_REQUEST``LDAP_RESPONSE` |
| [Memcache](#memcache) | `MEMCACHE_REQUEST``MEMCACHE_RESPONSE` |
| [Modbus](#modbus) | `MODBUS_RESPONSE` |
| [MongoDB](#mongodb) | `MONGODB_REQUEST``MONGODB_RESPONSE` |
| [MSMQ](#msmq) | `MSMQ_MESSAGE` |
| [NetFlow](#netflow) | `NETFLOW_RECORD` |
| [NFS](#nfs) | `NFS_RESPONSE` |
| [NTLM](#ntlm) | `NTLM_MESSAGE` |
| [POP3](#pop3) | `POP3_RESPONSE` |
| [RDP](#rdp) | `RDP_OPEN``RDP_CLOSE` `RDP_TICK` |
| [Redis](#redis) | `REDIS_REQUEST``REDIS_RESPONSE` |
| [RTCP](#rtcp) | `RTCP_MESSAGE` |
| [RTP](#rtp) | `RTP_TICK` |
| [SCCP](#sccp) | `SCCP_MESSAGE` |
| [SFlow](#sflow) | `SFLOW_RECORD` |
| [SIP](#sip) | `SIP_REQUEST``SIP_RESPONSE` |
| [SMPP](#smpp) | `SMPP_RESPONSE` |
| [SMTP](#smtp) | `SMTP_RESPONSE` |
| [SSH](#ssh) | `SSH_OPEN``SSH_CLOSE` `SSH_TICK` |
| [SSL](#ssl) | `SSL_ALERT``SSL_OPEN` `SSL_CLOSE` `SSL_HEARTBEAT` `SSL_RENEGOTIATE` |
| [Telnet](#telnet) | `TELNET_MESSAGE` |
- **debug(message: String): void**: Writes to the

debug log

if debugging is enabled. The maximum message size is 2048 bytes. Messages longer than 2048 bytes are truncated.
- **getTimestamp(): Number**: Returns the timestamp from the packet that caused the trigger event to run, expressed in milliseconds with microseconds as the fractional segment after the decimal.
- **log(message: String): void**: Writes to the debug log regardless of whether debugging is enabled.

Multiple calls to debug and log statements in which the message is the same value will display once every 30 seconds.

The limit for debug log entries is 2048 bytes. To log larger entries, see [Remote.Syslog](#remotesyslog).
- **md5(message: String|Buffer): String**: Hashes the UTF-8 representation of the specified message

[Buffer](#buffer)

object or string and returns the MD5 sum of the string.
- **sha1(message: String|Buffer): String**: Hashes the UTF-8 representation of the specified message

[Buffer](#buffer)

object or string and returns the SHA-1 sum of the string.
- **sha256(message: String|Buffer): String**: Hashes the UTF-8 representation of the specified message

[Buffer](#buffer)

object or string and returns the SHA-256 sum of the string.
- **sha512(message: String|Buffer): String**: Hashes the UTF-8 representation of the specified message

[Buffer](#buffer)

object or string and returns the SHA-512 sum of the string.
- **uuid(): String**: Returns a random version 4 Universally Unique Identifier (UUID).
