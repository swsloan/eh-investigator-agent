# Device Discovery

Use this file for device identity, metric buckets, locality, fingerprinting, and deduplication.

## Discovery model

After a device is discovered, ExtraHop collects metrics according to the analysis level configured for that device.

Default discovery is L2. L3 discovery can be configured globally per sensor or for specific CIDR ranges.

## L2 discovery

L2 discovery creates a device entry for each local MAC address observed over the wire. IP addresses map to the MAC, so metrics remain associated with the device as IP addresses change.

Remote IPs outside monitored broadcast domains may aggregate at the incoming router. DHCP relay can preserve remote IP-to-MAC continuity; without it, Remote L3 discovery is usually needed.

## L3 discovery

L3 discovery creates linked entries for each local device:

- an L2 parent with MAC address;
- an L3 child with IP addresses and MAC address.

Proxy ARP can create an L3 device for each IP the router answers for and can unintentionally discover remote devices. L2 metrics that cannot map to a specific L3 child, such as broadcast traffic, stay with the L2 parent.

## Remote L3 discovery

An IP observed without associated ARP/NDP is remote. Remote devices are not discovered by default.

Administrators can configure remote IP ranges. ExtraHop then creates one device entry per observed IP in those ranges. Remote devices do not have L2 parent entries.

Remote L3 discovery is common in large datacenter, routed, branch, and cloud/off-site monitoring patterns where the tap point is not on the same local segment as the endpoints.

## VPN discovery

VPN discovery correlates private RFC1918 addresses assigned to VPN clients with their public external IPs. It requires a manually configured VPN gateway and is not a default assumption.

## Locality

RFC1918 space is classified as internal by default:

- `10.0.0.0/8`
- `172.16.0.0/12`
- `192.168.0.0/16`

Administrators can adjust internal/external classification for environments that use non-RFC1918 internal space.

## Software fingerprinting

ExtraHop passively observes network fields and matches them against a curated fingerprint database. It does not actively probe devices for fingerprinting.

Observed fields can include HTTP Server headers, X.509 certificate subjects, and DHCP vendors. Fingerprint updates are cloud-delivered where ExtraHop Cloud Services are available.

## Deduplication

ExtraHop removes duplicate L2 and L3 frames/packets by default during metric collection and aggregation.

L2 deduplication removes identical Ethernet frames when the header and payload match, the duplicate is the immediately previous packet, and it arrives within 1 ms.

L3 deduplication removes duplicate TCP or UDP IPv4 packets on the same flow when packet identity, direction, length, IP ID, timing, and relevant checksums match. It does not apply to IPv6.

Deduplication commonly corrects packet-broker or port-mirroring artifacts that would otherwise appear as duplicate traffic or false retransmissions.
