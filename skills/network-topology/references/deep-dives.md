# Tier 2 deep-dives

Run these **only when the user asks**. Tier 1 (`net_detail` peers) is the map;
these add resolution to it and cost substantially more. Each one folds back into
`evidence/topology/topology.json` — re-write the file with the enriched data and add
its name to the snapshot's `tiers` list so the map can say what depth it reflects.

---

## A. Service dependencies — what each link actually carries

Turns raw adjacency ("these two hosts exchange bytes") into dependency ("this app
server depends on that domain controller for Kerberos"). This is usually the most
valuable upgrade and the cheapest of the three.

Device-level protocol categories **must** carry a `_client` or `_server` suffix, and
client/server perspectives are not interchangeable — if one is empty, try the other.

```bash
./excli-interface execute_metric_query -json '{"object_type":"device","object_ids":[4294967296],"metric_category":"cifs_server_detail","metric_specs":[{"name":"req"}],"bucketing":"total_by_object","from":-86400000,"until":0,"limit":1000}' > evidence/metrics/cifs-server-detail.json
```

Useful categories: `cifs_client` / `cifs_server`, `dns_client` / `dns_server`,
`http_client` / `http_server`, `ldap_client` / `ldap_server`, `kerberos_client` /
`kerberos_server`, `ssl_client` / `ssl_server`, `db_client` / `db_server`.

**Fold back:** add the protocol name to that edge's `protocols` array. An edge
carrying `["kerberos","ldap"]` toward a `domain_controller` is a real dependency
statement, and the map reads it as one.

Confirm every category and stat name with `search_metric_catalog` first — do not
guess them from UI labels.

---

## B. Exact connections — ports and per-connection detail

Highest fidelity, heaviest cost. Scope it to a **selected device or link**, never the
whole estate.

Record filters take **`discovery_id`**, not the OID — call `get_device` first if you
only have the OID. `~flow` carries L3/L4 connection metadata (participants, ports,
bytes, duration):

```bash
./excli-interface search_records -json '{"types":["~flow"],"filter":{"operator":"or","rules":[{"field":"client","operator":"=","operand":"005056bb0a190000"},{"field":"server","operator":"=","operand":"005056bb0a190000"}]},"from":-3600000,"limit":1000}' > evidence/records/flow-device.json
```

Builtin record types start with `~`. The real names are `~dns_request`/`~dns_response`,
`~ssl_open`/`~ssl_close`, `~kerberos_request`/`~kerberos_response` — there is no bare
`~dns` or `~ssl`. Numeric filter operands must still be strings (`"445"`, not `445`).
Special fields `.ipaddr` (any IP field) and `.port` (any port field) are useful here.

**Fold back:** add observed ports to the edge's `protocols` (e.g. `"tcp/445"`), and
tighten `first_seen` / `last_seen` from the record timestamps.

---

## C. Identity binding — which users authenticate from which hosts

This is the "devices with associated identities" half of the map. Authentication
records name the principal on a session.

```bash
./excli-interface search_records -json '{"types":["~kerberos_request"],"filter":{"field":"client","operator":"=","operand":"005056bb0a190000"},"from":-86400000,"limit":500}' > evidence/records/kerberos-client.json
```

Also useful: `~ntlm` (Windows auth without Kerberos) and `~ldap_request` (directory
binds). Scope to notable devices — servers, domain controllers, anything already
implicated — rather than sweeping every workstation.

**Fold back:** populate the snapshot's `identities` array:

```json
"identities": [
  { "name": "sean.todd@ACMELEGAL.LAB", "principal": "sean.todd@ACMELEGAL.LAB", "devices": ["4294967325"] }
]
```

`devices` entries may be OIDs, IPs, or device keys; unresolvable ones are dropped.
A principal seen on several hosts is a single identity bound to several devices —
emit it once with all of them, not once per host.

**Say what it means, and what it doesn't.** An identity observed on a host means that
account authenticated from or to it in the window. It does not establish that the
account is compromised, nor that the human owning it was present.
