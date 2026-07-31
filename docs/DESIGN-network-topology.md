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

## The attack overlay (Slice C)

Optional by construction: the picker defaults to **No overlay** and the base map is a
complete product without it.

**Incidents come from session workspaces, not the graph.** `evidence/verdict.json` is
the only structured forensic sequence that exists — the memory graph holds entities but
no ordered events, because the capture prompt asks for one prose episode. So
`/api/topology/incidents` enumerates workspaces (current and past sessions alike).

**Binding is best-effort, and says so.** The timeline contract gained optional `src`,
`dst`, `entities[]` and `tactic` fields, but every verdict already on disk lacks them:
the actors are prose inside `detail`. For those, `lib/attack-overlay.js` extracts IPs
and hostnames and treats the first-mentioned as the actor — then marks the event
**inferred** in the UI. A map that quietly guessed direction would be asserting
something the investigation never said.

**Ordering reconciles mixed time formats.** Real verdicts mix ISO stamps, bare clock
times, ranges, and phrases like "ongoing" in one timeline. Comparing those raw is wrong
by ~5 orders of magnitude (an epoch stamp vs. milliseconds-since-midnight), which threw
a late-stage event to the front of the attack. `orderEvents` walks in the analyst's
order carrying the last absolute date and anchors clock-only entries to it — how a
person reads it — rolling to the next day when the clock goes backwards.

**Selecting an incident reframes the map.** At an aggregate tier every actor collapses
into one cluster, so there is no path to draw. Choosing an incident therefore jumps to a
device view scoped to exactly its participants (`/map?keys=…`) — the map equivalent of
searching an address. The breadcrumb shows where you are and returns you.

**Repeat visits to one pair collapse into one path.** An attack routinely hits the same
two hosts several times (probe, then encrypt, then stage); those are one line on the
map, labelled with every step number it carries and coloured by the furthest-along
stage. The footer reports steps, paths, and nodes separately so the aggregation is
visible rather than hidden.

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

## Drift — what changed (Slice D)

A map tells you what the network looks like; **drift tells you what just became
true**, which is often the more useful question. `lib/topology-drift.js` diffs two
snapshots on the stable `key` and reports devices added/removed, role, criticality
and segment changes, dependencies gained and lost, and identities appearing on hosts
they have never used.

Every change carries a **severity**, so the list leads with what matters rather than
with whatever is most numerous: a new workstation is `info`, a new domain controller
is `high`, an account showing up on a new host is `medium` (a classic lateral-movement
tell). Conversations are keyed by canonical pair, so writing `a→b` one day and `b→a`
the next does not fabricate a change.

### Frame-to-frame stability is a hard requirement here

Drift is unreadable if re-running the layout reshuffles the map — the operator cannot
tell real movement from solver wander. Seeding ForceAtlas2 from the previous
coordinates is **not sufficient**: FA2 has no fixed origin or scale, so a re-run
drifts and rescales the whole graph (measured ~40% of the graph's extent after adding
a single device). Two things fix it:

1. **`alignTo`** fits a similarity transform (translate + uniform scale) on the nodes
   common to both layouts, putting the frame back where it was. Rotation is
   deliberately not corrected — FA2 seeded from a settled layout does not
   systematically rotate, and fitting rotation on a near-degenerate point set is
   numerically worse than leaving it be.
2. **A reduced iteration budget** when most nodes are seeded (15% of normal): a
   near-identical graph only needs to place what changed.

Measured after both: unchanged devices move a **median 1.4%** of the graph's extent
(p90 1.7%, max 2.6%) when a device is added. Locked in by a test.

### Retention

Snapshots accumulate one per mapping run, each carrying every device and conversation.
The coordinator keeps the newest `EH_TOPOLOGY_KEEP` (default 12) and prunes the rest
**after** a successful write, so a failed prune can never cost the snapshot just taken.

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
