import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  humanWindow, jsonArg, parseJsonOutput, phraseFor, reasonFor, resultSummary, toolLabel,
} from './tool-phrases.js';

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

// ---- result summaries --------------------------------------------------------

const plain = (segs) => (segs || []).map((s) => s.text).join('');
const strong = (segs) => (segs || []).filter((s) => s.strong).map((s) => s.text).join('');

test('finds JSON inside noisy stdout', () => {
  assert.deepEqual(parseJsonOutput('{"a":1}'), { a: 1 });
  assert.deepEqual(parseJsonOutput('warning: slow\n{"a":1}\n'), { a: 1 });
  assert.deepEqual(parseJsonOutput('[1,2]'), [1, 2]);
  assert.equal(parseJsonOutput('not json at all'), null);
  assert.equal(parseJsonOutput(''), null);
});

test('counts what came back, and emphasises the count', () => {
  const devices = resultSummary({ output: JSON.stringify({ devices: new Array(200).fill({}) }) });
  assert.equal(plain(devices), '200 devices returned');
  assert.equal(strong(devices), '200');

  const records = resultSummary({ output: JSON.stringify({ records: new Array(184).fill({}) }) });
  assert.equal(plain(records), '184 records returned');

  const one = resultSummary({ output: JSON.stringify({ detections: [{}] }) });
  assert.equal(plain(one), '1 detection returned', 'singular, not "1 detections"');
});

test('treats emptiness as the finding it is', () => {
  const none = resultSummary({ output: JSON.stringify({ detections: [] }) });
  assert.equal(plain(none), 'No detections in this window');
  assert.equal(strong(none), 'No detections');
  assert.equal(plain(resultSummary({ output: JSON.stringify({ devices: [] }) })), 'No devices matched');
});

test('reports the total behind a truncated record page', () => {
  const segs = resultSummary({ output: JSON.stringify({ records: new Array(100).fill({}), total: 4213 }) });
  assert.equal(plain(segs), '100 records returned of 4,213 matching');
  // A total that merely equals the page adds nothing.
  const exact = resultSummary({ output: JSON.stringify({ records: new Array(7).fill({}), total: 7 }) });
  assert.equal(plain(exact), '7 records returned');
});

test('summarises the metric sensors envelope by points and objects', () => {
  const output = JSON.stringify({
    sensors: [{ response: { stats: [
      { oid: 1, time: 1, values: [1, 2, 3] },
      { oid: 2, time: 1, values: [4, 5, 6] },
    ] } }],
  });
  const segs = resultSummary({ output });
  assert.equal(plain(segs), '6 data points across 2 objects');
  assert.equal(strong(segs), '6');
});

test('names a single device record', () => {
  const segs = resultSummary({ output: JSON.stringify({ extrahop_id: 'abc', display_name: 'nas-backup-02' }) });
  assert.equal(plain(segs), 'Device nas-backup-02');
  assert.equal(strong(segs), 'nas-backup-02');
});

test('leads with the reason when a call failed', () => {
  const segs = resultSummary({ output: 'ExtraHop CLI broker is not running.\ntrace...', isError: true });
  assert.equal(plain(segs), 'Failed: ExtraHop CLI broker is not running.');
});

test('claims nothing about output it does not recognise', () => {
  assert.equal(resultSummary({ output: 'total 48\ndrwxr-xr-x 4 user staff' }), null);
  assert.equal(resultSummary({ output: '' }), null);
  assert.equal(resultSummary({}), null);
  assert.equal(resultSummary({ output: JSON.stringify({ something: 'else' }) }), null);
});

// ---- toolLabel: name the act, not the transport --------------------------
// Every ExtraHop query, threat-intel lookup and web search reaches the agent as a
// shell command, so "Bash" was the only name the stream ever showed.

test('an ExtraHop query is named by system and operation, not "Bash"', () => {
  assert.deepEqual(
    toolLabel('Bash', { command: "./excli-interface search_records -json '{\"types\":[\"~cifs\"]}'" }),
    { source: 'ExtraHop', action: 'search_records' },
  );
  assert.deepEqual(
    toolLabel('Bash', { command: './excli-interface execute_metric_query -json \'{}\'' }),
    { source: 'ExtraHop', action: 'execute_metric_query' },
  );
});

test('the other interfaces name their own system', () => {
  assert.deepEqual(toolLabel('Bash', { command: './research-interface rdap -json \'{}\'' }),
    { source: 'Web research', action: 'rdap' });
  assert.deepEqual(toolLabel('Bash', { command: './reversinglabs-interface reputation -json \'{}\'' }),
    { source: 'ReversingLabs', action: 'reputation' });
  assert.deepEqual(toolLabel('Bash', { command: './investigation-plan update -json \'{}\'' }),
    { source: 'Investigation plan', action: 'update' });
  assert.deepEqual(toolLabel('Bash', { command: './propose-action create -json \'{}\'' }),
    { source: 'Change proposal', action: 'create' });
});

test('a real shell command names the program it runs', () => {
  assert.deepEqual(toolLabel('Bash', { command: 'mkdir -p evidence/records' }),
    { source: 'Workspace', action: 'mkdir' });
  // An env prefix is not the program.
  assert.deepEqual(toolLabel('Bash', { command: 'TZ=UTC jq .records evidence/x.json' }),
    { source: 'Workspace', action: 'jq' });
});

test('non-shell tools are named from what they are', () => {
  assert.deepEqual(toolLabel('Skill', { skill: 'network-topology' }), { source: 'Skill', action: 'network-topology' });
  assert.deepEqual(toolLabel('mcp__graphiti__add_memory', {}), { source: 'Memory', action: 'save' });
  assert.deepEqual(toolLabel('mcp__graphiti__search_nodes', {}), { source: 'Memory', action: 'recall' });
  assert.deepEqual(toolLabel('Read', { file_path: 'a.json' }), { source: 'Workspace', action: 'read' });
  assert.deepEqual(toolLabel('ToolSearch', { query: 'x' }), { source: 'Tool search', action: '' });
  // An unknown tool still gets a name rather than an empty header.
  assert.deepEqual(toolLabel('SomethingNew', {}), { source: 'SomethingNew', action: '' });
});

// ---- reasonFor: the agent's own words ------------------------------------

test('the agent-written command description becomes the reason', () => {
  // Claude Code writes this for nearly every Bash call; it was reaching the client
  // and being discarded.
  assert.equal(reasonFor('Bash', { command: 'x', description: 'Confirm the SMB peers and ports.' }),
    'Confirm the SMB peers and ports');
  assert.equal(reasonFor('Bash', { command: 'x' }), '');
  assert.equal(reasonFor('Bash', { command: 'x', description: '   ' }), '');
  assert.equal(reasonFor('Bash', null), '');
  assert.equal(reasonFor('Bash', { description: 'z'.repeat(300) }).length, 120, 'capped for one line');
});
