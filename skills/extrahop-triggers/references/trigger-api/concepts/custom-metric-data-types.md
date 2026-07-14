---
{
  "api_area": "trigger-api",
  "doc_kind": "reference_section",
  "name": "Data types for custom metrics",
  "section": "data-types-for-custom-metrics",
  "source_url": "https://docs.extrahop.com/current/extrahop-trigger-api/",
  "source_version": "26.2"
}
---

## Data types for custom metrics

The ExtraHop Trigger API enables you to create custom metrics that collect data about your environment, beyond what is provided by built-in protocol metrics.

You can create custom metrics of the following data types:

- **count**: The number of metric events that occurred over a specific time range. For example, to record information about the number of HTTP requests over time, select a top-level count metric. You could also select a detail count metric to record information about the number of times clients accessed a server, with the IPAddress key and an integer representing the number of accesses as a value.
- **snapshot**: A special type of count metric that, when queried over time, returns the most recent value (such as TCP established connections).
- **distinct**: The estimated number of unique items observed over time, such as the number of unique ports that received SYN packets, where a high number might indicate port scanning.
- **dataset**: A statistical summary of timing information, such as 5-number summary: min, 25th-percentile, median, 75th-percentile, max. For example, to record information about HTTP processing time over time, select a top-level

dataset

metric.
- **sampleset**: A statistical summary of timing information, such as mean and standard deviation. For example, to record information about the length of time it took the server to process each URI, select a detail sampleset with the URI string key and an integer representing processing time as a value.
- **max**: A special type of count metric that preserves the maximum. For example, to record the slowest HTTP statements over time without relying on a session table, select a top-level and a detail max metric.

Custom metrics are supported for the following source types:

- [Application](#application)
- [Device](#device)
- [Network](#network)
- [FlowInterface](#flowinterface)
- [FlowNetwork](#flownetwork)

For more information about the differences between top-level and detail metrics, see the [Metrics FAQ](https://docs.extrahop.com/26.2/metrics-faq/#what-is-the-difference-between-toplevel-and-detail-metrics).
