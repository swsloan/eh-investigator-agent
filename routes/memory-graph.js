import express from 'express';
import { overview, search, neighbors, quality, listEntities, assignType, retypeNode, deleteUntyped, deleteNode, mergeNodes, ONTOLOGY_TYPES } from '../lib/memory-graph.js';

/**
 * Read-only memory-graph API (v1: contextual recall). Backs the "What do we
 * know?" panel. Everything is a bounded neighborhood or an aggregate; there is
 * no whole-graph endpoint. Reads FalkorDB directly (GRAPH.RO_QUERY) — the viz
 * is strictly read-only; writing memory stays the agent's job at close.
 *
 *   GET /api/memory/graph/groups                 -> { groups:[…], default }
 *   GET /api/memory/graph/overview?group=        -> type breakdown + counts + untyped
 *   GET /api/memory/graph/search?group=&q=&limit= -> entity picker results
 *   GET /api/memory/graph/neighbors?group=&uuid=  -> focus + neighbors + facts + episodes
 *   GET /api/memory/graph/quality?group=          -> untyped [Entity] drift list
 */
export function memoryGraphRouter({ getConfig, client, envGroup, redact = (v) => v }) {
  const router = express.Router();
  let cachedGroups = null;
  let cachedGroupsAt = 0;
  let cachedDefault = null;

  function memoryEnabled() {
    return Boolean(getConfig?.().memory?.enabled);
  }

  // Cache the graph list briefly; it changes rarely and every request would
  // otherwise pay an extra round-trip.
  async function listGroups() {
    const now = Date.now();
    if (!cachedGroups || now - cachedGroupsAt > 30_000) {
      cachedGroups = await client.listGraphs();
      cachedGroupsAt = now;
    }
    return cachedGroups;
  }

  // Default namespace: the configured env group if it exists, else the graph
  // with the most entities (skip Graphiti's empty default), else the first.
  async function resolveDefault(groups) {
    if (envGroup && groups.includes(envGroup)) return envGroup;
    if (cachedDefault && groups.includes(cachedDefault)) return cachedDefault;
    let best = groups[0] || null;
    let bestCount = -1;
    for (const g of groups) {
      try {
        const ov = await overview(client, g);
        if (ov.entities > bestCount) { best = g; bestCount = ov.entities; }
      } catch { /* skip unreadable graph */ }
    }
    cachedDefault = best;
    return best;
  }

  // Validate the requested group against the real graph list so an arbitrary
  // string can never reach the GRAPH.RO_QUERY command as a graph key.
  async function pickGroup(req) {
    const groups = await listGroups();
    const requested = typeof req.query.group === 'string' ? req.query.group : '';
    if (requested && groups.includes(requested)) return requested;
    return resolveDefault(groups);
  }

  // Wrap a handler: gate on memory, map FalkorDB-unreachable to a friendly 503.
  const guard = (fn) => async (req, res) => {
    if (!memoryEnabled()) return res.status(503).json({ error: 'Memory is disabled. Enable it in Settings → Memory.', disabled: true });
    try {
      await fn(req, res);
    } catch (err) {
      res.status(502).json({ error: redact(err?.message || 'Memory graph query failed.') });
    }
  };

  router.get('/groups', guard(async (req, res) => {
    const groups = await listGroups();
    res.json({ groups, default: await resolveDefault(groups) });
  }));

  router.get('/overview', guard(async (req, res) => {
    res.json(await overview(client, await pickGroup(req)));
  }));

  router.get('/search', guard(async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (!q) return res.json({ group: await pickGroup(req), results: [] });
    const group = await pickGroup(req);
    res.json({ group, results: await search(client, group, q, req.query.limit) });
  }));

  router.get('/neighbors', guard(async (req, res) => {
    const uuid = typeof req.query.uuid === 'string' ? req.query.uuid : '';
    if (!uuid) return res.status(400).json({ error: 'uuid is required.' });
    const group = await pickGroup(req);
    const result = await neighbors(client, group, uuid);
    if (!result) return res.status(404).json({ error: 'Entity not found in memory.' });
    res.json({ group, ...result });
  }));

  router.get('/quality', guard(async (req, res) => {
    res.json(await quality(client, await pickGroup(req)));
  }));

  // List entities (optionally by ontology type) for browse drill-down + the
  // search-focus picker. Bounded, read-only.
  router.get('/entities', guard(async (req, res) => {
    const group = await pickGroup(req);
    const type = typeof req.query.type === 'string' ? req.query.type : '';
    res.json({ group, types: ONTOLOGY_TYPES, results: await listEntities(client, group, type, req.query.limit) });
  }));

  // Curation (WRITE): assign a type to, or delete, an untyped node. Guarded to
  // untyped nodes only; type must be a known ontology type.
  router.post('/curate', guard(async (req, res) => {
    const b = req.body || {};
    const group = await pickGroup(req);
    const uuid = typeof b.uuid === 'string' ? b.uuid : '';
    if (!uuid) return res.status(400).json({ error: 'uuid is required.' });
    if (b.action === 'delete') { // untyped drift list — guarded to untyped nodes
      return res.json(await deleteUntyped(client, group, uuid));
    }
    if (b.action === 'delete-any') { // entity inspector — remove mis-typed noise
      return res.json(await deleteNode(client, group, uuid));
    }
    if (b.action === 'merge') { // fold `uuid` (duplicate) into `into` (canonical)
      const into = typeof b.into === 'string' ? b.into : '';
      if (!into) return res.status(400).json({ error: 'into (canonical uuid) is required.' });
      return res.json(await mergeNodes(client, group, into, uuid));
    }
    if (b.action === 'assign' || b.action === 'retype') {
      if (!ONTOLOGY_TYPES.includes(b.type)) return res.status(400).json({ error: `type must be one of ${ONTOLOGY_TYPES.join(', ')}` });
      return res.json(b.action === 'retype'
        ? await retypeNode(client, group, uuid, b.type)
        : await assignType(client, group, uuid, b.type));
    }
    return res.status(400).json({ error: "action must be 'assign', 'retype', 'delete', or 'delete-any'." });
  }));

  return router;
}
