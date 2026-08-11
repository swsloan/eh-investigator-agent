// One rule for what an ExtraHop host setting may be, shared by everything that
// turns it into a request: buildExcliEnv (which hands it to the excli binary as
// EXTRAHOP_HOST) and the REST client.
//
// Why this is its own module: a host setting is a HOST, not a URL, and treating
// it as one is a credential-exfiltration path. `https://<host>/api/v1` happily
// reinterprets anything richer:
//
//   trusted.example@evil.example -> the host is evil.example, so the
//                                   `Authorization: ExtraHop apikey=…` header
//                                   goes to a server the operator did not choose
//   eda.lab?x=1 / eda.lab#f      -> the API path folds into a query or fragment
//   https://eda.lab              -> the host becomes literally "https"
//
// Confirmed against the excli binary (#134): with
// EXTRAHOP_HOST="real.invalid@127.0.0.1:19999" it dials 127.0.0.1:19999 and
// begins a TLS handshake there. This is not theoretical, and it is not limited
// to our own HTTP client.
//
// Deliberately dependency-free so both settings.js and extrahop-rest.js can
// import it without a cycle.

/** A hostname or IPv4 address, or a bracketed IPv6 literal, with an optional port. */
const HOST_RE = /^(\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?)(:\d{1,5})?$/;

/** True when `value` is a bare host we can safely put in front of a path. */
export function isPlainHost(value) {
  const host = String(value ?? '').trim();
  if (!HOST_RE.test(host)) return false;
  // Belt and braces: the parsed host must be exactly what was configured, so a
  // form the regex did not anticipate still cannot redirect the request.
  try {
    const parsed = new URL(`https://${host}/`);
    return parsed.host === host.toLowerCase() && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

/**
 * Return the host, or throw with a message aimed at whoever typed it. The error
 * carries `code: 'INVALID_EXTRAHOP_HOST'` so the settings route can answer 400
 * rather than 500, matching how an invalid RevealX 360 tenant is handled.
 */
export function assertPlainHost(value, label = 'The ExtraHop host') {
  const host = String(value ?? '').trim();
  if (isPlainHost(host)) return host;
  const error = new Error(`${label} must be a hostname or IP address with an optional port — not a URL. Remove any scheme ("https://"), path, query, "#", or "@".`);
  error.code = 'INVALID_EXTRAHOP_HOST';
  throw error;
}
