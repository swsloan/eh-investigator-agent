// Topology ingest coordinator (Slice A).
//
// The `network-topology` skill collects from ExtraHop and writes
// `evidence/topology/topology.json` into the session workspace. This watches for
// that artifact at turn end and runs the structured write path:
//
//     normalize (topology-model) -> lay out (topology-layout) -> persist (topology-store)
//
// Mirrors lib/memory-coordinator.js's turn-end reaction, with one deliberate
// difference: memory is written BY THE AGENT through Graphiti's LLM extraction,
// whereas topology is written BY THE SERVER from already-structured JSON — so byte
// counts, IDs, and coordinates survive losslessly and no model cost is incurred.
//
// Observe-only and never throws: a failed ingest must not break the session.

import fs from 'node:fs';
import path from 'node:path';
import { normalize } from './topology-model.js';
import { layoutSnapshot } from './topology-layout.js';
import { latestSnapshotId, readTier, writeSnapshot } from './topology-store.js';

export const TOPOLOGY_ARTIFACT = path.join('evidence', 'topology', 'topology.json');

/** Read + parse the artifact, or null when it is absent/unreadable/not an object. */
export function readArtifact(workspace) {
  if (!workspace) return null;
  try {
    const raw = fs.readFileSync(path.join(workspace, TOPOLOGY_ARTIFACT), 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * A cheap fingerprint of the artifact, so re-running a turn that didn't change the
 * map doesn't write a duplicate snapshot. Size+mtime is enough: the file is
 * rewritten wholesale by the skill, never appended to.
 */
export function artifactSignature(workspace) {
  if (!workspace) return '';
  try {
    const st = fs.statSync(path.join(workspace, TOPOLOGY_ARTIFACT));
    return `${st.size}:${Math.floor(st.mtimeMs)}`;
  } catch {
    return '';
  }
}

export function createTopologyCoordinator({ client, getConfig, resolveGroup, logger = console } = {}) {
  function enabled() {
    // Rides the memory toggle: both persist to the same FalkorDB instance, and a
    // deployment without it has nowhere to put a snapshot.
    return Boolean(client) && Boolean(getConfig?.().memory?.enabled);
  }

  /**
   * Ingest the artifact from one workspace. Exposed directly so the manual
   * re-ingest route can reuse it. Returns a result object, never throws.
   */
  async function ingest(workspace, { group } = {}) {
    if (!enabled()) return { ok: false, reason: 'memory/topology storage is not enabled' };
    const raw = readArtifact(workspace);
    if (!raw) return { ok: false, reason: 'no topology artifact in this workspace' };

    const namespace = group || resolveGroup?.() || '';
    const localityRules = getConfig?.().topology?.localityRules;
    const snapshot = normalize(raw, { group: namespace, localityRules });
    if (!snapshot.nodes.length) return { ok: false, reason: 'topology artifact contained no usable devices' };

    // Seed from the previous snapshot's coordinates so an unchanged network keeps
    // its shape between snapshots and only genuine change moves on the map.
    let previous = null;
    try {
      const prevId = await latestSnapshotId(client, namespace);
      if (prevId) {
        const tier = await readTier(client, namespace, { snapshotId: prevId, zoom: 3, limit: 5000 });
        previous = Object.fromEntries(tier.nodes.map((n) => [n.key, { x: Number(n.x), y: Number(n.y) }]));
      }
    } catch { /* first snapshot, or an unreadable prior — lay out fresh */ }

    const layout = layoutSnapshot(snapshot, { previous, logger });
    const written = await writeSnapshot(client, namespace, snapshot, layout);
    return { ok: true, ...written, group: namespace, layout: layout.meta };
  }

  async function onAgentEnd(session, meta = {}) {
    if (!enabled()) return;
    if (meta.hadError || meta.promptSource !== 'user') return;
    const signature = artifactSignature(session?.workspace);
    if (!signature || session.lastTopologySignature === signature) return; // nothing new
    session.lastTopologySignature = signature;

    session.recordEvent?.({ type: 'topology_status', status: 'ingesting', at: Date.now() });
    try {
      const result = await ingest(session.workspace);
      session.recordEvent?.({
        type: 'topology_status',
        status: result.ok ? 'stored' : 'skipped',
        at: Date.now(),
        ...(result.ok
          ? { snapshot_id: result.snapshot_id, devices: result.nodes, edges: result.edges }
          : { reason: result.reason }),
      });
      if (result.ok) {
        logger.info?.(`[topology:${session.id?.slice(0, 8)}] stored ${result.nodes} devices / ${result.edges} edges as ${result.snapshot_id}`);
      }
    } catch (err) {
      // A storage failure is surfaced, not hidden — but never rethrown into the session.
      session.recordEvent?.({ type: 'topology_status', status: 'failed', at: Date.now(), reason: err?.message || 'ingest failed' });
      logger.warn?.(`[topology:${session.id?.slice(0, 8)}] ingest failed: ${err?.message || err}`);
    }
  }

  function attachSession(session) {
    session.on('agent_end', (meta) => {
      onAgentEnd(session, meta).catch((err) => logger.warn?.(`[topology] ${err?.message || err}`));
    });
  }

  return { attachSession, ingest, enabled };
}
