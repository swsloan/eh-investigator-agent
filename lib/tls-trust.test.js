// TLS trust verification for the Node-side HTTPS clients.
//
// Covers the "TLS trust matrix" in docs/SECURITY-HARDENING.md end-to-end against
// a certificate issued by a throwaway private CA, rather than inferring the
// private-CA case from a public-CA endpoint. A synthetic CA is the right
// instrument here: a private CA *is* a self-signed CA, so the client's trust
// decision is identical, and the whole thing runs hermetically — no appliance,
// no credentials, no network.
//
// The excli (Go) half of the matrix cannot run here: bin/excli is fetched at
// image-build time and is not present in the working tree. It is covered by
// scripts/verify-tls-trust.sh, which runs against a built image.
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MAKE_CA = path.join(HERE, '..', 'scripts', 'make-test-ca.sh');

function hasOpenssl() {
  try {
    execFileSync('openssl', ['version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// Connect to the stub over TLS and report the outcome. `extra` carries the
// per-case trust configuration (a custom CA, or the insecure override).
function probe(port, extra = {}) {
  return new Promise((resolve) => {
    const req = https.get(
      { host: '127.0.0.1', port, path: '/', agent: false, ...extra },
      (res) => {
        res.resume();
        resolve({ ok: true, status: res.statusCode, authorized: res.socket.authorized });
      },
    );
    req.on('error', (err) => resolve({ ok: false, code: err.code || err.message }));
  });
}

describe('TLS trust', { skip: hasOpenssl() ? false : 'openssl not available' }, () => {
  let dir;
  let server;
  let port;
  let caPem;

  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eh-tls-'));
    execFileSync('bash', [MAKE_CA, dir], { stdio: 'ignore' });
    caPem = fs.readFileSync(path.join(dir, 'ca.crt'));

    // Stub appliance: presents the privately-issued leaf and rejects everything
    // with 401. A 401 therefore proves the TLS handshake completed, since
    // verification happens before any request is served.
    server = https.createServer(
      {
        key: fs.readFileSync(path.join(dir, 'leaf.key')),
        cert: fs.readFileSync(path.join(dir, 'leaf.crt')),
      },
      (req, res) => {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'stub-unauthorized' }));
      },
    );
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = server.address().port;
  });

  after(() => {
    // close() alone only stops accepting; keep-alive sockets would keep the
    // test file's event loop alive past the last assertion.
    server?.closeAllConnections();
    server?.close();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  test('fails closed against a certificate from an untrusted CA', async () => {
    const r = await probe(port);
    assert.equal(r.ok, false, 'expected the handshake to be rejected');
    // Assert fail-closed, not a specific OpenSSL code: which code surfaces
    // depends on how the chain is built (a self-signed root absent from the
    // store yields UNABLE_TO_VERIFY_LEAF_SIGNATURE, a missing intermediate
    // yields UNABLE_TO_GET_ISSUER_CERT_LOCALLY). Pinning one makes the test
    // brittle without making it stronger.
    assert.match(String(r.code), /CERT|SIGNATURE|SELF_SIGNED|UNABLE/i);
  });

  test('accepts the certificate when the private CA is supplied inline', async () => {
    const r = await probe(port, { ca: [caPem] });
    assert.equal(r.ok, true, `expected a completed handshake, got ${r.code}`);
    assert.equal(r.status, 401);
    assert.equal(r.authorized, true);
  });

  test('honours the private CA via NODE_EXTRA_CA_CERTS', async () => {
    // NODE_EXTRA_CA_CERTS is read once at process startup, so this has to run
    // in a child. This is the mechanism scripts/docker-entrypoint.sh exports,
    // so it is the one that matters for the container deployment.
    //
    // The spawn must be async: the child connects to the stub server running in
    // *this* process, so blocking the event loop here (execFileSync) deadlocks —
    // the server can never accept the connection the child is waiting on.
    const script = `
      const https = require('https');
      https.get({ host: '127.0.0.1', port: ${port}, path: '/', agent: false }, (res) => {
        console.log(JSON.stringify({ ok: true, status: res.statusCode, authorized: res.socket.authorized }));
        res.resume();
      }).on('error', (e) => console.log(JSON.stringify({ ok: false, code: e.code })));
    `;
    const { stdout } = await execFileAsync(process.execPath, ['-e', script], {
      env: { ...process.env, NODE_EXTRA_CA_CERTS: path.join(dir, 'ca.crt') },
      encoding: 'utf8',
    });
    const r = JSON.parse(stdout.trim());
    assert.equal(r.ok, true, `expected a completed handshake, got ${r.code}`);
    assert.equal(r.authorized, true);
  });

  test('insecure override connects but does not fake trust', async () => {
    const r = await probe(port, { rejectUnauthorized: false });
    assert.equal(r.ok, true);
    assert.equal(r.status, 401);
    // The escape hatch bypasses *rejection*; it must still report the peer as
    // unverified, so callers and logs can tell trust was never established.
    assert.equal(r.authorized, false);
  });
});
