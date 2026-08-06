import { expect, test } from '@playwright/test';

// The live activity view renders from the tool store, the plan state and the
// workspace file list — all client-side. Driving it through those modules is the
// only way to exercise it without a backend running a real turn, and it is also
// the honest test: these are exactly the inputs the SSE handlers feed it.

/** Put the app into a running turn with a plan and some tool calls. */
async function stageTurn(page, { withPlan = true, calls = [] } = {}) {
  // Wait for boot first. The app creates a session and its SSE snapshot sets
  // running:false a beat later, which would otherwise overwrite the staged turn.
  await expect.poll(() => page.evaluate(async () => {
    const { state } = await import('/js/state.js');
    return state.session?.id ?? null;
  })).not.toBeNull();

  return page.evaluate(async ({ withPlan, calls }) => {
    const [{ state }, store, activity] = await Promise.all([
      import('/js/state.js'), import('/js/tool-store.js'), import('/js/activity.js'),
    ]);
    state.session = { ...state.session, title: 'Noisiest device — 10.42.0.117' };
    if (withPlan) {
      state.investigationPlan = {
        initialized: true,
        plan: {
          tasks: [
            { id: 't1', title: 'Sweep 7-day device activity', status: 'completed' },
            { id: 't2', title: 'Rank talkers, isolate outlier', status: 'completed' },
            { id: 't3', title: 'Check detections against outlier', status: 'in_progress' },
            { id: 't4', title: 'Write report + verdict', status: 'pending' },
          ],
        },
        progress: { total: 4, resolved: 2, percent: 50, currentTask: { id: 't3' } },
      };
    }
    store.resetCalls();
    for (const c of calls) {
      store.startCall({ toolCallId: c.id, toolName: c.name, args: c.args || {} }, { phrase: c.phrase || '' });
      if (c.done) store.endCall({ toolCallId: c.id, isError: !!c.error }, { output: c.output || '' });
    }
    state.running = true;
    activity.onRunningChanged(true);
    return true;
  }, { withPlan, calls });
}

test.beforeEach(async ({ page }) => { await page.goto('/'); });

test('a running turn opens the live view, and Transcript goes back', async ({ page }) => {
  await expect(page.locator('#activity')).toBeHidden();
  await stageTurn(page, { calls: [{ id: 'a', name: 'bash', phrase: 'Searching detections' }] });

  await expect(page.locator('#activity')).toBeVisible();
  // Both surfaces stay mounted; the transcript keeps its streaming DOM.
  await expect(page.locator('#chat-scroll')).toBeHidden();
  await expect(page.locator('#chat')).toHaveCount(1);
  // The artifacts rail supersedes the files panel while it is up.
  await expect(page.locator('.files-panel')).toBeHidden();

  await page.locator('#activity-transcript').click();
  await expect(page.locator('#activity')).toBeHidden();
  await expect(page.locator('#chat-scroll')).toBeVisible();
  await expect(page.locator('.files-panel')).toBeVisible();
});

test('the centre column mirrors the plan and says what is running', async ({ page }) => {
  await stageTurn(page, {
    calls: [
      { id: 'a', name: 'bash', phrase: 'Querying traffic per device', done: true, output: '{}' },
      { id: 'b', name: 'bash', phrase: 'Searching DNS records over the last 14 days' },
    ],
  });

  // The agent's occupation is whatever is actually running, not the last thing started.
  await expect(page.locator('#activity-doing')).toHaveText('Searching DNS records over the last 14 days');

  const plan = page.locator('#activity-plan');
  await expect(plan).toBeVisible();
  await expect(page.locator('#activity-plan-count')).toHaveText('2/4');
  await expect(page.locator('#activity-plan-tasks li')).toHaveCount(4);
  await expect(page.locator('#activity-plan-tasks li.done')).toHaveCount(2);
  await expect(page.locator('#activity-plan-tasks li.current')).toHaveText(/Check detections/);
  // The meter reflects progress rather than being decorative.
  const width = await page.locator('#activity-plan-fill').evaluate((el) => el.style.width);
  expect(width).toBe('50%');
});

test('the plan card stays away when there is no plan', async ({ page }) => {
  await stageTurn(page, { withPlan: false, calls: [] });
  await expect(page.locator('#activity')).toBeVisible();
  await expect(page.locator('#activity-plan')).toBeHidden();
});

test('the current finding card carries the leaning', async ({ page }) => {
  await stageTurn(page, { calls: [] });
  await page.evaluate(async () => {
    const { setCurrentFinding } = await import('/js/activity.js');
    setCurrentFinding({ text: '412 GB of SMB matches the backup window.', leaning: 'expected-behavior' });
  });
  const card = page.locator('#activity-finding');
  await expect(card).toBeVisible();
  await expect(card).toContainText('412 GB of SMB matches the backup window.');
  await expect(card).toHaveAttribute('data-leaning', 'expected-behavior');
});

test('a message typed mid-turn is queued and sent at the boundary', async ({ page }) => {
  const posted = [];
  await page.route('**/api/sessions/*/message', (route) => {
    posted.push(route.request().postDataJSON());
    return route.fulfill({ json: { ok: true } });
  });
  await stageTurn(page, { calls: [] });

  await page.locator('#input').fill('check the DNS records too');
  await page.locator('#input').press('Enter');

  // The server refuses a message mid-turn, so it is held rather than sent.
  expect(posted).toHaveLength(0);
  await expect(page.locator('#composer-queued')).toBeVisible();
  await expect(page.locator('#composer-queued-text')).toHaveText('check the DNS records too');
  await expect(page.locator('#input')).toHaveValue('');

  // When the turn ends it goes out on its own.
  await page.evaluate(async () => {
    const { setRunning } = await import('/js/chat.js');
    setRunning(false);
  });
  await expect.poll(() => posted.length).toBe(1);
  expect(posted[0].text).toBe('check the DNS records too');
  await expect(page.locator('#composer-queued')).toBeHidden();
});

test('a queued message can be discarded before the turn ends', async ({ page }) => {
  const posted = [];
  await page.route('**/api/sessions/*/message', (route) => {
    posted.push(route.request().postDataJSON());
    return route.fulfill({ json: { ok: true } });
  });
  await stageTurn(page, { calls: [] });
  await page.locator('#input').fill('never mind');
  await page.locator('#input').press('Enter');
  await expect(page.locator('#composer-queued')).toBeVisible();

  await page.locator('#composer-queued-cancel').click();
  await expect(page.locator('#composer-queued')).toBeHidden();

  await page.evaluate(async () => {
    const { setRunning } = await import('/js/chat.js');
    setRunning(false);
  });
  await page.waitForTimeout(300);
  expect(posted, 'a discarded message is not sent later').toHaveLength(0);
});
