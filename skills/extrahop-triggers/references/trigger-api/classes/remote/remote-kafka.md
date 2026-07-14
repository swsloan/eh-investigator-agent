---
{
  "anchor": "remotekafka",
  "api_area": "trigger-api",
  "doc_kind": "class",
  "events": [],
  "examples": [],
  "methods": [
    "send",
    "Syntax:",
    "Parameters:",
    "name: String",
    "topic: String",
    "messages: Array",
    "partition: Number",
    "Return values:",
    "Examples:",
    "messages: String | Number"
  ],
  "name": "Remote.Kafka",
  "properties": [],
  "section": "open-data-stream-classes",
  "source_url": "https://docs.extrahop.com/current/extrahop-trigger-api/",
  "source_version": "26.2"
}
---

### Remote.Kafka

The `Remote.Kafka` class enables you to submit message data to a Kafka server through a Kafka open data stream (ODS).

You must first configure a Kafka ODS target from the Administration settings, which requires system and access administration privileges. For configuration information, see the [Open Data Streams](https://docs.extrahop.com/26.2/open-data-streams) section in the [Sensor Administration Guide](https://docs.extrahop.com/26.2/eh-admin-ui-guide).

#### Methods

- **send**: Sends an array of messages to a single topic with an option to indicate which Kafka partition the messages will be sent to.

- **Syntax:**: ```javascript
Remote.Kafka.send({"topic": "topic", "messages":[messages],
"partition": partition})
```

```javascript
Remote.Kafka("name").send({"topic": "topic", "messages":[messages],
"partition": partition})
```
- **Parameters:**: - **name: String**: The name of the ODS target that requests are sent to. If this field is not specified, the name is set to

`default`

.
- **topic: String**: A string corresponding to the topic associated with the Kafka

`send`

method. The topic string has the following restrictions:

- The string length must be between 1 and 249 characters.
- The string supports only alphanumeric characters and the following symbols: "-", "_", or ".".
- The string cannot be "." or "..".
- **messages: Array**: An optional array of messages to be sent. An element in this array cannot be an array itself.
- **partition: Number**: An optional non-negative integer corresponding to the Kafka partition the messages will be sent to. The

`send`

action will fail silently if the number provided exceeds the number of partitions on the Kafka cluster associated with the given target. This value is ignored unless

Manual Partitioning

is selected as the partitioning strategy when you configured the open data stream in the Administration settings.
- **Return values:**: None
- **Examples:**: ```javascript
Remote.Kafka.send({"topic": "my_topic", "messages": ["hello world", 42,
DHCP.msgType], "partition": 2});
```

```javascript
Remote.Kafka("my-target").send({"topic": "my_topic", "messages": [HTTP.query,
HTTP.uri]});
```

- **send**: Sends messages to a single topic.

- **Syntax:**: ```javascript
Remote.Kafka.send("topic", message1, message2, etc...)
```

```javascript
Remote.Kafka("my-target").send("topic", message1, message2, etc...)
```
- **Parameters:**: If

`Remote.Kafka.send`

is called with multiple arguments, the following fields are required:

- **topic: String**: A string corresponding to the topic associated with the Kafka

`send`

method. The topic string has the following restrictions:

- The string length must be between 1 and 249 characters.
- The string supports only alphanumeric characters and the following symbols: "-", "_", or ".".
- The string cannot be "." or "..".
- **messages: String | Number**: The messages to be sent. This cannot be an array.
- **Return values:**: None.
- **Examples:**: ```javascript
Remote.Kafka.send("my_topic", HTTP.query, HTTP.uri);
```

```javascript
Remote.Kafka("my-target").send("my_topic", HTTP.query, HTTP.uri);
```
