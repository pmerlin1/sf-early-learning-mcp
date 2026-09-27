/** Small bounded TTL cache that coalesces concurrent loads and never caches failures. */
export function createAsyncTtlCache({
  ttlMs,
  maxEntries = 1000,
  now = Date.now,
  shouldCache = () => true
}) {
  const values = new Map();
  const inFlight = new Map();

  function pruneExpired(currentTime) {
    for (const [key, entry] of values) {
      if (entry.expiresAt <= currentTime) values.delete(key);
    }
  }

  function remember(key, value, currentTime) {
    values.delete(key);
    values.set(key, { value, expiresAt: currentTime + ttlMs });
    while (values.size > maxEntries) values.delete(values.keys().next().value);
  }

  return {
    async getOrLoad(key, loader, enabled = true) {
      if (!enabled) return loader();

      const currentTime = now();
      pruneExpired(currentTime);
      const cached = values.get(key);
      if (cached) {
        values.delete(key);
        values.set(key, cached);
        return cached.value;
      }
      if (inFlight.has(key)) return inFlight.get(key);

      const promise = Promise.resolve()
        .then(loader)
        .then((value) => {
          if (shouldCache(value)) remember(key, value, now());
          return value;
        })
        .finally(() => inFlight.delete(key));
      inFlight.set(key, promise);
      return promise;
    },
    clear() {
      values.clear();
      inFlight.clear();
    },
    get size() {
      pruneExpired(now());
      return values.size;
    }
  };
}

export function isCacheEnabled() {
  return String(process.env.SFEL_CACHE || '').toLowerCase() !== 'off';
}
