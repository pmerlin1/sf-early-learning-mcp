import test from 'node:test';
import assert from 'node:assert/strict';
import { createAsyncTtlCache } from '../src/async-cache.js';

test('bounded async TTL cache shares loads, expires values, and skips failures', async (t) => {
  await t.test('reuses a cached result until its TTL expires', async () => {
    let now = 10;
    let loads = 0;
    const cache = createAsyncTtlCache({ ttlMs: 100, maxEntries: 3, now: () => now });
    const load = async () => ++loads;
    assert.equal(await cache.getOrLoad('provider', load), 1);
    assert.equal(await cache.getOrLoad('provider', load), 1);
    assert.equal(loads, 1);
    now = 111;
    assert.equal(await cache.getOrLoad('provider', load), 2);
    assert.equal(loads, 2);
  });

  await t.test('deduplicates simultaneous loads for the same key', async () => {
    const cache = createAsyncTtlCache({ ttlMs: 1000 });
    let loads = 0;
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const load = async () => {
      loads += 1;
      await gate;
      return { value: 'shared' };
    };
    const first = cache.getOrLoad('license', load);
    const second = cache.getOrLoad('license', load);
    await Promise.resolve();
    assert.equal(loads, 1);
    release();
    assert.deepEqual(await Promise.all([first, second]), [{ value: 'shared' }, { value: 'shared' }]);
  });

  await t.test('does not cache rejected loads or values rejected by shouldCache', async () => {
    const cache = createAsyncTtlCache({ ttlMs: 1000, shouldCache: (value) => value.ok });
    let loads = 0;
    await assert.rejects(cache.getOrLoad('failed', async () => {
      loads += 1;
      throw new Error('temporary');
    }), /temporary/);
    assert.deepEqual(await cache.getOrLoad('failed', async () => {
      loads += 1;
      return { ok: false };
    }), { ok: false });
    assert.deepEqual(await cache.getOrLoad('failed', async () => {
      loads += 1;
      return { ok: true };
    }), { ok: true });
    assert.deepEqual(await cache.getOrLoad('failed', async () => {
      loads += 1;
      return { ok: false };
    }), { ok: true });
    assert.equal(loads, 3);
  });

  await t.test('can bypass the cache for debugging', async () => {
    const cache = createAsyncTtlCache({ ttlMs: 1000 });
    let loads = 0;
    const load = async () => ++loads;
    assert.equal(await cache.getOrLoad('provider', load), 1);
    assert.equal(await cache.getOrLoad('provider', load, false), 2);
    assert.equal(await cache.getOrLoad('provider', load), 1);
    assert.equal(loads, 2);
  });
});
