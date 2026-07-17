import express from 'express';

// Test-only helper (not a *.test.js file, so `node --test` won't run it). Mounts
// routers on a throwaway Express app bound to an ephemeral port so route-level
// tests can drive them over real HTTP with `fetch`, then tears the server down.
export async function withServer(configure, run) {
  const app = express();
  app.use(express.json());
  configure(app);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const { port } = server.address();
  try {
    return await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}
