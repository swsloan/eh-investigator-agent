import express from 'express';
import { listSnapshots, latestSnapshotId, readNode, readTier, topologyGraphName } from '../lib/topology-store.js';

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
export function topologyRouter({ getConfig, client, coordinator, sessions, resolveGroup, redact = (v) => v }) {
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
      const tier = await readTier(client, group, {
        snapshotId,
        zoom: req.query.zoom,
        parent: typeof req.query.parent === 'string' ? req.query.parent : '',
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
