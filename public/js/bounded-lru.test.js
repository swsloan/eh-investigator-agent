import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BoundedLruCache, estimateValueBytes } from './bounded-lru.js';
import { state } from './state.js';

test('evicts the least-recently-used entry once maxEntries is exceeded', () => {
  const cache = new BoundedLruCache({ maxEntries: 3, maxBytes: Infinity });
  cache.set('a', 1);
  cache.set('b', 2);
  cache.set('c', 3);
  cache.get('a');           // 'a' becomes most-recently-used, so 'b' is now the LRU
  cache.set('d', 4);
  assert.equal(cache.has('b'), false, 'least-recently-used entry was evicted');
  assert.equal(cache.has('a'), true);
  assert.equal(cache.has('c'), true);
  assert.equal(cache.has('d'), true);
});

test('evicts on the byte bound even when the entry count is fine', () => {
  // A 150-char string costs ~308 bytes (2 bytes/char plus node overhead), so a
  // 500-byte budget holds exactly one of them.
  const value = 'x'.repeat(150);
  assert.ok(estimateValueBytes(value) > 250 && estimateValueBytes(value) < 500);
  const cache = new BoundedLruCache({ maxEntries: 100, maxBytes: 500 });
  cache.set('first', value);
  cache.set('second', value);
  assert.equal(cache.has('first'), false, 'byte pressure evicted the older entry');
  assert.equal(cache.has('second'), true);
});

test('refuses a single value larger than the whole budget', () => {
  const cache = new BoundedLruCache({ maxEntries: 100, maxBytes: 200 });
  cache.set('keeper', 'ok');
  // Storing this would require evicting everything and still not fit, so the
  // cache declines it rather than thrashing.
  assert.equal(cache.set('oversized', 'x'.repeat(150)), false);
  assert.equal(cache.has('oversized'), false);
  assert.equal(cache.has('keeper'), true, 'an oversized write does not flush the cache');
});

test('supports the Map surface files.js relies on (get/set/delete/has/clear)', () => {
  const cache = new BoundedLruCache({ maxEntries: 4 });
  cache.set('k', { rows: [1, 2, 3] });
  assert.deepEqual(cache.get('k'), { rows: [1, 2, 3] });
  assert.equal(cache.has('k'), true);
  cache.delete('k');
  assert.equal(cache.has('k'), false);
  assert.equal(cache.get('k'), undefined, 'a miss returns undefined, like Map');
  cache.set('a', 1);
  cache.clear();
  assert.equal(cache.has('a'), false);
});

test('estimateValueBytes returns a positive size for typical summary payloads', () => {
  assert.ok(estimateValueBytes({ rows: [{ a: 1 }] }) > 0);
  assert.ok(estimateValueBytes('hello') > 0);
});

test('state.summaryCache is bounded rather than a plain Map', () => {
  assert.ok(state.summaryCache instanceof BoundedLruCache, 'summaryCache is bounded');
  // Guard the regression this fixes: writing many summaries must not grow forever.
  for (let i = 0; i < 200; i++) state.summaryCache.set(`key-${i}`, { i });
  assert.ok(state.summaryCache.size <= 24, `summaryCache stayed within its entry cap (was ${state.summaryCache.size})`);
  state.summaryCache.clear();
});
