---
{
  "api_area": "trigger-api",
  "doc_kind": "reference_section",
  "name": "Overview",
  "section": "overview",
  "source_url": "https://docs.extrahop.com/current/extrahop-trigger-api/",
  "source_version": "26.2"
}
---

## Overview

Application Inspection triggers are composed of user-defined code that automatically executes on system events through the ExtraHop trigger API. By writing triggers, you can collect custom metric data about the activities on your network. In addition, triggers can perform operations on protocol messages (such as an HTTP request) before the packet is discarded.

The ExtraHop system monitors, extracts, and records a core set of Layer 7 (L7) metrics for devices on the network, such as response counts, error counts, and processing times. After these metrics are recorded for a given L7 protocol, the packets are discarded, freeing resources for continued processing.

Triggers enable you to:

- Generate and store custom metrics to the internal datastore of the ExtraHop system. For example, while the ExtraHop system does not collect information about which user agent generated an HTTP request, you can generate and collect that level of detail by writing a trigger and committing the data to the datastore. You can also view custom data that is stored in the datastore by creating custom metrics pages and displaying those metrics through the Metric Explorer and dashboards .
- Generate and send records for long-term storage and retrieval to a recordstore .
- Create a user-defined application that collects metrics across multiple types of network traffic to capture information with cross-tier impact. For example, to gain a unified view of all the network traffic associated with a website—from web transactions to DNS requests and responses to database transactions—you can create an application that contains all of these website-related metrics.
- Generate custom metrics and send the information to syslog consumers such as Splunk, or to third party databases such as MongoDB or Kafka.
- Initiate a packet capture to record individual flows based on user-specified criteria. You can download captured flows and process them through third-party tools. Your ExtraHop system must be licensed for packet capture to access this feature.

The purpose of this guide is to provide reference material when writing the blocks of JavaScript code that run when trigger conditions are met. The [Trigger API resources](#trigger-api-resources) section contains a list of topics that provide a comprehensive overview of trigger concepts and procedures.
