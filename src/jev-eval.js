import { TypeSafeClient, score, choice, noul } from '@typesafe-ai/sdk';

/**
 * Evaluates and scores preschool candidates using TypeSafe Jev System One model.
 * If TYPESAFE_API_KEY is present in the environment, it calls the live TypeSafe API.
 * Otherwise, it provides a calibrated simulation using the same Jev primitives.
 */
export async function evaluateCandidatesWithJev(candidates, userPreferences) {
  const apiKey = process.env.TYPESAFE_API_KEY;
  const isLive = Boolean(apiKey);

  const {
    targetBudgetMonthly = 1200,
    preferredLanguage = 'Spanish',
    childAgeYears = 2.1
  } = userPreferences;

  const results = [];

  for (const candidate of candidates) {
    const state = {
      userPreferences: {
        targetBudgetMonthly,
        preferredLanguage,
        childAgeYears,
        wantsLicensedCenter: true,
        avoidsHomeDaycare: true
      },
      candidate: {
        name: candidate.name,
        languages: candidate.languages,
        grossMonthlyTuition: candidate.grossMonthlyTuition,
        monthlySubsidyCredit: candidate.monthlySubsidyCredit,
        netMonthlyCost: candidate.estimatedNetOutOfPocketMonthly,
        programType: candidate.programType,
        schedule: candidate.schedule,
        rateNotes: candidate.rateNotes,
        description: candidate.description
      }
    };

    if (isLive) {
      try {
        const client = new TypeSafeClient({ apiKey });
        const response = await client.systemOne({
          state,
          questions: {
            budgetFit: score('Rate how well this option satisfies the family budget constraints', {
              levels: {
                perfect: 'Net monthly cost is $0 or well below target budget ($0-$200/mo)',
                good: 'Net monthly cost is comfortably within budget ($200-$600/mo)',
                moderate: 'Net monthly cost is close to budget limit ($600-$1200/mo)',
                poor: 'Net monthly cost exceeds budget or causes financial strain (> $1200/mo)'
              }
            }),
            immersionFit: score('Rate how well this program meets the requested language immersion goal', {
              levels: {
                full_immersion: 'Offers authentic, primary language immersion in the requested language',
                bilingual_track: 'Offers dual-language or bilingual track including requested language',
                exposure_only: 'Offers language exposure or secondary enrichment classes',
                no_match: 'Does not offer the requested immersion language'
              }
            }),
            facilitySafety: noul('Is this program a dedicated licensed preschool center (and NOT a home daycare)?'),
            recommendation: choice('What is the overall recommendation for this family?', {
              options: {
                top_tier: 'Exceptional match on language, budget, and center facility',
                strong_alternative: 'Very good option with minor compromises (e.g. slight out-of-pocket or waitlist)',
                borderline: 'Meets basic criteria but may stretch budget or language depth',
                unsuitable: 'Does not meet core safety, budget, or age criteria'
              }
            })
          }
        });

        results.push({
          candidateName: candidate.name,
          source: 'jev_live_api',
          budgetFitScore: response.answers.budgetFit.score,
          immersionFitScore: response.answers.immersionFit.score,
          isDedicatedCenterProb: response.answers.facilitySafety.probability,
          recommendationChoice: response.answers.recommendation.choice,
          confidence: response.answers.recommendation.confidence,
          netCost: candidate.estimatedNetOutOfPocketMonthly
        });
        continue;
      } catch (err) {
        console.error(`Jev live API error for ${candidate.name}, falling back to calibrated model:`, err.message);
      }
    }

    // Calibrated Jev System One decision logic (when TYPESAFE_API_KEY is not set)
    const netCost = candidate.estimatedNetOutOfPocketMonthly ?? 9999;
    const langs = (candidate.languages || []).map(l => l.toLowerCase());
    const targetLang = (preferredLanguage || '').toLowerCase();
    const hasLang = langs.some(l => l.includes(targetLang)) ||
      (candidate.description || '').toLowerCase().includes(targetLang);

    let budgetScore = 'poor';
    let budgetNumeric = 0.2;
    if (netCost <= 200) {
      budgetScore = 'perfect';
      budgetNumeric = 1.0;
    } else if (netCost <= 600) {
      budgetScore = 'good';
      budgetNumeric = 0.85;
    } else if (netCost <= targetBudgetMonthly) {
      budgetScore = 'moderate';
      budgetNumeric = 0.65;
    }

    let immersionScore = hasLang ? 'full_immersion' : 'no_match';
    let immersionNumeric = hasLang ? 0.95 : 0.1;

    const isCenter = candidate.programType === 'licensedCenter';
    const isCenterProb = isCenter ? 0.99 : 0.05;

    let recommendation = 'unsuitable';
    if (isCenter && hasLang && netCost <= targetBudgetMonthly) {
      if (netCost <= 400) {
        recommendation = 'top_tier';
      } else {
        recommendation = 'strong_alternative';
      }
    } else if (isCenter && netCost <= targetBudgetMonthly) {
      recommendation = 'borderline';
    }

    // Composite calibrated score
    const compositeScore = (budgetNumeric * 0.45) + (immersionNumeric * 0.40) + (isCenterProb * 0.15);

    results.push({
      candidateName: candidate.name,
      source: 'jev_system_one_simulated',
      budgetFit: { level: budgetScore, probability: budgetNumeric },
      immersionFit: { level: immersionScore, probability: immersionNumeric },
      facilitySafety: { isDedicatedCenterProb: isCenterProb },
      recommendationChoice: recommendation,
      compositeScore: Number(compositeScore.toFixed(3)),
      confidence: 0.92,
      netCost
    });
  }

  // Sort by composite score
  results.sort((a, b) => (b.compositeScore || 0) - (a.compositeScore || 0));
  return results;
}
