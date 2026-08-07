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

test('before the plan exists the card says so, rather than leaving a hole', async ({ page }) => {
  // Measured on a real investigation: `investigation-plan init` lands ~40s in, after
  // the agent has read its skills and the tool help. Hiding the card for that whole
  // stretch left the centre column empty and read as a stalled UI.
  await stageTurn(page, { withPlan: false, calls: [] });
  await expect(page.locator('#activity')).toBeVisible();
  const plan = page.locator('#activity-plan');
  await expect(plan).toBeVisible();
  await expect(plan).toHaveClass(/pending/);
  await expect(plan).toContainText('Reading its skills');
  await expect(page.locator('#activity-plan-count')).toHaveText('');

  // Once the real plan arrives the card becomes the plan, with no shape change.
  await page.evaluate(async () => {
    const [{ state }, activity] = await Promise.all([import('/js/state.js'), import('/js/activity.js')]);
    state.investigationPlan = {
      initialized: true,
      plan: { tasks: [{ id: 't1', title: 'Sweep 7-day device activity', status: 'in_progress' }] },
      progress: { total: 1, resolved: 0, percent: 0, currentTask: { id: 't1' } },
    };
    activity.renderAll();
  });
  await expect(plan).not.toHaveClass(/pending/);
  await expect(plan).toContainText('Sweep 7-day device activity');
  await expect(page.locator('#activity-plan-count')).toHaveText('0/1');
});

test('an idle session with no plan shows no plan card at all', async ({ page }) => {
  await stageTurn(page, { withPlan: false, calls: [] });
  await page.evaluate(async () => {
    const [{ state }, activity] = await Promise.all([import('/js/state.js'), import('/js/activity.js')]);
    state.running = false;
    activity.renderAll();
  });
  await expect(page.locator('#activity-plan')).toBeHidden();
});

test('a live view left open starts the next turn cleanly', async ({ page }) => {
  // Opened by hand, it survives the turn ending — so the next turn has to
  // re-initialise it. It used to sit reading "Idle" through a running turn,
  // still showing the previous investigation's finding.
  await stageTurn(page, { calls: [{ id: 'a', name: 'bash', phrase: 'Querying', done: true, output: '{}' }] });
  await page.evaluate(async () => {
    const { setCurrentFinding } = await import('/js/activity.js');
    setCurrentFinding({ text: 'Previous turn: 412 GB was the nightly backup.', leaning: 'expected-behavior' });
  });
  // End the turn with the view opened by the user, so it stays up.
  await page.evaluate(async () => {
    const [{ state }, activity] = await Promise.all([import('/js/state.js'), import('/js/activity.js')]);
    activity.setActivityOpen(false);
    activity.setActivityOpen(true, { byUser: true });
    state.running = false;
    activity.onRunningChanged(false);
  });
  await expect(page.locator('#activity')).toBeVisible();
  await expect(page.locator('#activity-state')).toHaveText('Idle');
  await expect(page.locator('#activity-finding')).toContainText('nightly backup');

  // A new turn starts: the stale finding goes, and the status leaves Idle.
  await page.evaluate(async () => {
    const [{ state }, activity] = await Promise.all([import('/js/state.js'), import('/js/activity.js')]);
    state.running = true;
    activity.onRunningChanged(true);
  });
  await expect(page.locator('#activity-state')).toHaveText(/Investigating/);
  await expect(page.locator('#activity-finding')).toBeHidden();
});

test('an empty workspace clears the artifacts rail rather than keeping the last one', async ({ page }) => {
  await stageTurn(page, { calls: [] });
  await page.evaluate(async () => {
    const [{ state }, activity] = await Promise.all([import('/js/state.js'), import('/js/activity.js')]);
    state.workspaceFiles = new Map([['evidence/metrics/old.json', {
      path: 'evidence/metrics/old.json', tag: 'METRICS', reveal: true, size: 10, mtime: 1, icon: 'metrics',
    }]]);
    activity.onFilesChanged();
  });
  await expect(page.locator('#activity-artifacts')).toContainText('old.json');

  // Switching to a session that has produced nothing must not leave the previous
  // workspace's artifacts on screen.
  await page.evaluate(async () => {
    const [{ state }, activity] = await Promise.all([import('/js/state.js'), import('/js/activity.js')]);
    state.workspaceFiles = new Map();
    activity.onFilesChanged();
  });
  await expect(page.locator('#activity-artifacts')).not.toContainText('old.json');
  await expect(page.locator('#activity-artifacts')).toContainText('Evidence and reports appear here');
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

test('the tool stream reads newest first, and folds the older calls away', async ({ page }) => {
  const calls = Array.from({ length: 9 }, (_, i) => ({
    id: `c${i}`, name: 'bash', phrase: `Step ${i}`, done: i < 8, output: '{}',
  }));
  await stageTurn(page, { calls });

  const cards = page.locator('#activity-tools .act-call');
  await expect(cards).toHaveCount(6);
  // The monitor's interesting line is the last one, so it is at the top — the
  // opposite of the transcript, which you read forwards.
  await expect(cards.first()).toContainText('Step 8');
  await expect(cards.first()).toHaveClass(/running/);
  await expect(cards.nth(1)).toContainText('Step 7');
  await expect(page.locator('#activity-tools .act-more')).toHaveText('3 earlier calls');
  await expect(page.locator('#activity-tools-head')).toHaveText(/9 calls/);
});

test('a tool card names the system and operation, and leads with the agent\'s reason', async ({ page }) => {
  await stageTurn(page, { calls: [] });
  await page.evaluate(async () => {
    const store = await import('/js/tool-store.js');
    const { toolLabel, reasonFor, phraseFor } = await import('/js/tool-phrases.js');
    const ev = {
      toolCallId: 'q',
      toolName: 'Bash',
      args: {
        command: "./excli-interface search_records -json '{\"types\":[\"~cifs\"],\"from\":-604800000}'",
        description: 'Confirm the SMB peers and ports on nas-backup-02',
      },
    };
    store.startCall(ev, {
      phrase: phraseFor(ev.toolName, ev.args),
      label: toolLabel(ev.toolName, ev.args),
      reason: reasonFor(ev.toolName, ev.args),
    });
  });

  const card = page.locator('#activity-tools .act-call').first();
  // The system, not the shell.
  await expect(card.locator('.act-call-source')).toHaveText('ExtraHop');
  await expect(card.locator('.act-call-action')).toHaveText('search_records');
  await expect(card).not.toContainText('Bash');
  // The agent's own reason leads; the derived phrase supports it.
  await expect(card.locator('.act-call-reason')).toHaveText('Confirm the SMB peers and ports on nas-backup-02');
  await expect(card.locator('.act-call-phrase')).toContainText('SMB records over the last 7 days');
  // And the centre column says why, not just what.
  await expect(page.locator('#activity-doing')).toHaveText('Confirm the SMB peers and ports on nas-backup-02');
});

test('a call with no description still reads as an action', async ({ page }) => {
  await stageTurn(page, { calls: [] });
  await page.evaluate(async () => {
    const store = await import('/js/tool-store.js');
    const { toolLabel, phraseFor } = await import('/js/tool-phrases.js');
    const ev = { toolCallId: 'm', toolName: 'Bash', args: { command: 'mkdir -p evidence/records' } };
    store.startCall(ev, { phrase: phraseFor(ev.toolName, ev.args), label: toolLabel(ev.toolName, ev.args), reason: '' });
  });
  const card = page.locator('#activity-tools .act-call').first();
  await expect(card.locator('.act-call-source')).toHaveText('Workspace');
  await expect(card.locator('.act-call-action')).toHaveText('mkdir');
  await expect(card.locator('.act-call-reason')).toHaveCount(0);
});

test('a finished call states what it found, with the number emphasised', async ({ page }) => {
  await stageTurn(page, { calls: [] });
  await page.evaluate(async () => {
    const store = await import('/js/tool-store.js');
    const { resultSummary } = await import('/js/tool-phrases.js');
    const output = JSON.stringify({ devices: new Array(200).fill({}) });
    store.startCall({ toolCallId: 'x', toolName: 'bash', args: {} }, { phrase: 'Searching devices' });
    store.endCall({ toolCallId: 'x' }, { output, summary: resultSummary({ output }) });
  });
  const card = page.locator('#activity-tools .act-call').first();
  await expect(card).toContainText('Searching devices');
  await expect(card.locator('.act-call-result')).toContainText('200 devices returned');
  await expect(card.locator('.act-call-result strong')).toHaveText('200');
});

test('progress on a running call is visible, not just its existence', async ({ page }) => {
  await stageTurn(page, { calls: [{ id: 'p', name: 'bash', phrase: 'Pulling records' }] });
  await page.evaluate(async () => {
    const store = await import('/js/tool-store.js');
    store.updateCall({ toolCallId: 'p', status: 'page 3 of 12' });
  });
  await expect(page.locator('#activity-tools .act-call.running .act-call-progress')).toHaveText('page 3 of 12');
});

test('a file being written shows as drafting before it exists in the workspace', async ({ page }) => {
  await stageTurn(page, { calls: [] });
  await page.evaluate(async () => {
    const [{ state }, store, activity] = await Promise.all([
      import('/js/state.js'), import('/js/tool-store.js'), import('/js/activity.js'),
    ]);
    // One finished artifact...
    state.workspaceFiles = new Map([
      ['evidence/metrics/top-talkers.json', {
        path: 'evidence/metrics/top-talkers.json', tag: 'METRICS', reveal: true, size: 12, mtime: 1,
      }],
    ]);
    // ...and one still being written, which the polled listing cannot know about yet.
    store.startCall({ toolCallId: 'w', toolName: 'write', args: { path: 'report-nas.html' } }, { phrase: 'Writing report-nas.html' });
    activity.onFilesChanged();
    activity.renderAll();
  });

  const artifacts = page.locator('#activity-artifacts .act-artifact');
  await expect(artifacts).toHaveCount(2);
  const drafting = page.locator('.act-artifact.drafting');
  await expect(drafting).toHaveCount(1);
  await expect(drafting).toContainText('report-nas.html');
  await expect(drafting.locator('.act-artifact-tag')).toHaveText('Drafting');
  await expect(page.locator('#activity-artifacts')).toContainText('top-talkers.json');
  await expect(page.locator('#activity-artifacts-head')).toHaveText(/Artifacts · 2/);
});

// The wires are decoration that reports state: they travel only while there is
// matching work in flight, so `.live` is the whole contract worth testing.
test('the wire to the tool rail travels only while a call is running', async ({ page }) => {
  await stageTurn(page, { calls: [{ id: 'r', name: 'bash', phrase: 'Pulling records' }] });
  const wire = page.locator('#activity-wire-tools');
  await expect(wire).toHaveClass(/live/);

  await page.evaluate(async () => {
    const store = await import('/js/tool-store.js');
    store.endCall({ toolCallId: 'r', isError: false }, { output: 'done' });
  });
  await expect(wire).not.toHaveClass(/live/);
  // Still drawn when idle — the dashes are the resting state, not the animation.
  await expect(wire).toBeVisible();
});

test('the wire to the artifacts rail travels only while a file is being written', async ({ page }) => {
  await stageTurn(page, { calls: [{ id: 'c', name: 'bash', phrase: 'Counting flows' }] });
  const wire = page.locator('#activity-wire-artifacts');
  await expect(wire).not.toHaveClass(/live/);

  await page.evaluate(async () => {
    const store = await import('/js/tool-store.js');
    store.startCall({ toolCallId: 'w', toolName: 'write', args: { path: 'report.html' } }, { phrase: 'Writing report.html' });
  });
  await expect(wire).toHaveClass(/live/);
});

test('the wires never intercept a click meant for the card beneath', async ({ page }) => {
  await stageTurn(page, { calls: [] });
  const overlapping = await page.evaluate(() => {
    const svg = document.getElementById('activity-wires');
    const box = svg.getBoundingClientRect();
    const x = box.left + box.width / 2;
    const y = box.top + box.height / 2;
    return document.elementFromPoint(x, y)?.closest('#activity-wires') !== null;
  });
  expect(overlapping).toBe(false);
});

// Opening it by hand. The view opens itself when a turn starts, which means an idle
// session had no way in at all — and no way back after closing it mid-turn.
test('the live view can be opened by hand, and is then the user\'s to close', async ({ page }) => {
  await expect(page.locator('#activity')).toBeHidden();
  const btn = page.locator('#live-view-btn');
  await expect(btn).toBeVisible();

  await btn.click();
  await expect(page.locator('#activity')).toBeVisible();
  await expect(page.locator('#chat-scroll')).toBeHidden();
  // Its own header carries the way back, so the entry point stands down.
  await expect(btn).toBeHidden();

  await page.locator('#activity-transcript').click();
  await expect(page.locator('#activity')).toBeHidden();
  await expect(btn).toBeVisible();
});

test('a hand-opened live view is not taken away when the turn ends', async ({ page }) => {
  await page.locator('#live-view-btn').click();
  await stageTurn(page, { calls: [{ id: 'a', name: 'bash', phrase: 'Searching detections', done: true }] });
  await expect(page.locator('#activity')).toBeVisible();

  // End the turn. An auto-opened view closes here; one the user opened stays.
  await page.evaluate(async () => {
    const [{ state }, activity] = await Promise.all([import('/js/state.js'), import('/js/activity.js')]);
    state.running = false;
    activity.onRunningChanged(false);
  });
  await expect(page.locator('#activity')).toBeVisible();
  await expect(page.locator('#activity-state')).toHaveText('Idle');
});
