// Pure helpers for excli argument classification, with no dependencies so the
// read-only guard can be unit-tested without loading the settings/backends graph.

export const HELP_ARGS = new Set(['-help', '--help', 'help']);

export function normalizeArg(arg) {
  return typeof arg === 'string' ? arg.trim().toLowerCase() : '';
}

// Write-class excli tools. Used by the broker's read-only guard
// (EH_BROKER_READONLY), which is how eval runs are prevented from mutating the
// monitored environment. Defense in depth: an explicit denylist of known
// mutating tools plus a mutating-verb prefix rule (so a newly added
// `update_*`/`create_*` tool is blocked by default). Confirm the exact tool set
// with `./excli-interface -listtools`.
export const MUTATING_TOOLS = new Set([
  'update_detection',
  'create_investigation',
  'assign_devicetag_to_devices',
  'unassign_devicetag_from_devices',
]);
export const MUTATING_PREFIXES = ['create_', 'update_', 'delete_', 'remove_', 'assign_', 'unassign_', 'set_', 'add_', 'patch_'];

/** True when argv[0] is a write-class tool (help invocations are always read-only). */
export function isMutatingTool(argv = []) {
  const tool = normalizeArg(argv[0]);
  if (!tool) return false;
  if (argv.slice(1).some((arg) => HELP_ARGS.has(normalizeArg(arg)))) return false;
  if (MUTATING_TOOLS.has(tool)) return true;
  return MUTATING_PREFIXES.some((p) => tool.startsWith(p));
}
