import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCandidatesWithJev } from '../src/jev-eval.js';
import { runABComparison } from '../src/ab-test.js';

test('TypeSafe Jev Integration & A/B Evaluation', async (t) => {
  const sampleCandidates = [
    {
      name: 'Sample Affordable Center',
      languages: ['English', 'Spanish'],
      grossMonthlyTuition: 1250,
      monthlySubsidyCredit: 1153,
      estimatedNetOutOfPocketMonthly: 97,
      programType: 'licensedCenter',
      schedule: ['fullTime'],
      description: 'Authentic Spanish immersion preschool center.'
    },
    {
      name: 'Sample Expensive Center',
      languages: ['English', 'Spanish'],
      grossMonthlyTuition: 3000,
      monthlySubsidyCredit: 1153,
      estimatedNetOutOfPocketMonthly: 1847,
      programType: 'licensedCenter',
      schedule: ['fullTime'],
      description: 'Private Spanish immersion program.'
    }
  ];

  await t.test('Jev evaluates budget and immersion correctly', async () => {
    const results = await evaluateCandidatesWithJev(sampleCandidates, {
      targetBudgetMonthly: 1200,
      preferredLanguage: 'Spanish',
      childAgeYears: 2.1
    });

    assert.equal(results.length, 2);
    // Affordable center should rank higher than expensive center
    assert.equal(results[0].candidateName, 'Sample Affordable Center');
    assert.ok(results[0].recommendationChoice === 'top_tier' || results[0].recommendationChoice === 'strong_alternative');
    assert.equal(results[1].recommendationChoice, 'unsuitable');
  });

  await t.test('runABComparison generates structured evaluation matrix', async () => {
    const ab = await runABComparison({
      childAgeYears: 2.1,
      targetBudgetMonthly: 1200,
      preferredLanguage: 'Spanish',
      candidateCount: 2
    });

    assert.ok(ab.matrix.length > 0);
    assert.ok(ab.evaluationSummary.consensusAgreementRate);
    assert.ok(ab.matrix[0].llmEval);
    assert.ok(ab.matrix[0].geminiEval); // backwards compatibility alias
    assert.ok(ab.matrix[0].jevSystemOneEval);
  });
});
