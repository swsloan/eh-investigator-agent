import assert from 'node:assert/strict';
import { test } from 'node:test';
import { captureSessionScope, isCurrentSessionScope, state } from './state.js';

function reset(sessionId = 's1', generation = 0) {
  state.session = sessionId ? { id: sessionId } : null;
  state.sessionGeneration = generation;
}

test('captureSessionScope returns null when no session is open', () => {
  reset(null);
  assert.equal(captureSessionScope(), null);
  // A null scope is never "current", so callers bail rather than applying results.
  assert.equal(isCurrentSessionScope(null), false);
});

test('a scope stays current while the same session is shown', () => {
  reset('s1', 3);
  const scope = captureSessionScope();
  assert.deepEqual(scope, { sessionId: 's1', sessionGeneration: 3 });
  assert.equal(isCurrentSessionScope(scope), true);
});

test('switching to a different session invalidates an in-flight scope', () => {
  reset('s1', 0);
  const scope = captureSessionScope();
  // switchSession() sets the new session and bumps the counter.
  state.session = { id: 's2' };
  state.sessionGeneration += 1;
  assert.equal(isCurrentSessionScope(scope), false);
});

test('leaving and returning to the same session still invalidates the old scope', () => {
  reset('s1', 0);
  const scope = captureSessionScope();
  state.session = { id: 's2' };
  state.sessionGeneration += 1;
  state.session = { id: 's1' }; // back to the original session id
  state.sessionGeneration += 1;
  // The id matches again, so the generation counter is what catches this.
  assert.equal(isCurrentSessionScope(scope), false);
});

test('closing the session invalidates any outstanding scope', () => {
  reset('s1', 1);
  const scope = captureSessionScope();
  state.session = null;
  assert.equal(isCurrentSessionScope(scope), false);
});
