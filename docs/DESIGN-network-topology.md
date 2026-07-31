# Design: network topology map (Slice A — data model, layout, store)

## Problem

The app can investigate an incident but cannot **show you where it happened**. An
investigation ends as a report plus a prose timeline; the shape of the estate — what
talks to what, which identities live where, what depends on the domain controllers —
is reconstructed by hand every time and then thrown away.

This feature derives a **map of the network** from telemetry ExtraHop already has,
persists it as structured entities in the graph store, and renders it with
Google-Maps-style semantic zoom: zoom out for the whole environment, zoom in for
progressively more detail. An incident can later be drawn **on top** of that map as an
optional overlay (Slice C), so an attack reads as a path across the estate rather than a
list of timestamps.

The base map is a first-class standalone view. "No overlay" is the default.

## Scope of this slice

Slice A is everything up to (but not including) pixels: the collection skill, the
normalization contract, server-side layout, and the persistent store. Slice B renders
it, Slice C overlays incidents, Slice D adds drift.

---

## Data model

One **snapshot** is a complete observation of the environment at a point in time.
Snapshots are immutable and versioned; the map always renders exactly one.

```
nodes[]:      { key, kind:'device', name, ip, mac, role, vlan, tags[], critical, oid, discovery_id }
edges[]:      { src, dst, bytes_in, bytes_out, protocols[], first_seen, last_seen }
identities[]: { name, principal, devices[] }          // tier-2 only
snapshot:     { id, group, collected_at, window, tiers[], device_count, edge_count, truncated }
```

`key` is the stable node identity across snapshots. It is the device **OID** when known
(ExtraHop's own durable handle), else the IP. Drift detection (Slice D) diffs on `key`,
so a stable key is what makes "this device disappeared" meaningful rather than noise.

**Two ID spaces, both carried.** ExtraHop metrics address devices by **OID**; records
address them by **discovery_id**. A topology that intends to support record-level
drill-down (tier 2, and Slice C's overlay) must carry both — `skills/extrahop-excli`
documents this pivot and it is the single most common source of empty results.

### The zoom hierarchy

| Zoom | Tier | Node count (typical) |
| --- | --- | --- |
| 0 | Locality (Internal / External / DMZ / custom) | 3–8 |
| 1 | Segment / VLAN | 10–60 |
| 2 | Role cluster within segment | 40–200 |
| 3 | Device | up to the full estate |
| 4 | Device + identities / services | focused subset |

Aggregation happens **server-side** in `routes/topology.js`, so the browser never
receives the full device set at low zoom.

---

## Localities are derived, not fetched — and this is a real limitation

**ExtraHop's Network Localities are not reachable from this app.** No excli/exmcp tool
exposes them; `search_devices` filters are `id, vendor, name, software, role, devclass,
ipaddr (CIDR), macaddr, vlanid, activity, tag, discover_time, is_critical` — no locality
field, and `get_device` returns none. Locality exists only in the **Trigger API**
(`ipaddress.localityName` / `localityNames`), which runs inside a deployed trigger on
the appliance and is not callable from here.

So we derive locality from CIDR rules:

- Default (per `skills/extrahop-architecture/domains/device-discovery.md`): RFC1918
  space — `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16` — is **Internal**; everything
  else is **External**.
- Operators can override with their own `{ cidr, name }` rules in Settings, evaluated
  most-specific-prefix-first (mirroring how the Trigger API sorts `localityNames`).

**Consequence to state plainly:** an environment using non-RFC1918 internal space will
be grouped wrongly until its rules are entered here. Derived localities are labeled as
*derived* in the UI. If this proves unacceptable in practice, the fallback is to make
**Segment/VLAN** the default top tier — `vlanid` *is* directly queryable — and demote
locality to an optional overlay.

---

## Storage: a sibling graph, not the memory graph

Topology is written to FalkorDB graph **`${group}topology`** (e.g.
`pocextrahoptopology`), never into the investigation-memory graph `${group}`.

Why not share the graph:

- An inventory of thousands of devices would swamp `overview()`'s type counts, the
  untyped-node drift detector, and the deliberately-bounded ~40-node ego-network panel.
- Every query in `lib/memory-graph.js` would need a "and not topology" exclusion clause
  — a regression risk spread across a well-tested surface, for no benefit.
- The two datasets have different lifecycles: memory is append-only investigation
  knowledge; topology is a periodically-replaced inventory snapshot.

A sibling graph keeps `listGraphs()` validation, `createFalkorClient()`, and every
existing memory behavior untouched. Cross-referencing memory entities (e.g. "this device
appears in a past investigation") is done at **query time by name/IP**, not by shared
storage. The graph name is sanitized to lowercase-alphanumeric to match the
`sanitizeGroupId()` convention already enforced for group ids.

### Graph shape

```
(:TopoDevice   { key, snapshot_id, name, ip, mac, role, vlan, critical, oid, discovery_id, x, y })
(:TopoRole     { key, snapshot_id, name, segment, device_count, x, y })
(:TopoSegment  { key, snapshot_id, name, locality, device_count, x, y })
(:TopoLocality { key, snapshot_id, name, device_count, x, y })
(:TopoIdentity { key, snapshot_id, name, principal })
(:TopoSnapshot { id, group, collected_at, window, tiers, device_count, edge_count, truncated })

[:TALKS_TO { snapshot_id, bytes_in, bytes_out, bytes_total, protocols, first_seen, last_seen }]
[:IN_SEGMENT { snapshot_id }]   [:IN_LOCALITY { snapshot_id }]   [:AUTHENTICATED_AS { snapshot_id }]
```

Every node and edge carries `snapshot_id`, so snapshots coexist and Slice D can diff
two of them without a separate store.

**Label names are an injection boundary, not just validation.** Labels are interpolated
into Cypher (FalkorDB has no parameterized labels), so they come from a fixed whitelist
in `lib/topology-store.js` — the same rule `ONTOLOGY_TYPES` enforces in
`lib/memory-graph.js`. All string values go through `cypherStr()`.

---

## Layout runs on the server

Node positions are computed **in Node.js** by `lib/topology-layout.js` (graphology +
`graphology-layout-forceatlas2`) and persisted as `x`/`y` on each node. The client
receives pre-positioned nodes and binds them directly.

Why not lay out in the browser:

- ForceAtlas2 over a few thousand nodes on the main thread blocks it for seconds — the
  browser shows "page unresponsive."
- The usual escape hatch, graphology's `/worker` layout entry points, is **unavailable**:
  `lib/security-headers.js` sets `worker-src 'none'`, and those workers are constructed
  from blob URLs.
- We are already persisting a snapshot, so coordinates cost nothing extra to store.

Running server-side sidesteps the CSP constraint entirely rather than designing around
it, and V8 on the server isn't competing with UI repaints.

**Aggregate positions are centroids of their members**, not independent layouts: role
cluster = centroid of its devices, segment = centroid of its role clusters, locality =
centroid of its segments. This is what makes zoom feel like a map — a cluster always
sits where its members actually are, so zooming expands **in place** instead of
teleporting the viewer somewhere new.

Layout is **deterministic** (seeded from the node key, not `Math.random()`), so
re-ingesting identical input reproduces the same map. Slice D seeds from the previous
snapshot's coordinates so unchanged parts of the network don't drift between snapshots
and only genuine change moves.

Iterations are bounded and scaled to node count, with the elapsed time logged — layout
is a server-side budget item, and a pathological graph must degrade to "slightly worse
positions," never to a hung ingest. Measured on the dev machine
(`lib/topology-layout.js`, synthetic estates):

| Devices | Iterations | Layout time |
| --- | --- | --- |
| 100 | 600 | 39 ms |
| 1,000 | 400 | 1.5 s |
| 5,000 | 80 | 1.8 s |

That is a once-per-snapshot background cost on the server. The same work on the
browser's main thread would be a multi-second freeze on every map open.

---

## Collection: agent collects, server persists

| Step | Who | Why |
| --- | --- | --- |
| Query ExtraHop | **agent**, via `skills/network-topology` + `./excli-interface` | The read-only broker path already exists; the agent can adapt the sweep and answer follow-ups |
| Write `evidence/topology/topology.json` | agent | Normal workspace convention; the raw responses stay auditable under `evidence/` |
| Normalize → lay out → persist | **server** (`lib/topology-coordinator.js`) | Structured and exact: no LLM extraction in the write path, so byte counts, ports, and IDs survive losslessly |
| Serve the map | server (`routes/topology.js`) | Read-only, LOD-aggregated, bounded |

This mirrors `lib/memory-coordinator.js`'s turn-end reaction and keeps the existing trust
boundary: the agent never holds ExtraHop credentials, and the server never invents data.

The agent additionally records **one** short recall episode to Graphiti (via the normal
memory path) so semantic search can surface "we have a map of this environment" — the
episode is a pointer, not the data.

### Evidence tiers

Tier 1 always runs and is cheap enough to sweep the estate:

- `search_devices` (paged, CIDR-scoped) → nodes with role, VLAN, tags, criticality
- `get_device` on notable devices → `discovery_id`
- `execute_metric_query` with `net_detail` / `bytes_in`,`bytes_out`,
  `bucketing: total_by_object` → weighted, directional peer edges

Tier 2 runs **only when the user asks for it** (cost/scope discipline, documented in
`skills/network-topology/references/deep-dives.md`):

- protocol `_client` / `_server` categories → service-level dependencies
- `~flow` records → exact ports and per-connection detail
- Kerberos / NTLM / LDAP records → identity binding

---

## Scale and limits

- Server-side aggregation keeps the wire payload bounded regardless of estate size; the
  client renders at most a few hundred nodes at any zoom.
- `net_detail` returns **top-N peers per device**, not every peer — the map is the
  significant-traffic topology, not a complete flow record. This is a deliberate
  fidelity/cost trade and is stated in the UI.
- Devices with no observed traffic in the window appear as isolated nodes; they are real
  (discovered) but unconnected, not missing.
- Ingest is chunked so a large snapshot never exceeds the FalkorDB client timeout.

## Related

- [DESIGN-graphiti-memory.md](DESIGN-graphiti-memory.md) — the memory graph this
  deliberately does **not** share storage with.
- [DESIGN-memory-visualization.md](DESIGN-memory-visualization.md) — the existing
  bounded ego-network renderer and its ~40-node constraint.
- [SECURITY-HARDENING.md](SECURITY-HARDENING.md) — the CSP that drives server-side layout.
