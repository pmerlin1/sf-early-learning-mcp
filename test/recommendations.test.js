import test from 'node:test';
import assert from 'node:assert/strict';
import { getRecommendations } from '../src/recommendations.js';

test('getRecommendations - Out-of-pocket calculation & search', async (t) => {
  await t.test('Calculates net cost = Math.max(0, tuition - subsidy)', async () => {
    const res = await getRecommendations({
      childAgeYears: 2.1,
      benefitTier: 'halfCreditELFA',
      targetBudgetMonthly: 1200,
      preferredLanguage: 'Spanish',
      programType: 'licensedCenter',
      maxResults: 3
    });

    assert.ok(res.recommendations.length > 0);
    assert.equal(res.ageCategory, 'toddler');
    assert.equal(res.monthlySubsidyDiscount, 1153);

    for (const rec of res.recommendations) {
      if (rec.grossMonthlyTuition !== null) {
        const expectedNet = Math.max(0, rec.grossMonthlyTuition - 1153);
        assert.equal(rec.estimatedNetOutOfPocketMonthly, expectedNet);
      }
    }
  });

  await t.test('Free tuition tier results in $0 out-of-pocket', async () => {
    const res = await getRecommendations({
      childAgeYears: 2.1,
      benefitTier: 'freeTuitionELFA',
      targetBudgetMonthly: 0,
      preferredLanguage: 'Spanish',
      programType: 'licensedCenter',
      maxResults: 2
    });

    assert.ok(res.recommendations.length > 0);
    for (const rec of res.recommendations) {
      assert.equal(rec.estimatedNetOutOfPocketMonthly, 0);
    }
  });
});
