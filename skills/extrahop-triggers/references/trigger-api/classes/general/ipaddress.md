---
{
  "anchor": "ipaddress",
  "api_area": "trigger-api",
  "doc_kind": "class",
  "events": [],
  "examples": [],
  "methods": [
    "IPAddress(ip: String | Number, mask: Number)",
    "ip: String",
    "mask: Number",
    "equals(equals: IPAddress): Boolean",
    "mask(mask: Number): IPAddress",
    "toJSON(): String",
    "toString(): String"
  ],
  "name": "IPAddress",
  "properties": [
    "hostNames: Array of Strings",
    "isBroadcast: Boolean",
    "isExternal: Boolean",
    "isLinkLocal: Boolean",
    "isMulticast: Boolean",
    "isRFC1918: Boolean",
    "isV4: Boolean",
    "isV6: Boolean",
    "localityName: String | null",
    "localityNames: Array of Strings"
  ],
  "section": "general-purpose-classes",
  "source_url": "https://docs.extrahop.com/current/extrahop-trigger-api/",
  "source_version": "26.2"
}
---

### IPAddress

The `IPAddress` class enables you to retrieve IP address attributes. The IPAddress class is also available as a property for the Flow class.

#### Methods

- **IPAddress(ip: String | Number, mask: Number)**: Constructor for the IPAddress class that takes two parameters:

- **ip: String**: The IP address string in CIDR format.
- **mask: Number**: The optional subnet mask in a numerical format, representing the number of leftmost '1' bits in the mask (optional).

#### Instance methods

- **equals(equals: IPAddress): Boolean**: Performs an equality test between IPAddress objects as shown in the following example:

```javascript
const exampleIp = new IPAddress("10.10.10.10"); 
if (Flow.client.ipaddr.equals(exampleIp)) {
    // Perform a task 
} 
```
- **mask(mask: Number): IPAddress**: Sets the subnet mask of the IPAddress object as shown in the following example:

```javascript
if ((Flow.ipaddr1.mask(24).toString() === "173.194.33.0")||
(Flow.ipaddr2.mask(24).toString() === "173.194.33.0"))
{Flow.setApplication("My L4 App");}
```

The `mask` parameter specifies the subnet mask in a numerical format, representing the number of leftmost '1' bits in the mask (optional).
- **toJSON(): String**: Converts the IPAddress object to JSON format.
- **toString(): String**: Converts the IPAddress object to a printable string as shown in the following example:

```javascript
if (Flow.client.ipaddr.toString() === "10.10.10.10"){ 
    // perform a task 
}
```

#### Properties

- **hostNames: Array of Strings**: An array of hostnames associated with the IPAddress.
- **isBroadcast: Boolean**: The value is

`true`

if the IP address is a broadcast address.
- **isExternal: Boolean**: The value is

`true`

if the IP address is external to your network.
- **isLinkLocal: Boolean**: The value is

`true`

if the IP address is a link local address such as (169.254.0.0/16).
- **isMulticast: Boolean**: The value is

`true`

if the IP address is a multicast address.
- **isRFC1918: Boolean**: The value is

`true`

if the IP address belongs to one of the RFC1918 private IP ranges (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16). The value is always

`false`

for IPv6 addresses.
- **isV4: Boolean**: The value is

`true`

if the IP address is an IPv4 address.
- **isV6: Boolean**: The value is

`true`

if the IP address is an IPv6 address.
- **localityName: String | null**: The name of the network locality that the IP address is in. If the IP address is in more than one network locality, the name of the first network locality is returned. To view the full list of network localities, specify the

`localityNames`

property. If the IP address is not in any network locality, the value is null.
- **localityNames: Array of Strings**: An array of network localities that the IP address is in. If the IP address is in more than 256 network localities, the array contains the first 256 entries. The array is sorted first by external networks, then internal networks, and then by network prefix length, with longer network prefixes first. For example,

`10.10.1.2/32`

appears before

`10.0.0.0/8`

. If the IP address is not in any network locality, the array is empty.
