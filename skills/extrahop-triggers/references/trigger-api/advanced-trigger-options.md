---
{
  "api_area": "trigger-api",
  "doc_kind": "reference_section",
  "name": "Advanced trigger options",
  "section": "advanced-trigger-options",
  "source_url": "https://docs.extrahop.com/current/extrahop-trigger-api/",
  "source_version": "26.2"
}
---

## Advanced trigger options

You can configure advanced options for some events when you create a trigger.

The following table describes available advanced options and applicable events.

| Option | Description | Supported events |
| --- | --- | --- |
| Bytes Per Packet to Capture | Specifies the number of bytes to capture per packet. The capture starts with the first byte in the packet. Specify this option only if the trigger script performs packet capture.A value of 0 specifies that the capture should collect all bytes in each packet. | All events are supported except the following list:ALERT_RECORD_COMMIT METRIC_CYCLE_BEGIN METRIC_CYCLE_END FLOW_REPORT NEW_APPLICATION NEW_DEVICE SESSION_EXPIRE |
| L7 Payload Bytes to Buffer | Specifies the maximum number of payload bytes to buffer.Note:If multiple triggers run on the same event, the trigger with the highest L7 Payload Bytes to Buffer value determines the maximum payload for that event for each trigger. | CIFS_REQUEST CIFS_RESPONSE HTTP_REQUEST HTTP_RESPONSE ICA_TICK LDAP_RESPONSE |
| Note: | If multiple triggers run on the same event, the trigger with the highest L7 Payload Bytes to Buffer value determines the maximum payload for that event for each trigger. |  |
| Clipboard Bytes | Specifies the number of bytes to buffer on a Citrix clipboard transfer. | ICA_TICK |
| Metric cycle | Specifies the length of the metric cycle, expressed in seconds. The only valid value is `30sec`. | METRIC_CYCLE_BEGIN METRIC_CYCLE_END METRIC_RECORD_COMMIT |
| Metric types | Specifies the metric type by the raw metric name, such as `extrahop.device.http_server`. Specify multiple metric types in a comma-delimited list. | ALERT_RECORD_COMMIT METRIC_RECORD_COMMIT |
| Run trigger on each flow turn | Enables packet capture on each flow turn.Per-turn analysis continuously analyzes communication between two endpoints to extract a single payload data point from the flow. If this option is enabled, any values specified for the Client matching string and Server matching string options are ignored. | SSL_PAYLOAD TCP_PAYLOAD |
| Client Port Range | Specifies the client port range. The trigger only runs when the port associated with the client is within the specified range. The range includes both the specified minimum and maximum port numbers. To select a single port, specify the same number in both the minimum and maximum fields. Valid values are `1` to `65535`. | SSL_PAYLOAD TCP_PAYLOAD UDP_PAYLOAD |
| Client Bytes to Buffer | Specifies the number of client bytes to buffer.The value of this option cannot be set to 0 if the value of the Server bytes to buffer option is also set to 0. | SSL_PAYLOAD TCP_PAYLOAD |
| Client Buffer Search String | Specifies the format string that indicates when to begin buffering client data. Returns the entire packet upon a string match. You can specify the string as text or hexidecimal numbers. For example, both `ExtraHop` and `\x45\x78\x74\x72\x61\x48\x6F\x70` are equivalent. Hexidecimal numbers are not case sensitive. Any value specified for this option is ignored if the Per Turn or Run trigger on all UDP packets option is enabled. | SSL_PAYLOAD TCP_PAYLOAD UDP_PAYLOAD |
| Server Port Range | Specifies the server port range. The trigger only runs when the port associated with the server is within the specified range. The range includes both the specified minimum and maximum port numbers. To select a single port, specify the same number in both the minimum and maximum fields. Valid values are `1` to `65535`. | SSL_PAYLOAD TCP_PAYLOAD UDP_PAYLOAD |
| Server Bytes to Buffer | Specifies the number of server bytes to buffer.The value of this option cannot be set to 0 if the value of the Client bytes to buffer option is also set to 0. | SSL_PAYLOAD TCP_PAYLOAD |
| Server Buffer Search String | Specifies the format string that indicates when to begin buffering server data.You can specify the string as text or hexidecimal numbers. For example, both `ExtraHop` and `\x45\x78\x74\x72\x61\x48\x6F\x70` are equivalent. Hexidecimal numbers are not case sensitive. Any value specified for this option is ignored if the Per Turn or Run trigger on all UDP option is enabled. | SSL_PAYLOAD TCP_PAYLOAD UDP_PAYLOAD |
| Run trigger on all UDP packets | Enables capture of all UDP datagrams. | UDP_PAYLOAD |
| Run FLOW_CLASSIFY on expiring, unclassified flows | Enables running the event upon expiration to accumulate metrics for flows that were not classified before expiring. | FLOW_CLASSIFY |
| External types | Specifies the types of external data the trigger processes. The trigger only runs if the payload contains a type field with one of the specified values. Type names cannot begin with an `@` character. Specify multiple types in a comma-separated list. | EXTERNAL_DATA |
