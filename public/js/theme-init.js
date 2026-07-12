(function () {
  try {
    var t = localStorage.getItem('eh-theme') || 'system';
    var dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  } catch (e) {
    // Ignore storage or media-query failures; the main app will apply defaults.
  }
})();
