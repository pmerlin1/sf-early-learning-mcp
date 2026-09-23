import { TypeSafeClient, score, choice } from '@typesafe-ai/sdk';
import { evaluateProximity } from './geo-utils.js';
import { isVerifiedLicensedFacility } from './ccld-utils.js';

function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalScore(answer) {
  return finiteNumber(answer?.score);
}

function scoreSummary(answer) {
  if (!answer) return null;
  return {
    score: normalScore(answer),
    confidence: finiteNumber(answer.confidence),
    probabilities: answer.probabilities || null
  };
}

/**
 * Evaluate candidates with TypeSafe Jev System One.
 * This function fails closed when Jev is not configured; it never substitutes local scores.
 */
export async function evaluateCandidatesWithJev(
  candidates,
  userPreferences = {},
  { clientFactory } = {}
) {
  const apiKey = process.env.TYPESAFE_API_KEY;
  if (!apiKey) {
    throw new Error(
      'TYPESAFE_API_KEY is required for Jev evaluation. Configure the TypeSafe API key and retry.'
    );
  }

  const {
    targetBudgetMonthly = 1200,
    preferredLanguage = 'Spanish',
    childAgeYears = 2.1,
    childIsPottyTrained,
    homeZipCode,
    homeLocation
  } = userPreferences;

  const userLoc = homeZipCode || homeLocation;
  const hasUserLoc = Boolean(userLoc);
  const client = clientFactory
    ? clientFactory(apiKey)
    : new TypeSafeClient({ apiKey });
  const results = [];

  for (const candidate of candidates) {
    const ccld = candidate.ccldInspection || null;
    const proximity = candidate.proximityLevel != null
      ? {
          distanceMiles: candidate.distanceMiles,
          proximityLevel: candidate.proximityLevel,
          proximityRating: candidate.proximityRating,
          isImmediateNeighborhood: candidate.isImmediateNeighborhood
        }
      : evaluateProximity(candidate.zipCode, candidate.location, userLoc);

    if (!isVerifiedLicensedFacility(ccld)) {
      results.push({
        candidateEntityId: candidate.entityId,
        candidateName: candidate.name,
        source: 'not_evaluated_safety_unverified',
        recommendationChoice: 'needs_verification',
        compositeScore: null,
        confidence: null,
        probabilities: null,
        netCost: candidate.estimatedNetOutOfPocketMonthly ?? null,
        ccldVerificationStatus: ccld?.verificationStatus || 'unavailable',
        inspectionDataStatus: ccld?.inspectionDataStatus || 'unavailable',
        ccldSummary: ccld?.safetySummary || 'CCLD inspection history is unavailable or incomplete.',
        distanceMiles: proximity.distanceMiles,
        proximityRating: proximity.proximityRating
      });
      continue;
    }

    const hasExplicitDiaperingSupport = candidate.diaperingStatus === 'confirmed' ||
      candidate.diaperingAccommodated === true;
    const state = {
      familyProfile: {
        childAgeYears,
        childIsPottyTrained: childIsPottyTrained ?? null,
        targetBudgetMonthly,
        preferredLanguage,
        homeLocation: userLoc || 'San Francisco',
        wantsLicensedCenter: true,
        pottyTrained: childIsPottyTrained ?? null
      },
      candidate: {
        name: candidate.name,
        languages: candidate.languages || [],
        ageFitStatus: candidate.ageFitStatus || 'unknown',
        programs: candidate.programs || [],
        address: candidate.address || '',
        zipCode: candidate.zipCode || '',
        grossMonthlyTuition: candidate.grossMonthlyTuition,
        grossMonthlyTuitionMin: candidate.grossMonthlyTuitionMin,
        grossMonthlyTuitionMax: candidate.grossMonthlyTuitionMax,
        monthlySubsidyCredit: candidate.monthlySubsidyCredit,
        monthlySubsidyCreditAppliedToRate: candidate.monthlySubsidyCreditAppliedToRate,
        scheduledMonthlySubsidyCredit: candidate.scheduledMonthlySubsidyCredit,
        subsidyEligibilityStatus: candidate.subsidyEligibilityStatus,
        providerFinancialAid: candidate.financialAid || [],
        netMonthlyCost: candidate.estimatedNetOutOfPocketMonthly,
        programType: candidate.programType,
        schedule: candidate.schedule || [],
        licenseNumber: candidate.licenseNumber,
        licenseStatus: ccld.status,
        distanceFromHomeMiles: proximity.distanceMiles,
        proximityRating: proximity.proximityRating,
        diaperingAccommodated: hasExplicitDiaperingSupport,
        diaperingStatus: candidate.diaperingStatus || 'unknown',
        diaperingFitStatus: candidate.diaperingFitStatus || 'unknown',
        diaperingEvidenceScore: candidate.diaperingEvidenceScore ?? null,
        diaperingEvidenceSource: candidate.diaperingEvidenceSource || null,
        pottyTrainingStatus: candidate.pottyTrainingStatus || 'unknown',
        pottyTrainingEvidenceScore: candidate.pottyTrainingEvidenceScore ?? null,
        pottyTrainingEvidenceSource: candidate.pottyTrainingEvidenceSource || null,
        ccldInspection: {
          status: ccld.status,
          verificationStatus: ccld.verificationStatus,
          inspectionDataStatus: ccld.inspectionDataStatus,
          totalTypeA: ccld.totalTypeA,
          totalTypeB: ccld.totalTypeB,
          complaintVisits: ccld.complaintVisits,
          substantiatedAllegations: ccld.substantiatedAllegations,
          lastVisitDate: ccld.lastVisitDate
        },
        description: candidate.description || ''
      }
    };

    const questions = {
      locationConvenience: score(
        'Rate how convenient and commutable this preschool location is for the family in San Francisco',
        [
          'Long cross-town commute (> 4.5 miles) with heavy traffic congestion',
          'Moderate cross-town commute (2.5 to 4.5 miles)',
          'Convenient adjacent neighborhood (1.2 to 2.5 miles)',
          'Immediate neighborhood or walking distance (< 1.2 miles or same zip code)'
        ]
      ),
      safetyScore: score(
        'Rate the state licensing inspection safety record using only the verified CCLD data in the candidate record',
        [
          'Critical concern: Type A citations, non-current license status, or substantiated complaint allegations',
          'Notable caution: Multiple Type B citations or complaint visits requiring parental review',
          'Minor technical findings: 1-2 routine Type B findings or unsubstantiated complaint visits',
          'Verified clear record: no citations or substantiated complaints in the complete CCLD history'
        ]
      ),
      budgetFit: score(
        'Rate how well this preschool satisfies the family budget constraints ($' +
          targetBudgetMonthly + '/mo). Use the conservative end of any published rate range.',
        [
          'Net monthly cost exceeds budget ceiling',
          'Net monthly cost is close to budget limit',
          'Net monthly cost is comfortably within budget',
          'Net monthly cost is $0 or well below target budget'
        ]
      ),
      immersionFit: score(
        'Rate the depth and authenticity of the requested language immersion goal from the provider information',
        [
          'Does not offer the requested immersion language',
          'Offers language exposure or secondary enrichment classes',
          'Offers dual-language or bilingual track including requested language',
          'Offers authentic, primary language immersion in the requested language'
        ]
      ),
      ...(candidate.diaperingFitStatus === 'not_required' ? {} : {
        toddlerDiaperingFit: score(
          'Rate fit for this family’s diapering need from the explicit structured provider evidence. ' +
            'Do not treat potty-training support or a toddler license as proof of diaper changing.',
          [
            'Poor fit: provider explicitly says it will not accept this child’s diapering needs',
            'Unknown: diaper changes are not documented by the provider',
            'Partial evidence: potty-training support is documented, but diaper changes are not confirmed',
            'Confirmed fit: provider explicitly lists diapering accommodation'
          ]
        )
      }),
      recommendation: choice(
        'What is the overall recommendation for this family, considering the candidate facts and preferences?',
        {
          top_tier: 'Exceptional match across safety, budget, language immersion, location, and toddler care',
          strong_alternative: 'Very good option with manageable compromises',
          caution_flagged: 'Notable licensing concerns, weak fit, or budget stretch requiring parental review',
          unsuitable: 'Does not meet the family requirements',
          needs_verification: 'Critical safety, rate, or age information is not verified'
        }
      )
    };

    try {
      const response = await client.systemOne({ state, questions });
      const answers = response.answers || {};
      const location = scoreSummary(answers.locationConvenience);
      const safety = scoreSummary(answers.safetyScore);
      const budget = scoreSummary(answers.budgetFit);
      const immersion = scoreSummary(answers.immersionFit);
      const diapering = scoreSummary(answers.toddlerDiaperingFit);

      const allWeights = hasUserLoc
        ? { location: 0.25, safety: 0.25, budget: 0.25, immersion: 0.15, diapering: 0.10 }
        : { safety: 0.35, budget: 0.30, immersion: 0.25, diapering: 0.10 };
      const applicableWeights = Object.entries(allWeights).filter(([criterion]) =>
        !(criterion === 'diapering' && candidate.diaperingFitStatus === 'not_required')
      );
      const applicableWeightTotal = applicableWeights.reduce((total, [, weight]) => total + weight, 0);
      const weights = Object.fromEntries(applicableWeights.map(([criterion, weight]) =>
        [criterion, weight / applicableWeightTotal]
      ));
      const normalized = {
        location: !location || location.score === null ? null : location.score / 3,
        safety: !safety || safety.score === null ? null : safety.score / 3,
        budget: !budget || budget.score === null ? null : budget.score / 3,
        immersion: !immersion || immersion.score === null ? null : immersion.score / 3,
        diapering: !diapering || diapering.score === null ? null : diapering.score / 3
      };
      const scoredWeights = Object.entries(weights).filter(([criterion]) =>
        normalized[criterion] !== null
      );
      const compositeCoverage = scoredWeights.reduce((total, [, weight]) => total + weight, 0);
      const composite = compositeCoverage > 0
        ? scoredWeights.reduce(
            (total, [criterion, weight]) => total + normalized[criterion] * weight,
            0
          ) / compositeCoverage
        : null;
      const missingScoreCriteria = Object.keys(weights).filter((criterion) =>
        normalized[criterion] === null
      );

      results.push({
        candidateEntityId: candidate.entityId,
        candidateName: candidate.name,
        source: 'jev_live_api',
        model: response.model || null,
        usage: response.usage || null,
        locationConvenienceScore: location?.score ?? null,
        safetyScore: safety?.score ?? null,
        safetyRating: !safety || safety.score === null
          ? 'Unknown'
          : (safety.score >= 2.5 ? 'Verified clear or minor findings' : 'Review required'),
        budgetFitScore: budget?.score ?? null,
        immersionFitScore: immersion?.score ?? null,
        toddlerDiaperingScore: diapering?.score ?? null,
        scoreDistributions: {
          locationConvenience: location,
          safety: safety,
          budget: budget,
          immersion: immersion,
          toddlerDiapering: diapering
        },
        recommendationChoice: answers.recommendation?.choice || null,
        probabilities: answers.recommendation?.probabilities || null,
        confidence: finiteNumber(answers.recommendation?.confidence),
        compositeScore: composite === null ? null : Number(composite.toFixed(3)),
        compositeCoverage: Number(compositeCoverage.toFixed(3)),
        missingScoreCriteria,
        netCost: candidate.estimatedNetOutOfPocketMonthly ?? null,
        ccldSummary: ccld.safetySummary
      });
    } catch (error) {
      throw new Error('Jev evaluation failed for ' + candidate.name + ': ' + error.message, {
        cause: error
      });
    }
  }

  results.sort((a, b) => (b.compositeScore ?? -1) - (a.compositeScore ?? -1));
  return results;
}
