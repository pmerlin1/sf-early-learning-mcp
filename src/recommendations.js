import { searchProfiles, getSiteDetails } from './carewait-client.js';
import { calculateEligibility } from './eligibility.js';
import { ELFA_RATES_FY26_27 } from './constants.js';
import { evaluateProximity } from './geo-utils.js';
import { isVerifiedLicensedFacility } from './ccld-utils.js';
import {
  checkClassroomAge,
  getPublishedMonthlyRate,
  isRateSafeForBudget,
  estimateOutOfPocket,
  rankCandidates
} from './recommendation-utils.js';

function normalizeTier(tier) {
  if (tier === 'elfaHalfCredit' || tier === 'halfCreditELFA') return 'halfCreditELFA';
  if (tier === 'elfaFullCredit' || tier === 'fullCreditELFA') return 'fullCreditELFA';
  if (
    tier === 'elfaFreeTuition' ||
    tier === 'cctrStateAndElfaFree' ||
    tier === 'freeTuitionELFA'
  ) return 'freeTuitionELFA';
  return 'privatePay';
}

function subsidyForTier(tier, ageCategory) {
  if (tier === 'halfCreditELFA') {
    return ELFA_RATES_FY26_27.halfCreditMonthly[ageCategory];
  }
  if (tier === 'fullCreditELFA' || tier === 'freeTuitionELFA') {
    return ELFA_RATES_FY26_27.fullTimeMonthlyReimbursement[ageCategory].rate;
  }
  return 0;
}

export async function getRecommendations(
  params = {},
  { search = searchProfiles, getDetails = getSiteDetails } = {}
) {
  const {
    childAgeYears = 2.1,
    familySize = 3,
    monthlyIncome,
    annualIncome,
    benefitTier,
    targetBudgetMonthly = 1200,
    preferredLanguage,
    homeZipCode,
    homeLocation,
    programType = 'licensedCenter',
    schedule,
    maxResults = 10
  } = params;

  const childMonths = Number(childAgeYears) * 12;
  if (!Number.isFinite(childMonths) || childMonths < 0) {
    throw new Error('childAgeYears must be a non-negative number.');
  }
  if (!Number.isFinite(Number(targetBudgetMonthly)) || Number(targetBudgetMonthly) < 0) {
    throw new Error('targetBudgetMonthly must be a non-negative number.');
  }

  const ageCategory = childMonths < 24 ? 'infant' : (childMonths < 36 ? 'toddler' : 'preschool');

  let activeTier = 'privatePay';
  if (monthlyIncome !== undefined || annualIncome !== undefined) {
    const eligibility = calculateEligibility({
      familySize,
      monthlyIncome,
      annualIncome,
      childAgeYears
    });
    activeTier = normalizeTier(eligibility.tier);
  } else if (benefitTier) {
    activeTier = normalizeTier(benefitTier);
  }

  const subsidyAmount = subsidyForTier(activeTier, ageCategory);
  const searchFilter = {
    ageYears: Math.floor(childAgeYears),
    programType,
    financialAid: activeTier !== 'privatePay' ? [activeTier] : undefined,
    language: preferredLanguage,
    schedule: schedule ? [schedule] : undefined,
    take: 50
  };

  const searchRes = await search(searchFilter);
  const items = searchRes.items || [];
  const detailedCandidates = [];
  const lookupWarnings = [];
  const candidateBatch = items.slice(0, 25);

  for (const item of candidateBatch) {
    try {
      const site = await getDetails(item.entityId);
      if (!site) {
        lookupWarnings.push({
          entityId: item.entityId,
          reason: 'provider_details_missing'
        });
        continue;
      }

      const ageFit = checkClassroomAge(childMonths, site.programsOffered);
      if (ageFit.status === 'incompatible') continue;

      if (preferredLanguage) {
        const preferred = preferredLanguage.toLowerCase();
        const siteLanguages = (site.languages || []).map((language) => String(language).toLowerCase());
        const description = String(site.description || '').toLowerCase();
        const name = String(site.name || '').toLowerCase();
        const hasLanguage = siteLanguages.some((language) => language.includes(preferred)) ||
          description.includes(preferred) ||
          name.includes(preferred);
        if (!hasLanguage) continue;
      }

      const rate = getPublishedMonthlyRate(site.monthlyRates, ageCategory);
      const hasCompleteRate = isRateSafeForBudget(rate.status);
      const freeTier = activeTier === 'freeTuitionELFA';
      const grossTuition = rate.conservativeGross;
      const costEstimate = estimateOutOfPocket(rate, subsidyAmount, freeTier);
      const netMonthly = costEstimate.estimate;
      const costEstimateBasis = freeTier
        ? 'ELFA free-tuition copay, conditional on an approved award and available funded slot'
        : (hasCompleteRate
          ? 'Published CareWait rate minus the applicable ELFA credit; upper end used for budget fit'
          : 'Unverified or incomplete published rate');

      const ccld = site.ccldInspection || null;
      const ccldVerificationStatus = ccld?.verificationStatus || 'unavailable';
      const inspectionDataStatus = ccld?.inspectionDataStatus || 'unavailable';
      const licenseStatus = ccld?.status || null;
      const ccldVerified = isVerifiedLicensedFacility(ccld);
      const diaperingStatus = ageCategory !== 'toddler'
        ? 'not_required'
        : ((site.diaperingStatus === 'confirmed' || site.diaperingAccommodated === true)
          ? 'confirmed'
          : 'unknown');
      const userLocation = homeZipCode || homeLocation;
      const proximity = evaluateProximity(site.zipCode, site.location, userLocation);

      detailedCandidates.push({
        entityId: site.entityId,
        name: site.name,
        address: site.address,
        zipCode: site.zipCode,
        location: site.location,
        phone: site.phone,
        email: site.email,
        programType: site.programType,
        languages: site.languages || [],
        programs: (site.programsOffered || []).map((program) =>
          program.name + ' (' + program.minAgeMonths + '-' + program.maxAgeMonths + ' mo)'
        ),
        ageFitStatus: ageFit.status,
        grossMonthlyTuition: grossTuition,
        grossMonthlyTuitionMin: rate.min,
        grossMonthlyTuitionMax: rate.max,
        monthlySubsidyCredit: subsidyAmount,
        estimatedNetOutOfPocketMonthly: netMonthly,
        estimatedNetOutOfPocketMonthlyMin: costEstimate.min,
        estimatedNetOutOfPocketMonthlyMax: costEstimate.max,
        costEstimateBasis,
        rateStatus: rate.status,
        rateNotes: site.rateNotes || '',
        schedule: site.schedule || [],
        description: site.description || '',
        licenseNumber: site.licenseNumber,
        licenseStatus,
        ccldVerificationStatus,
        inspectionDataStatus,
        safetySummary: ccld?.safetySummary || 'CCLD inspection history is unavailable or incomplete.',
        ccldInspection: ccld,
        diaperingAccommodated: diaperingStatus === 'confirmed',
        diaperingStatus,
        distanceMiles: proximity.distanceMiles,
        proximityRating: proximity.proximityRating,
        proximityLevel: proximity.proximityLevel,
        isImmediateNeighborhood: proximity.isImmediateNeighborhood,
        _hasCompleteRate: hasCompleteRate,
        _ccldVerified: ccldVerified,
        _diaperingVerified: diaperingStatus === 'confirmed' || diaperingStatus === 'not_required'
      });
    } catch (error) {
      lookupWarnings.push({
        entityId: item.entityId,
        reason: 'provider_details_lookup_failed'
      });
    }
  }

  const userLoc = homeZipCode || homeLocation;
  const eligibleCandidates = detailedCandidates.filter((candidate) => candidate._ccldVerified);
  const rateVerified = eligibleCandidates.filter((candidate) =>
    candidate.ageFitStatus === 'compatible' &&
    candidate._diaperingVerified &&
    candidate._hasCompleteRate &&
    candidate.estimatedNetOutOfPocketMonthly !== null
  );

  const withinBudget = rankCandidates(
    rateVerified.filter((candidate) =>
      candidate.estimatedNetOutOfPocketMonthly <= targetBudgetMonthly
    ),
    userLoc
  );

  const stretchOptions = rankCandidates(
    rateVerified.filter((candidate) =>
      candidate.estimatedNetOutOfPocketMonthly > targetBudgetMonthly
    ),
    null
  );

  const unverifiedRates = detailedCandidates
    .filter((candidate) => !candidate._hasCompleteRate)
    .sort((a, b) => (a.distanceMiles ?? 99) - (b.distanceMiles ?? 99));

  const unverifiedSafety = detailedCandidates
    .filter((candidate) => !candidate._ccldVerified)
    .sort((a, b) => (a.distanceMiles ?? 99) - (b.distanceMiles ?? 99));

  const unverifiedAge = detailedCandidates
    .filter((candidate) => candidate.ageFitStatus === 'unknown')
    .sort((a, b) => (a.distanceMiles ?? 99) - (b.distanceMiles ?? 99));

  const unverifiedDiapering = detailedCandidates
    .filter((candidate) => candidate.diaperingStatus === 'unknown')
    .sort((a, b) => (a.distanceMiles ?? 99) - (b.distanceMiles ?? 99));

  const publicCandidates = (candidates) => candidates.map(({
    _hasCompleteRate,
    _ccldVerified,
    _diaperingVerified,
    ...candidate
  }) => candidate);

  return {
    childAgeYears,
    ageCategory,
    subsidyBenefitTier: activeTier,
    monthlySubsidyDiscount: subsidyAmount,
    targetBudgetMonthly,
    homeLocation: userLoc || null,
    preferredLanguage: preferredLanguage || 'Any',
    totalFound: detailedCandidates.length,
    recommendations: publicCandidates(withinBudget.slice(0, maxResults)),
    stretchOptions: publicCandidates(stretchOptions.slice(0, 3)),
    unverifiedRateCandidates: publicCandidates(unverifiedRates.slice(0, 3)),
    unverifiedSafetyCandidates: publicCandidates(unverifiedSafety.slice(0, 10)),
    unverifiedAgeCandidates: publicCandidates(unverifiedAge.slice(0, 10)),
    unverifiedDiaperingCandidates: publicCandidates(unverifiedDiapering.slice(0, 10)),
    lookupWarnings
  };
}
