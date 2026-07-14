---
{
  "anchor": "icmp",
  "api_area": "trigger-api",
  "doc_kind": "class",
  "events": [
    "ICMP_MESSAGE"
  ],
  "examples": [],
  "methods": [
    "commitRecord(): void"
  ],
  "name": "ICMP",
  "properties": [
    "gwAddr: IPAddress",
    "hopLimit: Number",
    "isError: Boolean",
    "isQuery: Boolean",
    "isReply: Boolean",
    "msg: Buffer",
    "msgCode: Number",
    "msgId: Number",
    "msgLength: Number",
    "msgText: String",
    "msgType: Number",
    "nextHopMTU: Number",
    "original: Object",
    "ipproto: String",
    "ipver: String",
    "srcAddr: IPAddress",
    "srcPort: Number",
    "dstAddr: IPAddress",
    "dstPort: Number",
    "pointer: Number",
    "record: Object",
    "seqNum: Number",
    "version: Number"
  ],
  "section": "protocol-and-network-data-classes",
  "source_url": "https://docs.extrahop.com/current/extrahop-trigger-api/",
  "source_version": "26.2"
}
---

### ICMP

The ICMP class enables you to store metrics and access properties on `ICMP_MESSAGE` events.

#### Events

- **ICMP_MESSAGE**: Runs on every ICMP message processed by the device.

#### Methods

- **commitRecord(): void**: Sends a record to the configured recordstore on an

`ICMP_MESSAGE`

event.

To view the default properties committed to the record object, see the `record` property below.

For built-in records, each unique record is committed only once, even if the `commitRecord()` method is called multiple times for the same unique record.

#### Properties

- **gwAddr: IPAddress**: For a redirect message, returns the address of the gateway to which traffic for the network specified in the internet destination network field of the original datagram's data should be sent. Returns null for all other messages.

| Message | ICMPv4 Type | ICMPv6 Type |
| --- | --- | --- |
| `Redirect Message` | `5` | `n/a` |
- **hopLimit: Number**: The ICMP packet time to live or hop count.
- **isError: Boolean**: The value is

`true`

for message types in the following table.

| Message | ICMPv4 Type | ICMPv6 Type |
| --- | --- | --- |
| `Destination Unreachable` | `3` | `1` |
| `Redirect` | `5` | `n/a` |
| `Source Quench` | `4` | `n/a` |
| `Time Exceeded` | `11` | `3` |
| `Parameter Problem` | `12` | `4` |
| `Packet Too Big` | `n/a` | `2` |
- **isQuery: Boolean**: The value is

`true`

for message types in the following table.

| Message | ICMPv4 Type | ICMPv6 Type |
| --- | --- | --- |
| `Echo Request` | `8` | `128` |
| `Information Request` | `15` | `n/a` |
| `Timestamp request` | `13` | `n/a` |
| `Address Mask Request` | `17` | `n/a` |
| `Router Discovery` | `10` | `151` |
| `Multicast Listener Query` | `n/a` | `130` |
| `Router Solicitation (NDP)` | `n/a` | `133` |
| `Neighbor Solicitation` | `n/a` | `135` |
| `ICMP Node Information Query` | `n/a` | `139` |
| `Inverse Neighbor Discovery Solicitation` | `n/a` | `141` |
| `Home Agent Address Discovery Solicitation` | `n/a` | `144` |
| `Mobile Prefix Solicitation` | `n/a` | `146` |
| `Certification Path Solicitation` | `n/a` | `148` |
- **isReply: Boolean**: The value is

`true`

for message types in the following table.

| Message | ICMPv4 Type | ICMPv6 Type |
| --- | --- | --- |
| `Echo Reply` | `0` | `129` |
| `Information Reply` | `16` | `n/a` |
| `Timestamp Reply` | `14` | `n/a` |
| `Address Mask Reply` | `18` | `n/a` |
| `Multicast Listener Done` | `n/a` | `132` |
| `Multicast Listener Report` | `n/a` | `131` |
| `Router Advertisement (NDP)` | `n/a` | `134` |
| `Neighbor Advertisement` | `n/a` | `136` |
| `ICMP Node Information Response` | `n/a` | `140` |
| `Inverse Neighbor Discovery Advertisement` | `n/a` | `142` |
| `Home Agent Address Discovery Reply Message` | `n/a` | `145` |
| `Mobile Prefix Advertisement` | `n/a` | `147` |
| `Certification Path Advertisement` | `n/a` | `149` |
- **msg: Buffer**: A buffer object containing up to

`message_length_max`

bytes of the ICMP message. The

`message_length_max`

option is configured in the ICMP profile in the running config.

The following running config example changes the ICMP `message_length_max` from its default of 4096 bytes to 1234 bytes:

```javascript
"capture": {
    "app_proto": {
        "ICMP": {
            "message_length_max": 1234
         }
     }
}
```

| Tip: | You can convert the buffer object to a string through the String.fromCharCode method. To view the string in the runtime log, run the JSON.stringify method, as shown in the following example code:const icmp_msg = String.fromCharCode.apply(String, ICMP.msg); debug('ICMP message text: ' + JSON.stringify(icmp_msg, null, 4));You can also search the ICMP message strings with the includes and test methods, as shown in the following example code: const substring_search = 'search term'; const regex_search = '^search term$'; const icmp_msg = String.fromCharCode.apply(String, ICMP.msg); if (icmp_msg.includes(substring_search){ debug('ICMP message includes substring'); } if (regex_search.test(icmp_msg)){ debug('ICMP message matches regex'); } |
| --- | --- |
- **msgCode: Number**: The ICMP message code.
- **msgId: Number**: The ICMP message identifier for Echo Request, Echo Reply, Timestamp Request, Timestamp Reply, Information Request, and Information Reply messages. The value is

`null`

for all other message types.

The following table displays type IDs for the ICMP messages:

| Message | ICMPv4 Type | ICMPv6 Type |
| --- | --- | --- |
| `Echo Request` | `8` | `128` |
| `Echo Reply` | `0` | `129` |
| `Timestamp Request` | `13` | `n/a` |
| `Timestamp Reply` | `14` | `n/a` |
| `Information Request` | `15` | `n/a` |
| `Information Reply` | `16` | `n/a` |
- **msgLength: Number**: The length of the ICMP message, expressed in bytes.
- **msgText: String**: The descriptive text for the message (for example, echo request or port unreachable).
- **msgType: Number**: The ICMP message type.

The following table displays the ICMPv4 message types available:

| Type | Message |
| --- | --- |
| `0` | `Echo Reply` |
| `1 and 2` | `Unassigned` |
| `3` | `Destination Unreachable` |
| `4` | `Source Quench` |
| `5` | `Redirect Message` |
| `6` | `Alternate Host Address (deprecated)` |
| `7` | `Unassigned` |
| `8` | `Echo Request` |
| `9` | `Router Advertisement` |
| `10` | `Router Solicitation` |
| `11` | `Time Exceeded` |
| `12` | `Parameter Problem: Bad IP header` |
| `13` | `Timestamp` |
| `14` | `Timestamp Reply` |
| `15` | `Information Request (deprecated)` |
| `16` | `Information Reply (deprecated)` |
| `17` | `Address Mask Request (deprecated)` |
| `18` | `Address Mask Reply (deprecated)` |
| `19` | `Reserved` |
| `20-29` | `Reserved` |
| `30` | `Traceroute (deprecated)` |
| `31` | `Datagram Conversion Error (deprecated)` |
| `32` | `Mobile Host Redirect (deprecated)` |
| `33` | `Where Are You (deprecated)` |
| `34` | `Here I Am (deprecated)` |
| `35` | `Mobile Registration Request (deprecated)` |
| `36` | `Mobile Registration Reply (deprecated)` |
| `37` | `Domain Name Request (deprecated)` |
| `38` | `Domain Name Reply (deprecated)` |
| `39` | `Simple Key-Management for Internet Protocol (deprecated)` |
| `40` | `Photuris (deprecated)` |
| `41` | `ICMP experimental` |
| `42` | `Extended Echo Request` |
| `43` | `Extended Echo Reply` |
| `44-255` | `Unassigned` |

The following table displays the ICMPv6 message types available:

| Type | Message |
| --- | --- |
| `1` | `Destination Unreachable` |
| `2` | `Packet Too Big` |
| `3` | `Time Exceeded` |
| `4` | `Parameter Problem` |
| `100` | `Private Experimentation` |
| `101` | `Private Experimentation` |
| `127` | `Reserved for expansion of ICMPv6 error messages` |
| `128` | `Echo Request` |
| `129` | `Echo Reply` |
| `130` | `Multicast Listener Query` |
| `131` | `Multicast Listener Report` |
| `132` | `Multicast Listener Done` |
| `133` | `Router Solicitation` |
| `134` | `Router Advertisement` |
| `135` | `Neighbor Solicitation` |
| `136` | `Neighbor Advertisement` |
| `137` | `Redirect Message` |
| `138` | `Router Renumbering` |
| `139` | `ICMP Node Information Query` |
| `140` | `ICMP Node Information Response` |
| `141` | `Inverse Neighbor Discovery Solicitation Message` |
| `142` | `Inverse Neighbor Discovery Advertisement Message` |
| `143` | `Multicast Listener Discovery (MLDv2) reports` |
| `144` | `Home Agent Address Discovery Request Message` |
| `145` | `Home Agent Address Discovery Reply Message` |
| `146` | `Mobile Prefix Solicitation` |
| `147` | `Mobile Prefix Advertisement` |
| `148` | `Certification Path Solicitation` |
| `149` | `Certification Path Advertisement` |
| `150` | `ICMP messages utilized by experimental mobility protocols such as Seamoby` |
| `151` | `Multicast Router Advertisement` |
| `152` | `Multicast Router Solicitation` |
| `153` | `Multicast Router Termination` |
| `155` | `RPL Control Message` |
| `156` | `ILNPv6 Locator Update Message` |
| `157` | `Duplicate Address Request` |
| `158` | `Duplicate Address Confirmation` |
| `159` | `MPL Control Message` |
| `160` | `Extended Echo Request - No Error` |
| `161` | `Extended Echo Reply` |
| `200` | `Private Experimentation` |
| `201` | `Private Experimentation` |
| `255` | `Reserved for expansion of ICMPv6 informational messages` |
- **nextHopMTU: Number**: An ICMPv4

`Destination Unreachable`

or an ICMPv6

`Packet Too Big`

message, the maximum transmission unit of the next-hop link. The value is

`null`

for all other messages.

| Message | ICMPv4 Type | ICMPv6 Type |
| --- | --- | --- |
| `Destination Unreachable` | `3` | `n/a` |
| `Packet Too Big` | `n/a` | `2` |
- **original: Object**: An object containing the following elements from the IP datagram that caused the ICMP message to be sent:

- **ipproto: String**: The IP protocol of the datagram, such as TCP, UDP, ICMP, or ICMPv6.
- **ipver: String**: The IP version of the datagram, such as IPv4 or IPv6.
- **srcAddr: IPAddress**: The

[IPAddress](#ipaddress)

of the datagram sender.
- **srcPort: Number**: The port number of the datagram sender.
- **dstAddr: IPAddress**: The

[IPAddress](#ipaddress)

of the datagram receiver.
- **dstPort: Number**: The port number of the datagram receiver.

The value is `null` if the internet header and 64 bits of the Original Data datagram is not present in the message or if the IP protocol is not TCP or UDP.

Access only on `ICMP_MESSAGE` events; otherwise, an error will occur.
- **pointer: Number**: For a Parameter Problem message, the octet of the original datagram's header where the error was detected. The value is

`null`

for all other messages.

| Message | ICMPv4 Type | ICMPv6 Type |
| --- | --- | --- |
| `Parameter Problem` | `12` | `4` |
- **record: Object**: The record object that can be sent to the configured recordstore through a call to

`ICMP.commitRecord()`

on an

`ICMP_MESSAGE`

event.

The default record object can contain the following properties:

- `clientIsExternal`
- `gwAddr`
- `hopLimit`
- `msgCode`
- `msgId`
- `msgLength`
- `msgText`
- `msgType`
- `nextHopMTU`
- `pointer`
- `receiverIsExternal`
- `senderIsExternal`
- `serverIsExternal`
- `seqNum`
- `version`
- **seqNum: Number**: The ICMP sequence number for Echo Request, Echo Reply, Timestamp Request, Timestamp Reply, Information Request, and Information Reply messages. The value is

`null`

for all other messages.
- **version: Number**: The version of the ICMP message type, which can be ICMPv4 or ICMPv6.
