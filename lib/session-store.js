import fs from 'node:fs';
import path from 'node:path';

const HTML_EXTS = new Set(['.html', '.htm']);

export function atomicWriteJson(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
    fs.renameSync(tmp, file);
    fs.chmodSync(file, 0o600);
  } catch (err) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch { /* best effort cleanup */ }
    throw err;
  }
}

export function visibleFiles(workspace) {
  const out = [];
  const walk = (dir, rel) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink() || entry.name.startsWith('.')) continue;
      const abs = path.join(dir, entry.name);
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(abs, relPath);
      } else if (entry.isFile()) {
        out.push({ abs, relPath, stat: fs.statSync(abs) });
      }
    }
  };
  walk(workspace, '');
  return out;
}

function isHtmlFile(abs) {
  return HTML_EXTS.has(path.extname(abs).toLowerCase());
}

export function titleCaseSlug(s) {
  return s
    .replace(/^report[-_ ]*/i, '')
    .replace(/\.[^.]+$/, '')
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => /^[A-Z0-9]+$/.test(part)
      ? part
      : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

export function titleFromWorkspace(files) {
  const rootHtml = files.find((f) => !f.relPath.includes('/') && isHtmlFile(f.abs));
  if (rootHtml) return titleCaseSlug(path.basename(rootHtml.relPath));
  const newest = [...files].sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)[0];
  return newest ? titleCaseSlug(path.basename(newest.relPath)) : null;
}

/**
 * Reconstruct a .session.json for a workspace that lost its state file.
 * `recoverState(workspace, {redact})` is an optional backend hook that can
 * rebuild richer state (e.g. from Pi's JSONL history); otherwise we fall back
 * to a bare files-only record.
 */
export function backfillSessionState(id, workspace, { recoverState = null, redact = (value) => value } = {}) {
  const files = visibleFiles(workspace);
  const recovered = recoverState ? recoverState(workspace, { redact }) : null;
  if (!recovered && files.length === 0) return false;

  const state = recovered || {
    id,
    title: null,
    titleGenerated: true,
    createdAt: Math.min(...files.map((f) => f.stat.birthtimeMs || f.stat.mtimeMs)),
    promptCount: 1,
    transcript: [],
  };

  state.id = id;
  state.title ||= titleFromWorkspace(files) || `Recovered ${id.slice(0, 8)}`;
  if (!state.createdAt || !Number.isFinite(state.createdAt)) {
    state.createdAt = files.length
      ? Math.min(...files.map((f) => f.stat.birthtimeMs || f.stat.mtimeMs))
      : Date.now();
  }
  atomicWriteJson(path.join(workspace, '.session.json'), state);
  return true;
}

export function hasReadableSessionState(file) {
  try {
    const state = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Boolean(state && state.id && state.createdAt);
  } catch {
    return false;
  }
}

/**
 * Which backend a persisted workspace belongs to. States that predate
 * backend selection carry no stamp and are treated as `fallback`.
 */
export function readBackendStamp(workspace, fallback = 'pi') {
  try {
    const state = JSON.parse(fs.readFileSync(path.join(workspace, '.session.json'), 'utf8'));
    return typeof state.backend === 'string' && state.backend ? state.backend : fallback;
  } catch {
    return fallback;
  }
}

export function restoreSessionsFromWorkspaces(workspacesRoot, createSession, options = {}) {
  for (const entry of fs.readdirSync(workspacesRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const workspace = path.join(workspacesRoot, entry.name);
    const stateFile = path.join(workspace, '.session.json');
    if (fs.existsSync(stateFile) && !hasReadableSessionState(stateFile)) {
      fs.renameSync(stateFile, `${stateFile}.bad-${Date.now()}`);
    }
    if (fs.existsSync(stateFile) || backfillSessionState(entry.name, workspace, options)) {
      createSession(entry.name, { backend: readBackendStamp(workspace) });
    }
  }
}

export function sessionSummary(s) {
  return {
    id: s.id,
    backend: s.backend,
    title: s.title || 'New session',
    createdAt: s.createdAt,
    saved: !!s.saved,
    running: s.running,
    empty: s.promptCount === 0,
    model: s.options.model || '',
    reasoning: s.options.thinking || '',
    modelPinned: !!s.modelPinned,
    agentState: s.agentState,
  };
}
