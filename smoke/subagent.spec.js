import { expect, test } from '@playwright/test';

// Delegated (subagent) activity in both surfaces — #120 slice 0.
//
// The acceptance criterion is visual and specific: a `Task`-delegated unit of
// work must show its OWN tool calls, with the subagent's name and model visible.
// Before this slice it rendered as one card reading `Subagent · general-purpose`
// with nothing inside it. Driven through the real SSE handler, so these are the
// same events a delegated turn puts on the wire.

const PARENT = 'task-1';

/** Feed the SSE handler a delegation: the Task, then the subagent's own calls. */
async function stageDelegation(page, { finishChildren = true } = {}) {
  await expect.poll(() => page.evaluate(async () => {
    const { state } = await import('/js/state.js');
    return state.session?.id ? state.snapshotsApplied : 0;
  }), { message: 'initial SSE snapshot was never applied' }).toBeGreaterThan(0);

  return page.evaluate(async ({ parent, finishChildren }) => {
    const sse = await import('/js/sse.js');
    sse.handleEvent({
      type: 'tool_execution_start',
      toolCallId: parent,
      toolName: 'Task',
      args: { subagent_type: 'telemetry', description: 'Sweep SMB records for the outlier' },
    });
    const child = (id, command, description) => {
      sse.handleEvent({
        type: 'tool_execution_start',
        toolCallId: id,
        toolName: 'Bash',
        args: { command, description },
        parentToolCallId: parent,
        agentModel: 'claude-haiku-4-5-20251001',
      });
      if (finishChildren) {
        sse.handleEvent({
          type: 'tool_execution_end',
          toolCallId: id,
          toolName: 'Bash',
          isError: false,
          parentToolCallId: parent,
          result: { content: [{ type: 'text', text: '184 records' }] },
        });
      }
    };
    child('c1', './excli-interface search_records -json {}', 'Sweep SMB records over 7 days');
    child('c2', './excli-interface get_device -json {}', 'Resolve the peer device');
    sse.handleEvent({
      type: 'subagent_usage',
      parentToolCallId: parent,
      agentModel: 'claude-haiku-4-5-20251001',
      usage: { input: 20, output: 10, cacheRead: 40_000, cacheWrite: 500, totalTokens: 40_530 },
    });
    return true;
  }, { parent: PARENT, finishChildren });
}

test.beforeEach(async ({ page }) => { await page.goto('/'); });

test('a delegated unit of work shows its own tool calls in the transcript', async ({ page }) => {
  await stageDelegation(page);

  // The delegating card is still one card at top level…
  const parent = page.locator(`.tool-card:not(.tool-card-child)`).filter({ hasText: 'Subagent' });
  await expect(parent).toHaveCount(1);
  await expect(parent.locator('> .tool-head > .tool-name')).toHaveText('Subagent · telemetry');

  // …but it is no longer opaque: the subagent's calls are inside it.
  const children = parent.locator('.tool-children > .tool-card-child');
  await expect(children).toHaveCount(2);
  await expect(children.first().locator('> .tool-head > .tool-name')).toContainText('ExtraHop');
  // The delegating card names what was delegated, the tier it ran on, and what it
  // cost — once each, on the card that owns the unit of work.
  await expect(parent.locator('> .tool-head > .tool-summary')).toHaveText(/Delegating: Sweep SMB records/);
  await expect(parent.locator('> .tool-head > .tool-agent-model')).toHaveText(/haiku/i);
  await expect(parent.locator('> .tool-head > .tool-agent-usage')).toHaveText(/41k tok/);
  await expect(children.first().locator('> .tool-head > .tool-agent-model')).toHaveCount(0);

  // Nothing was flattened into the transcript alongside the parent: three calls
  // ran, but only the delegating one is a card in the message body.
  await expect(page.locator('#chat .tool-card')).toHaveCount(3);
  await expect(page.locator('#chat .tool-card:not(.tool-card-child)')).toHaveCount(1);
});

test('the live view nests delegated calls under the call that asked for them', async ({ page }) => {
  await stageDelegation(page, { finishChildren: false });
  await page.evaluate(async () => {
    const chat = await import('/js/chat.js');
    chat.setRunning(true); // a running turn opens the live view
  });

  const stream = page.locator('#activity-tools');
  await expect(page.locator('#activity')).toBeVisible();
  // One root card for the delegation, with the subagent's calls inside it.
  await expect(stream.locator('> .act-call')).toHaveCount(1);
  const nested = stream.locator('.act-call-children > .act-call-child');
  await expect(nested).toHaveCount(2);
  await expect(stream.locator('.act-call-children-head')).toHaveText(/2 calls · claude-haiku/);

  // The count is every call that ran, delegated ones included.
  await expect(page.locator('#activity-tools-head')).toHaveText('Tool activity · 3 calls');
  // The agent's current occupation is the delegated call actually in flight.
  await expect(page.locator('#activity-doing')).toHaveText('Resolve the peer device');
});

test('a delegated call whose parent never rendered still appears', async ({ page }) => {
  // Replay can slim the parent out of the transcript; the work must not vanish.
  await expect.poll(() => page.evaluate(async () => {
    const { state } = await import('/js/state.js');
    return state.session?.id ? state.snapshotsApplied : 0;
  })).toBeGreaterThan(0);
  await page.evaluate(async () => {
    const sse = await import('/js/sse.js');
    sse.handleEvent({
      type: 'tool_execution_start',
      toolCallId: 'lonely',
      toolName: 'Bash',
      args: { command: 'ls', description: 'List the evidence directory' },
      parentToolCallId: 'never-rendered',
      agentModel: 'claude-haiku-4-5-20251001',
    });
  });
  const orphan = page.locator('.tool-card.tool-card-orphan');
  await expect(orphan).toHaveCount(1);
  await expect(orphan.locator('.tool-agent-model')).toHaveText(/haiku/i);
});

test('delegated tokens are counted in the session usage readout', async ({ page }) => {
  const before = await page.evaluate(async () => {
    const { state } = await import('/js/state.js');
    return { cacheRead: state.usage.cacheRead, context: state.usage.contextTokens };
  });
  await stageDelegation(page);
  const after = await page.evaluate(async () => {
    const { state } = await import('/js/state.js');
    return { cacheRead: state.usage.cacheRead, context: state.usage.contextTokens };
  });
  expect(after.cacheRead - before.cacheRead).toBe(40_000);
  // But the context readout still means the LEAD's context, not the subagent's.
  expect(after.context).toBe(before.context);
});
