import { defineConfig, devices } from '@playwright/test';

// Minimal browser smoke: Playwright boots the real server (credential-free — the
// stack comes up without ExtraHop/Anthropic config) and drives the SPA. Scoped
// to smoke/ so it never picks up the node:test suites under lib/.
const PORT = Number(process.env.SMOKE_PORT || 4100);
const HOST = '127.0.0.1';
const baseURL = `http://${HOST}:${PORT}`;

export default defineConfig({
  testDir: './smoke',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  reporter: 'line',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'node server.js',
    url: `${baseURL}/api/health`,
    env: { PORT: String(PORT), HOST },
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
