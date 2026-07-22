import { getEvidenceSummary, listFiles, openPcapInWireshark, sessionFileUrl } from './api.js';
import { renderMarkdown, highlightCode } from './markdown.js';
import { linkWorkspaceFileReferences } from './workspace-file-links.js';
import { isInvestigationPlanFile } from './investigation-plan.js';
import { themeReportHtml } from './theme.js';
import { dom, $ } from './dom.js';
import { captureSessionScope, isCurrentSessionScope, state } from './state.js';
import { csvDownloadName, downloadName, fmtBytes, fmtTime, pdfDownloadName, triggerDownload } from './utils.js';

const ICON_FILE = '<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/>';
const ICON_UPLOAD = '<path d="M12 17V7M7 11l5-5 5 5"/><path d="M4 21h16"/>';
const ICON_FOLDER = '<path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>';
const FILE_ICONS = {
  report: '<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v5h5M9 17v-3m3 3v-6m3 6v-4"/>',
  detection: '<path d="M12 3l8 4v5c0 5-3.4 8-8 9-4.6-1-8-4-8-9V7z"/><path d="M12 8v5m0 3h.01"/>',
  metrics: '<path d="M4 19V5M4 19h16"/><path d="M7 15l4-4 3 2 5-7"/>',
  entity: '<circle cx="12" cy="7" r="3"/><circle cx="6" cy="17" r="2"/><circle cx="18" cy="17" r="2"/><path d="M10 9l-3 6m7-6l3 6M8 17h8"/>',
  device: '<rect x="4" y="4" width="16" height="12" rx="2"/><path d="M8 20h8M12 16v4M8 8h.01M11 8h5M8 11h.01M11 11h5"/>',
  activity: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  catalog: '<path d="M5 4h11a3 3 0 013 3v13H8a3 3 0 01-3-3z"/><path d="M8 4v16M11 8h5M11 12h5"/>',
  error: '<path d="M12 3L2.5 20h19z"/><path d="M12 9v4m0 3h.01"/>',
  packets: '<rect x="4" y="5" width="16" height="5" rx="1"/><rect x="4" y="14" width="16" height="5" rx="1"/><path d="M8 10v4m8-4v4"/>',
  records: '<rect x="4" y="5" width="16" height="14" rx="1"/><path d="M4 10h16M9 5v14"/>',
  'web-search': '<circle cx="10" cy="10" r="6"/><path d="M14.5 14.5L20 20M7 10h6M10 7v6"/>',
  markdown: '<path d="M4 5h16v14H4z"/><path d="M7 15V9l3 3 3-3v6m2-3h3m-1.5-1.5L18 12l-1.5 1.5"/>',
  html: '<path d="M8 8l-4 4 4 4m8-8l4 4-4 4m-3-10l-2 12"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="9" r="2"/><path d="M4 17l5-5 4 4 2-2 5 4"/>',
  code: '<path d="M8 8l-4 4 4 4m8-8l4 4-4 4"/>',
  text: ICON_FILE,
};

const TEXT_EXTS = new Set(['txt', 'log', 'csv', 'tsv', 'yaml', 'yml', 'xml', 'ini', 'conf', 'sh', 'py', 'js', 'mjs', 'ts', 'sql', 'css', 'toml', 'env', 'jsonl', 'ndjson']);
const IMG_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico']);
const HTML_EXTS = new Set(['html', 'htm']);
const PCAP_RE = /\.(?:pcap|pcapng|cap)(?:\.gz)?$/i;
const HIGHLIGHT_LANG_BY_EXT = new Map([
  ['py', 'python'],
  ['js', 'javascript'],
]);
const SOURCE_PREVIEW_LIMIT = 400_000;
const SUMMARY_LAYOUTS = new Set(['source', 'split', 'summary']);
const SUMMARY_BACKFILL_RETRY_MS = [1_000, 2_000, 4_000, 8_000];

function fileUrl(relPath, options = {}) {
  return sessionFileUrl(state.session.id, relPath, options);
}

function isReportFile(file) {
  if (file?.kind) return file.kind === 'report';
  const name = file.path.split('/').pop().toLowerCase();
  return name.startsWith('report-') && (name.endsWith('.html') || name.endsWith('.htm'));
}

function isSummarizableEvidenceJson(file) {
  return Boolean(file?.path)
    && file.path.toLowerCase().endsWith('.json')
    && file.summarizable === true;
}

function isPacketCapture(file) {
  return PCAP_RE.test(String(file?.path || ''));
}

function defaultSummaryLayout() {
  if (state.evidenceDefaultView === 'code') return 'source';
  if (state.evidenceDefaultView === 'split') return 'split';
  return 'summary';
}

function reportSeenKey(file) {
  return `eh-report-seen:${state.session?.id || 'none'}:${file.path}:${Math.round(file.mtime)}:${file.size}`;
}

function isReportSeen(file) {
  try { return localStorage.getItem(reportSeenKey(file)) === '1'; } catch { return false; }
}

function markReportSeen(file) {
  try { localStorage.setItem(reportSeenKey(file), '1'); } catch { /* ignore private-mode quota errors */ }
}

function fileIconMarkup(file, { muted = false } = {}) {
  if (muted) {
    return `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON_FILE}</svg>`;
  }
  if (file.icon === 'reversinglabs') {
    return '<img class="file-brand-icon" src="/vendor/reversinglabs/square_logo.jpeg" alt="">';
  }
  const paths = FILE_ICONS[file.icon] || ICON_FILE;
  return `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
}

function makeFileRow(file, isNew, { secondary = false } = {}) {
  const isUpload = file.path.startsWith('uploads/');
  const isReport = isReportFile(file);
  const reportUnseen = Boolean(file.primaryReport) && !isReportSeen(file);
  const showNew = Boolean(isNew && file.reveal && !isReport);
  const safeTag = /^[A-Z0-9 ]{1,24}$/.test(file.tag || '') ? file.tag : '';
  const kindToken = String(file.kind || 'file').toLowerCase().replace(/[^a-z0-9-]/g, '') || 'file';
  const row = document.createElement('div');
  row.className = 'file-row' + (isUpload ? ' upload' : '') + (secondary ? ' secondary-file' : '') + (file.empty ? ' empty-file' : '') + (reportUnseen ? ' report-unseen' : '') + (file.path === state.viewingPath ? ' viewing' : '');
  row.innerHTML = `
    <div class="file-icon icon-${secondary ? 'secondary' : (file.icon || 'text')}">${isUpload ? `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON_UPLOAD}</svg>` : fileIconMarkup(file, { muted: secondary })}</div>
    <div class="file-meta">
      <div class="file-name"></div>
      <div class="file-detail-row">
        <div class="file-sub"></div>
        ${safeTag ? `<span class="file-tag file-tag-${kindToken}">${safeTag}</span>` : ''}
        ${showNew ? '<span class="file-new">NEW</span>' : ''}
      </div>
    </div>
    <button class="file-dl" title="Download">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v10M7 11l5 5 5-5"/><path d="M4 21h16"/></svg>
    </button>`;
  row.querySelector('.file-name').textContent = file.path.split('/').pop();
  row.querySelector('.file-name').title = file.path;
  row.querySelector('.file-sub').textContent = `${file.empty ? 'Empty' : fmtBytes(file.size)} · ${fmtTime(file.mtime)}`;
  row.addEventListener('click', () => {
    if (file.primaryReport) {
      markReportSeen(file);
      row.classList.remove('report-unseen');
    }
    openViewer(file);
  });
  row.querySelector('.file-dl').addEventListener('click', (event) => {
    event.stopPropagation();
    triggerDownload(fileUrl(file.path, { dl: true }), downloadName(file.path));
  });
  return row;
}

function countFiles(node) {
  let n = node.files.length;
  for (const dir of node.dirs.values()) n += countFiles(dir);
  return n;
}

function renderTree(files, newPaths) {
  const tree = { files: [], dirs: new Map() };
  for (const file of files) {
    const parts = file.path.split('/');
    let node = tree;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!node.dirs.has(parts[i])) node.dirs.set(parts[i], { files: [], dirs: new Map() });
      node = node.dirs.get(parts[i]);
    }
    node.files.push(file);
  }

  const renderNode = (node, container, prefix) => {
    const sortedFiles = [...node.files].sort((a, b) => {
      if (a.primaryReport !== b.primaryReport) return a.primaryReport ? -1 : 1;
      const priorityA = Number.isFinite(a.sortPriority) ? a.sortPriority : 50;
      const priorityB = Number.isFinite(b.sortPriority) ? b.sortPriority : 50;
      if (priorityA !== priorityB) return priorityA - priorityB;
      return b.mtime - a.mtime || a.path.localeCompare(b.path);
    });
    const visibleFiles = sortedFiles.filter((file) => file.reveal);
    const hiddenFiles = sortedFiles.filter((file) => !file.reveal);
    for (const file of visibleFiles) container.appendChild(makeFileRow(file, newPaths.has(file.path)));
    const dirNames = [...node.dirs.keys()].sort();
    for (const name of dirNames) {
      const child = node.dirs.get(name);
      const dirPath = prefix ? `${prefix}/${name}` : name;
      const count = countFiles(child);
      const hasNew = files.some((file) => file.reveal && newPaths.has(file.path) && file.path.startsWith(dirPath + '/'));
      const isScratch = dirPath.toLowerCase() === 'scratch' || dirPath.toLowerCase().startsWith('scratch/');
      if (hasNew && !isScratch) state.openDirs.add(dirPath);

      const group = document.createElement('div');
      group.className = 'dir-group' + (state.openDirs.has(dirPath) ? ' open' : '');
      const row = document.createElement('div');
      row.className = 'dir-row';
      row.innerHTML = `
        <svg class="dir-chevron" viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 3l5 5-5 5"/></svg>
        <div class="file-icon">${dirPath.toLowerCase() === 'reversinglabs' ? '<img class="file-brand-icon" src="/vendor/reversinglabs/square_logo.jpeg" alt="">' : `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON_FOLDER}</svg>`}</div>
        <div class="file-meta"><div class="file-name"></div></div>
        ${hasNew ? '<span class="file-new">NEW</span>' : ''}
        <span class="file-count"></span>`;
      row.querySelector('.file-name').textContent = name + '/';
      row.querySelector('.file-count').textContent = count;
      row.addEventListener('click', () => {
        group.classList.toggle('open');
        if (group.classList.contains('open')) state.openDirs.add(dirPath);
        else state.openDirs.delete(dirPath);
      });
      const children = document.createElement('div');
      children.className = 'dir-children';
      renderNode(child, children, dirPath);
      group.appendChild(row);
      group.appendChild(children);
      container.appendChild(group);
    }
    if (hiddenFiles.length) {
      const hiddenContainer = document.createElement('div');
      hiddenContainer.className = 'secondary-files';
      const key = prefix || '/';
      if (state.expandedHiddenDirs.has(key)) {
        for (const file of hiddenFiles) hiddenContainer.appendChild(makeFileRow(file, false, { secondary: true }));
      } else {
        const showMore = document.createElement('button');
        showMore.type = 'button';
        showMore.className = 'files-show-more';
        showMore.textContent = `Show ${hiddenFiles.length} more…`;
        showMore.addEventListener('click', () => {
          state.expandedHiddenDirs.add(key);
          renderTree(files, newPaths);
        });
        hiddenContainer.appendChild(showMore);
      }
      container.appendChild(hiddenContainer);
    }
  };

  dom.filesList.innerHTML = '';
  renderNode(tree, dom.filesList, '');
}

export async function refreshFiles() {
  if (!state.session) return;
  const scope = captureSessionScope();
  const data = await listFiles(state.session.id);
  if (!data) return;
  // The session may have changed while this was in flight — dropping the result
  // keeps the previous session's file list from replacing the current one.
  if (!isCurrentSessionScope(scope)) return;
  // The plan has its own ribbon above this list. The server already omits it,
  // but an older session state or a partial response can still carry it, so the
  // client filters too rather than letting a generated file look like a
  // deliverable the agent authored.
  const files = (data.files || []).filter((file) => !isInvestigationPlanFile(file));
  const firstLoad = state.knownFiles === null;
  const previousFiles = state.knownFiles || new Map();
  const currentFiles = new Map();

  if (!files.length) {
    state.knownFiles = currentFiles;
    state.workspaceFiles = new Map();
    dom.filesList.innerHTML = '<div class="files-empty">No files yet. Upload evidence or ask the agent to produce a report.</div>';
    return;
  }
  const newPaths = new Set();
  for (const file of files) {
    const fingerprint = `${file.size}:${Math.round(file.mtime)}`;
    if (!firstLoad && previousFiles.get(file.path) !== fingerprint) newPaths.add(file.path);
    currentFiles.set(file.path, fingerprint);
  }
  state.knownFiles = currentFiles;
  state.workspaceFiles = new Map(files.map((file) => [file.path, file]));
  renderTree(files, newPaths);
  dom.chatEl.querySelectorAll('.msg-agent .md').forEach((element) => {
    linkWorkspaceFileReferences(element, files);
  });
}

export async function openWorkspacePath(relPath) {
  let file = state.workspaceFiles.get(relPath);
  if (!file) {
    await refreshFiles();
    file = state.workspaceFiles.get(relPath);
  }
  if (file) openViewer(file);
}

function setViewerStatus(text, kind = '') {
  dom.viewerStatus.textContent = text;
  dom.viewerStatus.className = `viewer-status ${kind}`.trim();
  dom.viewerStatus.classList.toggle('hidden', !text);
}

export function closeDownloadMenu() {
  dom.viewerDownloadMenu.classList.add('hidden');
  dom.viewerDownloadBtn.setAttribute('aria-expanded', 'false');
}

export function isDownloadMenuOpen() {
  return !dom.viewerDownloadMenu.classList.contains('hidden');
}

function toggleDownloadMenu() {
  const isOpen = isDownloadMenuOpen();
  dom.viewerDownloadMenu.classList.toggle('hidden', isOpen);
  dom.viewerDownloadBtn.setAttribute('aria-expanded', String(!isOpen));
}

function setSummaryLayout(layout) {
  const next = SUMMARY_LAYOUTS.has(layout) ? layout : 'split';
  state.summaryPaneLayout = next;
  dom.viewerBody.dataset.summaryLayout = next;
  dom.viewerSummaryLayout.querySelectorAll('[data-summary-layout]').forEach((button) => {
    const active = button.dataset.summaryLayout === next;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

function setSummaryLayoutControlsVisible(visible, layout) {
  dom.viewerSummaryLayout.classList.toggle('hidden', !visible);
  if (visible) {
    setSummaryLayout(layout || state.summaryPaneLayout || defaultSummaryLayout());
  } else {
    state.summaryPaneLayout = 'split';
    setSummaryLayout('split');
    delete dom.viewerBody.dataset.summaryLayout;
    dom.viewerSummaryLayout.classList.add('hidden');
  }
}

async function downloadPdfPath(relPath) {
  if (!relPath) return;
  closeDownloadMenu();
  setViewerStatus('Preparing PDF...');
  dom.viewerDownloadPdf.disabled = true;
  try {
    const res = await fetch(fileUrl(relPath, { format: 'pdf' }));
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `PDF export failed (HTTP ${res.status})`);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    triggerDownload(url, pdfDownloadName(relPath));
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    if (state.viewingPath === relPath) {
      setViewerStatus('PDF downloaded', 'ok');
      setTimeout(() => {
        if (state.viewingPath === relPath && dom.viewerStatus.textContent === 'PDF downloaded') setViewerStatus('');
      }, 1800);
    }
  } catch (err) {
    if (state.viewingPath === relPath) setViewerStatus(err.message, 'error');
  } finally {
    dom.viewerDownloadPdf.disabled = false;
  }
}

async function downloadCsvPath(relPath) {
  if (!relPath) return;
  closeDownloadMenu();
  triggerDownload(fileUrl(relPath, { format: 'csv' }), csvDownloadName(relPath));
}

function summaryCacheKey(file) {
  return `${state.session?.id || 'none'}:${file.path}:${Math.round(file.mtime || 0)}:${file.size || 0}`;
}

function setSummaryPane(pane, html, kind = '') {
  pane.className = `viewer-summary-pane ${kind}`.trim();
  pane.innerHTML = html;
}

function hasPendingBackfills(summary) {
  return Array.isArray(summary?.pendingBackfills) && summary.pendingBackfills.length > 0;
}

function scheduleSummaryBackfillRefresh(file, pane, cacheKey, attempt = 0) {
  if (attempt >= SUMMARY_BACKFILL_RETRY_MS.length) return;
  const activePath = file.path;
  setTimeout(() => {
    if (state.viewingPath !== activePath || !pane.isConnected) return;
    state.summaryCache.delete(cacheKey);
    loadSummaryPane(file, pane, { refresh: true, attempt: attempt + 1 });
  }, SUMMARY_BACKFILL_RETRY_MS[attempt]);
}

function renderSummaryLayout(file, sourceHtml) {
  const summaryId = `summary-${Math.random().toString(36).slice(2)}`;
  dom.viewerBody.className = 'viewer-body summary-mode';
  dom.viewerBody.innerHTML = `
    <section id="${summaryId}" class="viewer-summary-pane loading">
      <div class="viewer-summary-loading">Summarizing evidence...</div>
    </section>
    <section class="viewer-source-pane">${sourceHtml}</section>`;
  setSummaryLayout(state.summaryPaneLayout || defaultSummaryLayout());
  return dom.viewerBody.querySelector(`#${summaryId}`);
}

function truncatedSourcePreview(text) {
  return text.length > SOURCE_PREVIEW_LIMIT
    ? text.slice(0, SOURCE_PREVIEW_LIMIT) + '\n... (truncated preview)'
    : text;
}

function renderHighlightedSource(text, language) {
  dom.viewerBody.className = 'viewer-body';
  dom.viewerBody.innerHTML = `<pre class="raw"><code class="language-${language}"></code></pre>`;
  const code = dom.viewerBody.querySelector('code');
  code.textContent = truncatedSourcePreview(text);
  highlightCode(code);
}

async function loadSummaryPane(file, pane, { refresh = false, attempt = 0 } = {}) {
  const cacheKey = summaryCacheKey(file);
  const cached = state.summaryCache.get(cacheKey);
  if (cached && !refresh) {
    setSummaryPane(pane, cached.html, cached.kind);
    if (hasPendingBackfills(cached)) scheduleSummaryBackfillRefresh(file, pane, cacheKey, attempt);
    return;
  }
  const activePath = file.path;
  try {
    const result = await getEvidenceSummary(state.session.id, file.path, { refresh });
    if (state.viewingPath !== activePath || !pane.isConnected) return;
    if (!result.ok) throw new Error(result.data.error || 'Could not summarize evidence.');
    state.summaryCache.set(cacheKey, result.data);
    setSummaryPane(pane, result.data.html, result.data.kind);
    if (hasPendingBackfills(result.data)) scheduleSummaryBackfillRefresh(file, pane, cacheKey, attempt);
  } catch (err) {
    if (state.viewingPath !== activePath || !pane.isConnected) return;
    setSummaryPane(pane, '<div class="summary-empty"></div>', 'error');
    pane.querySelector('.summary-empty').textContent = err.message;
    if (dom.viewerBody.dataset.summaryLayout === 'summary') setSummaryLayout('source');
  }
}

function renderPacketCaptureViewer(file) {
  const available = Boolean(state.wiresharkAvailable);
  dom.viewerBody.className = 'viewer-body';
  dom.viewerBody.innerHTML = `
    <div class="pcap-preview">
      <svg class="pcap-icon" viewBox="0 0 64 64" aria-hidden="true">
        <path class="pcap-file-body" d="M18 8h20l12 12v34a4 4 0 0 1-4 4H18a4 4 0 0 1-4-4V12a4 4 0 0 1 4-4z"/>
        <path class="pcap-file-fold" d="M38 8v12h12"/>
        <path class="pcap-file-line" d="M22 34h20"/>
        <path class="pcap-file-line" d="M22 43h16"/>
        <path class="pcap-file-pulse" d="M22 25h6l3-6 5 12 3-6h5"/>
      </svg>
      <h3>Packet capture</h3>
      <p>${available ? 'Open this capture in Wireshark from the local app, or download it.' : 'Wireshark was not detected on this machine. You can still download the capture.'}</p>
      <div class="pcap-actions">
        <button id="viewer-open-wireshark" class="btn-primary slim" type="button" ${available ? '' : 'disabled'}>Open in Wireshark</button>
        <button id="viewer-download-pcap" class="btn-secondary slim" type="button">Download</button>
      </div>
    </div>`;
  const openBtn = $('viewer-open-wireshark');
  const downloadBtn = $('viewer-download-pcap');
  openBtn.title = available ? 'Open packet capture in Wireshark' : 'Wireshark is not installed or not on PATH';
  openBtn.addEventListener('click', async () => {
    if (!state.session || !state.viewingPath) return;
    openBtn.disabled = true;
    setViewerStatus('Opening Wireshark...');
    const { ok, data } = await openPcapInWireshark(state.session.id, state.viewingPath);
    if (ok) {
      setViewerStatus('Sent to Wireshark', 'ok');
    } else {
      setViewerStatus(data.error || 'Could not open Wireshark', 'error');
    }
    openBtn.disabled = !available;
  });
  downloadBtn.addEventListener('click', () => {
    triggerDownload(fileUrl(file.path, { dl: true }), downloadName(file.path));
  });
}

export function closeViewer() {
  closeDownloadMenu();
  dom.viewerEl.classList.add('hidden');
  dom.viewerScrim.classList.add('hidden');
  state.viewingPath = null;
  state.viewingIsHtml = false;
  state.viewingIsJson = false;
  state.viewingFile = null;
  state.viewingGeneratedHtml = null;
  state.summaryPaneLayout = 'split';
  setSummaryLayoutControlsVisible(false);
  dom.viewerBody.className = 'viewer-body';
  setViewerStatus('');
  dom.filesList.querySelectorAll('.file-row.viewing').forEach((el) => el.classList.remove('viewing'));
}

export function isViewerOpen() {
  return !dom.viewerEl.classList.contains('hidden');
}

export async function openViewer(file) {
  const ext = (file.path.split('.').pop() || '').toLowerCase();
  const activePath = file.path;
  state.viewingPath = file.path;
  state.viewingIsHtml = HTML_EXTS.has(ext);
  state.viewingIsJson = ext === 'json';
  state.viewingFile = file;
  state.viewingGeneratedHtml = null;
  const canSummarize = isSummarizableEvidenceJson(file);
  $('viewer-name').textContent = file.path;
  $('viewer-sub').textContent = `${fmtBytes(file.size)} · ${fmtTime(file.mtime)}`;
  setViewerStatus('');
  closeDownloadMenu();
  // Generated HTML hides this wrap because it has no file to download; a real
  // file must always bring it back, or the first plan view would strip download
  // controls from every file opened afterwards.
  dom.viewerDownloadWrap.classList.remove('hidden');
  dom.viewerDownloadBtn.title = state.viewingIsHtml || state.viewingIsJson ? 'Download options' : 'Download';
  dom.viewerDownloadFileLabel.textContent = state.viewingIsJson ? 'Download JSON' : 'Download';
  dom.viewerDownloadCsv.classList.toggle('hidden', !state.viewingIsJson);
  dom.viewerDownloadPdf.classList.toggle('hidden', !state.viewingIsHtml);
  setSummaryLayoutControlsVisible(canSummarize, canSummarize ? defaultSummaryLayout() : undefined);
  dom.viewerBody.className = 'viewer-body';
  dom.viewerBody.innerHTML = '<div class="viewer-msg">Loading…</div>';
  dom.viewerEl.classList.remove('hidden');
  dom.viewerScrim.classList.remove('hidden');
  dom.filesList.querySelectorAll('.file-row.viewing').forEach((el) => el.classList.remove('viewing'));

  try {
    if (isPacketCapture(file)) {
      renderPacketCaptureViewer(file);
      return;
    }
    if (IMG_EXTS.has(ext)) {
      dom.viewerBody.className = 'viewer-body';
      dom.viewerBody.innerHTML = '<div class="viewer-img"><img alt=""></div>';
      dom.viewerBody.querySelector('img').src = fileUrl(file.path);
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      if (canSummarize) {
        const pane = renderSummaryLayout(file, '<div class="viewer-msg compact">File is too large to preview. Use the download button above for the source JSON.</div>');
        loadSummaryPane(file, pane);
      } else {
        dom.viewerBody.innerHTML = '<div class="viewer-msg">File is too large to preview — use the download button above.</div>';
      }
      return;
    }
    const res = await fetch(fileUrl(file.path));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = await res.arrayBuffer();
    if (state.viewingPath !== activePath) return;
    const bytes = new Uint8Array(buf.slice(0, 8000));
    if (bytes.includes(0)) {
      if (canSummarize) {
        const pane = renderSummaryLayout(file, '<div class="viewer-msg compact">Binary-looking source preview skipped. Use the download button above for the source JSON.</div>');
        loadSummaryPane(file, pane);
      } else {
        dom.viewerBody.innerHTML = '<div class="viewer-msg">Binary file — no preview available. Use the download button above.</div>';
      }
      return;
    }
    const text = new TextDecoder().decode(buf);

    if (state.viewingIsHtml) {
      const iframe = document.createElement('iframe');
      iframe.setAttribute('sandbox', '');
      iframe.srcdoc = themeReportHtml(text);
      dom.viewerBody.className = 'viewer-body';
      dom.viewerBody.innerHTML = '';
      dom.viewerBody.appendChild(iframe);
    } else if (ext === 'md' || ext === 'markdown') {
      dom.viewerBody.className = 'viewer-body';
      dom.viewerBody.innerHTML = '<div class="md"></div>';
      renderMarkdown(dom.viewerBody.querySelector('.md'), text);
    } else if (ext === 'json') {
      let pretty = text;
      try { pretty = JSON.stringify(JSON.parse(text), null, 2); } catch { /* show as-is */ }
      if (canSummarize) {
        const pane = renderSummaryLayout(file, '<pre class="raw"><code class="language-json"></code></pre>');
        const code = dom.viewerBody.querySelector('.viewer-source-pane code');
        code.textContent = truncatedSourcePreview(pretty);
        highlightCode(code);
        loadSummaryPane(file, pane);
      } else {
        renderHighlightedSource(pretty, 'json');
      }
    } else if (HIGHLIGHT_LANG_BY_EXT.has(ext)) {
      renderHighlightedSource(text, HIGHLIGHT_LANG_BY_EXT.get(ext));
    } else if (TEXT_EXTS.has(ext) || !ext) {
      dom.viewerBody.className = 'viewer-body';
      dom.viewerBody.innerHTML = '<pre class="raw"></pre>';
      dom.viewerBody.querySelector('pre').textContent = text;
    } else {
      dom.viewerBody.className = 'viewer-body';
      dom.viewerBody.innerHTML = '<pre class="raw"></pre>';
      dom.viewerBody.querySelector('pre').textContent = text;
    }
  } catch (err) {
    dom.viewerBody.className = 'viewer-body';
    dom.viewerBody.innerHTML = '<div class="viewer-msg"></div>';
    dom.viewerBody.querySelector('.viewer-msg').textContent = `Could not load file: ${err.message}`;
  }
  refreshFiles();
}

/**
 * Show HTML the app generated in memory (the rendered investigation plan) in the
 * same viewer used for workspace files. Upstream keeps this in its own
 * file-viewer module; this fork merged the viewer into files.js, so it lands
 * here and reuses the existing sandboxed-iframe rendering rather than
 * introducing a second HTML path.
 *
 * There is no file behind it, so `state.viewingPath` stays null and the
 * download controls — all of which resolve a workspace path — are hidden.
 */
export function openGeneratedHtmlViewer({ title, subtitle = '', html, kind = 'generated-html', returnFocus = null } = {}) {
  if (!captureSessionScope()) return; // the session went away while the render was in flight
  state.viewingPath = null;
  state.viewingFile = null;
  state.viewingIsHtml = true;
  state.viewingIsJson = false;
  state.viewingGeneratedHtml = {
    title: String(title || 'Generated document'),
    subtitle: String(subtitle || ''),
    html: String(html || ''),
    kind,
    returnFocus,
  };
  $('viewer-name').textContent = state.viewingGeneratedHtml.title;
  $('viewer-sub').textContent = state.viewingGeneratedHtml.subtitle;
  setViewerStatus('');
  closeDownloadMenu();
  dom.viewerDownloadWrap.classList.add('hidden');
  setSummaryLayoutControlsVisible(false);
  renderGeneratedHtmlBody(state.viewingGeneratedHtml.html);
  dom.viewerEl.classList.remove('hidden');
  dom.viewerScrim.classList.remove('hidden');
  dom.filesList.querySelectorAll('.file-row.viewing').forEach((el) => el.classList.remove('viewing'));
}

function renderGeneratedHtmlBody(html) {
  // Same containment as a workspace HTML report: a sandboxed iframe with no
  // allowances, so plan text derived from wire data cannot script the app.
  const iframe = document.createElement('iframe');
  iframe.setAttribute('sandbox', '');
  iframe.srcdoc = themeReportHtml(html);
  dom.viewerBody.className = 'viewer-body';
  dom.viewerBody.innerHTML = '';
  dom.viewerBody.appendChild(iframe);
}

export function refreshThemedReportPreview() {
  if (state.viewingIsHtml && state.viewingFile) openViewer(state.viewingFile);
  // Generated HTML has no file to reopen; re-theme the snapshot we still hold.
  else if (state.viewingGeneratedHtml) renderGeneratedHtmlBody(state.viewingGeneratedHtml.html);
}

export function initFileViewer() {
  dom.chatEl.addEventListener('click', (event) => {
    const link = event.target.closest('a[data-workspace-path]');
    if (!link || !dom.chatEl.contains(link)) return;
    event.preventDefault();
    openWorkspacePath(link.dataset.workspacePath);
  });
  dom.viewerDownloadBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    if (!state.viewingPath) return;
    if (!state.viewingIsHtml && !state.viewingIsJson) {
      triggerDownload(fileUrl(state.viewingPath, { dl: true }), downloadName(state.viewingPath));
      return;
    }
    toggleDownloadMenu();
  });
  dom.viewerDownloadFile.addEventListener('click', (event) => {
    event.stopPropagation();
    if (!state.viewingPath) return;
    closeDownloadMenu();
    triggerDownload(fileUrl(state.viewingPath, { dl: true }), downloadName(state.viewingPath));
  });
  dom.viewerDownloadCsv.addEventListener('click', (event) => {
    event.stopPropagation();
    downloadCsvPath(state.viewingPath);
  });
  dom.viewerDownloadPdf.addEventListener('click', (event) => {
    event.stopPropagation();
    downloadPdfPath(state.viewingPath);
  });
  dom.viewerSummaryLayout.addEventListener('click', (event) => {
    const button = event.target.closest('[data-summary-layout]');
    if (!button) return;
    event.stopPropagation();
    setSummaryLayout(button.dataset.summaryLayout);
  });
  $('viewer-close').addEventListener('click', closeViewer);
  dom.viewerScrim.addEventListener('click', closeViewer);
  document.addEventListener('click', (event) => {
    if (!dom.viewerDownloadWrap.contains(event.target)) closeDownloadMenu();
  });
}
