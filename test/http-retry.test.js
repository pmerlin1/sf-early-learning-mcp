import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchWithRetry } from '../src/http-retry.js';

const response = (status, headers) => new Response('', { status, headers });

test('fetchWithRetry honors Retry-After and retries transient HTTP failures', async (t) => {
  await t.test('retries a 429 and honors a numeric Retry-After header', async () => {
    let calls = 0;
    const delays = [];
    const result = await fetchWithRetry('https://example.test/programs', {}, {
      fetchImpl: async () => (++calls === 1 ? response(429, { 'retry-after': '2' }) : response(200)),
      sleep: async (ms) => delays.push(ms),
      now: () => 0,
      random: () => 1
    });
    assert.equal(result.status, 200);
    assert.equal(calls, 2);
    assert.deepEqual(delays, [2000]);
  });

  await t.test('caps an HTTP-date Retry-After at 30 seconds', async () => {
    const delays = [];
    let calls = 0;
    await fetchWithRetry('https://example.test/programs', {}, {
      fetchImpl: async () => (++calls === 1
        ? response(503, { 'retry-after': 'Thu, 01 Jan 1970 00:01:00 GMT' })
        : response(200)),
      sleep: async (ms) => delays.push(ms),
      now: () => 0
    });
    assert.deepEqual(delays, [30_000]);
  });

  await t.test('uses full-jitter exponential delays with an 8-second ceiling', async () => {
    let calls = 0;
    const delays = [];
    await fetchWithRetry('https://example.test/programs', {}, {
      fetchImpl: async () => (++calls <= 8 ? response(503) : response(200)),
      sleep: async (ms) => delays.push(ms),
      random: () => 1,
      maxAttempts: 9
    });
    assert.deepEqual(delays, [250, 500, 1000, 2000, 4000, 8000, 8000, 8000]);
  });

  await t.test('does not retry a permanent 404 and includes URL and status', async () => {
    let calls = 0;
    await assert.rejects(
      fetchWithRetry('https://example.test/missing', {}, {
        fetchImpl: async () => { calls += 1; return response(404); },
        sleep: async () => assert.fail('a 404 must not sleep or retry')
      }),
      (error) => error.name === 'HttpRequestError' &&
        error.url === 'https://example.test/missing' && error.status === 404 &&
        /after 1 attempt/.test(error.message)
    );
    assert.equal(calls, 1);
  });

  await t.test('retries network failures and reports the last attempt', async () => {
    let calls = 0;
    await assert.rejects(
      fetchWithRetry('https://example.test/offline', {}, {
        fetchImpl: async () => { calls += 1; throw new Error('socket reset'); },
        sleep: async () => {},
        random: () => 0
      }),
      (error) => error.url === 'https://example.test/offline' &&
        error.status === null && error.attempts === 5 && /after 5 attempts/.test(error.message)
    );
    assert.equal(calls, 5);
  });

  await t.test('retries a request after the per-attempt abort timeout', async () => {
    let calls = 0;
    await assert.rejects(
      fetchWithRetry('https://example.test/slow', {}, {
        fetchImpl: async (_url, options) => {
          calls += 1;
          return new Promise((_resolve, reject) => {
            options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
          });
        },
        sleep: async () => {},
        timeoutMs: 2,
        maxAttempts: 2,
        random: () => 0
      }),
      /after 2 attempts/
    );
    assert.equal(calls, 2);
  });
});
