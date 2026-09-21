import { searchProfiles, getSiteDetails } from './carewait-client.js';
import { calculateEligibility } from './eligibility.js';
import { ELFA_RATES_FY26_27 } from './constants.js';

export async function getRecommendations(params = {}) {
  const {
    childAgeYears = 2.1,
    familySize = 3,
    monthlyIncome,
    annualIncome,
    benefitTier, // e.g. 'halfCreditELFA', 'freeTuitionELFA', 'fullCreditELFA'
    targetBudgetMonthly = 1200,
    preferredLanguage, // e.g. 'Spanish', 'Mandarin', 'Cantonese', 'French'
    programType = 'licensedCenter',
    schedule, // 'partTime', 'fullTime', or undefined
    maxResults = 10
  } = params;

  // 1. Calculate or extract benefit tier
  let subsidyAmount = 0;
  let activeTier = benefitTier;
  const childMonths = Number(childAgeYears) * 12;
  const ageCategory = childMonths < 24 ? 'infant' : (childMonths < 36 ? 'toddler' : 'preschool');

  if (monthlyIncome !== undefined || annualIncome !== undefined) {
    const el = calculateEligibility({ familySize, monthlyIncome, annualIncome, childAgeYears });
    activeTier = el.tier === 'elfaHalfCredit' ? 'halfCreditELFA' :
                 (el.tier === 'elfaFullCredit' ? 'fullCreditELFA' :
                 (el.tier === 'elfaFreeTuition' ? 'freeTuitionELFA' : 'privatePay'));
    subsidyAmount = el.monthlyCreditAmount;
  } else if (benefitTier) {
    if (benefitTier.includes('half') || benefitTier === 'halfCreditELFA') {
      subsidyAmount = ELFA_RATES_FY26_27.halfCreditMonthly[ageCategory];
      activeTier = 'halfCreditELFA';
    } else if (benefitTier.includes('full') || benefitTier === 'fullCreditELFA') {
      subsidyAmount = ELFA_RATES_FY26_27.fullTimeMonthlyReimbursement[ageCategory].rate;
      activeTier = 'fullCreditELFA';
    } else if (benefitTier.includes('free') || benefitTier === 'freeTuitionELFA') {
      subsidyAmount = 999999; // 100% free
      activeTier = 'freeTuitionELFA';
    }
  } else {
    // Default to ELFA Half Credit if not specified
    subsidyAmount = ELFA_RATES_FY26_27.halfCreditMonthly[ageCategory];
    activeTier = 'halfCreditELFA';
  }

  // 2. Search CareWait for matching profiles
  const searchFilter = {
    ageYears: Math.floor(childAgeYears),
    programType,
    financialAid: activeTier !== 'privatePay' ? [activeTier] : undefined,
    language: preferredLanguage,
    schedule: schedule ? [schedule] : undefined,
    take: 50
  };

  const searchRes = await searchProfiles(searchFilter);
  const items = searchRes.items || [];

  // 3. For the matching search items, inspect details and compute net cost
  const detailedCandidates = [];
  const candidateBatch = items.slice(0, 25);

  for (const item of candidateBatch) {
    try {
      const site = await getSiteDetails(item.entityId);
      if (!site) continue;

      // Check age compatibility
      let acceptsAge = false;
      for (const prog of site.programsOffered) {
        if (prog.minAgeMonths <= childMonths + 0.5 && prog.maxAgeMonths >= childMonths - 0.5) {
          acceptsAge = true;
          break;
        }
      }
      if (!acceptsAge && site.programsOffered.length > 0) {
        // Double check overall min/max
        const minM = Number(site.minAge) * 12;
        const maxM = Number(site.maxAge) * 12;
        if (!isNaN(minM) && !isNaN(maxM) && (childMonths < minM || childMonths > maxM)) {
          continue;
        }
      }

      // Check language fit if preferred
      if (preferredLanguage) {
        const pLangLower = preferredLanguage.toLowerCase();
        const siteLangs = site.languages.map(l => l.toLowerCase());
        const descLower = site.description.toLowerCase();
        const nameLower = site.name.toLowerCase();
        const hasLang = siteLangs.some(l => l.includes(pLangLower)) ||
                        descLower.includes(pLangLower) ||
                        nameLower.includes(pLangLower);
        if (!hasLang) {
          continue;
        }
      }

      // Calculate gross tuition and net out-of-pocket
      const rates = site.monthlyRates;
      let grossTuition = null;
      let rateType = 'unknown';

      if (ageCategory === 'toddler' && rates.toddler && (rates.toddler.max || rates.toddler.min)) {
        grossTuition = rates.toddler.min || rates.toddler.max;
        rateType = 'toddler';
      } else if (rates.preschool && (rates.preschool.max || rates.preschool.min)) {
        grossTuition = rates.preschool.min || rates.preschool.max;
        rateType = 'preschool';
      } else if (ageCategory === 'infant' && rates.infant && (rates.infant.max || rates.infant.min)) {
        grossTuition = rates.infant.min || rates.infant.max;
        rateType = 'infant';
      }

      let netMonthly = null;
      if (activeTier === 'freeTuitionELFA') {
        netMonthly = 0;
      } else if (grossTuition !== null) {
        netMonthly = Math.max(0, grossTuition - subsidyAmount);
      }

      detailedCandidates.push({
        entityId: site.entityId,
        name: site.name,
        address: site.address,
        zipCode: site.zipCode,
        phone: site.phone,
        email: site.email,
        programType: site.programType,
        languages: site.languages,
        programs: site.programsOffered.map(p => `${p.name} (${p.minAgeMonths}-${p.maxAgeMonths} mo)`),
        grossMonthlyTuition: grossTuition,
        monthlySubsidyCredit: subsidyAmount,
        estimatedNetOutOfPocketMonthly: netMonthly,
        rateNotes: site.rateNotes,
        schedule: site.schedule,
        description: site.description,
        licenseNumber: site.licenseNumber,
        ccldInspection: site.ccldInspection,
        diaperingAccommodated: site.diaperingAccommodated
      });
    } catch (e) {
      // skip on error
    }
  }

  // 4. Sort candidates:
  // Prioritize candidates where net out-of-pocket is within budget, then lowest out-of-pocket
  detailedCandidates.sort((a, b) => {
    const costA = a.estimatedNetOutOfPocketMonthly !== null ? a.estimatedNetOutOfPocketMonthly : 99999;
    const costB = b.estimatedNetOutOfPocketMonthly !== null ? b.estimatedNetOutOfPocketMonthly : 99999;
    return costA - costB;
  });

  return {
    childAgeYears,
    ageCategory,
    subsidyBenefitTier: activeTier,
    monthlySubsidyDiscount: subsidyAmount,
    targetBudgetMonthly,
    preferredLanguage: preferredLanguage || 'Any',
    totalFound: detailedCandidates.length,
    recommendations: detailedCandidates.slice(0, maxResults)
  };
}
