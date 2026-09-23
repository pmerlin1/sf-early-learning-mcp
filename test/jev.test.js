import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCandidatesWithJev } from '../src/jev-eval.js';

const clearInspection = {
  verificationStatus: 'verified',
  inspectionDataStatus: 'complete',
  status: 'Licensed',
  totalTypeA: 0,
  totalTypeB: 0,
  complaintVisits: 0,
  substantiatedAllegations: 0,
  safetySummary: 'Complete CCLD fixture with no findings.'
};

const candidate = {
  entityId: 'fixture-1',
  name: 'Sample Center',
  languages: ['Spanish'],
  grossMonthlyTuition: 1500,
  monthlySubsidyCredit: 1153,
  estimatedNetOutOfPocketMonthly: 347,
  programType: 'licensedCenter',
  schedule: ['fullTime'],
  description: 'Spanish bilingual preschool.',
  licenseNumber: 'fixture-license',
  ccldInspection: clearInspection,
  diaperingStatus: 'confirmed',
  proximityLevel: 2,
  distanceMiles: 1.5,
  proximityRating: 'Nearby',
  isImmediateNeighborhood: false
};

const scoreAnswer = (score) => ({
  type: 'score',
  score,
  confidence: 0.72,
  probabilities: { 0: 0.01, 1: 0.04, 2: 0.2, 3: 0.75 }
});

test('Jev evaluation requires a configured TypeSafe API key', async () => {
  const original = process.env.TYPESAFE_API_KEY;
  delete process.env.TYPESAFE_API_KEY;
  try {
    await assert.rejects(
      evaluateCandidatesWithJev([], {}),
      /TYPESAFE_API_KEY is required/
    );
  } finally {
    if (original === undefined) delete process.env.TYPESAFE_API_KEY;
    else process.env.TYPESAFE_API_KEY = original;
  }
});

test('Jev evaluator uses live typed answers and preserves their probabilities', async () => {
  const original = process.env.TYPESAFE_API_KEY;
  process.env.TYPESAFE_API_KEY = 'fixture-key';
  let calls = 0;
  try {
    const results = await evaluateCandidatesWithJev(
      [candidate],
      { targetBudgetMonthly: 500, preferredLanguage: 'Spanish' },
      {
        clientFactory: (apiKey) => {
          assert.equal(apiKey, 'fixture-key');
          return {
            systemOne: async ({ questions }) => {
              calls += 1;
              assert.equal(questions.safetyScore.type, 'score');
              assert.equal(questions.recommendation.type, 'choice');
              return {
                model: 'fixture-jev-model',
                usage: { input_tokens: 10, output_tokens: 5 },
                answers: {
                  locationConvenience: scoreAnswer(2),
                  safetyScore: scoreAnswer(3),
                  budgetFit: scoreAnswer(2),
                  immersionFit: scoreAnswer(3),
                  toddlerDiaperingFit: scoreAnswer(2),
                  recommendation: {
                    type: 'choice',
                    choice: 'top_tier',
                    confidence: 0.72,
                    probabilities: {
                      top_tier: 0.72,
                      strong_alternative: 0.18,
                      caution_flagged: 0.06,
                      unsuitable: 0.02,
                      needs_verification: 0.02
                    }
                  }
                }
              };
            }
          };
        }
      }
    );

    assert.equal(calls, 1);
    assert.equal(results[0].source, 'jev_live_api');
    assert.equal(results[0].model, 'fixture-jev-model');
    assert.equal(results[0].confidence, 0.72);
    assert.equal(results[0].scoreDistributions.safety.probabilities[3], 0.75);
    assert.equal(results[0].recommendationChoice, 'top_tier');
  } finally {
    if (original === undefined) delete process.env.TYPESAFE_API_KEY;
    else process.env.TYPESAFE_API_KEY = original;
  }
});

test('Jev will not score an unverified CCLD record as pristine', async () => {
  const original = process.env.TYPESAFE_API_KEY;
  process.env.TYPESAFE_API_KEY = 'fixture-key';
  let calls = 0;
  try {
    const results = await evaluateCandidatesWithJev(
      [{ ...candidate, ccldInspection: null }],
      {},
      {
        clientFactory: () => ({
          systemOne: async () => {
            calls += 1;
            throw new Error('Must not call Jev for this candidate');
          }
        })
      }
    );
    assert.equal(calls, 0);
    assert.equal(results[0].source, 'not_evaluated_safety_unverified');
    assert.equal(results[0].recommendationChoice, 'needs_verification');
    assert.equal(results[0].confidence, null);
    assert.equal(results[0].probabilities, null);
  } finally {
    if (original === undefined) delete process.env.TYPESAFE_API_KEY;
    else process.env.TYPESAFE_API_KEY = original;
  }
});
