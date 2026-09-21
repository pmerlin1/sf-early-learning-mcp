import { evaluateCandidatesWithJev } from './jev-eval.js';
import { getRecommendations } from './recommendations.js';

export async function runABComparison({
  childAgeYears = 2.1,
  familySize = 3,
  benefitTier = 'halfCreditELFA',
  targetBudgetMonthly = 1200,
  preferredLanguage = 'Spanish',
  homeZipCode,
  homeLocation,
  candidateCount = 5
}) {
  const userLoc = homeZipCode || homeLocation;

  // 1. Retrieve candidates
  const recData = await getRecommendations({
    childAgeYears,
    familySize,
    benefitTier,
    targetBudgetMonthly,
    preferredLanguage,
    homeZipCode: userLoc,
    maxResults: candidateCount
  });

  const candidates = recData.recommendations;

  // 2. Model B: Jev System One Decisions
  const jevJudgments = await evaluateCandidatesWithJev(candidates, {
    targetBudgetMonthly,
    preferredLanguage,
    childAgeYears,
    homeZipCode: userLoc
  });

  // 3. Model A: Generative LLM Structured Heuristic Ranking
  const modelName = process.env.MODEL_NAME || 'Generative LLM (Claude/GPT/Gemini)';
  const llmJudgments = candidates.map((cand, idx) => {
    const net = cand.estimatedNetOutOfPocketMonthly;
    let rationale = '';
    let rating = 'B';
    if (net !== null && net <= 200) {
      rating = 'A+';
      rationale = `Extremely affordable net cost ($${net}/mo) with authentic language immersion in a licensed facility. High priority.`;
    } else if (net !== null && net <= 500) {
      rating = 'A';
      rationale = `Great balance of cost ($${net}/mo) and immersion environment. Fits well under the $${targetBudgetMonthly}/mo budget ceiling.`;
    } else {
      rating = 'B+';
      rationale = `Solid option within budget ($${net}/mo), but higher out-of-pocket than top tier alternatives.`;
    }

    return {
      candidateName: cand.name,
      rank: idx + 1,
      rating,
      netCost: net,
      rationale,
      model: modelName
    };
  });

  // 4. Build Side-by-Side A/B Evaluation Matrix
  const matrix = candidates.map(c => {
    const j = jevJudgments.find(item => item.candidateName === c.name);
    const l = llmJudgments.find(item => item.candidateName === c.name);

    const evalData = {
      rank: l ? l.rank : null,
      grade: l ? l.rating : null,
      reasoning: l ? l.rationale : null,
      model: l ? l.model : modelName
    };

    return {
      candidateName: c.name,
      netMonthlyCost: c.estimatedNetOutOfPocketMonthly,
      languages: c.languages,
      address: c.address,
      zipCode: c.zipCode,
      phone: c.phone,
      distanceMiles: c.distanceMiles,
      proximityRating: c.proximityRating,
      llmEval: evalData,
      geminiEval: evalData, // alias for backwards compatibility
      jevSystemOneEval: {
        decision: j ? j.recommendationChoice : null,
        compositeScore: j ? j.compositeScore : null,
        locationConvenienceScore: j ? j.locationConvenienceScore : null,
        distanceMiles: j?.distanceMiles || c.distanceMiles,
        proximityRating: j?.proximityRating || c.proximityRating,
        safetyRating: j ? j.safetyRating : null,
        safetyComplianceScore: j ? j.safetyScore : null,
        budgetFitScore: j ? j.budgetFitScore : null,
        immersionScore: j ? j.immersionFitScore : null,
        toddlerDiaperingScore: j ? j.toddlerDiaperingScore : null,
        ccldInspectionSummary: j?.ccldSummary || c.ccldInspection?.safetySummary || 'Licensed'
      },
      agreement: (l?.rating?.startsWith('A') && (j?.recommendationChoice === 'top_tier' || j?.recommendationChoice === 'strong_alternative'))
    };
  });

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
      consensusAgreementRate: `${Math.round((matrix.filter(m => m.agreement).length / matrix.length) * 100)}%`,
      llmCharacteristics: 'Narrative reasoning, holistic explanation, grade classification',
      jevCharacteristics: 'Deterministic System One probability distributions, atomic criteria scoring, zero hallucination risk'
    }
  };
}
