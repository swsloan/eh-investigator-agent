const THEME_KEY = 'eh-theme';
const themeMedia = window.matchMedia('(prefers-color-scheme: dark)');

let refreshReportPreview = () => {};

export function getThemePref() {
  try { return localStorage.getItem(THEME_KEY) || 'system'; } catch { return 'system'; }
}

function resolveTheme(pref) {
  if (pref === 'light' || pref === 'dark') return pref;
  return themeMedia.matches ? 'dark' : 'light';
}

function currentTheme() {
  return resolveTheme(getThemePref());
}

export function themeReportHtml(html) {
  const theme = currentTheme();
  const attr = `data-report-theme="${theme}"`;
  if (!/<html\b/i.test(html)) return html;
  if (/<html\b[^>]*\sdata-report-theme=(["'])/i.test(html)) {
    return html.replace(/(<html\b[^>]*\sdata-report-theme=)(["'])([^"']*)(["'])/i, (_match, start, quote, _value, end) => {
      return `${start}${quote}${theme}${end}`;
    });
  }
  return html.replace(/<html\b([^>]*)>/i, (_match, attrs) => `<html${attrs} ${attr}>`);
}

function applyTheme(pref) {
  document.documentElement.setAttribute('data-theme', resolveTheme(pref));
}

export function syncThemeButtons(pref) {
  document.querySelectorAll('#set-theme .seg-btn').forEach((button) => {
    button.classList.toggle('active', button.dataset.value === pref);
  });
}

function setTheme(pref) {
  try { localStorage.setItem(THEME_KEY, pref); } catch { /* private mode */ }
  applyTheme(pref);
  syncThemeButtons(pref);
  refreshReportPreview();
}

export function initTheme({ refreshPreview } = {}) {
  refreshReportPreview = refreshPreview || refreshReportPreview;
  document.querySelectorAll('#set-theme .seg-btn').forEach((button) => {
    button.addEventListener('click', () => setTheme(button.dataset.value));
  });
  themeMedia.addEventListener('change', () => {
    if (getThemePref() === 'system') {
      applyTheme('system');
      refreshReportPreview();
    }
  });
  applyTheme(getThemePref());
  syncThemeButtons(getThemePref());
}
