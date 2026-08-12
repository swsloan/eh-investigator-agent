import { expect, test } from '@playwright/test';

// Approval salience (#137), driven client-side the same way activity.spec.js
// does: feed the real SSE handler the events the server would send and assert
// what the user actually sees — the tray chips (unattended, expiry countdown),
// the destructive type-to-confirm, the attended prompt at proposal time, and
// the persistent action notices.

/** Wait for the initial snapshot so a late setRunning(false) can't undo staging. */
async function waitForSnapshot(page) {
  await expect.poll(() => page.evaluate(async () => {
    const { state } = await import('/js/state.js');
    return state.session?.id ? state.snapshotsApplied : 0;
  }), { message: 'initial SSE snapshot was never applied' }).toBeGreaterThan(0);
}

/** Deliver an action_proposed event for the active session through handleEvent. */
function propose(page, overrides = {}) {
  return page.evaluate(async (over) => {
    const [{ state }, sse] = await Promise.all([import('/js/state.js'), import('/js/sse.js')]);
    const action = {
      id: over.id || '99999999-9999-4999-8999-999999999999',
      sessionId: state.session.id,
      status: 'proposed',
      capabilityId: 'create_tuningrule',
      label: 'Hide detections for scanner 10.0.0.9',
      params: { device: '10.0.0.9' },
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      destructive: false,
      presence: 'unattended',
      presenceReason: 'no one is viewing this session',
      ...over,
    };
    sse.handleEvent({ type: 'action_proposed', action });
    return action.id;
  }, overrides);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await waitForSnapshot(page);
});

test('an unattended proposal shows its presence and an expiry countdown in the tray', async ({ page }) => {
  await propose(page, {
    // Inside the 4h warn window, so the countdown chip renders.
    expiresAt: new Date(Date.now() + 90 * 60 * 1000).toISOString(),
  });
  const tray = page.locator('#actions-tray');
  await expect(tray).toBeVisible();
  await expect(tray.locator('.actions-tray-head')).toHaveText(/1 change awaiting your approval/);
  await expect(tray.locator('.action-presence')).toHaveText('unattended');
  await expect(tray.locator('.action-expiry')).toHaveText(/expires in 1h/);
  // No prompt for unattended — the tray and badge are the delivery.
  await expect(page.locator('#action-prompt-modal')).toBeHidden();
});

test('a destructive approval requires typing the capability id back', async ({ page }) => {
  await propose(page, { destructive: true });
  const card = page.locator('#actions-tray .action-card');
  await expect(card.locator('.action-destructive')).toBeVisible();
  await card.locator('.action-approve').click();

  // Buttons are replaced by the confirm block; Approve is disarmed until the
  // exact capability id is typed.
  const confirm = card.locator('.action-confirm');
  await expect(confirm).toBeVisible();
  const approve = confirm.locator('.action-approve');
  await expect(approve).toBeDisabled();
  await confirm.locator('.action-confirm-input').fill('create_tuning');
  await expect(approve).toBeDisabled();
  await confirm.locator('.action-confirm-input').fill('create_tuningrule');
  await expect(approve).toBeEnabled();

  // Cancel restores the ordinary buttons without deciding anything.
  await confirm.locator('.action-reject').click();
  await expect(card.locator('.action-confirm')).toHaveCount(0);
  await expect(card.locator('.action-approve')).toBeVisible();
});

test('an attended proposal prompts at proposal time, gated until the turn ends', async ({ page }) => {
  // Mid-turn: the agent proposed and is still working.
  await page.evaluate(async () => {
    const chat = await import('/js/chat.js');
    chat.setRunning(true);
  });
  await propose(page, { presence: 'attended', presenceReason: 'session is on screen' });

  const modal = page.locator('#action-prompt-modal');
  await expect(modal).toBeVisible();
  await expect(modal.locator('#action-prompt-note')).toHaveText(/still working/);
  await expect(modal.locator('.action-busy')).toBeVisible();
  await expect(modal.locator('.action-approve')).toHaveCount(0);

  // The turn ends → the same prompt becomes decidable in place.
  await page.evaluate(async () => {
    const chat = await import('/js/chat.js');
    chat.setRunning(false);
  });
  await expect(modal.locator('.action-busy')).toHaveCount(0);
  await expect(modal.locator('.action-approve')).toBeVisible();

  // Escape defers the decision to the tray; nothing is lost.
  await page.keyboard.press('Escape');
  await expect(modal).toBeHidden();
  await expect(page.locator('#actions-tray .action-card')).toHaveCount(1);
});

test('deciding elsewhere closes the prompt, and action notices land in the transcript', async ({ page }) => {
  await propose(page, { presence: 'attended' });
  const modal = page.locator('#action-prompt-modal');
  await expect(modal).toBeVisible();

  await page.evaluate(async () => {
    const [{ state }, sse] = await Promise.all([import('/js/state.js'), import('/js/sse.js')]);
    const decided = { ...state.actions[0], status: 'rejected' };
    sse.handleEvent({ type: 'action_decided', action: decided });
    sse.handleEvent({ type: 'action_notice', message: 'This turn ended with 1 proposed change still awaiting your approval — see the tray below.' });
  });
  await expect(modal).toBeHidden();
  await expect(page.locator('#chat')).toContainText(/still awaiting your approval/);
});
