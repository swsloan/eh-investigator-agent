// Read-back verification for governed writes (#23). Run: node --test lib/action-verify.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  unwrapRecord, tagNames, matchesValue,
  isVerifiable, verifierFor, desiredStateFor, preconditionOk,
  classifyVerification, verifyWrite, readbackState, summarizeMismatches,
} from './action-verify.js';

test('unwrapRecord tolerates wrappers, bare objects, and single-element arrays', () => {
  assert.deepEqual(unwrapRecord({ detection: { id: 1 } }), { id: 1 });
  assert.deepEqual(unwrapRecord({ data: { id: 2 } }), { id: 2 });
  assert.deepEqual(unwrapRecord({ id: 3 }), { id: 3 });
  assert.deepEqual(unwrapRecord([{ id: 4 }]), { id: 4 });
  assert.equal(unwrapRecord(null), null);
  assert.equal(unwrapRecord([]), null);
});

test('tagNames extracts names from object / string / wrapped shapes', () => {
  assert.deepEqual(tagNames([{ name: 'crown' }, { tag: 'dmz' }]), ['crown', 'dmz']);
  assert.deepEqual(tagNames(['a', 'b']), ['a', 'b']);
  assert.deepEqual(tagNames({ tags: [{ name: 'x' }] }), ['x']);
  assert.deepEqual(tagNames(null), []);
});

test('matchesValue: string/number agree, empties unify, real diffs fail', () => {
  assert.equal(matchesValue(123, '123'), true);
  assert.equal(matchesValue('open', 'open'), true);
  assert.equal(matchesValue(null, ''), true, 'null and empty are both "unset"');
  assert.equal(matchesValue(undefined, null), true);
  assert.equal(matchesValue('INC-1', null), false, 'wanted a value, got none');
  assert.equal(matchesValue('a', 'b'), false);
});

test('update_detection verifies only the fields the write set', () => {
  const params = { id: 5, status: 'closed', resolution: 'true_positive' };
  assert.deepEqual(desiredStateFor('update_detection', params), { status: 'closed', resolution: 'true_positive' });

  const ok = classifyVerification('update_detection', params, { detection: { id: 5, status: 'closed', resolution: 'true_positive', assignee: 'someone' } });
  assert.equal(ok.status, 'verified', 'unrelated fields (assignee) are ignored');

  const bad = classifyVerification('update_detection', params, { detection: { id: 5, status: 'closed', resolution: null } });
  assert.equal(bad.status, 'verification_failed');
  assert.equal(bad.mismatches.length, 1);
  assert.equal(bad.mismatches[0].field, 'resolution');
});

test('update_detection: accepted-but-not-persisted ticket_id is caught', () => {
  const v = classifyVerification('update_detection', { id: 1, ticket_id: 'INC-42' }, { detection: { id: 1, ticket_id: null } });
  assert.equal(v.status, 'verification_failed');
  assert.match(v.detail, /ticket_id/);
});

test('update_detection: a target that reads back missing fails verification', () => {
  const v = classifyVerification('update_detection', { id: 9, status: 'open' }, { detection: null });
  assert.equal(v.status, 'verification_failed');
});

test('assign_devicetag verifies the tag is present on every device', () => {
  const params = { tag: 'crown-jewel', device_ids: [10, 11] };
  const probes = verifierFor('assign_devicetag_to_devices').probes(params);
  assert.deepEqual(probes.map((p) => p.subject), ['device:10', 'device:11']);

  const ok = classifyVerification('assign_devicetag_to_devices', params, {
    'device:10': [{ name: 'crown-jewel' }],
    'device:11': [{ name: 'crown-jewel' }, { name: 'other' }],
  });
  assert.equal(ok.status, 'verified');

  const bad = classifyVerification('assign_devicetag_to_devices', params, {
    'device:10': [{ name: 'crown-jewel' }],
    'device:11': [{ name: 'other' }], // tag missing here
  });
  assert.equal(bad.status, 'verification_failed');
  assert.equal(bad.mismatches[0].subject, 'device:11');
});

test('unassign_devicetag verifies the tag is absent', () => {
  const params = { tag: 'gone', device_ids: [7] };
  assert.equal(classifyVerification('unassign_devicetag_from_devices', params, { 'device:7': [{ name: 'kept' }] }).status, 'verified');
  assert.equal(classifyVerification('unassign_devicetag_from_devices', params, { 'device:7': [{ name: 'gone' }] }).status, 'verification_failed');
});

test('an unknown/read-only capability is unsupported (stays executed)', () => {
  assert.equal(isVerifiable('get_detection'), false);
  assert.equal(desiredStateFor('get_detection', {}), null);
  assert.equal(classifyVerification('get_detection', {}, {}).status, 'unsupported');
});

test('preconditionOk fails when a before-probe target is unreadable', () => {
  assert.equal(preconditionOk('update_detection', { detection: { id: 1 } }).ok, true);
  assert.equal(preconditionOk('update_detection', { detection: null }).ok, false);
  assert.equal(preconditionOk('get_detection', null).ok, true, 'unsupported caps have no precondition');
});

test('readbackState maps probe results to raw records, null on failed read', async () => {
  const observe = async (probes) => {
    const out = {};
    for (const p of probes) out[p.subject] = p.subject === 'detection'
      ? { ok: true, record: { id: 1, status: 'open' } }
      : { ok: false, record: null };
    return out;
  };
  assert.deepEqual(await readbackState('update_detection', { id: 1 }, observe), { detection: { id: 1, status: 'open' } });
});

test('verifyWrite resolves verified / verification_failed and never throws', async () => {
  const good = await verifyWrite('update_detection', { id: 1, status: 'open' }, async () => ({ detection: { ok: true, record: { id: 1, status: 'open' } } }));
  assert.equal(good.actionStatus, 'verified');
  assert.equal(good.verification.status, 'verified');

  // A read-back that throws must degrade to verification_failed, not verified.
  const thrown = await verifyWrite('update_detection', { id: 1, status: 'open' }, async () => { throw new Error('appliance down'); });
  assert.equal(thrown.actionStatus, 'verification_failed');
  assert.match(thrown.verification.detail, /read-back could not run/);
});

test('summarizeMismatches renders a readable one-liner', () => {
  assert.match(
    summarizeMismatches([{ subject: 'detection', field: 'ticket_id', desired: 'INC-1', observed: null }]),
    /ticket_id: wanted INC-1, observed none/,
  );
});
