// Auth UX (Phase 4, #24). Two small jobs, only relevant when the deployment has
// token authentication enabled (the hardened profile); in the default loopback
// alpha this is inert.
//   1. Reveal the sign-out control when auth is on.
//   2. If a session expires, an API call comes back 401 — bounce to the login
//      page instead of leaving a half-broken UI behind.
export function initAuth() {
  // Global 401 safety net. Wrap fetch once; on an unauthenticated response send
  // the browser to the login page (guarded against loops).
  const nativeFetch = window.fetch.bind(window);
  let redirecting = false;
  window.fetch = async (...args) => {
    const res = await nativeFetch(...args);
    if (res.status === 401 && !redirecting && window.location.pathname !== '/login') {
      redirecting = true;
      window.location.assign('/login');
    }
    return res;
  };

  fetch('/api/auth/status')
    .then((r) => (r.ok ? r.json() : null))
    .then((status) => {
      if (status && status.enabled) {
        document.getElementById('logout-form')?.classList.remove('hidden');
      }
    })
    .catch(() => { /* status is best-effort; the control just stays hidden */ });
}
