import { expect, test } from '@playwright/test';

// A deliberately small smoke test: prove the app boots, the SPA shell renders,
// the health endpoint is up, and nothing throws in the browser on a fresh,
// credential-free load. It is the CI canary for "did we break the app entirely",
// not a functional/behavioral suite.

test('SPA loads clean and health is up', async ({ page, baseURL }) => {
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    // The app boots credential-free, so it legitimately gets a 503 from
    // /api/preflight until ExtraHop is configured; Chromium logs that as a
    // "Failed to load resource" console error. Ignore those network-status
    // errors — we're guarding against real JS errors, not expected backend state.
    if (/Failed to load resource/i.test(msg.text())) return;
    consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await page.goto('/');

  // Shell renders: the brand lockup and the primary "New session" control are
  // present without any credentials configured.
  await expect(page.locator('.brand')).toBeVisible();
  await expect(page.locator('#new-session-btn')).toBeVisible();

  // Health endpoint responds and reports the canonical version.
  const health = await page.request.get(`${baseURL}/api/health`);
  expect(health.status()).toBe(200);
  const body = await health.json();
  expect(body.ok).toBe(true);
  expect(typeof body.version).toBe('string');
  expect(body.version.length).toBeGreaterThan(0);

  // Give async init (SSE, session/preflight fetches) a moment to run, then assert
  // the load produced no uncaught errors or console errors.
  await page.waitForTimeout(1500);
  expect(pageErrors, `uncaught page errors: ${pageErrors.join(' | ')}`).toEqual([]);
  expect(consoleErrors, `console errors: ${consoleErrors.join(' | ')}`).toEqual([]);
});
