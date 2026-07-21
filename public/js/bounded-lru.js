export function estimateValueBytes(value, { maxNodes = 10_000 } = {}) {
  let bytes = 0;
  let nodes = 0;
  const stack = [value];
  const seen = new Set();
  while (stack.length && nodes < maxNodes) {
    const current = stack.pop();
    nodes += 1;
    if (typeof current === 'string') {
      bytes += current.length * 2;
    } else if (typeof current === 'number' || typeof current === 'boolean') {
      bytes += 8;
    } else if (current && typeof current === 'object' && !seen.has(current)) {
      seen.add(current);
      if (Array.isArray(current)) {
        for (const item of current) stack.push(item);
      } else {
        for (const [key, item] of Object.entries(current)) {
          bytes += key.length * 2;
          stack.push(item);
        }
      }
    }
  }
  return bytes + nodes * 8;
}

export class BoundedLruCache {
  constructor({ maxEntries = 24, maxBytes = 4 * 1024 * 1024, sizeOf = estimateValueBytes } = {}) {
    this.maxEntries = Math.max(1, Math.floor(maxEntries));
    this.maxBytes = Math.max(1, Math.floor(maxBytes));
    this.sizeOf = sizeOf;
    this.map = new Map();
    this.totalBytes = 0;
  }

  get size() {
    return this.map.size;
  }

  has(key) {
    return this.map.has(key);
  }

  get(key) {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key, value) {
    this.delete(key);
    const bytes = Math.max(0, Number(this.sizeOf(value, key)) || 0);
    if (bytes > this.maxBytes) return false;
    this.map.set(key, { value, bytes });
    this.totalBytes += bytes;
    this.evict();
    return this.map.has(key);
  }

  delete(key) {
    const entry = this.map.get(key);
    if (!entry) return false;
    this.totalBytes = Math.max(0, this.totalBytes - entry.bytes);
    return this.map.delete(key);
  }

  deleteWhere(predicate) {
    let deleted = 0;
    for (const [key, entry] of this.map) {
      if (!predicate(entry.value, key)) continue;
      this.delete(key);
      deleted += 1;
    }
    return deleted;
  }

  clear() {
    this.map.clear();
    this.totalBytes = 0;
  }

  keys() {
    return this.map.keys();
  }

  evict() {
    while (this.map.size > this.maxEntries || this.totalBytes > this.maxBytes) {
      const oldestKey = this.map.keys().next().value;
      if (oldestKey === undefined) break;
      this.delete(oldestKey);
    }
  }
}
