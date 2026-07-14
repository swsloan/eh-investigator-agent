function normalizeCandidate(value) {
  let candidate = String(value || '').trim().replaceAll('\\', '/');
  if (!candidate) return '';
  try { candidate = decodeURIComponent(candidate); } catch { /* keep malformed text literal */ }
  candidate = candidate.replace(/[?#].*$/, '');
  candidate = candidate.replace(/^file:\/\//i, '');
  candidate = candidate.replace(/^sandbox:/i, '');
  return candidate;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function buildWorkspaceFileIndex(files = []) {
  const byPath = new Map();
  const basenameCounts = new Map();

  for (const file of files) {
    const relPath = normalizeCandidate(file?.path).replace(/^\.\//, '').replace(/^\/+/, '');
    if (!relPath || relPath.includes('../')) continue;
    byPath.set(relPath, file);
    const basename = relPath.split('/').pop();
    basenameCounts.set(basename, (basenameCounts.get(basename) || 0) + 1);
  }

  const aliases = new Map();
  for (const [relPath, file] of byPath) {
    aliases.set(relPath, file);
    aliases.set(`./${relPath}`, file);
    const basename = relPath.split('/').pop();
    if (basenameCounts.get(basename) === 1) aliases.set(basename, file);
  }

  const textAliases = [...aliases.keys()]
    .filter((alias) => alias.includes('/') || alias.includes('.') || /^[A-Z][A-Z0-9_-]{2,}$/.test(alias))
    .sort((a, b) => b.length - a.length || a.localeCompare(b));

  return { byPath, aliases, textAliases };
}

export function resolveWorkspaceFile(candidate, index) {
  let value = normalizeCandidate(candidate);
  if (!value) return null;

  const apiMarker = '/files/';
  if (value.includes(apiMarker)) value = value.slice(value.lastIndexOf(apiMarker) + apiMarker.length);
  value = value.replace(/^\.\//, '');

  const direct = index.byPath.get(value.replace(/^\/+/, '')) || index.aliases.get(value);
  if (direct) return direct;

  const suffixMatches = [...index.byPath.entries()]
    .filter(([relPath]) => value.endsWith(`/${relPath}`));
  return suffixMatches.length === 1 ? suffixMatches[0][1] : null;
}

export function rewriteWorkspaceMarkdownLinks(raw, index) {
  return String(raw || '').replace(/(\[[^\]]*\]\()([^\s)]+)([^)]*\))/g, (match, prefix, href, suffix) => {
    if (/^https?:/i.test(href)) return match;
    const file = resolveWorkspaceFile(href, index);
    if (file) return `${prefix}#workspace-file:${encodeURIComponent(file.path)}${suffix}`;
    if (/^(?:file:|sandbox:|\.?\.?[\\/]|[^:]+[\\/])/i.test(href)) {
      return `${prefix}#workspace-candidate:${encodeURIComponent(href)}${suffix}`;
    }
    return match;
  });
}

function makeWorkspaceAnchor(doc, text, file) {
  const anchor = doc.createElement('a');
  anchor.href = `#workspace-file:${encodeURIComponent(file.path)}`;
  anchor.dataset.workspacePath = file.path;
  anchor.className = 'workspace-file-link';
  anchor.title = `Open ${file.path} in Workspace Files`;
  anchor.textContent = text;
  return anchor;
}

function decorateExistingAnchors(root, index) {
  for (const anchor of root.querySelectorAll('a')) {
    const rawHref = anchor.getAttribute('href') || '';
    let file = null;
    let candidate = anchor.dataset.workspaceCandidate || '';
    const encodedPath = rawHref.match(/^#workspace-file:(.+)$/)?.[1];
    const encodedCandidate = rawHref.match(/^#workspace-candidate:(.+)$/)?.[1];
    if (encodedPath) file = resolveWorkspaceFile(encodedPath, index);
    if (encodedCandidate) {
      try { candidate = decodeURIComponent(encodedCandidate); } catch { candidate = encodedCandidate; }
    }
    if (!file && candidate) file = resolveWorkspaceFile(candidate, index);
    if (!file && !/^https?:/i.test(rawHref) && !encodedCandidate) file = resolveWorkspaceFile(rawHref, index);
    if (!file && !rawHref) file = resolveWorkspaceFile(anchor.textContent, index);
    if (!file) {
      if (candidate) {
        anchor.dataset.workspaceCandidate = candidate;
        anchor.href = '#';
      }
      continue;
    }
    anchor.href = `#workspace-file:${encodeURIComponent(file.path)}`;
    delete anchor.dataset.workspaceCandidate;
    anchor.dataset.workspacePath = file.path;
    anchor.classList.add('workspace-file-link');
    anchor.title = `Open ${file.path} in Workspace Files`;
  }
}

function decorateTextNodes(root, index) {
  if (!index.textAliases.length) return;
  const aliases = index.textAliases.map(escapeRegExp).join('|');
  const pattern = new RegExp(`(^|[^A-Za-z0-9_./\\\\-])(${aliases})(?![A-Za-z0-9_/\\\\-]|\\.[A-Za-z0-9])`, 'g');
  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(root, 4);
  const nodes = [];
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (!node.parentElement?.closest('a, pre')) nodes.push(node);
  }

  for (const node of nodes) {
    const text = node.nodeValue || '';
    pattern.lastIndex = 0;
    let match;
    let cursor = 0;
    let changed = false;
    const fragment = doc.createDocumentFragment();
    while ((match = pattern.exec(text))) {
      const prefix = match[1];
      const mention = match[2];
      const mentionStart = match.index + prefix.length;
      const file = index.aliases.get(mention);
      if (!file) continue;
      fragment.append(text.slice(cursor, mentionStart));
      fragment.append(makeWorkspaceAnchor(doc, mention, file));
      cursor = mentionStart + mention.length;
      changed = true;
    }
    if (!changed) continue;
    fragment.append(text.slice(cursor));
    node.replaceWith(fragment);
  }
}

export function linkWorkspaceFileReferences(root, files = []) {
  const index = buildWorkspaceFileIndex(files);
  decorateExistingAnchors(root, index);
  decorateTextNodes(root, index);
}
