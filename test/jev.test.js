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
  diaperingFitStatus: 'confirmed',
  diaperingEvidenceScore: 100,
  diaperingEvidenceSource: 'CareWait: diapersProvided',
  pottyTrainingStatus: 'unknown',
  pottyTrainingEvidenceScore: 25,
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
  let observedState;
  try {
    const results = await evaluateCandidatesWithJev(
      [candidate],
      { targetBudgetMonthly: 500, preferredLanguage: 'Spanish' },
      {
        clientFactory: (apiKey) => {
          assert.equal(apiKey, 'fixture-key');
          return {
            systemOne: async ({ state, questions }) => {
              calls += 1;
              observedState = state;
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
    assert.equal(observedState.familyProfile.pottyTrained, null);
    assert.equal(observedState.familyProfile.preferredProgramType, 'licensedCenter');
    assert.equal(observedState.familyProfile.wantsLicensedCenter, undefined);
    assert.equal(observedState.candidate.diaperingEvidenceScore, 100);
    assert.equal(observedState.candidate.pottyTrainingEvidenceScore, 25);
    assert.equal(observedState.candidate.ageFitStatus, 'unknown');
    assert.equal(results[0].source, 'jev_live_api');
    assert.equal(results[0].model, 'fixture-jev-model');
    assert.equal(results[0].confidence, 0.72);
    assert.equal(results[0].scoreDistributions.safety.probabilities[3], 0.75);
    assert.equal(results[0].recommendationChoice, 'top_tier');
    assert.equal(results[0].compositeCoverage, 1);
    assert.deepEqual(results[0].missingScoreCriteria, []);
  } finally {
    if (original === undefined) delete process.env.TYPESAFE_API_KEY;
    else process.env.TYPESAFE_API_KEY = original;
  }
});

test('Jev does not turn missing scores into zero-valued composite penalties', async () => {
  const original = process.env.TYPESAFE_API_KEY;
  process.env.TYPESAFE_API_KEY = 'fixture-key';
  try {
    const results = await evaluateCandidatesWithJev(
      [candidate],
      { childAgeYears: 2.1 },
      {
        clientFactory: () => ({
          systemOne: async () => ({
            model: 'fixture-jev-model',
            answers: {
              safetyScore: scoreAnswer(3),
              budgetFit: scoreAnswer(3),
              recommendation: {
                type: 'choice',
                choice: 'strong_alternative',
                confidence: 0.7,
                probabilities: { strong_alternative: 0.7 }
              }
            }
          })
        })
      }
    );

    assert.equal(results[0].compositeScore, 1);
    assert.equal(results[0].compositeCoverage, 0.75);
    assert.deepEqual(results[0].missingScoreCriteria, ['immersion']);
  } finally {
    if (original === undefined) delete process.env.TYPESAFE_API_KEY;
    else process.env.TYPESAFE_API_KEY = original;
  }
});

test('Jev skips the diapering question when the family says it is not needed', async () => {
  const original = process.env.TYPESAFE_API_KEY;
  process.env.TYPESAFE_API_KEY = 'fixture-key';
  try {
    const results = await evaluateCandidatesWithJev(
      [{ ...candidate, diaperingFitStatus: 'not_required' }],
      { childAgeYears: 2.1, childIsPottyTrained: true, programType: 'licensedFamilyChildCare' },
      {
        clientFactory: () => ({
          systemOne: async ({ state, questions }) => {
            assert.equal(state.familyProfile.pottyTrained, true);
            assert.equal(state.familyProfile.preferredProgramType, 'licensedFamilyChildCare');
            assert.equal(questions.toddlerDiaperingFit, undefined);
            return {
              model: 'fixture-jev-model',
              answers: {
                safetyScore: scoreAnswer(3),
                budgetFit: scoreAnswer(3),
                immersionFit: scoreAnswer(3),
                recommendation: {
                  type: 'choice',
                  choice: 'top_tier',
                  confidence: 0.8,
                  probabilities: { top_tier: 0.8 }
                }
              }
            };
          }
        })
      }
    );

    assert.equal(results[0].compositeScore, 1);
    assert.equal(results[0].compositeCoverage, 1);
    assert.deepEqual(results[0].missingScoreCriteria, []);
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
