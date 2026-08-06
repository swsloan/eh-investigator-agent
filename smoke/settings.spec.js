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

// ---- right panel ------------------------------------------------------------
// Files was a docked column, Memory docked or expanded from history, and Map was
// always full screen, so the same three buttons changed the size of the app.

test.describe('right panel', () => {
  test.beforeEach(async ({ page }) => {
    await page.locator('#settings-modal .modal-close, #settings-modal .icon-btn').first().click().catch(() => {});
    await page.keyboard.press('Escape');
  });

  test('the map opens on the screen, because a map is a workspace', async ({ page }) => {
    await page.locator('.files-panel .rp-tab[data-rp="map"]').click();
    await expect(page.locator('#topology-overlay')).toBeVisible();
    // No stored preference yet, so the panel's own default applies.
    await expect(page.locator('#topology-overlay')).not.toHaveClass(/docked/);
    await expect(page.locator('#topo-dock')).toHaveText('Dock to the right');
  });

  test('docking is remembered, and the other panels follow it', async ({ page }) => {
    await page.locator('.files-panel .rp-tab[data-rp="map"]').click();
    await page.locator('#topo-dock').click();
    await expect(page.locator('#topology-overlay')).toHaveClass(/docked/);
    await expect(page.locator('body')).toHaveClass(/map-docked/);
    await expect(page.locator('#topo-dock')).toHaveText('Expand to full screen');

    // The choice is shared: memory is docked too, rather than deciding for itself.
    const shared = await page.evaluate(async () => {
      const rp = await import('/js/right-panel.js');
      return { surface: rp.rpSurface(), expandedWithMapDefault: rp.isExpanded('expanded') };
    });
    expect(shared.surface).toBe('docked');
    expect(shared.expandedWithMapDefault, 'a stored choice overrides a panel default').toBe(false);

    // And it survives a reload.
    await page.reload();
    await page.locator('.files-panel .rp-tab[data-rp="map"]').click();
    await expect(page.locator('#topology-overlay')).toHaveClass(/docked/);
  });

  test('one tab strip, wired once, and only one panel open at a time', async ({ page }) => {
    // Three copies of the strip exist in the markup (files, memory and map headers);
    // they are all driven from right-panel.js rather than from each panel.
    await page.locator('.files-panel .rp-tab[data-rp="map"]').click();
    await expect(page.locator('#topology-overlay')).toBeVisible();
    await expect(page.locator('#memory-overlay')).toBeHidden();

    await page.locator('#topology-overlay .rp-tab[data-rp="memory"]').click();
    await expect(page.locator('#memory-overlay')).toBeVisible();
    await expect(page.locator('#topology-overlay')).toBeHidden();

    await page.locator('#memory-overlay .rp-tab[data-rp="files"]').click();
    await expect(page.locator('#memory-overlay')).toBeHidden();
    await expect(page.locator('#topology-overlay')).toBeHidden();
    await expect(page.locator('.files-panel')).toBeVisible();
  });
});
