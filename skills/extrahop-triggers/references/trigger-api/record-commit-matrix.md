# Record Commit Matrix

Use this to quickly determine whether a class exposes `commitRecord()` and which events are involved. Load the class file for timing, record object, and event-specific caveats.

| Class | Area | Events | commitRecord | File |
| --- | --- | --- | --- | --- |
| Flow | general-purpose-classes | FLOW_CLASSIFY, FLOW_DETACH, FLOW_RECORD, FLOW_TICK, FLOW_TURN | yes | [Flow](classes/general/flow.md) |
| Remote | open-data-stream-classes | REMOTE_RESPONSE | no | [Remote](classes/remote/remote.md) |
| Remote.HTTP | open-data-stream-classes | - | no | [Remote.HTTP](classes/remote/remote-http.md) |
| Remote.Kafka | open-data-stream-classes | - | no | [Remote.Kafka](classes/remote/remote-kafka.md) |
| Remote.MongoDB | open-data-stream-classes | - | no | [Remote.MongoDB](classes/remote/remote-mongodb.md) |
| Remote.Raw | open-data-stream-classes | - | no | [Remote.Raw](classes/remote/remote-raw.md) |
| Remote.Syslog | open-data-stream-classes | - | no | [Remote.Syslog](classes/remote/remote-syslog.md) |
| AAA | protocol-and-network-data-classes | AAA_REQUEST, AAA_RESPONSE | yes | [AAA](classes/protocol/aaa.md) |
| ActiveMQ | protocol-and-network-data-classes | ACTIVEMQ_MESSAGE | yes | [ActiveMQ](classes/protocol/activemq.md) |
| AJP | protocol-and-network-data-classes | AJP_REQUEST, AJP_RESPONSE | yes | [AJP](classes/protocol/ajp.md) |
| BACnet | protocol-and-network-data-classes | BACNET_MESSAGE | yes | [BACnet](classes/protocol/bacnet.md) |
| CDP | protocol-and-network-data-classes | CDP_FRAME | no | [CDP](classes/protocol/cdp.md) |
| CIFS | protocol-and-network-data-classes | CIFS_REQUEST, CIFS_RESPONSE | yes | [CIFS](classes/protocol/cifs.md) |
| DB | protocol-and-network-data-classes | DB_REQUEST, DB_RESPONSE | yes | [DB](classes/protocol/db.md) |
| DHCP | protocol-and-network-data-classes | DHCP_REQUEST, DHCP_RESPONSE | yes | [DHCP](classes/protocol/dhcp.md) |
| DHCP6 | protocol-and-network-data-classes | DHCP6_REQUEST, DHCP6_RESPONSE | yes | [DHCP6](classes/protocol/dhcp6.md) |
| DICOM | protocol-and-network-data-classes | DICOM_REQUEST, DICOM_RESPONSE | yes | [DICOM](classes/protocol/dicom.md) |
| DNP3 | protocol-and-network-data-classes | DNP3_REQUEST, DNP3_RESPONSE | yes | [DNP3](classes/protocol/dnp3.md) |
| DNS | protocol-and-network-data-classes | DNS_REQUEST, DNS_RESPONSE | yes | [DNS](classes/protocol/dns.md) |
| FIX | protocol-and-network-data-classes | FIX_REQUEST, FIX_RESPONSE | yes | [FIX](classes/protocol/fix.md) |
| FTP | protocol-and-network-data-classes | FTP_REQUEST, FTP_RESPONSE | yes | [FTP](classes/protocol/ftp.md) |
| HL7 | protocol-and-network-data-classes | HL7_REQUEST, HL7_RESPONSE | yes | [HL7](classes/protocol/hl7.md) |
| HTTP | protocol-and-network-data-classes | HTTP_REQUEST, HTTP_RESPONSE | yes | [HTTP](classes/protocol/http.md) |
| IBMMQ | protocol-and-network-data-classes | IBMMQ_REQUEST, IBMMQ_RESPONSE | yes | [IBMMQ](classes/protocol/ibmmq.md) |
| ICA | protocol-and-network-data-classes | ICA_AUTH, ICA_CLOSE, ICA_OPEN, ICA_TICK | yes | [ICA](classes/protocol/ica.md) |
| ICMP | protocol-and-network-data-classes | ICMP_MESSAGE | yes | [ICMP](classes/protocol/icmp.md) |
| Kerberos | protocol-and-network-data-classes | KERBEROS_REQUEST, KERBEROS_RESPONSE | yes | [Kerberos](classes/protocol/kerberos.md) |
| LDAP | protocol-and-network-data-classes | LDAP_REQUEST, LDAP_RESPONSE | yes | [LDAP](classes/protocol/ldap.md) |
| LLDP | protocol-and-network-data-classes | LLDP_FRAME | no | [LLDP](classes/protocol/lldp.md) |
| LLMNR | protocol-and-network-data-classes | LLMNR_REQUEST, LLMNR_RESPONSE | yes | [LLMNR](classes/protocol/llmnr.md) |
| Memcache | protocol-and-network-data-classes | MEMCACHE_REQUEST, MEMCACHE_RESPONSE | yes | [Memcache](classes/protocol/memcache.md) |
| Modbus | protocol-and-network-data-classes | MODBUS_REQUEST, MODBUS_RESPONSE | yes | [Modbus](classes/protocol/modbus.md) |
| MongoDB | protocol-and-network-data-classes | MONGODB_REQUEST, MONGODB_RESPONSE | yes | [MongoDB](classes/protocol/mongodb.md) |
| MSMQ | protocol-and-network-data-classes | MSMQ_MESSAGE | yes | [MSMQ](classes/protocol/msmq.md) |
| NetFlow | protocol-and-network-data-classes | NETFLOW_RECORD | no | [NetFlow](classes/protocol/netflow.md) |
| NFS | protocol-and-network-data-classes | NFS_REQUEST, NFS_RESPONSE | yes | [NFS](classes/protocol/nfs.md) |
| NMF | protocol-and-network-data-classes | NMF_RECORD | yes | [NMF](classes/protocol/nmf.md) |
| NTLM | protocol-and-network-data-classes | NTLM_MESSAGE | yes | [NTLM](classes/protocol/ntlm.md) |
| NTP | protocol-and-network-data-classes | NTP_MESSAGE | yes | [NTP](classes/protocol/ntp.md) |
| POP3 | protocol-and-network-data-classes | POP3_REQUEST, POP3_RESPONSE | yes | [POP3](classes/protocol/pop3.md) |
| QUIC | protocol-and-network-data-classes | QUIC_CLOSE, QUIC_OPEN | yes | [QUIC](classes/protocol/quic.md) |
| RDP | protocol-and-network-data-classes | RDP_CLOSE, RDP_OPEN, RDP_TICK | yes | [RDP](classes/protocol/rdp.md) |
| Redis | protocol-and-network-data-classes | REDIS_REQUEST, REDIS_RESPONSE | yes | [Redis](classes/protocol/redis.md) |
| RFB | protocol-and-network-data-classes | RFB_CLOSE, RFB_OPEN, RFB_TICK | yes | [RFB](classes/protocol/rfb.md) |
| RPC | protocol-and-network-data-classes | RPC_REQUEST, RPC_RESPONSE | yes | [RPC](classes/protocol/rpc.md) |
| RTCP | protocol-and-network-data-classes | RTCP_MESSAGE | yes | [RTCP](classes/protocol/rtcp.md) |
| RTP | protocol-and-network-data-classes | RTP_CLOSE, RTP_OPEN, RTP_TICK | yes | [RTP](classes/protocol/rtp.md) |
| SCCP | protocol-and-network-data-classes | SCCP_MESSAGE | yes | [SCCP](classes/protocol/sccp.md) |
| SDP | protocol-and-network-data-classes | - | no | [SDP](classes/protocol/sdp.md) |
| SFlow | protocol-and-network-data-classes | SFLOW_RECORD | yes | [SFlow](classes/protocol/sflow.md) |
| SIP | protocol-and-network-data-classes | SIP_REQUEST, SIP_RESPONSE | yes | [SIP](classes/protocol/sip.md) |
| SLP | protocol-and-network-data-classes | SLP_MESSAGE | yes | [SLP](classes/protocol/slp.md) |
| SMPP | protocol-and-network-data-classes | SMPP_REQUEST, SMPP_RESPONSE | yes | [SMPP](classes/protocol/smpp.md) |
| SMTP | protocol-and-network-data-classes | SMTP_OPEN, SMTP_REQUEST, SMTP_RESPONSE | yes | [SMTP](classes/protocol/smtp.md) |
| SNMP | protocol-and-network-data-classes | SNMP_REQUEST, SNMP_RESPONSE, SNMP_MESSAGE | yes | [SNMP](classes/protocol/snmp.md) |
| SOCKS | protocol-and-network-data-classes | SOCKS_REQUEST, SOCKS_RESPONSE | yes | [SOCKS](classes/protocol/socks.md) |
| SSH | protocol-and-network-data-classes | SSH_CLOSE, SSH_OPEN, SSH_TICK | yes | [SSH](classes/protocol/ssh.md) |
| SSL | protocol-and-network-data-classes | SSL_ALERT, SSL_CLOSE, SSL_HEARTBEAT, SSL_OPEN, SSL_PAYLOAD, SSL_RECORD, SSL_RENEGOTIATE | yes | [SSL](classes/protocol/ssl.md) |
| TCP | protocol-and-network-data-classes | TCP_CLOSE, TCP_OPEN, TCP_PAYLOAD | no | [TCP](classes/protocol/tcp.md) |
| Telnet | protocol-and-network-data-classes | TELNET_MESSAGE | yes | [Telnet](classes/protocol/telnet.md) |
| TFTP | protocol-and-network-data-classes | TFTP_REQUESTS, TFTP_RESPONSE | yes | [TFTP](classes/protocol/tftp.md) |
| Turn | protocol-and-network-data-classes | - | no | [Turn](classes/protocol/turn.md) |
| UDP | protocol-and-network-data-classes | UDP_PAYLOAD | no | [UDP](classes/protocol/udp.md) |
| WebSocket | protocol-and-network-data-classes | WEBSOCKET_OPEN, WEBSOCKET_CLOSE, WEBSOCKET_MESSAGE | no | [WebSocket](classes/protocol/websocket.md) |
| WSMAN | protocol-and-network-data-classes | WSMAN_REQUEST, WSMAN_RESPONSE | yes | [WSMAN](classes/protocol/wsman.md) |
