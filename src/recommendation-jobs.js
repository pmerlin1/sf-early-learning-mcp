import { createHash } from 'node:crypto';
import { buildAllRecommendations, paginateRecommendations } from './recommendations.js';

const DEFAULT_WAIT_MS = 40_000;
const RESULT_TTL_MS = 30 * 60 * 1000;
const MAX_CACHED_SEARCHES = 10;
const IN_PROGRESS_MESSAGE =
  'The exhaustive search is still running. Call this tool again with the same search parameters to check progress or retrieve results.';

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function searchParameters(params = {}) {
  const { page: _page, maxResults: _legacyMaxResults, ...searchParams } = params;
  return searchParams;
}

async function waitForJob(promise, ms) {
  if (ms <= 0) return { completed: false };
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ completed: false }), ms);
  });
  const completion = promise.then(
    (value) => ({ completed: true, value }),
    (error) => ({ completed: true, error })
  );
  try {
    return await Promise.race([completion, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Keep long recommendation searches alive across MCP tool calls. Each normalized search has
 * one background build and a bounded in-memory result cache; the page number is not part of
 * the key, so requesting another page never repeats CareWait, CCLD, or Jev work.
 */
export function createRecommendationJobManager({
  build = buildAllRecommendations,
  paginate = paginateRecommendations,
  waitMs = Number(process.env.SFEL_SEARCH_WAIT_MS) || DEFAULT_WAIT_MS,
  ttlMs = RESULT_TTL_MS,
  maxEntries = MAX_CACHED_SEARCHES,
  now = Date.now
} = {}) {
  const jobs = new Map();

  function prune() {
    const currentTime = now();
    for (const [key, job] of jobs) {
      if (job.state !== 'running' && currentTime - job.finishedAt >= ttlMs) jobs.delete(key);
    }
  }

  function makeRoom() {
    prune();
    while (jobs.size >= maxEntries) {
      const oldestFinished = [...jobs.entries()].find(([, job]) => job.state !== 'running');
      if (!oldestFinished) throw new Error('All recommendation search slots are busy; retry shortly.');
      jobs.delete(oldestFinished[0]);
    }
  }

  function start(key, params) {
    makeRoom();
    const job = {
      state: 'running',
      progress: {
        stage: 'starting',
        searchPagesFinished: 0,
        programsFound: 0,
        programsChecked: 0,
        programsScored: 0
      },
      result: null,
      error: null,
      finishedAt: null,
      promise: null
    };
    jobs.set(key, job);
    job.promise = Promise.resolve()
      .then(() => build(params, {
        onProgress: (progress) => {
          job.progress = { ...job.progress, ...progress, updatedAt: new Date(now()).toISOString() };
        }
      }))
      .then((result) => {
        job.state = 'complete';
        job.result = result;
        job.finishedAt = now();
        return result;
      }, (error) => {
        job.state = 'failed';
        job.error = error;
        job.finishedAt = now();
        jobs.delete(key);
        throw error;
      });
    // A request may return in_progress before this background promise settles.
    job.promise.catch(() => {});
    return job;
  }

  async function getPage(params = {}) {
    const page = params.page ?? 1;
    if (!Number.isInteger(Number(page)) || Number(page) < 1) {
      throw new Error('page must be a positive integer starting at 1.');
    }
    const searchParams = searchParameters(params);
    const key = createHash('sha256')
      .update(JSON.stringify(canonicalize(searchParams)))
      .digest('hex');
    prune();

    let job = jobs.get(key);
    if (job) {
      jobs.delete(key);
      jobs.set(key, job);
    } else {
      job = start(key, searchParams);
    }

    if (job.state === 'running') {
      const outcome = await waitForJob(job.promise, waitMs);
      if (!outcome.completed) {
        return {
          status: 'in_progress',
          progress: { ...job.progress },
          message: IN_PROGRESS_MESSAGE
        };
      }
      if (outcome.error) throw outcome.error;
    }
    if (job.state === 'failed') throw job.error;
    if (!job.result) throw new Error('Recommendation search completed without a result.');
    return paginate(job.result, page);
  }

  return {
    getPage,
    clear() {
      jobs.clear();
    },
    get size() {
      prune();
      return jobs.size;
    }
  };
}

const recommendationJobManager = createRecommendationJobManager();

export function getRecommendationPage(params = {}) {
  return recommendationJobManager.getPage(params);
}
