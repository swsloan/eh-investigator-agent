// Pure helpers for excli argument classification, with no dependencies so the
// read-only guard can be unit-tested without loading the settings/backends graph.

export const HELP_ARGS = new Set(['-help', '--help', 'help']);

export function normalizeArg(arg) {
  return typeof arg === 'string' ? arg.trim().toLowerCase() : '';
}

// Write-class excli tools. This denylist is the *fallback* heuristic used when a
// tool is absent from the live capability catalog (see below) — e.g. a brand-new
// tool the running binary exposes before the catalog is (re)fetched. Defense in
// depth: an explicit denylist of known mutating tools plus a mutating-verb prefix
// rule (so a newly added `update_*`/`create_*` tool is blocked by default).
// Confirm the exact tool set with `./excli-interface -listtools`.
export const MUTATING_TOOLS = new Set([
  'update_detection',
  'create_investigation',
  'assign_devicetag_to_devices',
  'unassign_devicetag_from_devices',
]);
export const MUTATING_PREFIXES = ['create_', 'update_', 'delete_', 'remove_', 'assign_', 'unassign_', 'set_', 'add_', 'patch_'];

// --- Annotation-driven classification (excli is an MCP server under the hood) ---
// `./excli-interface -jsonschema` emits each tool's MCP annotations. We treat a
// tool as write-class unless it is *provably* read-only (`readOnlyHint === true`),
// so anything unannotated or ambiguous fails safe to "write". `destructiveHint`
// is surfaced separately to let callers require a stronger confirmation for
// destructive writes (none exist in excli 0.0.107, but a future `delete_*` would).

/** 'read' when the tool is provably read-only, else 'write' (fail-safe). */
export function capabilityAccessType(annotations) {
  return annotations && annotations.readOnlyHint === true ? 'read' : 'write';
}

/** True only when the tool explicitly declares itself destructive. */
export function isDestructiveCapability(annotations) {
  return Boolean(annotations && annotations.destructiveHint === true);
}

/**
 * Parse `excli -jsonschema` output (a JSON array of tool descriptors) into a
 * classification map keyed by lower-cased tool name. Pure and defensive: returns
 * null on malformed/empty input so the caller falls back to the heuristic.
 */
export function parseCapabilityCatalog(jsonSchemaText) {
  let tools;
  try {
    tools = JSON.parse(jsonSchemaText);
  } catch {
    return null;
  }
  if (!Array.isArray(tools)) return null;
  const map = new Map();
  for (const tool of tools) {
    if (!tool || typeof tool.name !== 'string') continue;
    const annotations = tool.annotations || null;
    map.set(tool.name.trim().toLowerCase(), {
      accessType: capabilityAccessType(annotations),
      destructive: isDestructiveCapability(annotations),
      readOnlyHint: annotations && typeof annotations.readOnlyHint === 'boolean' ? annotations.readOnlyHint : null,
      destructiveHint: annotations && typeof annotations.destructiveHint === 'boolean' ? annotations.destructiveHint : null,
    });
  }
  return map.size ? map : null;
}

/**
 * True when argv[0] is a write-class tool (help invocations are always
 * read-only). Annotation-first: if a live `catalog` (from parseCapabilityCatalog)
 * knows this tool, trust its MCP hint; otherwise fall back to the denylist +
 * mutating-prefix heuristic so a tool missing from the catalog still fails safe.
 */
export function isMutatingTool(argv = [], catalog = null) {
  const tool = normalizeArg(argv[0]);
  if (!tool) return false;
  if (argv.slice(1).some((arg) => HELP_ARGS.has(normalizeArg(arg)))) return false;
  const entry = catalog && typeof catalog.get === 'function' ? catalog.get(tool) : null;
  if (entry) return entry.accessType === 'write';
  if (MUTATING_TOOLS.has(tool)) return true;
  return MUTATING_PREFIXES.some((p) => tool.startsWith(p));
}
