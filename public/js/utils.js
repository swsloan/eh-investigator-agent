export function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function fmtTime(ms) {
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Compact token counts, same thresholds as pi's TUI footer.
export function fmtTokens(n) {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  if (n < 10_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  return `${Math.round(n / 1_000_000)}M`;
}

export function downloadName(relPath) {
  return relPath.split('/').pop() || 'download';
}

export function pdfDownloadName(relPath) {
  return `${downloadName(relPath).replace(/\.[^.]+$/, '') || 'download'}.pdf`;
}

export function csvDownloadName(relPath) {
  return `${downloadName(relPath).replace(/\.[^.]+$/, '') || 'download'}.csv`;
}

export function triggerDownload(url, name = '') {
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
