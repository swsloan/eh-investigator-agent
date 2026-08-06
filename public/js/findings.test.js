import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFinding, placeholderIndex, splitFindings } from './findings.js';

test('parses a finding line into sentence and leaning', () => {
  assert.deepEqual(
    parseFinding('412 GB of SMB matches the backup window. [leaning: expected-behavior]'),
    { text: '412 GB of SMB matches the backup window.', leaning: 'expected-behavior' },
  );
  assert.deepEqual(
    parseFinding('svc_backup authenticated on a host it has never used.'),
    { text: 'svc_backup authenticated on a host it has never used.', leaning: '' },
  );
  assert.deepEqual(
    parseFinding('Odd but explainable. [ LEANING : Suspicious ]'),
    { text: 'Odd but explainable.', leaning: 'suspicious' },
    'the tag is matched case- and space-insensitively',
  );
});

test('drops a leaning it does not recognise rather than inventing one', () => {
  const parsed = parseFinding('Something happened. [leaning: definitely-evil]');
  assert.equal(parsed.leaning, '', 'unknown leanings carry no verdict colour');
  assert.equal(parsed.text, 'Something happened.', 'but the tag is still stripped from the prose');
});

test('ignores a finding that is only a tag', () => {
  assert.equal(parseFinding('[leaning: malicious]'), null);
  assert.equal(parseFinding('   '), null);
  assert.equal(parseFinding(undefined), null);
});

test('lifts findings out of prose and leaves ordered placeholders', () => {
  const raw = [
    'I pulled seven days of traffic.',
    '',
    'FINDING: nas-backup-02 dominates at 412 GB. [leaning: inconclusive]',
    '',
    'Now checking detections.',
    'FINDING: No detections fired against it. [leaning: expected-behavior]',
  ].join('\n');
  const { text, findings } = splitFindings(raw);

  assert.equal(findings.length, 2);
  assert.equal(findings[0].text, 'nas-backup-02 dominates at 412 GB.');
  assert.equal(findings[1].leaning, 'expected-behavior');
  assert.match(text, /%%EH-FINDING-0%%/);
  assert.match(text, /%%EH-FINDING-1%%/);
  assert.doesNotMatch(text, /FINDING:/, 'the raw marker never reaches the renderer');
  // Order is preserved, which is what keeps a chip where the agent said it.
  assert.ok(text.indexOf('%%EH-FINDING-0%%') < text.indexOf('%%EH-FINDING-1%%'));
  assert.match(text, /I pulled seven days of traffic\./);
});

test('leaves ordinary prose alone', () => {
  const raw = 'No findings here. The word FINDING appears mid-sentence and should not match.';
  const { text, findings } = splitFindings(raw);
  assert.equal(findings.length, 0);
  assert.equal(text, raw);
});

test('a finding line with nothing after the tag stays as written', () => {
  const raw = 'FINDING: [leaning: malicious]';
  const { text, findings } = splitFindings(raw);
  assert.equal(findings.length, 0, 'nothing to say, nothing to chip');
  assert.equal(text, raw);
});

test('recognises its own placeholders and nothing else', () => {
  assert.equal(placeholderIndex('%%EH-FINDING-0%%'), 0);
  assert.equal(placeholderIndex('  %%EH-FINDING-12%%  '), 12);
  assert.equal(placeholderIndex('%%EH-FINDING-x%%'), -1);
  assert.equal(placeholderIndex('text %%EH-FINDING-0%%'), -1);
  assert.equal(placeholderIndex(''), -1);
});

test('handles indented and mid-stream finding lines', () => {
  const { findings } = splitFindings('  FINDING: indented but valid.');
  assert.equal(findings.length, 1);
  // A line still being typed converts as soon as it parses; it simply grows.
  const partial = splitFindings('FINDING: half a sen');
  assert.equal(partial.findings[0].text, 'half a sen');
});
