const RETRYABLE_STATUSES = new Set([408, 425, 429]);

function responseHeader(response, name) {
  try {
    return response.headers?.get?.(name) ?? null;
  } catch {
    return null;
  }
}

function retryAfterMs(response, now) {
  const raw = responseHeader(response, 'retry-after');
  if (raw == null) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(raw);
  return Number.isNaN(date) ? null : Math.max(0, date - now);
}

function retryableStatus(status) {
  return RETRYABLE_STATUSES.has(status) || status >= 500;
}

function exponentialDelay(attempt, random, baseDelayMs, maxDelayMs) {
  const ceiling = Math.min(baseDelayMs * (2 ** (attempt - 1)), maxDelayMs);
  return Math.floor(Math.max(0, Math.min(1, random())) * ceiling);
}

function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason || new Error('Request aborted.'));
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason || new Error('Request aborted.'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function responseMessage(response) {
  try {
    const text = await response.text();
    return text ? `: ${text.slice(0, 300)}` : '';
  } catch {
    return '';
  }
}

function requestError(url, attempts, status, cause, message) {
  const lastStatus = status == null ? 'network error' : `HTTP ${status}`;
  const error = new Error(
    `Request failed after ${attempts} attempt${attempts === 1 ? '' : 's'} for ${url} (${lastStatus})${message || ''}`,
    cause ? { cause } : undefined
  );
  error.name = 'HttpRequestError';
  error.url = url;
  error.attempts = attempts;
  error.status = status ?? null;
  return error;
}

/**
 * Fetch with bounded retries for transient network errors and retryable HTTP statuses.
 * The injected fetch, sleep, random source, and clock make retry behavior deterministic in tests.
 */
export async function fetchWithRetry(url, options = {}, {
  fetchImpl = (...args) => globalThis.fetch(...args),
  sleep = wait,
  random = Math.random,
  now = Date.now,
  timeoutMs = 15_000,
  maxAttempts = 5,
  baseDelayMs = 250,
  maxDelayMs = 8_000,
  maxRetryAfterMs = 30_000
} = {}) {
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new TypeError('maxAttempts must be a positive integer.');
  }

  let lastError = null;
  let lastStatus = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (options.signal?.aborted) {
      throw options.signal.reason || new Error('Request aborted.');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort(new Error(`Request timed out after ${timeoutMs}ms.`));
    }, timeoutMs);
    const abortFromCaller = () => controller.abort(options.signal.reason);
    options.signal?.addEventListener('abort', abortFromCaller, { once: true });
    const signal = controller.signal;

    let response;
    try {
      response = await fetchImpl(url, { ...options, signal });
    } catch (error) {
      if (options.signal?.aborted) throw options.signal.reason || error;
      lastError = error;
      lastStatus = null;
      if (attempt >= maxAttempts) {
        throw requestError(url, attempt, null, error, `: ${String(error?.message || error).slice(0, 300)}`);
      }
      await sleep(exponentialDelay(attempt, random, baseDelayMs, maxDelayMs), options.signal);
      continue;
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', abortFromCaller);
    }

    if (response.ok) return response;

    lastStatus = response.status;
    lastError = null;
    if (!retryableStatus(response.status) || attempt >= maxAttempts) {
      const message = await responseMessage(response);
      throw requestError(url, attempt, response.status, null, message);
    }

    try {
      await response.body?.cancel();
    } catch {
      // A failed body cancellation does not change the retry decision.
    }

    const serverDelay = retryAfterMs(response, now());
    const delay = serverDelay == null
      ? exponentialDelay(attempt, random, baseDelayMs, maxDelayMs)
      : Math.min(serverDelay, maxRetryAfterMs);
    await sleep(delay, options.signal);
  }

  throw requestError(url, maxAttempts, lastStatus, lastError);
}
