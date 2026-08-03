// Attack overlay staging + entity binding. Run: node --test lib/attack-overlay.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TACTICS, bindEntry, buildOverlay, deviceIndex, extractHosts, externalActor, normalizeTactic, orderEvents, parseTime, tacticFor, timeKey,
} from './attack-overlay.js';

const DEVICES = [
  { key: 'oid:1', name: 'jjkoupro12.acmelegal.lab', ip: '172.16.204.161', oid: '4294967325' },
  { key: 'oid:2', name: 'nlqawdc1.acmelegal.lab', ip: '172.16.204.10', oid: '4294967296' },
  { key: 'oid:3', name: 'nlqawdc2.acmelegal.lab', ip: '172.16.204.11', oid: '4294967299' },
];
const resolve = deviceIndex(DEVICES);

test('normalizeTactic canonicalizes spelling and rejects nonsense', () => {
  assert.equal(normalizeTactic('lateral movement'), 'Lateral Movement');
  assert.equal(normalizeTactic('LATERAL_MOVEMENT'), 'Lateral Movement');
  assert.equal(normalizeTactic('credential-access'), 'Credential Access');
  assert.equal(normalizeTactic('Hacking'), '', 'not an ATT&CK tactic');
  assert.equal(normalizeTactic(''), '');
});

test('an explicit tactic always beats inference', () => {
  const out = tacticFor({ tactic: 'Discovery', event: 'ransom notes deployed' });
  assert.deepEqual(out, { tactic: 'Discovery', inferred: false });
});

test('tactic is inferred from text for verdicts written before the field existed', () => {
  const cases = [
    ['Ransom-note deployment begins', 'Impact'],
    ['Network-wide ping sweep', 'Discovery'],
    ['PowerShell remoting attempts to peers', 'Lateral Movement'],
    ['Mass file access / exfil-staging', 'Exfiltration'],
    ['Kerberoasting against the DC', 'Credential Access'],
  ];
  for (const [event, expected] of cases) {
    const out = tacticFor({ event });
    assert.equal(out.tactic, expected, `"${event}" → ${expected}`);
    assert.equal(out.inferred, true, 'flagged as inferred, not asserted');
  }
  assert.equal(tacticFor({ event: 'Something happened' }).tactic, '', 'no false confidence');
});

test('deviceIndex resolves a device by key, IP, OID, hostname and short name', () => {
  assert.equal(resolve('oid:1'), 'oid:1');
  assert.equal(resolve('172.16.204.161'), 'oid:1');
  assert.equal(resolve('4294967325'), 'oid:1');
  assert.equal(resolve('jjkoupro12.acmelegal.lab'), 'oid:1');
  assert.equal(resolve('JJKOUPRO12'), 'oid:1', 'short name, case-insensitive');
  assert.equal(resolve('nope'), '');
  assert.equal(resolve(''), '');
});

test('extractHosts finds hostnames but not IPs or evidence filenames', () => {
  const hosts = extractHosts('KALI (172.16.206.22) hit ca.acmelegal.lab per evidence/records/http.json');
  assert.ok(hosts.includes('ca.acmelegal.lab'));
  assert.ok(!hosts.some((h) => h.startsWith('172.')), 'IPs are handled separately');
  assert.ok(!hosts.some((h) => h.endsWith('.json')), 'an evidence path is not a host');
});

test('structured src/dst bind exactly, and are not marked inferred', () => {
  const out = bindEntry({ src: '172.16.204.161', dst: 'nlqawdc1.acmelegal.lab' }, resolve);
  assert.deepEqual(out, { src: 'oid:1', dst: 'oid:2', entities: ['oid:1', 'oid:2'], inferred: false });
});

test('without structured fields, actors are read from prose in mention order', () => {
  // The real shape of every verdict written before Slice C.
  const out = bindEntry({
    event: 'Ransom-note deployment begins',
    detail: 'jjkoupro12.acmelegal.lab begins writing HOW_TO_RECOVER_FILES.txt via SMB to nlqawdc1.acmelegal.lab.',
  }, resolve);
  assert.equal(out.src, 'oid:1', 'the first-mentioned host is the actor');
  assert.equal(out.dst, 'oid:2');
  assert.equal(out.inferred, true, 'guessed from prose — the UI must be able to say so');
});

test('an event naming no known device binds to nothing rather than guessing', () => {
  const out = bindEntry({ event: 'Appliance-side observation', detail: 'No hosts named here.' }, resolve);
  assert.deepEqual(out.entities, []);
  assert.equal(out.src, '');
  assert.equal(out.inferred, false);
});

test('timeKey handles stamps, ranges, bare clock times, and phrases', () => {
  assert.equal(typeof timeKey('2026-07-29T03:00:00Z'), 'number');
  assert.ok(timeKey('04:00–05:00') < timeKey('06:00'), 'a range sorts by its start');
  assert.ok(timeKey('~04:58') > timeKey('03:32'), 'approximate clock times still order');
  assert.equal(timeKey('ongoing'), null, 'a phase is unparseable, not an error');
  assert.equal(timeKey(''), null);
});

test('parseTime distinguishes absolute stamps from bare clock times', () => {
  // The distinction that matters: Date.parse('04:00') silently yields *today*, which
  // would fabricate an epoch stamp for a clock-only entry and wreck the ordering.
  assert.equal(parseTime('2026-07-29T03:00:00Z').kind, 'absolute');
  assert.equal(parseTime('04:00–05:00').kind, 'clock');
  assert.equal(parseTime('~04:58').kind, 'clock');
  assert.equal(parseTime('ongoing').kind, 'none');
});

test('mixed absolute and clock-only times order correctly (real verdict shape)', () => {
  // Regression: sorting raw keys put "04:00–05:00" FIRST, because a time-of-day key
  // (~1.4e7) is tiny next to an epoch stamp (~1.8e12) — throwing a late-stage event
  // to the front of the attack.
  const ordered = orderEvents([
    { time: '2026-07-29T02:19:30Z', event: 'enumeration' },
    { time: '2026-07-29T03:00:00Z', event: 'ransom notes' },
    { time: '04:00–05:00', event: 'staging' },
    { time: 'ongoing', event: 'encryption burst' },
  ]);
  assert.deepEqual(ordered.map((e) => e.event),
    ['enumeration', 'ransom notes', 'staging', 'encryption burst']);
});

test('a clock time that rolls past midnight lands on the next day, not before the attack', () => {
  const ordered = orderEvents([
    { time: '2026-07-29T23:00:00Z', event: 'late night' },
    { time: '01:30', event: 'after midnight' },
  ]);
  assert.deepEqual(ordered.map((e) => e.event), ['late night', 'after midnight']);
});

test('a hostname ending in c2 is not mistaken for command-and-control', () => {
  // Regression: /c2\b/ matched the "c2" in "nlqawdc2." because the dot is a word
  // boundary, mislabelling SCM probing as C2.
  const out = tacticFor({
    event: 'SCM admin-access probing',
    detail: 'jjkoupro12 sends Service Control Manager requests to nlqawdc2.acmelegal.lab.',
  });
  assert.notEqual(out.tactic, 'Command and Control');
  assert.equal(out.tactic, 'Privilege Escalation', 'admin-access probing is privilege testing');
  // A genuine C2 reference still classifies.
  assert.equal(tacticFor({ event: 'C2 beacon observed' }).tactic, 'Command and Control');
  assert.equal(tacticFor({ event: 'command-and-control channel' }).tactic, 'Command and Control');
});

// The real jjkoupro12 ransomware timeline, in the shape it exists on disk today
// (no src/dst/tactic — the exact backward-compatibility case Slice C must handle).
const RANSOMWARE = {
  disposition: 'malicious',
  confidence: 'high',
  attack_techniques: ['T1486', 'T1021', 'T1039', 'T1135'],
  timeline: [
    { time: '02:19:30', event: 'Network share enumeration begins', detail: 'jjkoupro12.acmelegal.lab queries share lists on 8 hosts, including nlqawdc1.acmelegal.lab.' },
    { time: '02:29:30', event: 'Network-wide ping sweep', detail: 'jjkoupro12.acmelegal.lab ICMP-scans approximately 500 devices.' },
    { time: '03:00:00', event: 'Ransom-note deployment begins', detail: 'jjkoupro12.acmelegal.lab begins writing HOW_TO_RECOVER_FILES.txt via SMB to nlqawdc1.acmelegal.lab.' },
    { time: '03:36:00', event: 'Lateral-movement attempts', detail: 'jjkoupro12.acmelegal.lab sends PowerShell remoting requests to peers.' },
    { time: '04:00–05:00', event: 'Mass file access / exfil-staging', detail: 'jjkoupro12.acmelegal.lab reads 100 client documents from nlqawdc2.acmelegal.lab.' },
  ],
};

test('the real ransomware timeline stages and binds end to end', () => {
  const o = buildOverlay(RANSOMWARE, DEVICES, { sessionId: 's1', title: 'jjkoupro12 ransomware' });

  assert.equal(o.events.length, 5);
  assert.equal(o.disposition, 'malicious');
  assert.deepEqual(o.techniques, ['T1486', 'T1021', 'T1039', 'T1135']);

  // The attack reads as a kill chain, in order.
  assert.deepEqual(o.events.map((e) => e.tactic),
    ['Discovery', 'Discovery', 'Impact', 'Lateral Movement', 'Exfiltration']);

  // Every event binds to the offender, and the two DC-directed ones bind their target.
  assert.equal(o.unbound, 0, 'every event bound to at least one real device');
  assert.ok(o.events.every((e) => e.src === 'oid:1'), 'jjkoupro12 is the actor throughout');
  assert.equal(o.events[2].dst, 'oid:2', 'ransom notes land on nlqawdc1');
  assert.equal(o.events[4].dst, 'oid:3', 'staging reads come from nlqawdc2');

  assert.deepEqual(o.entities.sort(), ['oid:1', 'oid:2', 'oid:3']);
  assert.deepEqual(o.stages.map((s) => s.tactic), ['Discovery', 'Lateral Movement', 'Exfiltration', 'Impact'],
    'stages are reported in kill-chain order, not timeline order');
});

test('events are ordered chronologically, keeping unparseable times in author order', () => {
  const o = buildOverlay({
    timeline: [
      { time: 'ongoing', event: 'Beaconing continues' },
      { time: '01:00', event: 'Early event' },
      { time: '05:00', event: 'Late event' },
    ],
  }, DEVICES);
  assert.deepEqual(o.events.map((e) => e.event), ['Beaconing continues', 'Early event', 'Late event']);
  assert.deepEqual(o.events.map((e) => e.seq), [0, 1, 2]);
});

test('structured fields on a new verdict are used verbatim and not flagged inferred', () => {
  const o = buildOverlay({
    timeline: [{ time: '01:00', event: 'x', src: '172.16.204.161', dst: '172.16.204.10', tactic: 'Impact' }],
  }, DEVICES);
  assert.equal(o.events[0].src, 'oid:1');
  assert.equal(o.events[0].dst, 'oid:2');
  assert.equal(o.events[0].tactic, 'Impact');
  assert.equal(o.events[0].inferred, false);
  assert.equal(o.events[0].tacticInferred, false);
});

test('a verdict with no timeline, or junk input, yields an empty overlay not a crash', () => {
  for (const input of [{}, null, undefined, { timeline: 'nope' }]) {
    const o = buildOverlay(input, DEVICES);
    assert.deepEqual(o.events, []);
    assert.deepEqual(o.entities, []);
    assert.equal(o.bound, 0);
  }
});

test('an empty device list leaves every event unbound rather than throwing', () => {
  const o = buildOverlay(RANSOMWARE, []);
  assert.equal(o.events.length, 5, 'events still stage for the kill-chain strip');
  assert.equal(o.unbound, 5);
  assert.equal(o.bound, 0);
});

test('externalActor mints a key for an IP but not for arbitrary prose', () => {
  assert.deepEqual(externalActor('198.51.100.7'), { key: 'ext:198.51.100.7', name: '198.51.100.7', ip: '198.51.100.7' });
  assert.equal(externalActor('999.1.1.1'), null, 'not a valid IP');
  assert.equal(externalActor('acmelegal.lab'), null, 'a bare hostname is too noisy to mint a node');
  assert.equal(externalActor(''), null);
});

test('an incident reaching an external IP draws it as an external actor node', () => {
  const o = buildOverlay({
    disposition: 'malicious',
    timeline: [
      { time: '2026-07-29T02:00:00Z', event: 'C2 beacon', detail: 'jjkoupro12.acmelegal.lab beacons to 198.51.100.7', tactic: 'Command and Control' },
      { time: '2026-07-29T03:00:00Z', event: 'Exfil', detail: 'data staged to 203.0.113.42', tactic: 'Exfiltration' },
    ],
  }, DEVICES, { sessionId: 's1', title: 'external test' });
  const extKeys = o.externals.map((e) => e.key).sort();
  assert.deepEqual(extKeys, ['ext:198.51.100.7', 'ext:203.0.113.42'], 'both external endpoints are minted');
  assert.ok(o.entities.includes('ext:198.51.100.7'), 'external actor is part of the incident entity set');
  // The internal device is still bound normally.
  assert.ok(o.entities.includes('oid:1'), 'the internal beacon source still binds to its device');
});

test('externals only include endpoints that actually made it into the entity set', () => {
  // An external IP mentioned but never bound (no known internal peer in the event) still
  // becomes an entity via its own event, so this guards the filter, not a fluke.
  const o = buildOverlay({ timeline: [{ event: 'noise', detail: 'nothing here' }] }, DEVICES);
  assert.deepEqual(o.externals, [], 'no spurious external nodes when none were named');
});

test('TACTICS is the full ATT&CK enterprise sequence in kill-chain order', () => {
  assert.equal(TACTICS[0], 'Reconnaissance');
  assert.equal(TACTICS[TACTICS.length - 1], 'Impact');
  assert.ok(TACTICS.indexOf('Lateral Movement') > TACTICS.indexOf('Initial Access'));
  assert.ok(TACTICS.indexOf('Exfiltration') > TACTICS.indexOf('Collection'));
});
