const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const TRUSTED_FETCH_SITES = new Set(['same-origin', 'none']);

function hostParts(host) {
  if (!host) return null;
  try {
    return new URL(`http://${host}`).host;
  } catch {
    return null;
  }
}

export function isLoopbackHostname(hostname) {
  const host = String(hostname || '').toLowerCase();
  return host === 'localhost'
    || host === '[::1]'
    || host === '::1'
    || /^127(?:\.\d{1,3}){3}$/.test(host);
}

export function isLocalHostHeader(host) {
  if (!host) return false;
  try {
    const url = new URL(`http://${host}`);
    return isLoopbackHostname(url.hostname);
  } catch {
    return false;
  }
}

export function isSameLocalOrigin(source, requestHost) {
  const expectedHost = hostParts(requestHost);
  if (!source || !expectedHost || !isLocalHostHeader(requestHost)) return false;
  try {
    const url = new URL(source);
    return (url.protocol === 'http:' || url.protocol === 'https:')
      && isLoopbackHostname(url.hostname)
      && url.host === expectedHost;
  } catch {
    return false;
  }
}

export function localOriginGuard(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();

  const host = req.get('host');
  if (!isLocalHostHeader(host)) {
    return res.status(403).json({ error: 'Mutating requests must target the local app origin.' });
  }

  const fetchSite = String(req.get('sec-fetch-site') || '').toLowerCase();
  if (fetchSite && !TRUSTED_FETCH_SITES.has(fetchSite)) {
    return res.status(403).json({ error: 'Cross-origin requests are not allowed.' });
  }

  const origin = req.get('origin');
  if (origin && !isSameLocalOrigin(origin, host)) {
    return res.status(403).json({ error: 'Cross-origin requests are not allowed.' });
  }

  const referer = req.get('referer');
  if (!origin && referer && !isSameLocalOrigin(referer, host)) {
    return res.status(403).json({ error: 'Cross-origin requests are not allowed.' });
  }

  return next();
}
