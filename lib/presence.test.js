// Session presence (#137). Run: node --test lib/presence.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { markUnattended, resolvePresence } from './presence.js';

test('a session with a live viewer is attended', () => {
  const session = { options: {} };
  const p = resolvePresence(session, 1);
  assert.equal(p.attended, true);
  assert.equal(p.mode, 'attended');
});

test('a session nobody is viewing is unattended', () => {
  const session = { options: {} };
  const p = resolvePresence(session, 0);
  assert.equal(p.attended, false);
  assert.equal(p.mode, 'unattended');
  assert.match(p.reason, /no one is viewing/i);
});

test('a statically unattended session stays unattended even with viewers', () => {
  const session = { options: {} };
  markUnattended(session, 'eval run');
  const p = resolvePresence(session, 3);
  assert.equal(p.attended, false);
  assert.equal(p.reason, 'eval run');
});

test('markUnattended defaults its reason and tolerates a bare session', () => {
  const session = { options: {} };
  markUnattended(session);
  assert.equal(session.options.unattended, 'background run');
  assert.doesNotThrow(() => markUnattended(null, 'x'));
  assert.doesNotThrow(() => markUnattended({}, 'x'));
});

test('a malformed session object does not throw; viewers alone decide', () => {
  assert.equal(resolvePresence(null, 0).attended, false);
  assert.equal(resolvePresence(undefined, 5).attended, true, 'viewers still count without options');
});
