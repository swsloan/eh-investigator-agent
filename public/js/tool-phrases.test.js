import { test } from 'node:test';
import assert from 'node:assert/strict';
import { humanWindow, jsonArg, phraseFor } from './tool-phrases.js';

const bash = (command) => phraseFor('bash', { command });

test('reads the -json payload the brokered interfaces take', () => {
  assert.deepEqual(jsonArg(`./excli-interface search_records -json '{"types":["~dns"]}'`), { types: ['~dns'] });
  assert.equal(jsonArg('./excli-interface search_records'), null);
  assert.equal(jsonArg(`./excli-interface search_records -json '{not json}'`), null, 'unparseable payloads earn no phrase');
  assert.equal(jsonArg(`./excli-interface search_records -json '[1,2]'`), null, 'a non-object payload is not a query');
});

test('turns negative millisecond offsets into a readable window', () => {
  assert.equal(humanWindow(-604_800_000), 'over the last 7 days');
  assert.equal(humanWindow(-1_209_600_000), 'over the last 14 days');
  assert.equal(humanWindow(-86_400_000), 'over the last 1 day');
  assert.equal(humanWindow(-28_800_000), 'over the last 8 hours');
  assert.equal(humanWindow(-300_000), 'over the last 5 minutes');
  // A positive `from` is an absolute epoch, which says nothing about duration.
  assert.equal(humanWindow(1_735_689_600_000), '');
  assert.equal(humanWindow(undefined), '');
});

test('describes record searches by protocol and window', () => {
  assert.equal(
    bash(`./excli-interface search_records -json '{"types":["~dns"],"from":-1209600000}'`),
    'Searching DNS records over the last 14 days',
  );
  assert.equal(
    bash(`./excli-interface search_records -json '{"types":["~cifs"],"from":-28800000}'`),
    'Searching SMB records over the last 8 hours',
  );
  assert.equal(
    bash(`./excli-interface search_records -json '{"types":["~kerberos_request"]}'`),
    'Searching Kerberos records',
  );
  // Unknown record types still read as themselves rather than as a raw token.
  assert.equal(
    bash(`./excli-interface search_records -json '{"types":["~custom_thing"]}'`),
    'Searching custom thing records',
  );
});

test('describes metric queries by subject, grouping and window', () => {
  assert.equal(
    bash(`./excli-interface execute_metric_query -json '{"metric_category":"net_detail","metric_specs":[{"name":"bytes_in"},{"name":"bytes_out"}],"object_type":"device","from":-604800000}'`),
    'Querying traffic per device over the last 7 days',
  );
  assert.equal(
    bash(`./excli-interface execute_metric_query -json '{"metric_specs":[{"name":"dns_query"}],"object_type":"device","from":-86400000}'`),
    'Querying dns query per device over the last 1 day',
  );
  // No specs: fall back to the category rather than inventing a subject.
  assert.equal(
    bash(`./excli-interface execute_metric_query -json '{"metric_category":"http_server","object_type":"device"}'`),
    'Querying http server per device',
  );
});

test('names the other ExtraHop verbs without over-claiming', () => {
  assert.equal(bash(`./excli-interface search_devices -json '{"limit":200}'`), 'Searching devices');
  assert.equal(bash(`./excli-interface get_device -json '{"id":42}'`), 'Looking up a device');
  assert.equal(
    bash(`./excli-interface search_detections -json '{"from":-604800000}'`),
    'Searching detections over the last 7 days',
  );
  // A verb with no payload still gets its intent line.
  assert.equal(bash('./excli-interface search_devices'), 'Searching devices');
});

test('covers the research and ReversingLabs interfaces', () => {
  assert.equal(
    bash(`./research-interface search -json '{"query":"CVE-2024-3400","count":8}'`),
    'Searching the web for “CVE-2024-3400”',
  );
  assert.equal(bash(`./research-interface cve -json '{"cve":"CVE-2024-3400"}'`), 'Looking up a CVE');
  assert.equal(bash(`./reversinglabs-interface reputation -json '{"hashes":["abc"]}'`), 'Checking file reputation');
  assert.equal(bash('./reversinglabs-interface probe'), 'Testing the ReversingLabs connection');
});

test('leaves an ordinary shell command to speak for itself', () => {
  assert.equal(bash('cat evidence/metrics/top-talkers.json'), '');
  assert.equal(bash('ls -la'), '');
});

test('describes native file and web tools', () => {
  assert.equal(phraseFor('read', { path: 'evidence/records/smb.json' }), 'Reading smb.json');
  assert.equal(phraseFor('write', { file_path: '/w/report.html' }), 'Writing report.html');
  assert.equal(phraseFor('edit', { path: 'notes.md' }), 'Editing notes.md');
  assert.equal(phraseFor('WebSearch', { query: 'lateral movement smb' }), 'Searching the web for “lateral movement smb”');
  assert.equal(phraseFor('read', {}), '', 'no path, no claim');
  assert.equal(phraseFor('SomeUnknownTool', { a: 1 }), '');
});

test('never throws on malformed input', () => {
  for (const bad of [undefined, null, 0, '', 'str', [], { command: null }, { command: 42 }]) {
    assert.doesNotThrow(() => phraseFor('bash', bad));
    assert.doesNotThrow(() => phraseFor(bad, { command: 'x' }));
  }
});
