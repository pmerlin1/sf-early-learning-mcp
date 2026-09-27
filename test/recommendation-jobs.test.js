import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecommendationJobManager } from '../src/recommendation-jobs.js';

const resultWithCount = (count) => ({
  recommendations: Array.from({ length: count }, (_, index) => ({
    entityId: 'job-' + index,
    name: 'Job program ' + index
  })),
  stretchOptions: [],
  unverifiedSafetyCandidates: [],
  unverifiedRateCandidates: [],
  unverifiedAgeCandidates: [],
  listTotals: { recommendations: count },
  coverage: { careWaitMatches: count, programsChecked: count, complete: true }
});

test('recommendation jobs continue in the background and share cached results across pages', async (t) => {
  await t.test('returns progress, joins identical searches, then serves another page without rebuilding', async () => {
    let builds = 0;
    const manager = createRecommendationJobManager({
      waitMs: 0,
      build: async (params, { onProgress }) => {
        builds += 1;
        assert.equal(params.page, undefined);
        onProgress({ stage: 'checking_providers', programsFound: 45, programsChecked: 7 });
        await new Promise((resolve) => setTimeout(resolve, 20));
        return resultWithCount(45);
      }
    });

    const first = await manager.getPage({ childAgeYears: 2.1, page: 1 });
    const joined = await manager.getPage({ childAgeYears: 2.1, page: 2 });
    assert.equal(first.status, 'in_progress');
    assert.equal(first.progress.programsChecked, 7);
    assert.match(first.message, /same search parameters/);
    assert.equal(joined.status, 'in_progress');
    assert.equal(builds, 1);

    await new Promise((resolve) => setTimeout(resolve, 30));
    const secondPage = await manager.getPage({ childAgeYears: 2.1, page: 2 });
    assert.equal(secondPage.status, undefined);
    assert.equal(secondPage.page, 2);
    assert.equal(secondPage.recommendations.length, 10);
    assert.equal(secondPage.recommendations[0].entityId, 'job-10');
    assert.equal(builds, 1);
  });

  await t.test('expires completed results and caps the number of cached searches', async () => {
    let now = 1_000;
    let builds = 0;
    const manager = createRecommendationJobManager({
      waitMs: 100,
      ttlMs: 10,
      maxEntries: 2,
      now: () => now,
      build: async () => {
        builds += 1;
        return resultWithCount(1);
      }
    });

    await manager.getPage({ childAgeYears: 2.1 });
    await manager.getPage({ childAgeYears: 2.1 });
    assert.equal(builds, 1);
    now += 11;
    await manager.getPage({ childAgeYears: 2.1 });
    assert.equal(builds, 2);
    await manager.getPage({ childAgeYears: 3.1 });
    await manager.getPage({ childAgeYears: 4.1 });
    assert.equal(manager.size, 2);
  });

  await t.test('excludes page and legacy maxResults from the job key', async () => {
    let builds = 0;
    const manager = createRecommendationJobManager({
      waitMs: 100,
      build: async () => {
        builds += 1;
        return resultWithCount(21);
      }
    });
    const first = await manager.getPage({ childAgeYears: 2.1, page: 1, maxResults: 10 });
    const second = await manager.getPage({ childAgeYears: 2.1, page: 2, maxResults: 5 });
    assert.equal(first.totalPages, 3);
    assert.equal(second.page, 2);
    assert.equal(builds, 1);
  });
});
