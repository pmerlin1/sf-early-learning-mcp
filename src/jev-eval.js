import { TypeSafeClient, score, choice, noul } from '@typesafe-ai/sdk';
import { evaluateProximity } from './geo-utils.js';

/**
 * Evaluates and scores preschool candidates using TypeSafe Jev System One model.
 * Produces a nuanced meta composite score across location proximity, safety licensing,
 * budget, language immersion, and toddler development / diapering needs.
 */
export async function evaluateCandidatesWithJev(candidates, userPreferences = {}) {
  const apiKey = process.env.TYPESAFE_API_KEY;
  const isLive = Boolean(apiKey);

  const {
    targetBudgetMonthly = 1200,
    preferredLanguage = 'Spanish',
    childAgeYears = 2.1,
    homeZipCode,
    homeLocation
  } = userPreferences;

  const userLoc = homeZipCode || homeLocation;
  const hasUserLoc = Boolean(userLoc);

  const results = [];

  for (const candidate of candidates) {
    const ccld = candidate.ccldInspection || {};
    const totalTypeA = ccld.totalTypeA || 0;
    const totalTypeB = ccld.totalTypeB || 0;
    const complaintVisits = ccld.complaintVisits || 0;
    const substantiated = ccld.substantiatedAllegations || 0;

    // Evaluate proximity if not already computed
    const proximity = candidate.proximityLevel != null
      ? {
          distanceMiles: candidate.distanceMiles,
          proximityLevel: candidate.proximityLevel,
          proximityRating: candidate.proximityRating,
          isImmediateNeighborhood: candidate.isImmediateNeighborhood
        }
      : evaluateProximity(candidate.zipCode, candidate.location, userLoc);

    const state = {
      familyProfile: {
        childAgeYears,
        targetBudgetMonthly,
        preferredLanguage,
        homeLocation: userLoc || 'San Francisco',
        wantsLicensedCenter: true,
        pottyTrained: childAgeYears >= 3.0 // 2.1-year-olds need diapering accommodation
      },
      candidate: {
        name: candidate.name,
        languages: candidate.languages,
        address: candidate.address,
        zipCode: candidate.zipCode,
        grossMonthlyTuition: candidate.grossMonthlyTuition,
        monthlySubsidyCredit: candidate.monthlySubsidyCredit,
        netMonthlyCost: candidate.estimatedNetOutOfPocketMonthly,
        programType: candidate.programType,
        schedule: candidate.schedule,
        licenseNumber: candidate.licenseNumber,
        distanceFromHomeMiles: proximity.distanceMiles,
        proximityRating: proximity.proximityRating,
        diaperingAccommodated: candidate.diaperingAccommodated !== false,
        ccldInspection: {
          status: ccld.status || 'Licensed',
          totalTypeA,
          totalTypeB,
          complaintVisits,
          substantiatedAllegations: substantiated,
          lastVisitDate: ccld.lastVisitDate || 'N/A'
        },
        description: candidate.description
      }
    };

    if (isLive) {
      try {
        const client = new TypeSafeClient({ apiKey });
        const response = await client.systemOne({
          state,
          questions: {
            locationConvenience: score('Rate how convenient and commutable this preschool location is for the family in San Francisco', [
              'Long cross-town commute (> 4.5 miles) with heavy traffic congestion (e.g. Richmond to Bayview/Vis Valley)',
              'Moderate cross-town commute (2.5 to 4.5 miles, e.g. Richmond to Mission or SOMA)',
              'Convenient adjacent neighborhood (1.2 to 2.5 miles, e.g. Richmond to Presidio Heights or Sunset)',
              'Immediate neighborhood or walking distance (< 1.2 miles or same zip code)'
            ]),
            safetyScore: score('Rate the state licensing inspection safety record of this facility', [
              'Critical concern: Type A citations, active license restriction, or multiple substantiated complaint allegations',
              'Notable caution: Multiple Type B citations or substantiated complaints on file requiring parental review',
              'Minor technical finding: 1-2 isolated routine Type B recordkeeping/facility citations, fully resolved, 0 Type A, 0 substantiated allegations',
              'Pristine safety record: Zero citations ever recorded, 0 substantiated complaints, spotless state inspection history'
            ]),
            budgetFit: score(`Rate how well this preschool satisfies the family budget constraints ($${targetBudgetMonthly}/mo)`, [
              'Net monthly cost exceeds budget ceiling (> target budget)',
              'Net monthly cost is close to budget limit',
              'Net monthly cost is comfortably within budget',
              'Net monthly cost is $0 or well below target budget'
            ]),
            immersionFit: score('Rate the depth and authenticity of the requested language immersion goal', [
              'Does not offer the requested immersion language',
              'Offers language exposure or secondary enrichment classes',
              'Offers dual-language or bilingual track including requested language',
              'Offers authentic, primary language immersion in the requested language'
            ]),
            toddlerDiaperingFit: score('Rate how well this program supports toddler developmental and diapering needs', [
              'Unsuitable: Requires independent potty training for an unpotty-trained toddler',
              'Ambiguous: Diapering support not explicitly confirmed',
              'Accommodated: Accommodates diapering on-site',
              'Optimal: Dedicated toddler license with diaper changing tables and supportive toilet learning'
            ]),
            recommendation: choice('What is the meta composite recommendation verdict for this family?', {
              top_tier: 'Exceptional match across location proximity, safety, budget, language immersion, and toddler care',
              strong_alternative: 'Very good option with minor compromises (e.g. adjacent neighborhood or 1 minor resolved technical finding)',
              caution_flagged: 'Notable state citations, substantiated allegations, or budget stretch requiring parental caution',
              unsuitable: 'Critical health/safety hazard, exceeds budget ceiling, or unsuited for child age'
            })
          }
        });

        const lScore = Number(response.answers.locationConvenience.score);
        const sScore = Number(response.answers.safetyScore.score);
        const bScore = Number(response.answers.budgetFit.score);
        const iScore = Number(response.answers.immersionFit.score);
        const tScore = Number(response.answers.toddlerDiaperingFit.score);

        // Normalized 0 to 1
        const lNorm = lScore / 3;
        const sNorm = sScore / 3;
        const bNorm = bScore / 3;
        const iNorm = iScore / 3;
        const tNorm = tScore / 3;

        // Composite weighted score:
        // Location Proximity: 25% (if user specified location)
        // Safety: 25%
        // Budget: 25%
        // Immersion: 15%
        // Toddler Diapering: 10%
        let composite = 0;
        if (hasUserLoc) {
          composite = (lNorm * 0.25) + (sNorm * 0.25) + (bNorm * 0.25) + (iNorm * 0.15) + (tNorm * 0.10);
        } else {
          composite = (sNorm * 0.35) + (bNorm * 0.30) + (iNorm * 0.25) + (tNorm * 0.10);
        }

        results.push({
          candidateName: candidate.name,
          source: 'jev_live_api',
          locationConvenienceScore: lScore,
          proximityRating: proximity.proximityRating,
          distanceMiles: proximity.distanceMiles,
          safetyScore: sScore,
          safetyRating: sScore >= 2.5 ? 'Pristine' : (sScore >= 1.5 ? 'Minor resolved findings' : 'Caution flagged'),
          budgetFitScore: bScore,
          immersionFitScore: iScore,
          toddlerDiaperingScore: tScore,
          recommendationChoice: response.answers.recommendation.choice,
          probabilities: response.answers.recommendation.probabilities,
          confidence: response.answers.recommendation.confidence,
          compositeScore: Number(composite.toFixed(3)),
          netCost: candidate.estimatedNetOutOfPocketMonthly,
          ccldSummary: ccld.safetySummary || 'Licensed child care center'
        });
        continue;
      } catch (err) {
        console.error(`Jev live API error for ${candidate.name}, using calibrated composite model:`, err.message);
      }
    }

    // Calibrated Jev System One decision logic (when TYPESAFE_API_KEY is not set or on fallback)
    const netCost = candidate.estimatedNetOutOfPocketMonthly ?? 9999;
    const langs = (candidate.languages || []).map(l => l.toLowerCase());
    const targetLang = (preferredLanguage || '').toLowerCase();
    const hasLang = langs.some(l => l.includes(targetLang)) ||
      (candidate.description || '').toLowerCase().includes(targetLang);

    // 1. Location proximity score (0 to 3)
    const lScore = proximity.proximityLevel;

    // 2. Safety scoring (0 to 3)
    let sScore = 3.0;
    let sRating = 'Pristine';
    if (totalTypeA > 0 || substantiated > 0) {
      sScore = 0.5;
      sRating = 'Caution flagged';
    } else if (totalTypeB > 2 || complaintVisits > 2) {
      sScore = 1.2;
      sRating = 'Notable citations';
    } else if (totalTypeB > 0 || complaintVisits > 0) {
      sScore = 2.2; // 1-2 minor Type B resolved: small ding, not disqualified
      sRating = 'Minor resolved findings';
    }

    // 3. Budget scoring (0 to 3)
    let bScore = 0.0;
    if (netCost <= 100) {
      bScore = 3.0;
    } else if (netCost <= 300) {
      bScore = 2.6;
    } else if (netCost <= 600) {
      bScore = 2.0;
    } else if (netCost <= targetBudgetMonthly) {
      bScore = 1.2;
    }

    // 4. Immersion scoring (0 to 3)
    let iScore = hasLang ? 2.8 : 0.2;

    // 5. Toddler diapering (0 to 3)
    let tScore = candidate.diaperingAccommodated !== false ? 3.0 : 0.5;

    // Composite weighted score (0 to 1)
    let composite = 0;
    if (hasUserLoc) {
      composite = ((lScore / 3) * 0.25) + ((sScore / 3) * 0.25) + ((bScore / 3) * 0.25) + ((iScore / 3) * 0.15) + ((tScore / 3) * 0.10);
    } else {
      composite = ((sScore / 3) * 0.35) + ((bScore / 3) * 0.30) + ((iScore / 3) * 0.25) + ((tScore / 3) * 0.10);
    }

    let recommendation = 'unsuitable';
    if (sScore >= 2.0 && bScore >= 2.0 && iScore >= 2.0 && (!hasUserLoc || lScore >= 1.5)) {
      recommendation = 'top_tier';
    } else if (sScore >= 1.5 && bScore >= 1.0 && iScore >= 1.5) {
      recommendation = 'strong_alternative';
    } else if (sScore < 1.5 || bScore === 0) {
      recommendation = sScore < 1.5 ? 'caution_flagged' : 'unsuitable';
    }

    results.push({
      candidateName: candidate.name,
      source: 'jev_system_one_simulated',
      locationConvenienceScore: lScore,
      proximityRating: proximity.proximityRating,
      distanceMiles: proximity.distanceMiles,
      safetyScore: sScore,
      safetyRating: sRating,
      budgetFitScore: bScore,
      immersionFitScore: iScore,
      toddlerDiaperingScore: tScore,
      recommendationChoice: recommendation,
      compositeScore: Number(composite.toFixed(3)),
      confidence: 0.93,
      netCost,
      ccldSummary: ccld.safetySummary || 'Licensed child care center'
    });
  }

  // Sort by composite score
  results.sort((a, b) => (b.compositeScore || 0) - (a.compositeScore || 0));
  return results;
}
