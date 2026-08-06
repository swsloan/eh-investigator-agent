import { expect, test } from '@playwright/test';

// Settings mixed analyst configuration with operator tooling across seven tabs, one
// of which held four controls. These tests pin the shape it was consolidated into,
// and the coupling that makes the consolidation risky.

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.locator('#settings-btn').click();
  await expect(page.locator('#settings-modal')).toBeVisible();
});

test('five analyst tabs plus Developer, and no Challenger tab of its own', async ({ page }) => {
  const tabs = page.locator('.settings-nav-btn');
  await expect(tabs).toHaveText([
    'General', 'Agent & models', 'Memory', 'Integrations', 'Connection', 'Developer',
  ]);
  await expect(page.locator('.settings-nav-btn[data-panel="challenger"]')).toHaveCount(0);
});

test('the challenger controls moved into Agent & models, and still work', async ({ page }) => {
  await page.locator('.settings-nav-btn[data-panel="agent"]').click();
  const panel = page.locator('.settings-panel[data-panel="agent"]');
  await expect(panel).toBeVisible();

  // All four controls are present, under their own heading rather than merged
  // invisibly into the model settings above them.
  await expect(panel.locator('.settings-subhead')).toHaveText('Challenger');
  for (const id of ['set-challenger-enabled', 'set-challenger-auto', 'set-challenger-model', 'set-challenger-reasoning']) {
    await expect(panel.locator(`#${id}`)).toHaveCount(1);
  }
  // The save path reads these by id, so being in a different panel is not enough —
  // they have to be operable where they now live.
  const enabled = panel.locator('#set-challenger-enabled');
  const before = await enabled.isChecked();
  await enabled.click();
  expect(await enabled.isChecked()).toBe(!before);
});

test('Developer keeps the data-panel eval.js hangs its refresh off', async ({ page }) => {
  const dev = page.locator('.settings-nav-btn[data-panel="eval"]');
  await expect(dev).toHaveText('Developer');
  // eval.js finds this button by that exact selector and the lookup is ?.-guarded,
  // so renaming the value would disable case refresh in silence.
  await dev.click();
  await expect(page.locator('.settings-panel[data-panel="eval"]')).toBeVisible();
  // The panel has its own subsection titles below this one.
  await expect(page.locator('.settings-panel[data-panel="eval"] .panel-title').first()).toHaveText('Developer');
  await expect(page.locator('.settings-panel[data-panel="eval"] .settings-subhead').first()).toHaveText('Evaluation');
});

test('switching tabs shows exactly one panel', async ({ page }) => {
  for (const name of ['general', 'agent', 'memory', 'integrations', 'connection', 'eval']) {
    await page.locator(`.settings-nav-btn[data-panel="${name}"]`).click();
    await expect(page.locator('.settings-panel:not(.hidden)')).toHaveCount(1);
    await expect(page.locator(`.settings-panel[data-panel="${name}"]`)).toBeVisible();
    await expect(page.locator(`.settings-nav-btn[data-panel="${name}"]`)).toHaveAttribute('aria-selected', 'true');
  }
});
