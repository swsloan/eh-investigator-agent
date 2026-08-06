import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { listSnapshots, latestSnapshotId, readEnrichments, readIdentities, readMixedTier, readNode, readNodeHistory, readSnapshotForDiff, readTier, topologyGraphName } from '../lib/topology-store.js';
import { buildOverlay } from '../lib/attack-overlay.js';
import { describeDrift, diffSnapshots } from '../lib/topology-drift.js';

/**
 * Read-only network-topology map API (Slice A). Backs the zoomable map.
 *
 * Aggregation happens HERE, not in the browser: `/map` returns one zoom tier at a
 * time (localities → segments → role clusters → devices), so the wire payload stays
 * bounded no matter how large the estate is. Nodes arrive with server-computed x/y,
 * so the client binds coordinates and renders immediately (see
 * docs/DESIGN-network-topology.md for why layout is not done in the browser).
 *
 *   GET  /api/topology/snapshots?group=                 -> versions, newest first
 *   GET  /api/topology/map?group=&snapshot=&zoom=&parent= -> one tier, with coordinates
 *   GET  /api/topology/node/:key?group=&snapshot=       -> device detail + peers + identities
 *   POST /api/topology/ingest/:sessionId                -> re-ingest a workspace artifact
 *
 * Reads use GRAPH.RO_QUERY. The only write is the explicit ingest, which goes
 * through the same coordinator the turn-end path uses.
 */
export function topologyRouter({ getConfig, client, coordinator, sessions, resolveGroup, ensureEnrichmentSession, redact = (v) => v }) {
  const router = express.Router();
  let cachedGraphs = null;
  let cachedAt = 0;

  function enabled() {
    return Boolean(client) && Boolean(getConfig?.().memory?.enabled);
  }

  async function graphList() {
    const now = Date.now();
    if (!cachedGraphs || now - cachedAt > 30_000) {
      cachedGraphs = await client.listGraphs();
      cachedAt = now;
    }
    return cachedGraphs;
  }

  /**
   * Resolve the requested group to one whose topology graph actually exists.
   * Validating against the live graph list means an arbitrary query string can
   * never reach FalkorDB as a graph key — the same guard routes/memory-graph.js uses.
   */
  async function pickGroup(req) {
    const requested = typeof req.query.group === 'string' ? req.query.group : '';
    const fallback = resolveGroup?.() || '';
    const graphs = await graphList();
    for (const candidate of [requested, fallback]) {
      if (candidate && graphs.includes(topologyGraphName(candidate))) return candidate;
    }
    // Nothing mapped yet for either — report the fallback so the UI can say "no map".
    return fallback || requested;
  }

  async function pickSnapshot(req, group) {
    const requested = typeof req.query.snapshot === 'string' ? req.query.snapshot : '';
    if (requested) {
      const known = await listSnapshots(client, group, 100);
      if (known.some((s) => s.id === requested)) return requested;
    }
    return latestSnapshotId(client, group);
  }

  function guard(req, res) {
    if (!enabled()) {
      res.status(503).json({ error: 'Topology storage is not enabled (Settings → Memory).' });
      return false;
    }
    return true;
  }

  function fail(res, err) {
    res.status(500).json({ error: redact(err?.message || 'Topology query failed.') });
  }

  router.get('/snapshots', async (req, res) => {
    if (!guard(req, res)) return;
    try {
      const group = await pickGroup(req);
      const graphs = await graphList();
      if (!graphs.includes(topologyGraphName(group))) return res.json({ group, snapshots: [] });
      res.json({ group, snapshots: await listSnapshots(client, group, req.query.limit) });
    } catch (err) { fail(res, err); }
  });

  router.get('/map', async (req, res) => {
    if (!guard(req, res)) return;
    try {
      const group = await pickGroup(req);
      const graphs = await graphList();
      if (!graphs.includes(topologyGraphName(group))) {
        return res.json({ group, snapshot_id: '', nodes: [], edges: [], zoom: 0, empty: true });
      }
      const snapshotId = await pickSnapshot(req, group);
      if (!snapshotId) return res.json({ group, snapshot_id: '', nodes: [], edges: [], zoom: 0, empty: true });

      // `expanded` asks for the zone view: segments, with the named ones opened into
      // their devices. It is its own read because the payload is mixed-resolution and
      // has no single `zoom`; every other parameter combination keeps the old path.
      if (typeof req.query.expanded === 'string') {
        const mixed = await readMixedTier(client, group, {
          snapshotId,
          expanded: req.query.expanded.split(',').map((k) => k.trim()).filter(Boolean),
          external: req.query.external === '1' || req.query.external === 'true',
          limit: req.query.limit,
        });
        return res.json({ group, ...mixed });
      }

      const tier = await readTier(client, group, {
        snapshotId,
        zoom: req.query.zoom,
        parent: typeof req.query.parent === 'string' ? req.query.parent : '',
        // Which device field a device-tier drill matches `parent` on, so a segment can
        // drill straight to its devices (skipping the degenerate Role hop).
        scope: typeof req.query.scope === 'string' ? req.query.scope : '',
        // Default view hides External; `external=1` opts it back in.
        external: req.query.external === '1' || req.query.external === 'true',
        // `neighbors=1` pulls one-hop peers outside a scoped device view.
        neighbors: req.query.neighbors === '1' || req.query.neighbors === 'true',
        // `keys` is the attack overlay asking for exactly the incident's devices.
        keys: typeof req.query.keys === 'string' && req.query.keys
          ? req.query.keys.split(',').map((k) => k.trim()).filter(Boolean)
          : null,
        limit: req.query.limit,
      });
      res.json({ group, ...tier });
    } catch (err) { fail(res, err); }
  });

  router.get('/node/:key', async (req, res) => {
    if (!guard(req, res)) return;
    try {
      const group = await pickGroup(req);
      const snapshotId = await pickSnapshot(req, group);
      if (!snapshotId) return res.status(404).json({ error: 'No topology snapshot for this group.' });
      const detail = await readNode(client, group, { snapshotId, key: req.params.key });
      if (!detail) return res.status(404).json({ error: 'Device not found in this snapshot.' });
      res.json({ group, snapshot_id: snapshotId, ...detail });
    } catch (err) { fail(res, err); }
  });

  // Enrichment quick-picks the UI offers, mapped to a concrete ExtraHop ask. The label
  // is stored with the result; the ask guides the agent. Free text is also allowed.
  const ENRICH_PRESETS = {
    ports: 'the listening/open ports and the services on them',
    dns: 'recent DNS lookups this device made (domains queried)',
    users: 'which user accounts authenticated from or to this device',
    software: 'the operating system, software, and vendor/model details',
    peers: 'its most significant peers with protocols and byte volumes',
  };

  /**
   * Kick off a user-directed enrichment for one device (Slice 5). The server has no
   * excli access — only the agent does — so this sends a scoped prompt to a dedicated
   * background "map" session, which queries ExtraHop read-only and appends the result
   * to evidence/topology/enrichments.json; the coordinator merges it into a durable,
   * snapshot-independent store at turn end. The UI polls GET /enrichments/:key.
   */
  router.post('/enrich/:key', async (req, res) => {
    if (!guard(req, res)) return;
    if (typeof ensureEnrichmentSession !== 'function') {
      return res.status(503).json({ error: 'Enrichment is not available in this deployment.' });
    }
    try {
      const group = await pickGroup(req);
      const snapshotId = await pickSnapshot(req, group);
      if (!snapshotId) return res.status(404).json({ error: 'No topology snapshot for this group.' });
      const detail = await readNode(client, group, { snapshotId, key: req.params.key });
      if (!detail) return res.status(404).json({ error: 'Device not found in this snapshot.' });

      const presetKey = typeof req.body?.preset === 'string' ? req.body.preset : '';
      const freeText = typeof req.body?.request === 'string' ? req.body.request.trim().slice(0, 400) : '';
      const ask = ENRICH_PRESETS[presetKey] || freeText;
      if (!ask) return res.status(400).json({ error: 'Nothing was requested.' });
      const label = (presetKey && presetKey in ENRICH_PRESETS ? presetKey : (freeText || 'detail')).slice(0, 60);

      const session = ensureEnrichmentSession();
      if (session.running) return res.status(409).json({ error: 'The map is already running a query — try again in a moment.' });

      const d = detail.device;
      const prompt = [
        'Use the network-topology skill\'s "device enrichment" step (SKILL.md §7).',
        `Target device — name: ${JSON.stringify(d.name)}, ip: ${JSON.stringify(d.ip)}, key: ${JSON.stringify(d.key)}`
          + (d.discovery_id ? `, discovery_id: ${JSON.stringify(d.discovery_id)}` : '')
          + (d.oid ? `, oid: ${JSON.stringify(d.oid)}` : '') + '.',
        `Retrieve, read-only via ./excli-interface: ${ask}.`,
        `Then append exactly one entry to evidence/topology/enrichments.json (a JSON array), of the form`,
        `{"device_key": ${JSON.stringify(d.key)}, "label": ${JSON.stringify(label)}, "value": "<a concise answer, one sentence or a short list>", "collected_at": "<ISO 8601 now>"}.`,
        'Create the file with a single-element array if it does not exist; otherwise read it, append, and write it back. Do not modify anything in ExtraHop.',
      ].join('\n');

      session.prompt(prompt);
      res.json({ ok: true, sessionId: session.id, label });
    } catch (err) { fail(res, err); }
  });

  /** Enrichments recorded for one device (Slice 5). Polled by the device panel. */
  // One device's traffic over the retained snapshots, for the inspector's trend.
  // Ordered and stamped here by joining the snapshot headers, so the client gets a
  // series it can draw without a second request.
  router.get('/node/:key/history', async (req, res) => {
    if (!guard(req, res)) return;
    try {
      const group = await pickGroup(req);
      const [rows, snapshots] = await Promise.all([
        readNodeHistory(client, group, { key: req.params.key, limit: req.query.limit }),
        listSnapshots(client, group, 100),
      ]);
      const stamp = new Map(snapshots.map((s) => [s.id, s.collected_at]));
      const series = rows
        .filter((r) => stamp.has(r.snapshot_id))
        .map((r) => ({
          snapshot_id: r.snapshot_id,
          collected_at: stamp.get(r.snapshot_id),
          bytes_total: Number(r.bytes_total) || 0,
          peer_count: Number(r.peer_count) || 0,
        }))
        .sort((a, b) => String(a.collected_at).localeCompare(String(b.collected_at)));
      res.json({ group, key: req.params.key, series });
    } catch (err) { fail(res, err); }
  });

  router.get('/enrichments/:key', async (req, res) => {
    if (!guard(req, res)) return;
    try {
      const group = await pickGroup(req);
      const graphs = await graphList();
      if (!graphs.includes(topologyGraphName(group))) return res.json({ group, key: req.params.key, enrichments: [] });
      res.json({ group, key: req.params.key, enrichments: await readEnrichments(client, group, req.params.key) });
    } catch (err) { fail(res, err); }
  });

  /**
   * Users in a snapshot and the devices each authenticated on (Slice 2). Read-only,
   * bounded, most-connected first.
   */
  router.get('/identities', async (req, res) => {
    if (!guard(req, res)) return;
    try {
      const group = await pickGroup(req);
      const graphs = await graphList();
      if (!graphs.includes(topologyGraphName(group))) return res.json({ group, snapshot_id: '', identities: [] });
      const snapshotId = await pickSnapshot(req, group);
      if (!snapshotId) return res.json({ group, snapshot_id: '', identities: [] });
      const identities = await readIdentities(client, group, { snapshotId, limit: req.query.limit });
      res.json({ group, snapshot_id: snapshotId, identities });
    } catch (err) { fail(res, err); }
  });

  /**
   * What changed between two snapshots (Slice D). Defaults to the newest pair, which
   * is the question people actually ask: "what's different since last time?"
   */
  router.get('/drift', async (req, res) => {
    if (!guard(req, res)) return;
    try {
      const group = await pickGroup(req);
      const snapshots = await listSnapshots(client, group, 100);
      if (snapshots.length < 2) {
        return res.json({
          group,
          changes: [],
          summary: { total: 0 },
          description: snapshots.length
            ? 'Only one snapshot so far — map the network again to see what changed.'
            : 'No snapshots yet.',
          from: snapshots[0]?.id || '',
          to: snapshots[0]?.id || '',
          snapshots,
        });
      }
      const pick = (q, fallback) => (typeof q === 'string' && snapshots.some((s) => s.id === q) ? q : fallback);
      // listSnapshots is newest-first, so [1] is the previous snapshot.
      const to = pick(req.query.to, snapshots[0].id);
      const from = pick(req.query.from, snapshots[1].id);
      if (from === to) return res.json({ group, from, to, changes: [], summary: { total: 0 }, description: 'Same snapshot on both sides.', snapshots });

      const [before, after] = await Promise.all([
        readSnapshotForDiff(client, group, from),
        readSnapshotForDiff(client, group, to),
      ]);
      const diff = diffSnapshots(before, after, { limit: req.query.limit });

      // Tier coordinates for every device a change touches, so the map can highlight
      // it at whatever zoom is showing (same lift the attack overlay uses).
      const touched = new Set();
      for (const c of diff.changes) {
        touched.add(c.key);
        for (const e of c.endpoints || c.devices || []) touched.add(e);
      }
      const tier = await readTier(client, group, { snapshotId: to, zoom: 3, limit: 5000 });
      const tierMap = {};
      for (const d of tier.nodes) {
        if (!touched.has(d.key)) continue;
        tierMap[d.key] = { key: d.key, locality: d.locality, segment: d.segment, role_key: d.role_key };
      }
      res.json({ group, from, to, snapshots, tierMap, description: describeDrift(diff), ...diff });
    } catch (err) { fail(res, err); }
  });

  /**
   * Incidents available to overlay on the map (Slice C).
   *
   * Read from session WORKSPACES, not the memory graph: the graph holds entities but
   * no ordered events — the capture prompt stores one prose episode — so
   * `evidence/verdict.json` is the only structured forensic sequence that exists.
   * Both the current session and every past one are enumerated.
   */
  function readVerdict(workspace) {
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(workspace, 'evidence', 'verdict.json'), 'utf8'));
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }

  router.get('/incidents', (req, res) => {
    try {
      const out = [];
      for (const session of sessions?.values?.() || []) {
        if (!session?.workspace) continue;
        const verdict = readVerdict(session.workspace);
        const events = Array.isArray(verdict?.timeline) ? verdict.timeline.length : 0;
        if (!verdict || !events) continue; // an investigation with no sequence can't be drawn
        out.push({
          id: session.id,
          title: session.title || 'Investigation',
          disposition: String(verdict.disposition || ''),
          confidence: String(verdict.confidence || ''),
          events,
          createdAt: session.createdAt || 0,
        });
      }
      out.sort((a, b) => b.createdAt - a.createdAt);
      res.json({ incidents: out });
    } catch (err) { fail(res, err); }
  });

  router.get('/incidents/:sessionId', async (req, res) => {
    if (!guard(req, res)) return;
    try {
      const session = sessions?.get?.(req.params.sessionId);
      if (!session?.workspace) return res.status(404).json({ error: 'Session not found.' });
      const verdict = readVerdict(session.workspace);
      if (!verdict) return res.status(404).json({ error: 'This session has no verdict to overlay.' });

      // Bind the incident against the snapshot actually being displayed, so an event
      // naming a device the map doesn't contain is reported unbound rather than
      // silently dropped.
      const group = await pickGroup(req);
      const snapshotId = await pickSnapshot(req, group);
      let devices = [];
      if (snapshotId) {
        const tier = await readTier(client, group, { snapshotId, zoom: 3, limit: 5000 });
        devices = tier.nodes;
      }
      const overlay = buildOverlay(verdict, devices, { sessionId: session.id, title: session.title });
      // Tier coordinates per involved device, so the client can lift an actor to the
      // cluster that represents it at the current zoom (a device is not drawn at
      // zoom 0 — its locality is).
      const tierMap = {};
      for (const d of devices) {
        if (!overlay.entities.includes(d.key)) continue;
        tierMap[d.key] = { key: d.key, locality: d.locality, segment: d.segment, role_key: d.role_key, name: d.name };
      }
      // External actors (C2, exfil) aren't devices and live in no cluster: they draw as
      // themselves at every zoom, so each tier field resolves to the external key.
      for (const ext of overlay.externals || []) {
        tierMap[ext.key] = { key: ext.key, locality: ext.key, segment: ext.key, role_key: ext.key, name: ext.name, external: true };
      }
      res.json({ group, snapshot_id: snapshotId, tierMap, ...overlay });
    } catch (err) { fail(res, err); }
  });

  // Manual re-ingest: reads evidence/topology/topology.json from a session workspace
  // and stores it. The same path the turn-end coordinator takes, exposed so a map can
  // be (re)built without waiting for another agent turn.
  router.post('/ingest/:sessionId', async (req, res) => {
    if (!guard(req, res)) return;
    try {
      const session = sessions?.get?.(req.params.sessionId);
      if (!session?.workspace) return res.status(404).json({ error: 'Session not found.' });
      const result = await coordinator.ingest(session.workspace);
      if (!result.ok) return res.status(422).json({ error: result.reason });
      session.lastTopologySignature = undefined; // allow the turn-end path to re-run later
      res.json(result);
    } catch (err) { fail(res, err); }
  });

  return router;
}
