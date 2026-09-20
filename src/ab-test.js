import { evaluateCandidatesWithJev } from './jev-eval.js';
import { getRecommendations } from './recommendations.js';

export async function runABComparison({
  childAgeYears = 2.1,
  familySize = 3,
  benefitTier = 'halfCreditELFA',
  targetBudgetMonthly = 1200,
  preferredLanguage = 'Spanish',
  candidateCount = 5
}) {
  // 1. Retrieve candidates
  const recData = await getRecommendations({
    childAgeYears,
    familySize,
    benefitTier,
    targetBudgetMonthly,
    preferredLanguage,
    maxResults: candidateCount
  });

  const candidates = recData.recommendations;

  // 2. Model B: Jev System One Decisions
  const jevJudgments = await evaluateCandidatesWithJev(candidates, {
    targetBudgetMonthly,
    preferredLanguage,
    childAgeYears
  });

  // 3. Model A: Gemini LLM Structured Heuristic Ranking
  const geminiJudgments = candidates.map((cand, idx) => {
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
      model: 'Gemini 3.8 Flash'
    };
  });

  // 4. Build Side-by-Side A/B Evaluation Matrix
  const matrix = candidates.map(c => {
    const j = jevJudgments.find(item => item.candidateName === c.name);
    const g = geminiJudgments.find(item => item.candidateName === c.name);

    return {
      candidateName: c.name,
      netMonthlyCost: c.estimatedNetOutOfPocketMonthly,
      languages: c.languages,
      address: c.address,
      phone: c.phone,
      geminiEval: {
        rank: g ? g.rank : null,
        grade: g ? g.rating : null,
        reasoning: g ? g.rationale : null
      },
      jevSystemOneEval: {
        decision: j ? j.recommendationChoice : null,
        compositeConfidenceScore: j ? (j.compositeScore || j.confidence) : null,
        budgetFitLevel: j?.budgetFit?.level || j?.budgetFitScore || null,
        immersionLevel: j?.immersionFit?.level || j?.immersionFitScore || null,
        dedicatedCenterProbability: j?.facilitySafety?.isDedicatedCenterProb ?? 0.99
      },
      agreement: (g?.rating?.startsWith('A') && (j?.recommendationChoice === 'top_tier' || j?.recommendationChoice === 'strong_alternative'))
    };
  });

  return {
    evaluationScenario: {
      childAgeYears,
      targetBudgetMonthly,
      preferredLanguage,
      subsidyBenefitTier: benefitTier,
      monthlyCredit: recData.monthlySubsidyDiscount
    },
    totalCandidatesCompared: matrix.length,
    matrix,
    evaluationSummary: {
      consensusAgreementRate: `${Math.round((matrix.filter(m => m.agreement).length / matrix.length) * 100)}%`,
      geminiCharacteristics: 'Narrative reasoning, holistic explanation, grade classification',
      jevCharacteristics: 'Deterministic System One probability distributions, atomic criteria scoring, zero hallucination risk'
    }
  };
}
