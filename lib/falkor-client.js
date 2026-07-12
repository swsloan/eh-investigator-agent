import net from 'node:net';

/**
 * Minimal, read-only FalkorDB (Redis RESP) client for the memory-graph viz.
 *
 * FalkorDB speaks the Redis wire protocol; we speak just enough of it to issue
 * `GRAPH.RO_QUERY` and `GRAPH.LIST` and parse the reply. Deliberately no npm
 * dependency (matches the app's lean dependency posture) and **read-only by
 * construction**: the only query command exposed is `GRAPH.RO_QUERY`, which
 * FalkorDB itself rejects if the Cypher attempts a write. The viz never mutates
 * memory — that stays the agent's job at investigation close.
 *
 * We always RETURN scalar values (or arrays of scalars via collect()/labels()),
 * never whole nodes, so the reply parser only has to handle RESP primitives and
 * nested arrays — not FalkorDB's compact node/edge encoding.
 */

function parseRedisUrl(url) {
  try {
    const u = new URL(url);
    return {
      host: u.hostname || 'falkordb',
      port: Number(u.port || 6379),
      password: decodeURIComponent(u.password || ''),
    };
  } catch {
    return { host: 'falkordb', port: 6379, password: '' };
  }
}

/** Encode a command as a RESP array of bulk strings. */
function encodeCommand(args) {
  let out = `*${args.length}\r\n`;
  for (const a of args) {
    const s = String(a);
    out += `$${Buffer.byteLength(s)}\r\n${s}\r\n`;
  }
  return out;
}

/**
 * Parse one RESP reply from `buf` starting at `offset`.
 * Returns `{ value, offset }` (offset = index just past this reply) or `null`
 * if the buffer doesn't yet hold a complete reply.
 */
function parseReply(buf, offset) {
  if (offset >= buf.length) return null;
  const type = String.fromCharCode(buf[offset]);
  const nl = buf.indexOf('\r\n', offset);
  if (nl === -1) return null;
  const line = buf.toString('utf8', offset + 1, nl);
  const next = nl + 2;
  switch (type) {
    case '+': return { value: line, offset: next };
    case '-': return { value: new Error(line), offset: next };
    case ':': return { value: Number(line), offset: next };
    case '$': {
      const len = Number(line);
      if (len === -1) return { value: null, offset: next };
      if (buf.length < next + len + 2) return null;
      return { value: buf.toString('utf8', next, next + len), offset: next + len + 2 };
    }
    case '*': {
      const count = Number(line);
      if (count === -1) return { value: null, offset: next };
      const arr = [];
      let cur = next;
      for (let i = 0; i < count; i++) {
        const r = parseReply(buf, cur);
        if (!r) return null; // incomplete — wait for more data
        arr.push(r.value);
        cur = r.offset;
      }
      return { value: arr, offset: cur };
    }
    default:
      return { value: line, offset: next };
  }
}

/** Open a socket, (optionally AUTH,) run the given commands, return replies. */
function connectAndRun(conn, commands, timeoutMs) {
  return new Promise((resolve, reject) => {
    const toSend = conn.password ? [['AUTH', conn.password], ...commands] : commands;
    const expected = toSend.length;
    const replies = [];
    let buf = Buffer.alloc(0);
    let settled = false;

    const socket = net.connect({ host: conn.host, port: conn.port });
    const done = (fn, arg) => { if (settled) return; settled = true; clearTimeout(timer); socket.destroy(); fn(arg); };
    const timer = setTimeout(() => done(reject, new Error(`FalkorDB query timed out after ${timeoutMs}ms`)), timeoutMs);

    socket.on('connect', () => socket.write(toSend.map(encodeCommand).join('')));
    socket.on('error', (err) => done(reject, err));
    socket.on('close', () => { if (!settled) done(reject, new Error('FalkorDB connection closed unexpectedly')); });
    socket.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      while (replies.length < expected) {
        const r = parseReply(buf, 0);
        if (!r) break;
        replies.push(r.value);
        buf = buf.subarray(r.offset);
      }
      if (replies.length < expected) return;
      // AUTH reply first (if sent); surface its error too.
      if (conn.password && replies[0] instanceof Error) return done(reject, replies[0]);
      const results = conn.password ? replies.slice(1) : replies;
      const err = results.find((r) => r instanceof Error);
      if (err) return done(reject, err);
      done(resolve, results);
    });
  });
}

/**
 * Create a read-only FalkorDB client.
 *   url      redis://[:password@]host:port  (default from FALKORDB_URI or falkordb:6379)
 *   password optional; falls back to FALKORDB_PASSWORD
 */
export function createFalkorClient({ url, password, timeoutMs = 5000 } = {}) {
  const conn = parseRedisUrl(url || process.env.FALKORDB_URI || 'redis://falkordb:6379');
  if (password || process.env.FALKORDB_PASSWORD) conn.password = password || process.env.FALKORDB_PASSWORD;

  /**
   * Run a read-only Cypher query against a graph (namespace).
   * Returns { columns:[name], rows:[[value,…]] }. Row values are strings,
   * numbers, null, or nested arrays (from collect()/labels()).
   */
  async function query(graph, cypher) {
    const [reply] = await connectAndRun(conn, [['GRAPH.RO_QUERY', graph, cypher]], timeoutMs);
    // Non-compact reply: [header, rows, stats]. A write/empty reply may be just stats.
    if (!Array.isArray(reply) || reply.length < 2) return { columns: [], rows: [] };
    const header = Array.isArray(reply[0]) ? reply[0] : [];
    const rows = Array.isArray(reply[1]) ? reply[1] : [];
    const columns = header.map((h) => (Array.isArray(h) ? h[h.length - 1] : h));
    return { columns, rows };
  }

  /**
   * Run a WRITE Cypher query (GRAPH.QUERY, not RO). Used ONLY by the deliberate,
   * user-confirmed curation path (relabel/delete untyped nodes). Everything else
   * stays read-only via query().
   */
  async function mutate(graph, cypher) {
    const [reply] = await connectAndRun(conn, [['GRAPH.QUERY', graph, cypher]], timeoutMs);
    if (!Array.isArray(reply)) return { columns: [], rows: [] };
    const header = Array.isArray(reply[0]) ? reply[0] : [];
    const rows = Array.isArray(reply[1]) ? reply[1] : [];
    return { columns: header.map((h) => (Array.isArray(h) ? h[h.length - 1] : h)), rows };
  }

  /** List graph namespaces (FalkorDB graph keys). */
  async function listGraphs() {
    const [reply] = await connectAndRun(conn, [['GRAPH.LIST']], timeoutMs);
    return Array.isArray(reply) ? reply.filter((g) => typeof g === 'string') : [];
  }

  /** Cheap liveness probe. */
  async function ping() {
    const [reply] = await connectAndRun(conn, [['PING']], timeoutMs);
    return reply === 'PONG';
  }

  return { query, mutate, listGraphs, ping, endpoint: `${conn.host}:${conn.port}` };
}

/** Escape a string for safe inlining as a single-quoted Cypher literal. */
export function cypherStr(value) {
  return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/[\r\n]/g, ' ')}'`;
}
