import { expect, test } from '@playwright/test';

// The finding-chip pipeline has a browser-only step: `splitFindings` leaves a
// placeholder paragraph, marked renders it, and `replaceFindingPlaceholders` swaps
// it for a chip. Whether marked emits that placeholder as its own <p> — rather than
// escaping it, merging it into a neighbouring paragraph, or wrapping it in
// something else — cannot be checked with node:test, because marked and DOMPurify
// are browser globals loaded from /vendor. So it is checked here, against the real
// pair the app ships.

async function renderInPage(page, raw) {
  return page.evaluate(async (source) => {
    const [{ splitFindings, replaceFindingPlaceholders }, { renderMarkdown }] = await Promise.all([
      import('/js/findings.js'),
      import('/js/markdown.js'),
    ]);
    const el = document.createElement('div');
    document.body.appendChild(el);
    const { text, findings } = splitFindings(source);
    renderMarkdown(el, text);
    replaceFindingPlaceholders(el, findings);
    return {
      chips: [...el.querySelectorAll('.finding-chip')].map((c) => ({
        text: c.querySelector('.finding-text')?.textContent || '',
        leaning: c.dataset.leaning || '',
      })),
      leftoverPlaceholders: /%%EH-FINDING-/.test(el.innerHTML),
      html: el.innerHTML,
      prose: el.textContent,
      // The security property is structural, not textual: escaped angle brackets in
      // the HTML string are fine, live elements and event handlers are not.
      elementNames: [...el.querySelectorAll('*')].map((n) => n.tagName.toLowerCase()),
      eventAttributes: [...el.querySelectorAll('*')]
        .flatMap((n) => [...n.attributes].map((a) => a.name))
        .filter((name) => name.startsWith('on')),
    };
  }, raw);
}

test.beforeEach(async ({ page }) => { await page.goto('/'); });

test('a finding line becomes a chip, in place, with its leaning', async ({ page }) => {
  const out = await renderInPage(page, [
    'I pulled seven days of traffic per device.',
    '',
    'FINDING: nas-backup-02 dominates at 412 GB. [leaning: inconclusive]',
    '',
    'Checking detections next.',
  ].join('\n'));

  expect(out.chips).toEqual([{ text: 'nas-backup-02 dominates at 412 GB.', leaning: 'inconclusive' }]);
  expect(out.leftoverPlaceholders, `placeholder survived: ${out.html}`).toBe(false);
  // The surrounding narrative is untouched and still in order.
  expect(out.prose).toContain('I pulled seven days of traffic per device.');
  expect(out.prose).toContain('Checking detections next.');
  expect(out.html.indexOf('finding-chip')).toBeGreaterThan(out.html.indexOf('seven days'));
  expect(out.html.indexOf('finding-chip')).toBeLessThan(out.html.indexOf('Checking detections'));
});

test('renders several findings in the order the agent stated them', async ({ page }) => {
  const out = await renderInPage(page, [
    'FINDING: First thing. [leaning: expected-behavior]',
    '',
    'Some prose in between.',
    '',
    'FINDING: Second thing. [leaning: suspicious]',
  ].join('\n'));

  expect(out.chips.map((c) => c.text)).toEqual(['First thing.', 'Second thing.']);
  expect(out.chips.map((c) => c.leaning)).toEqual(['expected-behavior', 'suspicious']);
  expect(out.leftoverPlaceholders).toBe(false);
});

test('markdown still renders normally around a chip', async ({ page }) => {
  const out = await renderInPage(page, [
    '## Heading',
    '',
    '- one',
    '- two',
    '',
    'FINDING: Something worth saying.',
    '',
    '`code span` and **bold**.',
  ].join('\n'));

  expect(out.chips).toHaveLength(1);
  expect(out.html).toContain('<h2');
  expect(out.html).toContain('<li>');
  expect(out.html).toContain('<code>');
  expect(out.html).toContain('<strong>');
});

test('model text is never treated as markup', async ({ page }) => {
  const out = await renderInPage(
    page,
    'FINDING: host <img src=x onerror=alert(1)> claimed <b>ownership</b>.',
  );
  // The chip carries the literal characters the model wrote...
  expect(out.chips[0].text).toBe('host <img src=x onerror=alert(1)> claimed <b>ownership</b>.');
  // ...as text. No element was created from it and no handler was bound. (Escaped
  // angle brackets in the HTML string are the correct outcome, not a leak.)
  expect(out.elementNames).not.toContain('img');
  expect(out.elementNames).not.toContain('b');
  expect(out.eventAttributes).toEqual([]);
});

test('prose that merely mentions the word is left alone', async ({ page }) => {
  const out = await renderInPage(page, 'My FINDING: style notes are not a finding line when inline.');
  expect(out.chips).toHaveLength(0);
  expect(out.leftoverPlaceholders).toBe(false);
});
