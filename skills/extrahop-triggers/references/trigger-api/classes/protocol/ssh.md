---
{
  "anchor": "ssh",
  "api_area": "trigger-api",
  "doc_kind": "class",
  "events": [
    "SSH_CLOSE",
    "SSH_OPEN",
    "SSH_TICK"
  ],
  "examples": [],
  "methods": [
    "commitRecord(): void"
  ],
  "name": "SSH",
  "properties": [
    "clientBytes: Number",
    "clientCipherAlgorithm: String",
    "clientCompressionAlgorithm: String",
    "clientCompressionAlgorithmsClientToServer: String",
    "clientCompressionAlgorithmsServerToClient: String",
    "clientEncryptionAlgorithmsClientToServer: String",
    "clientEncryptionAlgorithmsServerToClient: String",
    "clientImplementation: String",
    "clientKexAlgorithms: String",
    "clientL2Bytes: Number",
    "clientMacAlgorithm: String",
    "clientMacAlgorithmsClientToServer: String",
    "clientMacAlgorithmsServerToClient: String",
    "clientPkts: Number",
    "clientRTO: Number",
    "clientVersion: String",
    "clientZeroWnd: Number",
    "duration: Number",
    "hasshAlgorithms: String",
    "hassh: String",
    "hasshServerAlgorithms: String",
    "hasshServer: String",
    "ja4SSH: String",
    "kexAlgorithm: String",
    "messageNumbers: Array of Numbers",
    "record: Object",
    "roundTripTime: Number",
    "serverBytes: Number",
    "serverCipherAlgorithm: String",
    "serverCompressionAlgorithm: String",
    "serverCompressionAlgorithmsClientToServer: String",
    "serverCompressionAlgorithmsServerToClient: String",
    "serverEncryptionAlgorithmsClientToServer: String",
    "serverEncryptionAlgorithmsServerToClient: String",
    "serverHostKey: String",
    "serverHostKeyType: String",
    "serverImplementation: String",
    "serverKexAlgorithms: String",
    "serverL2Bytes: Number",
    "serverMacAlgorithm: String",
    "serverMacAlgorithmsClientToServer: String",
    "serverMacAlgorithmsServerToClient: String",
    "serverPkts: Number",
    "serverRTO: Number",
    "serverVersion: String",
    "serverZeroWnd: Number"
  ],
  "section": "protocol-and-network-data-classes",
  "source_url": "https://docs.extrahop.com/current/extrahop-trigger-api/",
  "source_version": "26.2"
}
---

### SSH

Secure Socket Shell (SSH) is a network protocol that provides a secure method for remote login and other network services over an unsecured network. The `SSH` class object enables you to store metrics and access properties on `SSH_CLOSE`, `SSH_OPEN` and `SSH_TICK` events.

#### Events

- **SSH_CLOSE**: Runs when the SSH connection is shut down by being closed, expired, or aborted.
- **SSH_OPEN**: Runs when the SSH connection is first fully established after negotiating session information. If the negotiation fails because the key exchange is invalid, the

`SSH_OPEN`

event runs when there is an invalid exchange, and then the

`SSH_TICK`

and

`SSH_CLOSE`

events run in immediate succession.

If a connection closes before `SSH_OPEN` runs, `SSH_OPEN`, `SSH_TICK`, and `SSH_CLOSE` run in immediate succession.

- **SSH_TICK**: Runs periodically on SSH flows.

#### Methods

- **commitRecord(): void**: Sends a record to the configured recordstore on either an

`SSH_OPEN`

,

`SSH_CLOSE`

, or

`SSH_TICK`

event.

The event determines which properties are committed to the record object. To view the properties committed for each event, see the `record` property below.

For built-in records, each unique record is committed only once, even if `SSH.commitRecord` is called multiple times for the same unique record.

#### Properties

- **clientBytes: Number**: The total number of bytes sent by the

client

since the last SSH event ran. For

`SSH_OPEN`

events, this property is the number of bytes sent by the client since the start of the flow.
- **clientCipherAlgorithm: String**: The encryption cipher algorithm on the SSH

client

.
- **clientCompressionAlgorithm: String**: The compression algorithm applied to data transferred over the connection by the SSH client.
- **clientCompressionAlgorithmsClientToServer: String**: The compression algorithms that the SSH client supports for client to server communications.
- **clientCompressionAlgorithmsServerToClient: String**: The compression algorithms that the SSH client supports for server to client communications.
- **clientEncryptionAlgorithmsClientToServer: String**: The encryption algorithms that the SSH client supports for client to server communications.
- **clientEncryptionAlgorithmsServerToClient: String**: The encryption algorithms that the SSH client supports for server to client communications.
- **clientImplementation: String**: The SSH implementation installed on the client, such as OpenSSH or PUTTY.
- **clientKexAlgorithms: String**: The SSH key exchange algorithms that the client supports.
- **clientL2Bytes: Number**: The total number of

L2

client bytes observed since the last SSH event ran. For

`SSH_OPEN`

events, this property is the number of L2 client bytes observed since the start of the flow. Note that this property does not return the total number of bytes for the entire SSH session.
- **clientMacAlgorithm: String**: The Method Authentication Code (MAC) algorithm on the SSH client.
- **clientMacAlgorithmsClientToServer: String**: The Method Authentication Code (MAC) algorithms that the SSH client supports for client to server communications.
- **clientMacAlgorithmsServerToClient: String**: The Method Authentication Code (MAC) algorithms that the SSH client supports for server to client communications.
- **clientPkts: Number**: The total number of packets sent by the client since the last SSH event ran. For

`SSH_OPEN`

events, this property is the number of packets sent by the client since the start of the flow. Note that this property does not return the total number of packets for the entire SSH session.
- **clientRTO: Number**: The total number of client

retransmission timeouts

(RTOs) observed since the last SSH event ran. For

`SSH_OPEN`

events, this property is the number of client RTOs observed since the start of the flow. Note that this property does not return the total number of client RTOs for the entire SSH session.
- **clientVersion: String**: The version of SSH on the

client

.
- **clientZeroWnd: Number**: The total number of zero windows sent by the client since the last SSH event ran. For

`SSH_OPEN`

events, this property is the number of zero windows sent by the client since the start of the flow. Note that this property does not return the total number of zero windows for the entire SSH session.
- **duration: Number**: The duration, expressed in milliseconds, of the SSH connection.

Access only on `SSH_CLOSE` events; otherwise, an error will occur.
- **hasshAlgorithms: String**: A string containing the SSH key exchange, encryption, message authentication, and compression algorithms that the client supports for SSH communications. These algorithms are communicated in the SSH_MSG_KEXINIT packet sent at the start of an SSH connection.
- **hassh: String**: An MD5 hash of the hasshAlgorithms string.
- **hasshServerAlgorithms: String**: A string containing the SSH key exchange, encryption, message authentication, and compression algorithms that the server supports for SSH communications. These algorithms are communicated in the SSH_MSG_KEXINIT packet sent at the start of an SSH connection.
- **hasshServer: String**: An MD5 hash of the hasshServerAlgorithms string.
- **ja4SSH: String**: The JA4S fingerprint for the SSH traffic, which includes the packet length modes, number of packets, and ACKs for the SSH client and server.

Access only on `SSH_TICK` events; otherwise, an error will occur. The `ja4SSH` property is available on every other `SSH_TICK` event. If the property is not available, an empty string is returned.
- **kexAlgorithm: String**: The Key Exchange (Kex) algorithm on the SSH connection.
- **messageNumbers: Array of Numbers**: The numeric IDs of the SSH messages exchanged, listed in chronological order. The array cannot contain more than 50 entries. If more than 50 messages are exchanged, the array contains the 50 most recent IDs.

Access only on `SSH_OPEN` events; otherwise, an error will occur.
- **record: Object**: The record object that can be sent to the configured recordstore through a call to

`SSH.commitRecord()`

on either an

`SSH_OPEN`

,

`SSH_CLOSE`

, or

`SSH_TICK`

event.

The event on which the method was called determines which properties the default record object can contain as displayed in the following table:

| `SSH_TICK` | `SSH_OPEN` | `SSH_CLOSE` |
| --- | --- | --- |
| `clientCipherAlgorithm` | `clientCipherAlgorithm` | `clientCipherAlgorithm` |
| `clientCompressionAlgorithm` | `clientCompressionAlgorithm` | `clientCompressionAlgorithm` |
| `clientImplementation` | `clientImplementation` | `clientImplementation` |
| `clientIsExternal` | `clientIsExternal` | `clientIsExternal` |
| `clientMacAlgorithm` | `clientMacAlgorithm` | `clientMacAlgorithm` |
| `clientVersion` | `clientVersion` | `clientVersion` |
| `clientZeroWnd` | `clientZeroWnd` | `clientZeroWnd` |
| `kexAlgorithm` | `kexAlgorithm` | `kexAlgorithm` |
| `receiverIsExternal` | `receiverIsExternal` | `receiverIsExternal` |
| `senderIsExternal` | `senderIsExternal` | `senderIsExternal` |
| `serverCipherAlgorithm` | `serverCipherAlgorithm` | `serverCipherAlgorithm` |
| `serverCompressionAlgorithm` | `serverCompressionAlgorithm` | `serverCompressionAlgorithm` |
| `serverImplementation` | `serverImplementation` | `serverImplementation` |
| `serverIsExternal` | `serverIsExternal` | `serverIsExternal` |
| `serverMacAlgorithm` | `serverMacAlgorithm` | `serverMacAlgorithm` |
| `serverVersion` | `serverVersion` | `serverVersion` |
| `serverZeroWnd` | `serverZeroWnd` | `serverZeroWnd` |
|  |  | `duration` |
- **roundTripTime: Number**: The median round trip time (RTT), expressed in milliseconds.

An RTT is the time it took for a device to send a single TCP packet and receive an immediate corresponding acknowledgment (ACK) packet.

The median value is calculated by sampling the RTTs observed since the last SSH event ran; for

`SSH_OPEN`

events, the sample begins at the start of the flow. The value is

`NaN`

if there are no RTT samples.
- **serverBytes: Number**: The total number of bytes sent by the server since the last SSH event ran. For

`SSH_OPEN`

events, this property is the number of bytes sent by the server since the start of the flow.
- **serverCipherAlgorithm: String**: The encryption cipher algorithm on the SSH server.
- **serverCompressionAlgorithm: String**: Returns the type of compression applied to data transferred over the connection by the SSH server.
- **serverCompressionAlgorithmsClientToServer: String**: The compression algorithms that the SSH server supports for client to server communications.
- **serverCompressionAlgorithmsServerToClient: String**: The compression algorithms that the SSH server supports for server to client communications.
- **serverEncryptionAlgorithmsClientToServer: String**: The encryption algorithms that the SSH server supports for client to server communications.
- **serverEncryptionAlgorithmsServerToClient: String**: The encryption algorithms that the SSH server supports for server to client communications.
- **serverHostKey: String**: The base64 encoding of the public SSH key sent from the server to the client.
- **serverHostKeyType: String**: The type of public SSH key sent from the server to the client, such as ssh-rsa or ssh-ed25519.
- **serverImplementation: String**: The SSH implementation installed on the server, such as OpenSSH or PUTTY.
- **serverKexAlgorithms: String**: The SSH key exchange algorithms that the server supports.
- **serverL2Bytes: Number**: The total number of

L2

server bytes observed since the last SSH event ran. For

`SSH_OPEN`

events, this property is the number of L2 server bytes observed since the start of the flow. Note that this property does not return the total number of bytes for the entire SSH session.
- **serverMacAlgorithm: String**: The Method Authentication Code (MAC) algorithm on the SSH server.
- **serverMacAlgorithmsClientToServer: String**: The Method Authentication Code (MAC) algorithms that the SSH server supports for client to server communications.
- **serverMacAlgorithmsServerToClient: String**: The Method Authentication Code (MAC) algorithms that the SSH server supports for server to client communications.
- **serverPkts: Number**: The total number of packets sent by the server since the last SSH event ran. For

`SSH_OPEN`

events, this property is the number of packets sent by the server since the start of the flow. Note that this property does not return the total number of packets for the entire SSH session.
- **serverRTO: Number**: The total number of server

retransmission timeouts

(RTOs) observed since the last SSH event ran. For

`SSH_OPEN`

events, this property is the number of server RTOs observed since the start of the flow. Note that this property does not return the total number of server RTOs for the entire SSH session.
- **serverVersion: String**: The version of SSH on the server.
- **serverZeroWnd: Number**: The total number of packets sent by the server since the last SSH event ran. For

`SSH_OPEN`

events, this property is the number of packets sent by the server since the start of the flow. Note that this property does not return the total number of zero windows for the entire SSH session.
