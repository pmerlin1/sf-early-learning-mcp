import { TypeSafeClient, score, choice } from '@typesafe-ai/sdk';
import { evaluateProximity, resolveCoordinates } from './geo-utils.js';
import { isVerifiedLicensedFacility } from './ccld-utils.js';

// Jev rates each criterion on a 0-3 rubric. A program's composite is the weighted mean of those
// ratings, each divided by 3. Location applies only when the family gives a San Francisco zip
// code and language immersion only when it names a language; the weights are renormalized over
// the criteria that apply.
export const JEV_BASE_WEIGHTS = {
  withLocation: { location: 0.30, safety: 0.30, budget: 0.25, immersion: 0.15 },
  withoutLocation: { safety: 0.40, budget: 0.35, immersion: 0.25 }
};

// Programs scored at once. Jev answers in well under a second, so this limits load, not latency.
const JEV_CONCURRENCY = 8;
// Upper bound for scoring one request; calls still pending then are reported as failed.
const JEV_DEADLINE_MS = 60_000;
// Provider descriptions are marketing text; the opening is enough to judge language immersion.
const DESCRIPTION_LIMIT = 1500;

const MISSING_KEY_MESSAGE =
  'TYPESAFE_API_KEY is required: get_smart_recommendations uses TypeSafe Jev to score and rank ' +
  'programs. Set TYPESAFE_API_KEY in the MCP server environment and retry. check_elfa_eligibility, ' +
  'search_sf_childcare, get_childcare_details, and get_state_licensing_record work without it.';

/** Fails before any provider lookups when Jev cannot run, so no other ranking is substituted. */
export function assertJevConfigured() {
  if (!String(process.env.TYPESAFE_API_KEY ?? '').trim()) throw new Error(MISSING_KEY_MESSAGE);
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function scoreSummary(answer) {
  if (!answer) return null;
  return {
    score: finiteNumber(answer.score),
    confidence: finiteNumber(answer.confidence),
    probabilities: answer.probabilities || null
  };
}

function weightsFor(hasHomeLocation, preferredLanguage) {
  const base = hasHomeLocation ? JEV_BASE_WEIGHTS.withLocation : JEV_BASE_WEIGHTS.withoutLocation;
  const applicable = Object.entries(base)
    .filter(([criterion]) => criterion !== 'immersion' || Boolean(preferredLanguage));
  const total = applicable.reduce((sum, [, weight]) => sum + weight, 0);
  return Object.fromEntries(applicable.map(([criterion, weight]) => [criterion, weight / total]));
}

const roundWeights = (weights) => Object.fromEntries(
  Object.entries(weights).map(([criterion, weight]) => [criterion, Number(weight.toFixed(3))])
);

/** The composite weights Jev scoring applies for a family's preferences, rounded for display. */
export function jevCompositeWeights({ homeZipCode, homeLocation, preferredLanguage } = {}) {
  const hasHomeLocation = resolveCoordinates(homeZipCode || homeLocation) !== null;
  return roundWeights(weightsFor(hasHomeLocation, preferredLanguage));
}

const CRITERION_LABELS = {
  location: () => 'commute',
  safety: () => 'licensing record',
  budget: () => 'budget fit',
  immersion: (language) => language + ' immersion'
};

function buildQuestions({ weights, askLocation, askBudget, preferredLanguage, targetBudgetMonthly }) {
  const questions = {};
  if (askLocation) {
    questions.locationConvenience = score(
      'Rate how convenient this program is to reach from the family\'s home, using ' +
        'distanceFromHomeMiles (straight-line miles within San Francisco)',
      [
        'Long cross-town commute (more than 4.5 miles)',
        'Moderate cross-town commute (2.5 to 4.5 miles)',
        'Adjacent neighborhood (1.2 to 2.5 miles)',
        'Immediate neighborhood or walking distance (under 1.2 miles or the same zip code)'
      ]
    );
  }
  questions.safetyScore = score(
    'Rate the state licensing inspection safety record using only the verified CCLD data in the candidate record',
    [
      'Critical concern: Type A citations, non-current license status, or substantiated complaint allegations',
      'Notable caution: Multiple Type B citations or complaint visits requiring parental review',
      'Minor technical findings: 1-2 routine Type B findings or unsubstantiated complaint visits',
      'Verified clear record: no citations or substantiated complaints in the complete CCLD history'
    ]
  );
  if (askBudget) {
    questions.budgetFit = score(
      'Rate how well this program fits the family\'s maximum monthly out-of-pocket budget ($' +
        targetBudgetMonthly + '/mo), using netMonthlyCost, the conservative end of any published range',
      [
        'Net monthly cost exceeds the budget',
        'Net monthly cost is close to the budget limit',
        'Net monthly cost is comfortably within budget',
        'Net monthly cost is $0 or well below budget'
      ]
    );
  }
  if (preferredLanguage) {
    questions.immersionFit = score(
      'Rate how well this program offers ' + preferredLanguage + ' language immersion, from its ' +
        'listed languages, programs, and description',
      [
        'Does not offer ' + preferredLanguage,
        'Offers ' + preferredLanguage + ' exposure or enrichment classes only',
        'Offers a dual-language or bilingual track that includes ' + preferredLanguage,
        'Offers primary ' + preferredLanguage + ' immersion'
      ]
    );
  }
  const considered = Object.keys(weights)
    .map((criterion) => CRITERION_LABELS[criterion](preferredLanguage))
    .join(', ');
  questions.recommendation = choice(
    'What is the overall recommendation for this family, weighing ' + considered + '?',
    {
      top_tier: 'Exceptional match on ' + considered,
      strong_alternative: 'Very good option with manageable compromises',
      caution_flagged: 'Notable licensing concerns, weak fit, or a budget stretch that needs parental review',
      unsuitable: 'Does not meet the family\'s requirements',
      needs_verification: 'The candidate facts look inconsistent or incomplete'
    }
  );
  return questions;
}

// Jev sees the verified facts code gathered. Diaper-change support is left out: CareWait rarely
// records it, so it is reported to families as a tour question rather than judged.
function stateFor(candidate, proximity, ccld, profile) {
  const description = String(candidate.description || '');
  return {
    familyProfile: {
      childAgeYears: profile.childAgeYears,
      targetBudgetMonthly: profile.targetBudgetMonthly,
      preferredLanguage: profile.preferredLanguage || 'No preference',
      homeLocation: profile.homeLocation ?? 'Not provided',
      preferredProgramType: profile.programType
    },
    candidate: {
      name: candidate.name,
      programType: candidate.programType,
      address: candidate.address || '',
      zipCode: candidate.zipCode || '',
      distanceFromHomeMiles: proximity.distanceMiles ?? null,
      proximityRating: proximity.proximityRating ?? null,
      languages: candidate.languages || [],
      programs: candidate.programs || [],
      ageFitStatus: candidate.ageFitStatus || 'unknown',
      schedule: candidate.schedule || [],
      grossMonthlyTuition: candidate.grossMonthlyTuition ?? null,
      grossMonthlyTuitionMin: candidate.grossMonthlyTuitionMin ?? null,
      grossMonthlyTuitionMax: candidate.grossMonthlyTuitionMax ?? null,
      rateBasis: candidate.rateBasis || 'gross',
      monthlySubsidyCreditAppliedToRate: candidate.monthlySubsidyCreditAppliedToRate ?? 0,
      subsidyEligibilityStatus: candidate.subsidyEligibilityStatus || 'unknown',
      netMonthlyCost: candidate.estimatedNetOutOfPocketMonthly ?? null,
      netMonthlyCostMin: candidate.estimatedNetOutOfPocketMonthlyMin ?? null,
      netMonthlyCostMax: candidate.estimatedNetOutOfPocketMonthlyMax ?? null,
      costEstimateBasis: candidate.costEstimateBasis || '',
      licenseNumbers: candidate.licenseNumbers ||
        (candidate.licenseNumber ? [candidate.licenseNumber] : []),
      licenseStatus: ccld.status,
      ccldInspection: {
        status: ccld.status,
        verificationStatus: ccld.verificationStatus,
        inspectionDataStatus: ccld.inspectionDataStatus,
        totalTypeA: ccld.totalTypeA,
        totalTypeB: ccld.totalTypeB,
        complaintVisits: ccld.complaintVisits,
        substantiatedAllegations: ccld.substantiatedAllegations,
        lastVisitDate: ccld.lastVisitDate ?? null,
        summary: ccld.safetySummary || ''
      },
      description: description.length > DESCRIPTION_LIMIT
        ? description.slice(0, DESCRIPTION_LIMIT) + '…'
        : description
    }
  };
}

function describeError(error) {
  const name = error?.constructor?.name || 'Error';
  const status = error?.status ? ' (HTTP ' + error.status + ')' : '';
  return name + status + ': ' + String(error?.message || error).slice(0, 300);
}

async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function scoreCandidate(client, candidate, context, signal) {
  const ccld = candidate.ccldInspection || null;
  const proximity = candidate.proximityLevel != null
    ? {
        distanceMiles: candidate.distanceMiles ?? null,
        proximityRating: candidate.proximityRating ?? null
      }
    : evaluateProximity(candidate.zipCode, candidate.location, context.profile.homeLocation);
  const base = {
    candidateEntityId: candidate.entityId,
    candidateName: candidate.name,
    netCost: candidate.estimatedNetOutOfPocketMonthly ?? null,
    distanceMiles: proximity.distanceMiles ?? null,
    proximityRating: proximity.proximityRating ?? null
  };

  // Missing or incomplete CCLD data is unknown, not clean, so Jev is never asked to rate it.
  if (!isVerifiedLicensedFacility(ccld)) {
    return {
      ...base,
      source: 'not_evaluated_safety_unverified',
      recommendationChoice: 'needs_verification',
      compositeScore: null,
      confidence: null,
      probabilities: null,
      ccldVerificationStatus: ccld?.verificationStatus || 'unavailable',
      inspectionDataStatus: ccld?.inspectionDataStatus || 'unavailable',
      ccldSummary: ccld?.safetySummary || 'CCLD inspection history is unavailable or incomplete.'
    };
  }

  const { weights } = context;
  const questions = buildQuestions({
    weights,
    // A criterion that applies but lacks its fact is left unasked and reported as missing.
    askLocation: 'location' in weights && proximity.distanceMiles != null,
    askBudget: candidate.estimatedNetOutOfPocketMonthly != null,
    preferredLanguage: context.profile.preferredLanguage,
    targetBudgetMonthly: context.profile.targetBudgetMonthly
  });

  let response;
  try {
    response = await client.systemOne(
      { state: stateFor(candidate, proximity, ccld, context.profile), questions },
      { signal }
    );
  } catch (error) {
    return {
      ...base,
      source: 'jev_failed',
      error: describeError(error),
      recommendationChoice: null,
      compositeScore: null,
      compositeCoverage: 0,
      compositeWeights: roundWeights(weights),
      missingScoreCriteria: Object.keys(weights),
      confidence: null,
      probabilities: null,
      ccldSummary: ccld.safetySummary
    };
  }

  const answers = response.answers || {};
  const summaries = {
    location: scoreSummary(answers.locationConvenience),
    safety: scoreSummary(answers.safetyScore),
    budget: scoreSummary(answers.budgetFit),
    immersion: scoreSummary(answers.immersionFit)
  };
  const normalized = Object.fromEntries(Object.keys(weights).map((criterion) => {
    const value = summaries[criterion]?.score;
    return [criterion, value == null ? null : Math.min(1, Math.max(0, value / 3))];
  }));
  // A missing answer lowers coverage instead of counting as zero.
  const scoredWeights = Object.entries(weights).filter(([criterion]) => normalized[criterion] !== null);
  const coverage = scoredWeights.reduce((total, [, weight]) => total + weight, 0);
  const composite = coverage > 0
    ? scoredWeights.reduce((total, [criterion, weight]) => total + normalized[criterion] * weight, 0) /
      coverage
    : null;

  return {
    ...base,
    source: 'jev_live_api',
    model: response.model || null,
    usage: response.usage || null,
    locationConvenienceScore: summaries.location?.score ?? null,
    safetyScore: summaries.safety?.score ?? null,
    safetyRating: summaries.safety?.score == null
      ? 'Unknown'
      : (summaries.safety.score >= 2.5 ? 'Verified clear or minor findings' : 'Review required'),
    budgetFitScore: summaries.budget?.score ?? null,
    immersionFitScore: summaries.immersion?.score ?? null,
    scoreDistributions: {
      locationConvenience: summaries.location,
      safety: summaries.safety,
      budget: summaries.budget,
      immersion: summaries.immersion
    },
    recommendationChoice: answers.recommendation?.choice || null,
    probabilities: answers.recommendation?.probabilities || null,
    confidence: finiteNumber(answers.recommendation?.confidence),
    compositeScore: composite === null ? null : Number(composite.toFixed(3)),
    compositeCoverage: Number(coverage.toFixed(3)),
    compositeWeights: roundWeights(weights),
    missingScoreCriteria: Object.keys(weights).filter((criterion) => normalized[criterion] === null),
    ccldSummary: ccld.safetySummary
  };
}

/**
 * Score candidates with TypeSafe Jev System One: commute (with a home zip code), licensing
 * record, budget fit, and language immersion (when a language is requested), plus an overall
 * recommendation. Fails closed without a key and never substitutes local scores. A failed call
 * leaves that program unscored; if every call fails, the error is raised.
 */
export async function evaluateCandidatesWithJev(
  candidates,
  userPreferences = {},
  { clientFactory, concurrency = JEV_CONCURRENCY, deadlineMs = JEV_DEADLINE_MS } = {}
) {
  assertJevConfigured();
  const apiKey = process.env.TYPESAFE_API_KEY.trim();

  const {
    targetBudgetMonthly = 1200,
    preferredLanguage,
    childAgeYears = 2.1,
    homeZipCode,
    homeLocation,
    programType = 'licensedCenter'
  } = userPreferences;
  const userLoc = homeZipCode || homeLocation;
  const context = {
    weights: weightsFor(resolveCoordinates(userLoc) !== null, preferredLanguage),
    profile: {
      childAgeYears,
      targetBudgetMonthly,
      preferredLanguage: preferredLanguage || null,
      homeLocation: userLoc ?? null,
      programType
    }
  };

  const client = clientFactory ? clientFactory(apiKey) : new TypeSafeClient({ apiKey });
  const signal = AbortSignal.timeout(deadlineMs);
  const results = await mapWithConcurrency(candidates, concurrency, (candidate) =>
    scoreCandidate(client, candidate, context, signal)
  );

  const attempted = results.filter((result) => result.source !== 'not_evaluated_safety_unverified');
  if (attempted.length > 0 && attempted.every((result) => result.source === 'jev_failed')) {
    throw new Error(
      'Jev scoring failed for all ' + attempted.length + ' programs. First error: ' + attempted[0].error
    );
  }

  return results.sort((a, b) => (b.compositeScore ?? -1) - (a.compositeScore ?? -1));
}

/** Model, counts, failures, and total token usage for a set of Jev results. */
export function summarizeJevScoring(results = []) {
  const scored = results.filter((result) => result.source === 'jev_live_api');
  const failed = results.filter((result) => result.source === 'jev_failed');
  return {
    model: scored.find((result) => result.model)?.model ?? null,
    candidatesScored: scored.length,
    candidatesFailed: failed.length,
    failures: failed.map((result) => ({
      entityId: result.candidateEntityId,
      name: result.candidateName,
      error: result.error
    })),
    usage: scored.reduce((total, result) => ({
      input_tokens: total.input_tokens + (finiteNumber(result.usage?.input_tokens) ?? 0),
      output_tokens: total.output_tokens + (finiteNumber(result.usage?.output_tokens) ?? 0)
    }), { input_tokens: 0, output_tokens: 0 })
  };
}
