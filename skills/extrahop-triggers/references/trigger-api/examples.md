---
{
  "api_area": "trigger-api",
  "doc_kind": "reference_section",
  "name": "Examples",
  "section": "examples-349",
  "source_url": "https://docs.extrahop.com/current/extrahop-trigger-api/",
  "source_version": "26.2"
}
---

## Examples

The following examples are available:

- [Example: Collect ActiveMQ metrics](#example-collect-activemq-metrics)
- [Example: Send data to Azure with Remote.HTTP](#example-send-data-to-azure-with-remotehttp)
- [Example: Monitor SMB actions on devices](#example-monitor-smb-actions-on-devices)
- [Example: Track 500-level HTTP responses by customer ID and URI](#example-track-500-level-http-responses-by-customer-id-and-uri)
- [Example: Collect response metrics on database queries](#example-collect-response-metrics-on-database-queries)
- [Example: Send discovered device data to a remote syslog server](#example-send-discovered-device-data-to-a-remote-syslog-server)
- [Example: Send data to Elasticsearch with Remote.HTTP](#example-send-data-to-elasticsearch-with-remotehttp)
- [Example: Access HTTP header attributes](#example-access-http-header-attributes)
- [Example: Collect IBMMQ metrics](#example-collect-ibmmq-metrics)
- [Example: Record Memcache hits and misses](#example-record-memcache-hits-and-misses)
- [Example: Parse memcache keys](#example-parse-memcache-keys)
- [Example: Add metrics to the metric cycle store](#example-add-metrics-to-the-metric-cycle-store)
- [Example: Parse NTP with universal payload analysis](#example-parse-ntp-with-universal-payload-analysis)
- [Example: Parse custom PoS messages with universal payload analysis](#example-parse-custom-pos-messages-with-universal-payload-analysis)
- [Example: Parse syslog over TCP with universal payload analysis](#example-parse-syslog-over-tcp-with-universal-payload-analysis)
- [Example: Record data to a session table](#example-record-data-to-a-session-table)
- [Example: Track SOAP requests](#example-track-soap-requests)
- [Example: Matching topnset keys](#example-matching-topnset-keys)
- [Example: Create an application container](#example-create-an-application-container)

### Example: Collect ActiveMQ metrics

The trigger in this example records destination information from the Java Messaging Service (JMS). The trigger creates an application and collects custom metrics that include the whether the broker of an event is the sender or receiver and the JMS destination field specified on that event.

Run the trigger on the following events: `ACTIVEMQ_MESSAGE`

```javascript
var app = Application("ActiveMQ Sample");
    if (ActiveMQ.senderIsBroker) {
       if (ActiveMQ.receiverIsBroker) {
          app.metricAddCount("amq_broker", 1);
          app.metricAddDetailCount("amq_broker", ActiveMQ.queue, 1);
       } 
       else {
          app.metricAddCount("amq_msg_out", 1);
          app.metricAddDetailCount("amq_msg_out", ActiveMQ.queue, 1);
       }
} 
else {
    app.metricAddCount("amq_msg_in", 1);
    app.metricAddDetailCount("amq_msg_in", ActiveMQ.queue, 1);
}
```

#### Related classes

- [ActiveMQ](#activemq)
- [Application](#application)

### Example: Send data to Azure with Remote.HTTP

The trigger in this example sends data to the Microsoft Azure Table storage service through an HTTP open data stream (ODS).

You must first configure an HTTP open data stream from the Administration settings before you create the trigger. The ODS configuration contains the authentication information required to sign in to your Microsoft Azure service. For configuration information, see [Configure an HTTP target for an open data stream](https://docs.extrahop.com/26.2/eh-admin-ui-guide/#configure-an-http-target-for-an-open-data-stream) in the [ExtraHop Admin UI Guide](https://docs.extrahop.com/26.2/eh-admin-ui-guide/).

Run the trigger on the following events: `HTTP_RESPONSE`

```javascript
// The name of the HTTP destination defined in the ODS config
var REST_DEST = "my_table_storage";

// The name of the table within Azure Table storage
var TABLE_NAME = "TestTable";

/* If the header is not set to this value, Azure expects to receive XML; 
 * however, it is easier for a trigger to send JSON.
 * The ODS config enables you to specify the datatype of fields; in this case
 * the timestamp (TS) field is a datetime even though it is serialized from a 
 * Date to a String.
 */

var headers = { "Content-Type": "application/json;odata=minimalmetadata" };

var now = new Date(getTimestamp());
var msg = {
    "RowKey":        now.getTime().toString(), // must be a string
    "PartitionKey":  "my_key", // must be a string
    "HTTPMethod":    HTTP.method,
    "DestAddr":      Flow.server.ipaddr,
    "SrcAddr":       Flow.client.ipaddr,
    "SrcPort":       Flow.client.port,
    "DestPort":      Flow.server.port,
    "TS@odata.type": "Edm.DateTime", // metadata to describe format of TS field
    "TS":            now.toISOString(),
    "ServerTime":    HTTP.processingTime,
    "RspTTLB":       HTTP.rspTimeToLastByte,
    "RspCode":       HTTP.statusCode.toString(),
    "URI":           "http://" + HTTP.host + HTTP.path,
};

// debug(JSON.stringify(msg));
Remote.HTTP(REST_DEST).post( { path: "/" + TABLE_NAME, headers: headers, payload:
JSON.stringify(msg) } );
```

#### Related classes

- [Remote.HTTP](#remotehttp)
- [Flow](#flow)
- [HTTP](#http)

### Example: Monitor SMB actions on devices

The trigger in this example monitors the SMB actions performed on devices, and then creates custom device metrics that collect the total number of bytes read and written, and the number of bytes written by SMB users that are not authorized to access a sensitive resource.

Run the trigger on the following events: `CIFS_RESPONSE`

```javascript
var client = Flow.client.device,
   server = Flow.server.device,
   clientAddress = Flow.client.ipaddr,
   serverAddress = Flow.server.ipaddr,
   file = CIFS.resource,
   user = CIFS.user,
   resource,
   permissions,
   writeBytes,
   readBytes;

// Resource to monitor
resource = "\\Clients\\Confidential\\";
// Users of interest and their permissions
permissions = {
   "\\\\EXTRAHOP\\tom" : {read: false, write: false},
   "\\\\Anonymous" : {read: true, write: false},
   "\\\\WORKGROUP\\maria" : {read: true, write: true}
};

// Check if this is an action on your monitored resource
if ((file !== null) && (file.indexOf(resource) !== -1)) {
   if (CIFS.isCommandWrite) {
      writeBytes = CIFS.reqSize;
      // Record bytes written
      Device.metricAddCount("cifs_write_bytes", writeBytes);
      Device.metricAddDetailCount("cifs_write_bytes", user, writeBytes);
      // Record number of writes
      Device.metricAddCount("cifs_writes", 1);
      Device.metricAddDetailCount("cifs_writes", user, 1);      
      // Record number of unauthorized writes
      if (!permissions[user] || !permissions[user].write) {
         Device.metricAddCount("cifs_unauth_writes", 1);
         Device.metricAddDetailCount("cifs_unauth_writes", user, 1);
      }
   }
   
   if (CIFS.isCommandRead) {
      readBytes = CIFS.reqSize;
      // Record bytes read
      Device.metricAddCount("cifs_read_bytes", readBytes);
      Device.metricAddDetailCount("cifs_read_bytes", user, readBytes);  
      // Record number of reads
      Device.metricAddCount("cifs_reads", 1);
      Device.metricAddDetailCount("cifs_reads", user, 1);     
      // Record number of unauthorized reads
      if (!permissions[user] || !permissions[user].read) {
         Device.metricAddCount("cifs_unauth_reads", 1);
         Device.metricAddDetailCount("cifs_unauth_reads", user, 1);
      }
   }
}
```

#### Related classes

- [CIFS](#cifs)
- [Device](#device)
- [Flow](#flow)

### Example: Track 500-level HTTP responses by customer ID and URI

The trigger in this example tracks HTTP server responses that result in an error code of 500. The trigger also creates custom device metrics that collect the customer ID and URI in the header of each 500 response.

Run the trigger on the following events: `HTTP_REQUEST` and `HTTP_RESPONSE`

```javascript
var custId,
   query,
   uri,
   key;

if (event === "HTTP_REQUEST") {
   custId = HTTP.headers["Cust-ID"];
   // Only keep the URI if there is a customer id
   if (custId !== null) {
      Flow.store.custId = custId;

      query = HTTP.query;

      /* Pull the complete URI (URI plus query string) and save it to
       * the Flow store for a subsequent response event.
       *
       * The query string data is only available on the request.
       */
      uri = HTTP.uri;
      if ((uri !== null) && (query !== null)) {
         uri = uri + "?" + query;
      }

      // Keep URIs for handling by HTTP_RESPONSE triggers
      Flow.store.uri = uri;
   }
} 
else if (event === "HTTP_RESPONSE") {
   custId = Flow.store.custId;

   // Count total requests by customer ID
   Device.metricAddCount("custid_rsp_count", 1);
   Device.metricAddDetailCount("custid_rsp_count_detail", custId, 1);

   // If the status code is 500 or 503, record the URI and customer ID
   if ((HTTP.statusCode === 500) || (HTTP.statusCode === 503)){
      // Combine URI and customer ID to create the detail key
      key = custId;
      if (Flow.store.uri != null) {
        key += ", " + Flow.store.uri;
      } 
      Device.metricAddCount("custid_error_count", 1);
      Device.metricAddDetailCount("custid_error_count_detail", key, 1);
   }
}
```

#### Related classes

- [HTTP](#http)
- [Flow](#flow)
- [Device](#device)

### Example: Collect response metrics on database queries

The trigger in this example creates custom device metrics that collect the number of responses and the processing times on database queries.

Run the trigger on the following events: `DB_RESPONSE`

```javascript
let stmt = DB.statement;
if (stmt === null) {
    return;
}

// Remove leading whitespace and truncate
stmt = stmt.trimLeft().substr(0, 1023);

// Record counts by statement
Device.metricAddCount("db_rsp_count", 1);
Device.metricAddDetailCount("db_rsp_count_detail", stmt, 1);

// Record processing times by statement
Device.metricAddSampleset("db_proc_time", DB.processingTime);
Device.metricAddDetailSampleset("db_proc_time_detail",
                                stmt, DB.processingTime);
```

#### Related classes

- [DB](#db)
- [Device](#device)

### Example: Send discovered device data to a remote syslog server

The trigger in this example discovers when a new device is detected on the ExtraHop system and creates remote syslog messages that contain device attributes.

You must first configure a remote open data stream from the Administration settings before you create the trigger. The ODS configuration specifies the location of the remote syslog server. For configuration information, see [Configure a syslog target for an open data stream](https://docs.extrahop.com/26.2/eh-admin-ui-guide/#configure-a-syslog-target-for-an-open-data-stream) in the [ExtraHop Admin UI Guide](https://docs.extrahop.com/26.2/eh-admin-ui-guide/).

Run the trigger on the following events: `NEW_DEVICE`

```javascript
var dev = Discover.device;
Remote.Syslog.info('Discovered device ' + dev.id + ' (hwaddr: ' + dev.hwaddr + ')
');
```

#### Related classes

- [Remote.Syslog](#remotesyslog)
- [Discover](#discover)
- [Device](#device)

### Example: Send data to Elasticsearch with Remote.HTTP

The trigger in this example sends data to an Elasticsearch server through an HTTP open data stream (ODS).

You must first configure an HTTP open data stream from the Administration settings before you create the trigger. The ODS configuration specifies the Elasticsearch target and any required authentication credentials. For configuration information, see [Configure an HTTP target for an open data stream](https://docs.extrahop.com/26.2/eh-admin-ui-guide/#configure-an-http-target-for-an-open-data-stream) in the [ExtraHop Admin UI Guide](https://docs.extrahop.com/26.2/eh-admin-ui-guide/).

Run the trigger on the following events: `HTTP_REQUEST` and `HTTP_RESPONSE`

```javascript
var date = new Date();
var payload = {
    'ts' : date.toISOString(), // Timestamp recognized by Elasticsearch
    'eh_event' : 'http',
    'my_path' : HTTP.path};
var obj = {
    'path' : '/extrahop/http', // Add to ExtraHop index
    'headers' : {},
    'payload' : JSON.stringify(payload)} ;
Remote.HTTP('elasticsearch').request('POST', obj);
```

#### Related classes

- [Remote.HTTP](#remotehttp)

### Example: Access HTTP header attributes

The trigger in this example accesses HTTP event attributes from the header object, and creates custom device metrics that count header requests and attributes.

Run the trigger on the following events: `HTTP_RESPONSE`

```javascript
var hdr,
   session,
   accept,  
   results,
   headers = HTTP.headers,
   i;

// Header lookups are case-insensitive properties
session = headers["X-Session-Id"];

/* Session is a string representing the value of the header (or null
 * if the header is not present). Header values are always strings.  
 */

// This syntax also works if the header is a legal property name
accept = headers.accept;

/*
 * In the event that there are multiple instances of a header,
 * accessing the header in the above manner (as a property)
 * will always return the value for the first appearance of the
 * header.
 */

if (session !== null)
{
   // Count requests per session ID
   Device.metricAddCount("req_count", 1);
   Device.metricAddDetailCount("req_count", session, 1);
}

/* Looping over all headers
 *
 * The "length" property is case-sensitive and is not
 * treated as a header lookup. Instead, it returns the number of
 * headers (as if HTTP.headers were an array). In the unlikely
 * event that there is a header called "Length," it would still be
 * accessible with HTTP.headers["Length"] (or HTTP.headers.Length).
 */

for (i = 0; i < headers.length; i++) {
   hdr = headers[i];
   debug("headers[" + i + "].name: " + hdr.name);
   debug("headers[" + i + "].value: " + hdr.value);
   Device.metricAddCount("hdr_count", 1);
   /* Count instances of each header */
   Device.metricAddDetailCount("hdr_count", hdr.name, 1);
}

// Searching for headers by prefix
results = HTTP.findHeaders("Content-");

/* The "results" property is an array (a real javascript array, as opposed
 * to an array-like object) of header objects (with name and value
 * properties) where the names match the prefix of the string passed
 * to findHeaders.
 */
for (i = 0; i < results.length; i++) {
   hdr = results[i];
   debug("results[" + i + "].name: " + hdr.name);
   debug("results[" + i + "].value: " + hdr.value);
}
```

#### Related classes

- [HTTP](#http)
- [Device](#device)

### Example: Collect IBMMQ metrics

The triggers in this example work together to give a view of the flow of queue level messages through the IBMMQ protocol. The triggers create custom application metrics that count the number of messages in, out, and exchanged between brokers by different message queues.

Run the following trigger on the `IBMMQ_REQUEST` event.

```javascript
if (IBMMQ.method == "MESSAGE_DATA") {
    var app = Application("IBMMQ Sample");
    app.metricAddCount("broker", 1);
    if (IBMMQ.queue !== null) {
        var ret = IBMMQ.queue.split(":");
        var queue = ret.length > 1 ? ret[1] : ret[0];
        app.metricAddDetailCount("broker", queue, 1);
    }
    else {
        app.metricAddCount("queueless_broker", 1);
    }
    if (IBMMQ.queue !== null && IBMMQ.queue.indexOf("QUEUE2") > -1) {
        app.metricAddCount("queue2_broker", 1);
    }
    app.commit();
}
elseif (IBMMQ.method == "MQPUT" || IBMMQ.method == "MQPUT1") {
    var app = Application("IBMMQ Sample");
    app.metricAddCount("msg_in", 1);
    if (IBMMQ.queue !== null) {
        var ret = IBMMQ.queue.split(":");
        var queue = ret.length > 1 ? ret[1] : ret[0];
        app.metricAddDetailCount("msg_in", queue, 1);
    }
    else {
        app.metricAddCount("queueless_msg_in", 1);
    }
    if (IBMMQ.queue !== null && IBMMQ.queue.indexOf("QUEUE2") > -1) {
        app.metricAddCount("queue2_msg_in", 1);
    }
    app.commit();
}
```

Run the following trigger on the `IBMMQ_RESPONSE` event.

```javascript
if (IBMMQ.method == "ASYNC_MSG_V7" || IBMMQ.method == "MQGET_REPLY") {
    var app = Application("IBMMQ Sample");
    if (IBMMQ.payload === null) {
        app.metricAddCount("payloadless_msg_out", 1);
    }
    else {
        app.metricAddCount("msg_out", 1);
        if (IBMMQ.queue !== null) {
            var ret = IBMMQ.queue.split(":");
            var queue = ret.length > 1 ? ret[1] : ret[0];
            app.metricAddDetailCount("msg_out", queue, 1);
        }
        else {
            app.metricAddCount("queueless_msg_out", 1);
        }
        if (IBMMQ.queue !== null && IBMMQ.queue.indexOf("QUEUE2") > -1) {
            app.metricAddCount("queue2_msg_out", 1);
        }
    }
    app.commit();
}
```

#### Related classes

- [IBMMQ](#ibmmq)
- [Application](#application)

### Example: Record Memcache hits and misses

The trigger in this example creates custom device metrics that record each memcache hit or miss and the access time of each hit.

Run the trigger on the following events: `MEMCACHE_RESPONSE`

```javascript
var hits = Memcache.hits;
var misses = Memcache.misses;
var accessTime = Memcache.accessTime;
var i;

Device.metricAddCount('memcache_key_hit', hits.length);

for (i = 0; i < hits.length; i++) {
   var hit = hits[i];
   if (hit.key != null) {
      Device.metricAddDetailCount('memcache_key_hit_detail', hit.key, 1);
   }
}

if (!isNaN(accessTime)) {
   Device.metricAddSampleset('memcache_key_hit', accessTime);
   if ((hits.length > 0) && (hits[0].key != null)) {
      Device.metricAddDetailSampleset('memcache_key_hit_detail', hits[0].key,
                                       accessTime);
   }
}

Device.metricAddCount('memcache_key_miss', misses.length);

for (i = 0; i < misses.length; i++) {
   var miss = misses[i];
   if (miss.key != null) {
      Device.metricAddDetailCount('memcache_key_miss_detail', miss.key, 1);
   }
}
```

#### Related classes

- [Memcache](#memcache)
- [Device](#device)

### Example: Parse memcache keys

Parses the memcache keys to extract detailed breakdowns, such as by ID module and class name, and creates custom device metrics to collect key details.

Keys are formatted as `"com.extrahop.<module>.<class>_<id>"`—for example: `"com.extrahop.widgets.sprocket_12345"`.

Run the trigger on the following events: `MEMCACHE_RESPONSE`

```javascript
var method = Memcache.method;
var statusCode = Memcache.statusCode;
var reqKeys = Memcache.reqKeys;
var hits = Memcache.hits;
var misses = Memcache.misses;
var error = Memcache.error;
var hit;
var miss;
var key;
var size;
var reqKey;
var i;

// Record breakdown of hit count and value size by module and class
for (i = 0; i < hits.length; i++) {
   hit = hits[i];
   key = hit.key;
   size = hit.size;

   Device.metricAddCount("hit", 1);
   if (key != null) {
      var parts = key.split(".");

      if ((parts.length == 4) && (parts[0] == "com") &&
         (parts[1] == "extrahop")) {
         var module = parts[2];
         var subparts = parts[3].split("_");
 
         Device.metricAddDetailCount("hit_module", module, 1);
         Device.metricAddDetailSampleset("hit_module_size", module, size);

         if (subparts.length == 2) {
            var hitClass = module + "." + subparts[0];

            Device.metricAddDetailCount("hit_class", hitClass, 1);
            Device.metricAddDetailSampleset("hit_class_size", hitClass,
                                             size);
         }
      }
   }
}

// Record misses by ID to help identify caching issues
for (i = 0; i < misses.length; i++) {
   miss = misses[i];
   key = miss.key;
   if (key != null) {
      var parts = key.split(".");

      if ((parts.length == 4) && (parts[0] == "com") &&
         (parts[1] == "extrahop") && (parts[2] == "widgets")) {
         var subparts = parts[3].split("_");

         if ((subparts.length == 2) && (subparts[0] == "sprocket")) {
            Device.metricAddDetailCount("sprocket_miss_id", subparts[1], 1);
         }
      }
   }
}
  
// Record the keys that produced any errors
if (error != null && method != null) {
   for (i = 0; i < reqKeys.length; i++) {
      reqKey = reqKeys[i];
      if (reqKey != null) {
         var errDetail = method + " " + reqKey + " / " + statusCode + ": " +
                         error;
         Device.metricAddDetailCount("error_key", errDetail, 1);
      }
   }  
}

// Record the status code, matching built-in metrics
if (Memcache.isBinaryProtocol && statusCode != "NO_ERROR") {
   Device.metricAddDetailCount("status_code",
                                 method + "/" + statusCode, 1);
} 
else { 
   Device.metricAddDetailCount("status_code", statusCode, 1);
}
```

#### Related classes

- [Memcache](#memcache)
- [Device](#device)

### Example: Add metrics to the metric cycle store

The trigger in this example illustrates how to temporarily store data from all metric record commits that occur during a metric cycle.

Run the trigger on the following events: `METRIC_CYCLE_BEGIN`, `METRIC_CYCLE_END`, `METRIC_RECORD_COMMIT`

Configure [advanced trigger options](#advanced-trigger-options) as shown in the following table:

| Option | Value |
| --- | --- |
| Metric Cycle | 30sec |
| Metric Type | extrahop.device.http_server,extrahop.device.tcp |

```javascript
var store = MetricCycle.store;

function processMetric() {
    var id = MetricRecord.id,
        deviceId = MetricRecord.object.id,
        fields = MetricRecord.fields;

    if (!store.metrics[deviceId]) {
        store.metrics[deviceId] = {};
    } 
    if (id === 'extrahop.device.http_server') {
        store.metrics[deviceId].httpRspAborted= fields['rsp_abort'];
    } 
    else if (id === 'extrahop.device.tcp') {
        store.metrics[deviceId].tcpAborted = fields['aborted_out'];
    }
}

function commitSyntheticMetrics() {
    var dev,
        metrics,
        abortPct,
        deviceId;
    for (deviceId in store.metrics) {
        metrics = store.metrics[deviceId];
        abortPct = (metrics.httpRspAborted / metrics.tcpAborted) * 100;
        dev = new Device(deviceId);
        dev.metricAddSnap('http-tcp-abort-pct', abortPct);
    }
}

switch (event) {
case 'METRIC_CYCLE_BEGIN':
    store.metrics = {};
    break;

case 'METRIC_RECORD_COMMIT':
    processMetric();
    break;

case 'METRIC_CYCLE_END':
    commitSyntheticMetrics();
    break;
}
```

#### Related classes

- [MetricCycle](#metriccycle)
- [MetricRecord](#metricrecord)
- [Device](#device)

### Example: Parse custom PoS messages with universal payload analysis

The trigger in this example parses TCP messages from a point-of-sale (PoS) system and creates custom device metrics that collect specific values in the 4th to 7th bytes of both response and request messages.

Run the trigger on the following events: `TCP_PAYLOAD`

```javascript
// Define variables; store client or server payload into a Buffer object

var buf_client = Flow.client.payload, 
    buf_server = Flow.server.payload,
    protocol = Flow.l7proto,

// PoS Message Type Structure Definition
    pos_message_type = {
        "0100" : "0100_Authorization_Request",
        "0101" : "0101_Authorization_Request_Repeat",
        "0110" : "0110_Authorization_Response",
        "0200" : "0200_Financial_Request",
        "0201" : "0201_Financial_Request_Repeat",
        "0210" : "0210_Financial_Response",
        "0220" : "0220_Financial_Transaction_Advice_Request",
        "0221" : "0221_Financial_Transaction_Advice_Request_Repeat",
        "0230" : "0230_Financial_Transaction_Advice_Response",
        "0420" : "0420_Reversal_Advice_Request",
        "0421" : "0421_Reversal_Advice_Request_Repeat",
        "0430" : "0430_Reversal_Advice_Response",
        "0600" : "0600_Administration_Request",
        "0601" : "0601_Administration_Request_Repeat",
        "0610" : "0610_Administration_Response",
        "0620" : "0620_Administration_Advice_Request",
        "0621" : "0621_Administration_Advice_Request_Repeat",
        "0630" : "0630_Administration_Advice_Response",
        "0800" : "0800_Administration_Request",
        "0801" : "0801_Administration_Request_Repeat",
        "0810" : "0810_Administration_Response"
    };

// Skip parsing if it is a protocol of no interest or there is no payload
if (protocol !== 'tcp:4015' || (buf_client === null && buf_server === null)) {
    // debug('Protocol of no interest: ' + protocol);
    return;
} else {
    /* Store the data into variables for future access since there is some payload
     * to parse
     */
    var client_ip = Flow.client.ipaddr,
        server_ip = Flow.server.ipaddr,
        client_port = Flow.client.port,
        server_port = Flow.server.port;
        // client = new Device(Flow.client.device.id),
        // server = new Device(Flow.server.device.id);
}

if (buf_client !== null && buf_client.length >= 7) {

    // This is a client payload
    var cli_msg_type = buf_client.slice(3,7).decode('utf-8');
    debug('Client: ' + client_ip + ":" + client_port + " Type: " + pos_message_type[cli_msg_type]);
    Device.metricAddCount('UPA_Request', 1);
    Device.metricAddDetailCount('UPA_Request_by_Message', pos_message_type[cli_msg_type], 1);
    Device.metricAddDetailCount('UPA_Request_by_Client', client_ip.toString(), 1);

} else if (buf_server !== null && buf_server.length >= 7) {

    // This is a server payload
    var srv_msg_type = buf_server.slice(3,7).decode('utf-8');
    debug('Server: ' + server_ip + " Client: " + client_ip + ":" + client_port +"
Type: " + pos_message_type[srv_msg_type]);
    Device.metricAddCount('UPA_Response', 1);
    Device.metricAddDetailCount('UPA_Response_by_Message', pos_message_type[srv_msg_type], 1);
    Device.metricAddDetailCount('UPA_Response_by_Client', client_ip.toString(), 1);

} else {

    // No buffer captured situation
    //debug('Null or not enough buffer data');
    return;
}
```

#### Related classes

- [Buffer](#buffer)
- [Device](#device)
- [Flow](#flow)

### Example: Parse syslog over TCP with universal payload analysis

The trigger in this example parses the syslog over TCP and counts the syslog activity over time, both network-wide and per device.

| Note: | You might need to edit the trigger example to make sure the network ports for your syslog server match the ports in your environment. |
| --- | --- |

Run the trigger on the following events: `TCP_PAYLOAD`, `UDP_PAYLOAD`

```javascript
// Global variables
var buffer         = Flow.client.payload,
    buffer_size    = Flow.client.payload.length + 1,
    client         = new Device(Flow.client.device.id),
    data_as_json   = { client_ip       : Flow.client.ipaddr.toString(),
                       client_port     : Flow.client.port.toString(),
                       server_ip       : Flow.server.ipaddr.toString(),  
                       server_port     : Flow.server.port.toString(),
                       protocol        : 'syslog',
                       protocol_fields : {} },
    protocol        = Flow.l7proto,
    server          = new Device(Flow.server.device.id),
    syslog          = {},
    syslog_facility = {
        "0": "kern",
        "1": "user",
        "2": "mail",
        "3": "daemon",
        "4": "auth",
        "5": "syslog",
        "6": "lpr",
        "7": "news",
        "8": "uucp",
        "9": "clock_daemon",
        "10": "authpriv",
        "11": "ftp",
        "12": "ntp",
        "13": "log_audit",
        "14": "log_alert",
        "15": "cron",
        "16": "local0",
        "17": "local1",
        "18": "local2",
        "19": "local3",
        "20": "local4",
        "21": "local5",
        "22": "local6",
        "23": "local7",
    },
    syslog_priority = {
         "0": "emerg",
         "1": "alert",
         "2": "crit",
         "3": "err",
         "4": "warn",
         "5": "notice",
         "6": "info",
         "7": "debug",
    };

// Exit out early if not classified properly or no payload

if ( ( protocol != 'tcp:5141' ) || ( buffer === null ) ) {
    debug('Invalid protocol ' + protocol +
          ' or null buffer (' + buffer.unpack('z').join(' ') + ')');
    return;
}

// Get started parsing Syslog

var data = buffer.unpack('z');

// Separate the PRIO field from the rest of the message
var msg_part  = data[0].split('>')[1].split(' ');
var prio_part = data[0].split('>')[0].split('<')[1];

// Decode the PRIO field into Syslog facility and priority
var raw_facility = parseInt(prio_part) >> 3;
var raw_priority = parseInt(prio_part) & 7;

syslog.facility = syslog_facility[raw_facility];
syslog.priority = syslog_priority[raw_priority];

/* Timestamp and hostname are technically part of the HEADER field, but
 * treat the rest of the message as a <space> delimited
 * string, which it is (the syslog protocol is very basic)
 */
syslog.timestamp = msg_part.slice(0,3).join(' ');
syslog.hostname  = msg_part[3];
syslog.message   = msg_part.slice(4).join(' ');

/* At the network level, keep counts of who is sending messages by
 * both facility and priority
 */
Network.metricAddCount('syslog:priority_' + syslog.priority, 1);
Network.metricAddDetailCount('syslog:priority_' +
                             syslog.priority + '_detail',
                             Flow.client.ipaddr, 1);
Network.metricAddCount('syslog:facility_' + syslog.facility, 1);
Network.metricAddDetailCount('syslog:facility_' +
                             syslog.facility + '_detail',
                             Flow.client.ipaddr, 1);

/* Devices receiving messages keep a count of who sent those messages
 * by facility and priority
 */
server.metricAddCount('syslog:priority_' + syslog.priority, 1);
server.metricAddDetailCount('syslog:priority_' +
                            syslog.priority + '_detail',
                            Flow.client.ipaddr, 1);
server.metricAddCount('syslog:facility_' + syslog.facility, 1);
server.metricAddDetailCount('syslog:facility_' +
                            syslog.facility + '_detail',
                            Flow.client.ipaddr, 1);

/* Devices sending messages keep a count of who they sent those messages
 * to by facility and priority
 */
client.metricAddCount('syslog:priority_' + syslog.priority, 1);
client.metricAddDetailCount('syslog:priority_' +
                            syslog.priority + '_detail',
                            Flow.server.ipaddr, 1);
client.metricAddCount('syslog:facility_' + syslog.facility, 1);
client.metricAddDetailCount('syslog:facility_' +
                            syslog.facility + '_detail',
                            Flow.server.ipaddr, 1);

data_as_json.protocol_fields = syslog;
data_as_json.ts              = new Date();

//try {
//    Remote.MongoDB.insert('payload.syslog', data_as_json);
//}
//catch ( err ) {
//    Remote.Syslog.debug(JSON.stringify(data_as_json));
//}
debug('Syslog data: ' + JSON.stringify(data_as_json, null, 4));
```

#### Related classes

- [Flow](#flow)
- [Network](#network)
- [Buffer](#buffer)
- [Remote.MongoDB](#remotemongodb)
- [Remote.Syslog](#remotesyslog)

### Example: Parse NTP with universal payload analysis

The trigger in the following example parses the network time protocol through universal payload analysis (UPA).

Run the trigger on the following events: `UDP_PAYLOAD`

```javascript
var buf = Flow.server.payload,
    flags,
    values,
    fmt,
    offset = 0,
    ntpData = {},
    proto = Flow.l7proto;
if ((proto !== 'NTP') || (buf === null)) {
    return;
}
// Parse individual flag values from flags byte
function parseFlags(flags) {
    return {
        'LI': flags >> 6,
        'VN': (flags & 0x3f) >> 3,
        'mode': flags & 0x7
    };
}

// Convert from NTP short format
function ntpShort(n) {
    return n / 65536.0;
}

// Convert integral part of NTP timestamp format to Date
function ntpTimestamp(n) {
    /* NTP dates start at 1900, subtract the difference
     * and convert to milliseconds */
    var ms = (n - 0x83aa7e80) * 1000;
    return new Date(ms);
}

// First part of NTP header
fmt = ('B' + // Flags (LI, VN, mode)
       'B' + // Stratum
       'b' + // Polling interval (signed)
       'b' + // Precision (signed)
       'I' + // Root delay
       'I'); // Root dispersion

values = buf.unpack(fmt);

offset = values.bytes;

flags = parseFlags(values[0]);
if (flags.VN !== 4) {
    // Expecting NTPv4
    return;
}

ntpData.flags = flags;
ntpData.stratum = values[1];
ntpData.poll = values[2];
ntpData.precision = values[3];
ntpData.rootDelay = ntpShort(values[4]);
ntpData.rootDispersion = ntpShort(values[5]);

// The next field, the reference ID, depends upon the stratum field
switch (ntpData.stratum)
{ 
case 0:
case 1:
    // Identifier string (4 bytes), and 4 NTP timestamps in two parts
    fmt = '4s8I';
    break;
default:
    // Unsigned int (based on IP), and 4 NTP timestamps in two parts
    fmt = 'I8I';
    break;
} 
// Passing in offset enables you to continue parsing where you left off
values = buf.unpack(fmt, offset);
ntpData.referenceId = values[0];

// Only the integral parts of the timestamp are referenced here
ntpData.referenceTimestamp = ntpTimestamp(values[1]);
ntpData.originTimestamp = ntpTimestamp(values[3]);
ntpData.receiveTimestamp = ntpTimestamp(values[5]);
ntpData.transmitTimestamp = ntpTimestamp(values[7]);

debug('NTP data:' + JSON.stringify(ntpData, null, 4));
```

#### Related classes

- [Buffer](#buffer)
- [Flow](#flow)
- [UDP](#udp)

### Example: Record data to a session table

The trigger in this example records specific HTTP transactions to the session table and creates custom network metrics that collect session expiration data.

Run the trigger on the following events: `HTTP_REQUEST`, `SESSION_EXPIRE`

```javascript
// HTTP_REQUEST
if (event == "HTTP_REQUEST") {
   if (HTTP.userAgent === null) {
      return;
   }

   // Look for the OS name
   var re = /(Windows|Mac|Linux)/;
   var os = HTTP.userAgent.match(re);
   if (os === null) {
      return;
   } 
   // Specify the matched string as the key for session table entry
   var os_name = os[0];

   var opts =
    {
      // Expire added entries after 30 seconds
      expire: 30,
      // Retain entries with normal priority if session table grows too large
      priority: Session.PRIORITY_NORMAL,
      // Make expired entries available on SESSION_EXPIRE events
      notify: true
   };
   // Ensure an entry for this key is present; an existing entry will not be replaced
   Session.add(os_name, 0, opts);
   // Increase the count for this entry
   var count = Session.increment(os_name);
   debug(os_name + ": " + count);
}

/* After 30 seconds, the accumulated per-OS counts appear in the Session.expiredKeys
 * list, accessible in the SESSION_EXPIRE event:
 */
   //SESSION_EXPIRE 
if (event == "SESSION_EXPIRE"){
   var keys = Session.expiredKeys;
   for (var i = 0; i < keys.length; i++) {
      debug("count of " + keys[i].name + ": " + keys[i].value);
      if (keys[i].value > 500) {
         Network.metricAddCount("os-high-request-count", 1);
         Network.metricAddDetailCount("os-high-request-count",
                                        keys[i].name, 1);
      }
   }
}
```

#### Related classes

- [HTTP](#http)
- [Network](#network)
- [Session](#session)

### Example: Track SOAP requests

The trigger in this example tracks SOAP requests through the SOAPAction header, saves them into the flow store, and creates custom network metrics that collect data about the transactions.

| Note: | Before you begin, confirm your SOAP implementation passes the necessary information through the header. |
| --- | --- |

Run the trigger on the following events: `HTTP_REQUEST`, `HTTP_RESPONSE`

```javascript
var soapAction,
   headers = HTTP.headers,
   method,
   detailMethod,
   parts;

if (event === "HTTP_REQUEST") {
   soapAction = headers["SOAPAction"]
   if (soapAction != null) {
       Flow.store.soapAction = soapAction;
   }
} 
else if (event === "HTTP_RESPONSE") {
   soapAction = Flow.store.soapAction;
   if (soapAction != null) {
      parts = soapAction.split("/");
      if (parts.length > 0) {
         method = soapAction.split("/")[1];
      } 
      else {
         method = soapAction;
      } 
      detailMethod = method + "_detail";
      Network.metricAddCount(method, 1);
      Network.metricAddDetailCount(detailMethod, Flow.client.ipaddr, 1);
      Network.metricAddSampleset("soap_proc", HTTP.processingTime);
      Network.metricAddDetailSampleset("soap_proc_detail", method,
                                       HTTP.processingTime);
   }
}
```

#### Related classes

- [Flow](#flow)
- [HTTP](#http)
- [Network](#network)

### Example: Matching topnset keys

The triggers in this example illustrate topnset key matching by string and IPAddress, and includes advanced key mapping.

#### Topnset key matching by string

Run the trigger on the following events: `METRIC_RECORD_COMMIT`

Configure [advanced trigger options](#advanced-trigger-options) as shown in the following table:

| Option | Value |
| --- | --- |
| Metric Cycle | 30sec |
| Metric Type | extrahop.device.app |

```javascript
var stat = MetricRecord.fields['bytes_out'],
    id = MetricRecord.object.id,
    proto = 'HTTP2-SSL',
    entry;

entry = stat.lookup(proto);
if (entry !==null) {
    debug('Device ' + id + ' sent ' + entry.value + ' bytes over ' + proto);
}
```

#### Topnset key matching by IPAddress

Run the trigger on the following events: `METRIC_RECORD_COMMIT`

Configure [advanced trigger options](#advanced-trigger-options) as shown in the following table:

| Option | Value |
| --- | --- |
| Metric Cycle | 30sec |
| Metric Type | extrahop.device.net_detail |

```javascript
var stat = MetricRecord.fields['bytes_out'],
    total = 0,
    entry,
    entries,
    i,
    ip = new IPAddress('192.168.112.1');

entries = stat.findEntries(ip);
for (i = 0; i < entries.length; i++) {
    entry = entries[i];
    total += entry.value;
}
Remote.Syslog.alert('IP ' + ip + ' sent ' + total + ' bytes.');
```

#### Advanced topnset key matching

Run the trigger on the following events: `METRIC_RECORD_COMMIT`

Configure [advanced trigger options](#advanced-trigger-options) as shown in the following table:

| Option | Value |
| --- | --- |
| Metric Cycle | 30sec |
| Metric Type | extrahop.device.net_detail |

```javascript
var stat = MetricRecord.fields['bytes_out'],
    entry,
    entries,
    key,
    i;

entries = stat.findEntries({addr: /192.168.112.1*/, proto: 17});

debug('matched ' + entries.length + '/' + stat.entries.length + ' entries')};

for (i = 0; i < entries.length; i++) {
    entry = entries[i];
    key = entry.key;
    Remote.Syslog.alert('unexpected outbound UDP traffic from: ' +
                        JSON.stringify(key));
}
```

#### Related classes

- [MetricRecord](#metricrecord)
- [IPAddress](#ipaddress)
- [Remote.Syslog](#remotesyslog)

### Example: Create an application container

The trigger in this example creates an application container based on traffic associated with a two-tier application, and creates custom application metrics collected on HTTP and database events.

Run the trigger on the following events: `HTTP_RESPONSE` and `DB_RESPONSE`

```javascript
/* Initialize the application object against which you will
 * commit specific HTTP and DB transactions. After traffic is
 * committed, an application container called "My App" will appear
 * in the Applications tab in the ExtraHop system.
 */

var myApp = Application("My App");

/* These configurable properties describe features that define
 * your application traffic.
 */

var myAppHTTPHost = "myapp.internal.example.com";
var myAppDatabaseName = "myappdb";
if (event == "HTTP_RESPONSE") {

   /* HTTP transactions can be committed to the application on
    * HTTP_RESPONSE events. 
    */

   /* Commit this HTTP transaction only if the HTTP host header for
    * this response is defined and matches your application's HTTP host.
    */

   if (HTTP.host && (HTTP.host == myAppHTTPHost)) {
      myApp.commit();

      /* Capture custom metrics about user agents that experience
       * HTTP 40x or 50x responses.
       */

      if (HTTP.statusCode && (HTTP.statusCode >= 400))
{
 
         // Increment the overall count of 40x or 50x responses
         
         myApp.metricAddCount('myapp_40x_50x', 1);

         // Collect additional detail on referer, if any

         if (HTTP.referer) {
            myApp.metricAddDetailCount('myapp_40x_50x_refer_detail',
                                       HTTP.referer, 1);
         }
      }
   }

} else if (event == "DB_RESPONSE") {
   /* Database transactions can be committed to the application on
    * DB_RESPONSE events.
    *
    * Commit this database transaction only if the database name for
    * this response matches the name of our application database.
    */
   if (DB.database && (DB.database == myAppDatabaseName)) {
      myApp.commit();
   }
}
```

#### Related classes

- [Application](#application)
- [DB](#db)
- [HTTP](#http)
