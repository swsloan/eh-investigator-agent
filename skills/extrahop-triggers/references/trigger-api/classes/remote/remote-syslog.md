---
{
  "anchor": "remotesyslog",
  "api_area": "trigger-api",
  "doc_kind": "class",
  "events": [],
  "examples": [
    "Example: Send discovered device data to a remote syslog server",
    "Example: Parse syslog over TCP with universal payload analysis",
    "Example: Matching topnset keys"
  ],
  "methods": [
    "emerg(message:String):void",
    "Syntax:",
    "Parameters",
    "name: String",
    "alert(message:String):void",
    "crit(message:String):void",
    "error(message:String):void",
    "warn(message:String):void",
    "notice(message:String):void",
    "info(message:String):void",
    "debug(message:String):void"
  ],
  "name": "Remote.Syslog",
  "properties": [],
  "section": "open-data-stream-classes",
  "source_url": "https://docs.extrahop.com/current/extrahop-trigger-api/",
  "source_version": "26.2"
}
---

### Remote.Syslog

The `Remote.Syslog` class enables you to create remote syslog messages and send message data to a Syslog open data stream (ODS).

You must first configure a syslog ODS target from the Administration settings, which requires system and access administration privileges. For configuration information, see the [Open Data Streams](https://docs.extrahop.com/26.2/open-data-streams) section in the [Sensor Administration Guide](https://docs.extrahop.com/26.2/eh-admin-ui-guide).

| Note: | If submitting an rsyslog message succeeds, the APIs will return true. In the case of either success or failure, the trigger will continue to execute as a failure to submit an rsyslog message is a "soft" failure. Incorrect usage of the APIs, in other words, calling them with the wrong number or type of arguments, will still result in trigger execution stopping. |
| --- | --- |

#### Methods

- **emerg(message:String):void**: Sends a message to the remote syslog server with an emergency severity level.

- **Syntax:**: ```javascript
Remote.Syslog.emerg("eh_event=web uri=" + HTTP.uri + " req_size=" + HTTP.reqSize + "
rsp_size=" + HTTP.rspSize + " processingTime=" + HTTP.processingTime);
```

```javascript
Remote.Syslog("name").emerg("eh_event=web uri=" + HTTP.uri + " req_size=" +
HTTP.reqSize + " rsp_size=" + HTTP.rspSize + " processingTime=" + HTTP.processingTime);
```
- **Parameters**: - **name: String**: The name of the ODS target that requests are sent to. If this field is not specified, the name is set to

`default`

.
- **alert(message:String):void**: Sends a message to the remote syslog server with an alert severity level.

- **Syntax:**: ```javascript
Remote.Syslog.alert("eh_event=web uri=" + HTTP.uri + " req_size=" + HTTP.reqSize + "
rsp_size=" + HTTP.rspSize + " processingTime=" + HTTP.processingTime);
```

```javascript
Remote.Syslog("name").alert("eh_event=web uri=" + HTTP.uri + " req_size=" +
HTTP.reqSize + " rsp_size=" + HTTP.rspSize + " processingTime=" + HTTP.processingTime);
```
- **Parameters**: - **name: String**: The name of the ODS target that requests are sent to. If this field is not specified, the name is set to

`default`

.
- **crit(message:String):void**: Sends a message to the remote syslog server with a critical severity level.

- **Syntax:**: ```javascript
Remote.Syslog.crit("eh_event=web uri=" + HTTP.uri + " req_size=" + HTTP.reqSize + "
rsp_size=" + HTTP.rspSize + " processingTime=" + HTTP.processingTime);
```

```javascript
Remote.Syslog("name").crit("eh_event=web uri=" + HTTP.uri + " req_size=" +
HTTP.reqSize + " rsp_size=" + HTTP.rspSize + " processingTime=" + HTTP.processingTime);
```
- **Parameters**: - **name: String**: The name of the ODS target that requests are sent to. If this field is not specified, the name is set to

`default`

.
- **error(message:String):void**: Sends a message to the remote syslog server with an error severity level.

- **Syntax:**: ```javascript
Remote.Syslog.error("eh_event=web uri=" + HTTP.uri + " req_size=" + HTTP.reqSize + "
rsp_size=" + HTTP.rspSize + " processingTime=" + HTTP.processingTime);
```

```javascript
Remote.Syslog("name").error("eh_event=web uri=" + HTTP.uri + " req_size=" +
HTTP.reqSize + " rsp_size=" + HTTP.rspSize + " processingTime=" + HTTP.processingTime);
```
- **Parameters**: - **name: String**: The name of the ODS target that requests are sent to. If this field is not specified, the name is set to

`default`

.
- **warn(message:String):void**: Sends a message to the remote syslog server with a warning severity level.

- **Syntax:**: ```javascript
Remote.Syslog.warn("eh_event=web uri=" + HTTP.uri + " req_size=" + HTTP.reqSize + "
rsp_size=" + HTTP.rspSize + " processingTime=" + HTTP.processingTime);
```

```javascript
Remote.Syslog("name").warn("eh_event=web uri=" + HTTP.uri + " req_size=" +
HTTP.reqSize + " rsp_size=" + HTTP.rspSize + " processingTime=" + HTTP.processingTime);
```
- **Parameters**: - **name: String**: The name of the ODS target that requests are sent to. If this field is not specified, the name is set to

`default`

.
- **notice(message:String):void**: Sends a message to the remote syslog server with a notice severity level.

- **Syntax:**: ```javascript
Remote.Syslog.notice("eh_event=web uri=" + HTTP.uri + " req_size=" + HTTP.reqSize + "
rsp_size=" + HTTP.rspSize + " processingTime=" + HTTP.processingTime);
```

```javascript
Remote.Syslog("name").notice("eh_event=web uri=" + HTTP.uri + " req_size=" +
HTTP.reqSize + " rsp_size=" + HTTP.rspSize + " processingTime=" + HTTP.processingTime);
```
- **Parameters**: - **name: String**: The name of the ODS target that requests are sent to. If this field is not specified, the name is set to

`default`

.
- **info(message:String):void**: Sends a message to the remote syslog server with an info severity level.

- **Syntax:**: ```javascript
Remote.Syslog.info("eh_event=web uri=" + HTTP.uri + " req_size=" + HTTP.reqSize + "
rsp_size=" + HTTP.rspSize + " processingTime=" + HTTP.processingTime);
```

```javascript
Remote.Syslog("name").info("eh_event=web uri=" + HTTP.uri + " req_size=" +
HTTP.reqSize + " rsp_size=" + HTTP.rspSize + " processingTime=" + HTTP.processingTime);
```
- **Parameters**: - **name: String**: The name of the ODS target that requests are sent to. If this field is not specified, the name is set to

`default`

.
- **debug(message:String):void**: Sends a message to the remote syslog server with a debug severity level.

- **Syntax:**: ```javascript
Remote.Syslog.debug("eh_event=web uri=" + HTTP.uri + " req_size=" + HTTP.reqSize + "
rsp_size=" + HTTP.rspSize + " processingTime=" + HTTP.processingTime);
```

```javascript
Remote.Syslog("name").debug("eh_event=web uri=" + HTTP.uri + " req_size=" +
HTTP.reqSize + " rsp_size=" + HTTP.rspSize + " processingTime=" + HTTP.processingTime);
```
- **Parameters**: - **name: String**: The name of the ODS target that requests are sent to. If this field is not specified, the name is set to

`default`

.

#### Message size

By default, the message sent to the remote server is limited to 1024 bytes, including the message header and trailer (if necessary). The message header always includes the priority and timestamp, which together are up to 30 bytes.

If you have system and access administration privileges, you can increase the default message size in the Administration settings. Click Running Config from the Appliance Settings section, and then click Edit config. Go to the "remote" section, and under the ODS target name, such as "rsyslog", add "message_length_max" as shown in the example below. The "message_length_max" setting applies only to the message passed to the Remote.Syslog APIs; the message header does not count against the maximum.

```javascript
"remote": {
   "rsyslog": {
   "host": "hostname",
   "port": 54322,
   "ipproto": "tcp",
   "message_length_max": 4000
   }
}
```

#### Timestamp

The default timestamp format for rsyslog messages is UTC. You can change the timestamp to local time when you configure the open data stream in the Administration settings.

#### Trigger Examples

- [Example: Send discovered device data to a remote syslog server](#example-send-discovered-device-data-to-a-remote-syslog-server)
- [Example: Parse syslog over TCP with universal payload analysis](#example-parse-syslog-over-tcp-with-universal-payload-analysis)
- [Example: Matching topnset keys](#example-matching-topnset-keys)
