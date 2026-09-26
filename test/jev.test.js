import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateCandidatesWithJev,
  jevCompositeWeights,
  summarizeJevScoring
} from '../src/jev-eval.js';

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

const choiceAnswer = (choice = 'top_tier') => ({
  type: 'choice',
  choice,
  confidence: 0.72,
  probabilities: { [choice]: 0.72 }
});

// Every score question answered with `value`, plus a recommendation.
const answerAll = (value) => ({ questions }) => Object.fromEntries(
  Object.entries(questions).map(([name, question]) => [
    name,
    question.type === 'score' ? scoreAnswer(value) : choiceAnswer()
  ])
);

function fakeClient(answersFor, { observe = () => {}, model = 'fixture-jev-model' } = {}) {
  return () => ({
    systemOne: async (request) => {
      observe(request);
      return {
        model,
        usage: { input_tokens: 10, output_tokens: 5 },
        answers: answersFor(request)
      };
    }
  });
}

async function withKey(value, fn) {
  const original = process.env.TYPESAFE_API_KEY;
  if (value === undefined) delete process.env.TYPESAFE_API_KEY;
  else process.env.TYPESAFE_API_KEY = value;
  try {
    return await fn();
  } finally {
    if (original === undefined) delete process.env.TYPESAFE_API_KEY;
    else process.env.TYPESAFE_API_KEY = original;
  }
}

test('Jev evaluation requires a configured TypeSafe API key', async () => {
  await withKey(undefined, () => assert.rejects(
    evaluateCandidatesWithJev([], {}),
    /TYPESAFE_API_KEY is required/
  ));
  await withKey('   ', () => assert.rejects(
    evaluateCandidatesWithJev([], {}),
    /TYPESAFE_API_KEY is required/
  ));
});

test('Jev evaluator uses live typed answers and preserves their probabilities', async () => {
  let calls = 0;
  let observed;
  const results = await withKey('fixture-key', () => evaluateCandidatesWithJev(
    [candidate],
    { targetBudgetMonthly: 500, preferredLanguage: 'Spanish' },
    {
      clientFactory: (apiKey) => {
        assert.equal(apiKey, 'fixture-key');
        return fakeClient(({ questions }) => {
          assert.equal(questions.safetyScore.type, 'score');
          assert.equal(questions.recommendation.type, 'choice');
          return {
            safetyScore: scoreAnswer(3),
            budgetFit: scoreAnswer(2),
            immersionFit: scoreAnswer(3),
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
          };
        }, {
          observe: (request) => {
            calls += 1;
            observed = request;
          }
        })();
      }
    }
  ));

  assert.equal(calls, 1);
  assert.equal(observed.state.familyProfile.preferredProgramType, 'licensedCenter');
  assert.equal(observed.state.familyProfile.preferredLanguage, 'Spanish');
  assert.equal(observed.state.candidate.ageFitStatus, 'unknown');
  assert.equal(observed.state.candidate.netMonthlyCost, 347);
  assert.equal(observed.state.candidate.ccldInspection.totalTypeA, 0);
  assert.equal(results[0].source, 'jev_live_api');
  assert.equal(results[0].model, 'fixture-jev-model');
  assert.equal(results[0].confidence, 0.72);
  assert.equal(results[0].scoreDistributions.safety.probabilities[3], 0.75);
  assert.equal(results[0].recommendationChoice, 'top_tier');
  assert.equal(results[0].compositeCoverage, 1);
  assert.deepEqual(results[0].missingScoreCriteria, []);
  assert.deepEqual(results[0].compositeWeights, { safety: 0.4, budget: 0.35, immersion: 0.25 });
  // (3/3 * 0.40 + 2/3 * 0.35 + 3/3 * 0.25) = 0.883
  assert.equal(results[0].compositeScore, 0.883);
});

test('Jev is asked only about verified facts, never about diapering', async () => {
  let observed;
  await withKey('fixture-key', () => evaluateCandidatesWithJev(
    [candidate],
    { childIsPottyTrained: false },
    { clientFactory: fakeClient(answerAll(2), { observe: (request) => { observed = request; } }) }
  ));

  const stateText = JSON.stringify(observed.state);
  assert.doesNotMatch(stateText, /diaper|potty/i);
  assert.equal(Object.keys(observed.questions).some((name) => /diaper/i.test(name)), false);
});

test('Jev skips the immersion question when the family has no language preference', async () => {
  let observed;
  const results = await withKey('fixture-key', () => evaluateCandidatesWithJev(
    [candidate],
    {},
    { clientFactory: fakeClient(answerAll(3), { observe: (request) => { observed = request; } }) }
  ));

  assert.deepEqual(Object.keys(observed.questions), ['safetyScore', 'budgetFit', 'recommendation']);
  assert.equal(observed.state.familyProfile.preferredLanguage, 'No preference');
  assert.deepEqual(results[0].compositeWeights, { safety: 0.533, budget: 0.467 });
  assert.equal(results[0].compositeCoverage, 1);
  assert.deepEqual(results[0].missingScoreCriteria, []);
});

test('Jev rates the commute only when the home zip code places the family in San Francisco', async () => {
  let observed;
  const inRichmond = await withKey('fixture-key', () => evaluateCandidatesWithJev(
    [candidate],
    { homeZipCode: 94121, preferredLanguage: 'Spanish' },
    { clientFactory: fakeClient(answerAll(3), { observe: (request) => { observed = request; } }) }
  ));
  assert.ok(observed.questions.locationConvenience);
  assert.equal(observed.state.candidate.distanceFromHomeMiles, 1.5);
  assert.deepEqual(inRichmond[0].compositeWeights,
    { location: 0.3, safety: 0.3, budget: 0.25, immersion: 0.15 });

  await withKey('fixture-key', () => evaluateCandidatesWithJev(
    [candidate],
    { homeZipCode: 94015 },
    { clientFactory: fakeClient(answerAll(3), { observe: (request) => { observed = request; } }) }
  ));
  assert.equal(observed.questions.locationConvenience, undefined, 'Daly City is outside the zip table');

  const unplaced = await withKey('fixture-key', () => evaluateCandidatesWithJev(
    [{ ...candidate, distanceMiles: null }],
    { homeZipCode: 94121 },
    { clientFactory: fakeClient(answerAll(3), { observe: (request) => { observed = request; } }) }
  ));
  assert.equal(observed.questions.locationConvenience, undefined);
  assert.deepEqual(unplaced[0].missingScoreCriteria, ['location'], 'an unknown distance is missing, not zero');
  assert.ok(unplaced[0].compositeCoverage < 1);
});

test('Jev does not turn missing scores into zero-valued composite penalties', async () => {
  const results = await withKey('fixture-key', () => evaluateCandidatesWithJev(
    [candidate],
    { childAgeYears: 2.1, preferredLanguage: 'Spanish' },
    {
      clientFactory: fakeClient(() => ({
        safetyScore: scoreAnswer(3),
        budgetFit: scoreAnswer(3),
        recommendation: choiceAnswer('strong_alternative')
      }))
    }
  ));

  assert.equal(results[0].compositeScore, 1);
  assert.equal(results[0].compositeCoverage, 0.75);
  assert.deepEqual(results[0].missingScoreCriteria, ['immersion']);
});

test('a failed Jev call leaves that program unscored and ranked after the scored ones', async () => {
  class APIConnectionError extends Error {}
  const results = await withKey('fixture-key', () => evaluateCandidatesWithJev(
    [{ ...candidate, entityId: 'broken', name: 'Broken' }, candidate],
    {},
    {
      clientFactory: () => ({
        systemOne: async (request) => {
          if (request.state.candidate.name === 'Broken') {
            throw new APIConnectionError('socket hang up');
          }
          return {
            model: 'fixture-jev-model',
            usage: { input_tokens: 10, output_tokens: 5 },
            answers: answerAll(3)(request)
          };
        }
      })
    }
  ));

  assert.equal(results[0].candidateEntityId, 'fixture-1');
  assert.equal(results[1].candidateEntityId, 'broken');
  assert.equal(results[1].source, 'jev_failed');
  assert.equal(results[1].compositeScore, null);
  assert.match(results[1].error, /APIConnectionError: socket hang up/);

  const summary = summarizeJevScoring(results);
  assert.equal(summary.model, 'fixture-jev-model');
  assert.equal(summary.candidatesScored, 1);
  assert.equal(summary.candidatesFailed, 1);
  assert.deepEqual(summary.usage, { input_tokens: 10, output_tokens: 5 });
  assert.equal(summary.failures[0].entityId, 'broken');
});

test('Jev scoring raises an error when every call fails', async () => {
  class AuthenticationError extends Error {
    status = 401;
  }
  await withKey('bad-key', () => assert.rejects(
    evaluateCandidatesWithJev(
      [candidate, { ...candidate, entityId: 'fixture-2' }],
      {},
      {
        clientFactory: () => ({
          systemOne: async () => {
            throw new AuthenticationError('invalid API key');
          }
        })
      }
    ),
    /Jev scoring failed for all 2 programs.*AuthenticationError \(HTTP 401\): invalid API key/
  ));
});

test('Jev scores several programs at once without exceeding the concurrency limit', async () => {
  let inFlight = 0;
  let peak = 0;
  const many = Array.from({ length: 20 }, (_, index) => ({ ...candidate, entityId: 'c' + index }));
  const results = await withKey('fixture-key', () => evaluateCandidatesWithJev(many, {}, {
    clientFactory: () => ({
      systemOne: async (request) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        return { model: 'fixture-jev-model', answers: answerAll(2)(request) };
      }
    })
  }));

  assert.equal(results.length, 20);
  assert.ok(results.every((result) => result.source === 'jev_live_api'));
  assert.ok(peak > 1, 'programs are scored concurrently');
  assert.ok(peak <= 8, 'at most 8 calls are in flight');
});

test('composite weights follow the criteria that apply to the family', () => {
  assert.deepEqual(jevCompositeWeights({ homeZipCode: 94102, preferredLanguage: 'Spanish' }),
    { location: 0.3, safety: 0.3, budget: 0.25, immersion: 0.15 });
  assert.deepEqual(jevCompositeWeights({ homeZipCode: 94102 }),
    { location: 0.353, safety: 0.353, budget: 0.294 });
  assert.deepEqual(jevCompositeWeights({ preferredLanguage: 'Cantonese' }),
    { safety: 0.4, budget: 0.35, immersion: 0.25 });
});

test('Jev will not score an unverified CCLD record as pristine', async () => {
  let calls = 0;
  const results = await withKey('fixture-key', () => evaluateCandidatesWithJev(
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
  ));
  assert.equal(calls, 0);
  assert.equal(results[0].source, 'not_evaluated_safety_unverified');
  assert.equal(results[0].recommendationChoice, 'needs_verification');
  assert.equal(results[0].confidence, null);
  assert.equal(results[0].probabilities, null);
});
