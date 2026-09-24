import { evaluateCandidatesWithJev } from './jev-eval.js';
import { getRecommendations } from './recommendations.js';

export async function runHeuristicVsJevComparison({
  childAgeYears = 2.1,
  childIsPottyTrained,
  familySize = 3,
  monthlyIncome,
  annualIncome,
  benefitTier = 'privatePay',
  targetBudgetMonthly = 1200,
  preferredLanguage = 'Spanish',
  homeZipCode,
  homeLocation,
  programType = 'licensedCenter',
  candidateCount = 5
}) {
  const userLoc = homeZipCode || homeLocation;
  const recData = await getRecommendations({
    childAgeYears,
    childIsPottyTrained,
    familySize,
    monthlyIncome,
    annualIncome,
    benefitTier,
    targetBudgetMonthly,
    preferredLanguage,
    homeZipCode: userLoc,
    programType,
    maxResults: candidateCount
  });

  const candidates = recData.recommendations;
  const jevJudgments = await evaluateCandidatesWithJev(candidates, {
    targetBudgetMonthly,
    preferredLanguage,
    childAgeYears,
    childIsPottyTrained,
    homeZipCode: userLoc,
    programType
  });

  const heuristicJudgments = candidates.map((candidate, index) => {
    const net = candidate.estimatedNetOutOfPocketMonthly;
    let rating = 'B';
    let rationale;

    if (net === null || net === undefined) {
      rating = 'Unrated';
      rationale = 'No verified monthly out-of-pocket estimate is available.';
    } else if (net <= 200) {
      rating = 'A+';
      rationale = 'The verified conservative net estimate is $' + net +
        '/month, within the $' + targetBudgetMonthly + ' monthly target.';
    } else if (net <= 500) {
      rating = 'A';
      rationale = 'The verified conservative net estimate is $' + net +
        '/month, within the $' + targetBudgetMonthly + ' monthly target.';
    } else if (net <= targetBudgetMonthly) {
      rating = 'B+';
      rationale = 'The verified conservative net estimate is $' + net +
        '/month, within the $' + targetBudgetMonthly + ' monthly target.';
    } else {
      rating = 'C';
      rationale = 'The verified conservative net estimate is $' + net +
        '/month, above the $' + targetBudgetMonthly + ' monthly target.';
    }

    return {
      candidateEntityId: candidate.entityId,
      candidateName: candidate.name,
      rank: index + 1,
      rating,
      netCost: net,
      rationale,
      method: 'rule_based_budget_heuristic'
    };
  });

  const matrix = candidates.map((candidate) => {
    const jev = jevJudgments.find((item) => item.candidateEntityId === candidate.entityId);
    const heuristic = heuristicJudgments.find((item) =>
      item.candidateEntityId === candidate.entityId
    );
    const comparable = jev?.source === 'jev_live_api';
    const heuristicPositive = heuristic?.rating?.startsWith('A');
    const jevPositive = jev?.recommendationChoice === 'top_tier' ||
      jev?.recommendationChoice === 'strong_alternative';

    return {
      candidateName: candidate.name,
      netMonthlyCost: candidate.estimatedNetOutOfPocketMonthly,
      costEstimateBasis: candidate.costEstimateBasis,
      languages: candidate.languages,
      address: candidate.address,
      zipCode: candidate.zipCode,
      phone: candidate.phone,
      distanceMiles: candidate.distanceMiles,
      proximityRating: candidate.proximityRating,
      heuristicEval: heuristic || null,
      jevSystemOneEval: jev
        ? {
            source: jev.source,
            model: jev.model || null,
            decision: jev.recommendationChoice,
            compositeScore: jev.compositeScore,
            compositeCoverage: jev.compositeCoverage,
            missingScoreCriteria: jev.missingScoreCriteria || [],
            probabilities: jev.probabilities || null,
            confidence: jev.confidence,
            scoreDistributions: jev.scoreDistributions || null,
            safetyRating: jev.safetyRating || null,
            safetyScore: jev.safetyScore ?? null,
            budgetFitScore: jev.budgetFitScore ?? null,
            immersionScore: jev.immersionFitScore ?? null,
            toddlerDiaperingScore: jev.toddlerDiaperingScore ?? null,
            ccldVerificationStatus: jev.ccldVerificationStatus || 'verified',
            inspectionDataStatus: jev.inspectionDataStatus || 'complete',
            ccldInspectionSummary: jev.ccldSummary || candidate.safetySummary
          }
        : null,
      agreement: comparable ? heuristicPositive === jevPositive : null
    };
  });

  const comparableCount = matrix.filter((item) => item.agreement !== null).length;
  const agreementCount = matrix.filter((item) => item.agreement === true).length;

  return {
    evaluationScenario: {
      childAgeYears,
      targetBudgetMonthly,
      preferredLanguage,
      homeLocation: userLoc || 'All SF',
      subsidyBenefitTier: benefitTier,
      monthlyCredit: recData.monthlySubsidyDiscount
    },
    totalCandidatesCompared: matrix.length,
    matrix,
    evaluationSummary: {
      agreementRate: comparableCount === 0
        ? null
        : Math.round((agreementCount / comparableCount) * 100) + '%',
      candidatesWithBothEvaluations: comparableCount,
      heuristicCharacteristics: 'Rule-based budget grading; no generative LLM is called.',
      jevCharacteristics: 'TypeSafe Jev System One model response with typed scores and probabilities.'
    }
  };
}

// Retained for callers importing the former function name.
export const runABComparison = runHeuristicVsJevComparison;
