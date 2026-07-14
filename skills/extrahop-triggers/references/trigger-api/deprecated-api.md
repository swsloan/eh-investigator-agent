---
{
  "api_area": "trigger-api",
  "doc_kind": "reference_section",
  "name": "Deprecated API elements",
  "section": "deprecated-api-elements",
  "source_url": "https://docs.extrahop.com/current/extrahop-trigger-api/",
  "source_version": "26.2"
}
---

## Deprecated API elements

The API elements listed in this section have been deprecated. Each element includes an alternative and the version in which the element was deprecated.

If your trigger script contains a deprecated element, the syntax validator in the trigger editor lets you know which element is deprecated and suggests a replacement element, if available. You cannot save the trigger until you fix your code or you disable syntax validation. For better trigger performance, replace deprecated elements.

### Deprecated advanced trigger options

| Option | Replacement | Version |
| --- | --- | --- |
| `5min`, `1hr`, and `24hr` metric cycles | There is no replacement for 5 minute, 1 hour, and 24 hour metric cycles. However, 30 second metric cycles are still supported. | 9.6 |

### Deprecated global functions

| Function | Replacement | Version |
| --- | --- | --- |
| `exit():``Void` | The return statement | 4.0 |
| `getTimestampMSec():``Number` | `getTimestamp():``Number` | 4.0 |

### Deprecated global function parameters

| Function | Property | Replacement | Version |
| --- | --- | --- | --- |
| `commitDetection()` | `categories` | You can [specify detection categories in the Detection Catalog](https://docs.extrahop.com/26.2/create-custom-detection/#create-a-custom-detection-type). | 9.3 |

### Deprecated events

| Event | Replacement | Version |
| --- | --- | --- |
| `NEW_VLAN` | No replacement | 6.1 |

### Deprecated classes

| Class | Replacement | Version |
| --- | --- | --- |
| `RemoteSyslog` | [Remote.Syslog](#remotesyslog) | 4.0 |
| `XML` | Regular expressions | 6.0 |
| `TroubleGroup` | No replacement | 6.0 |

### Deprecated methods by class

| Class | Method | Replacement | Version |
| --- | --- | --- | --- |
| [Flow](#flow) | `getApplication():``String` | `getApplications():``String` | 5.3 |
| `setApplication(name:``String``, turnTiming:``Boolean``):``void` | `addApplication(name:``String``, turnTiming:``Boolean``):``void` | 5.3 |  |
| [Session](#session) | `update(key:``String``, value: *, options:``Object``)*` | `replace(key:``String``, value: *, options:``Object``): *` | 3.9 |
| [SSL](#ssl) | `setApplication(name:``String``):` `void` | `addApplication(name:``String``):` `void` | 5.3 |

### Deprecated properties by class

| Class | Property | Replacement | Version |
| --- | --- | --- | --- |
| [AAA](#aaa) | `error:``String` | `isError:``Boolean` | 5.0 |
| `record.protocol:``String` | `record.type:``String` | 26.2 |  |
| `tprocess:``Number` | `processingTime:``Number` | 5.2 |  |
| [DB](#db) | `tprocess:``Number` | `processingTime:``Number` | 5.2 |
| [Detection](#detection) | `participants.object_type:` `String` | instanceof operator | 7.8 |
| [Discover](#discover) | `vlan:``VLAN` | No replacement | 6.1 |
| [DNS](#dns) | `tprocess:``Number` | `processingTime:``Number` | 5.2 |
| [Flow](#flow) | `isClientAborted:``Boolean` | `isAborted:``Boolean` | 3.10 |
| `isServerAborted:``Boolean` | `isAborted:``Boolean` | 3.10 |  |
| `turnInfo:``String` | Top-level [Turn](#turn) object with attributes for the turn | 3.9 |  |
| [FTP](#ftp) | `tprocess:``Number` | `processingTime:``Number` | 5.2 |
| [HL7](#hl7) | tprocess: `Number` | processingTime: `Number` | 5.2 |
| [HTTP](#http) | `payloadText:``String` | `payload:``Buffer` | 4.0 |
| `tprocess:``Number` | `processingTime:``Number` | 5.2 |  |
| [IBMMQ](#ibmmq) | `messageID:``String` | `msgID:``Buffer` | 5.2 |
| `msgSize:``Number` | `totalMsgLength:``Number` | 5.2 |  |
| `objectHandle:``String` | No replacement | 5.0 |  |
| `payload:``Buffer` | `msg:``Buffer` | 5.2 |  |
| [ICA](#ica) | `authTicket:``String` | `user:``String` | 3.7 |
| `application:``String` | `program:``String` | 5.2 |  |
| `client:``String` | `clientMachine:``String` | 6.0 |  |
| [LDAP](#ldap) | `tprocess:``Number` | `processingTime:``Number` | 5.2 |
| [MongoDB](#mongodb) | `roundTripTime:``Number` on the `MONGODB_REQUEST` event. | No replacement | 25.2 |
| `tprocess:``Number` | `processingTime:``Number` | 5.2 |  |
| [Netflow](#netflow) | `tos:``Number` | `dscp:``Number``dscp:``String` | 6.1 |
| [NTLM](#ntlm) | `ntlmRspVersion:``String` | `rspVersion:``String` | 8.2 |
| [QUIC](#quic) | `cyuFingerprint:``String` | No replacement | 9.6 |
| `tags:``Array of Objects` | No replacement | 9.6 |  |
| `record.cyuFingerprint:``String` | No replacement | 9.6 |  |
| [SMPP](#smpp) | `tprocess:``Number` | `processingTime:``Number` | 5.2 |
| [SMTP](#smtp) | `recipient:``String` | `recipientList:``Array of Strings` | 7.5 |
| `roundTripTime:``Number` on the `SMTP_REQUEST` event. | No replacement | 25.2 |  |
| `tprocess:``Number` | `processingTime:``Number` | 5.2 |  |
| [SSL](#ssl) | `SSL.record.ja3Hash:` `String` | `SSL.ja3Hash:` `String` | 9.7 |
| `SSL.record.ja3sHash:` `String` | `SSL.ja3sHash` `String` | 9.7 |  |
| `reqBytes:``Number` | `clientBytes:``Number` | 6.1 |  |
| `reqL2Bytes:``Number` | `clientL2Bytes:``Number` | 6.1 |  |
| `reqPkts:``Number` | `clientPkts:``Number` | 6.1 |  |
| `rspBytes:``Number` | `serverBytes:``Number` | 6.1 |  |
| `rspL2Bytes:``Number` | `serverL2Bytes:``Number` | 6.1 |  |
| `rspPkts:``Number` | `serverPkts:``Number` | 6.1 |  |
| [TCP](#tcp) | `wndSize:``Number` | `initRcvWndSize:``Number` | 6.2 |
| `wndSize1:``Number` | `initRcvWndSize1:``Number` | 6.2 |  |
| `wndSize2:``Number` | `initRcvWndSize2:``Number` | 6.2 |  |
| [Turn](#turn) | `reqSize:``Number` | `clientBytes:``Number` | 4.0 |
| `reqXfer:``Number` | `clientTransferTime:``Number` | 4.0 |  |
| `respSize:``Number` | `serverBytes:``Number` | 4.0 |  |
| `rspXfer:``Number` | `serverTransferTime:``Number` | 4.0 |  |
| `tprocess:``Number` | `processingTime:``Number` | 4.0 |  |
