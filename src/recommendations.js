import { searchProfiles, getSiteDetails } from './carewait-client.js';
import { calculateEligibility } from './eligibility.js';
import { ELFA_RATES_FY26_27, ELFA_SOURCE_LIST } from './constants.js';
import { evaluateProximity } from './geo-utils.js';
import { ccldFacilityUrl, isVerifiedLicensedFacility } from './ccld-utils.js';
import {
  checkClassroomAge,
  detectRateBasis,
  getCareSupportEvidence,
  getProviderSubsidyEligibility,
  getPublishedMonthlyRate,
  isRateSafeForBudget,
  estimateOutOfPocket,
  rankCandidates
} from './recommendation-utils.js';

// "Either" means either licensed setting. License-exempt programs have no CCLD record to
// verify, so they are left out rather than crowding licensed programs out of the batch.
const LICENSED_PROGRAM_TYPES = ['licensedCenter', 'licensedFamilyChildCare'];

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
    childIsPottyTrained,
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
    programType: programType === 'any' ? LICENSED_PROGRAM_TYPES : programType,
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
      const rateBasis = detectRateBasis(site.rateNotes);
      const postCredit = rateBasis === 'post_credit';
      const subsidyEligibilityStatus = getProviderSubsidyEligibility(
        site.financialAid,
        activeTier,
        site.financialAidStatus
      );
      const subsidyEligible = subsidyEligibilityStatus === 'eligible';
      const postCreditConflict = postCredit && !subsidyEligible;
      // A private-pay family has no ELFA tier to conflict with: the provider simply does not
      // publish the tuition that family would pay.
      const privatePayRateUnpublished = postCreditConflict && activeTier === 'privatePay';
      const hasCompleteRate = isRateSafeForBudget(rate.status) && !postCreditConflict;
      const freeTier = activeTier === 'freeTuitionELFA' && subsidyEligible;
      const appliedSubsidyAmount = subsidyEligible && !postCredit && !freeTier
        ? subsidyAmount
        : 0;
      // Post-credit amounts are not gross tuition, so gross stays unknown for those providers.
      const grossTuition = postCredit ? null : rate.conservativeGross;
      const costEstimate = postCreditConflict
        ? {
            min: null,
            max: null,
            estimate: null,
            basis: privatePayRateUnpublished
              ? 'private_pay_rate_not_published'
              : 'provider_aid_and_post_credit_rate_conflict'
          }
        : estimateOutOfPocket(rate, appliedSubsidyAmount, freeTier, rateBasis);
      const netMonthly = costEstimate.estimate;
      let costEstimateBasis;
      if (freeTier) {
        costEstimateBasis = 'ELFA free-tuition copay, conditional on an approved award and available funded slot';
      } else if (privatePayRateUnpublished) {
        costEstimateBasis = 'Provider publishes only amounts families pay after the ELFA credit, so its private-pay tuition is not published; verify the rate with the provider';
      } else if (postCreditConflict) {
        costEstimateBasis = 'Provider rate notes mention an ELFA-adjusted amount, but this provider does not confirm the selected ELFA tier; verify the applicable rate';
      } else if (!hasCompleteRate) {
        costEstimateBasis = 'Unverified or incomplete published rate';
      } else if (postCredit) {
        costEstimateBasis = 'Provider publishes the amount families pay after the ELFA credit; upper end used for budget fit, credit not subtracted again';
      } else if (subsidyEligible) {
        costEstimateBasis = 'Published CareWait rate minus the provider-confirmed applicable ELFA credit; upper end used for budget fit';
      } else if (activeTier === 'privatePay') {
        costEstimateBasis = 'Published CareWait rate; no ELFA credit assumed';
      } else if (subsidyEligibilityStatus === 'not_listed') {
        costEstimateBasis = 'Provider does not list the selected ELFA tier; no credit applied to the published rate';
      } else {
        costEstimateBasis = 'Provider ELFA eligibility is unknown; no credit applied to the published rate';
      }

      const ccld = site.ccldInspection || null;
      const ccldVerificationStatus = ccld?.verificationStatus || 'unavailable';
      const inspectionDataStatus = ccld?.inspectionDataStatus || 'unavailable';
      const licenseStatus = ccld?.status || null;
      const ccldVerified = isVerifiedLicensedFacility(ccld);
      const supportEvidence = getCareSupportEvidence(site.accommodations || []);
      const diaperingStatus = site.diaperingStatus === 'confirmed' ||
        site.diaperingAccommodated === true || supportEvidence.diaperingStatus === 'confirmed'
        ? 'confirmed'
        : 'unknown';
      const pottyTrainingStatus = site.pottyTrainingStatus === 'confirmed' ||
        supportEvidence.pottyTrainingStatus === 'confirmed'
        ? 'confirmed'
        : 'unknown';
      // Diaper-change evidence is required whenever the family says the child is not potty
      // trained, and for toddlers whose status is unknown; toilet training is never assumed
      // from a preschool age when the family has said otherwise. Infant care is not gated here.
      const needsDiaperChanges = ageCategory === 'toddler'
        ? childIsPottyTrained !== true
        : (ageCategory === 'preschool' && childIsPottyTrained === false);
      const reportCareEvidence = ageCategory === 'toddler' || needsDiaperChanges;
      const diaperingFitStatus = !needsDiaperChanges
        ? 'not_required'
        : (diaperingStatus === 'confirmed'
          ? 'confirmed'
          : (pottyTrainingStatus === 'confirmed'
            ? 'potty_training_only_diapering_unconfirmed'
            : 'unknown'));
      const userLocation = homeZipCode || homeLocation;
      const proximity = evaluateProximity(site.zipCode, site.location, userLocation);
      const licenseNumbers = site.licenseNumbers || (site.licenseNumber ? [site.licenseNumber] : []);

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
        financialAid: site.financialAid || [],
        programs: (site.programsOffered || []).map((program) =>
          program.name + ' (' + program.minAgeMonths + '-' + program.maxAgeMonths + ' mo)'
        ),
        ageFitStatus: ageFit.status,
        grossMonthlyTuition: grossTuition,
        grossMonthlyTuitionMin: postCredit ? null : rate.min,
        grossMonthlyTuitionMax: postCredit ? null : rate.max,
        rateBasis,
        publishedMonthlyMin: rate.min,
        publishedMonthlyMax: rate.max,
        monthlySubsidyCredit: subsidyEligible ? subsidyAmount : 0,
        monthlySubsidyCreditAppliedToRate: appliedSubsidyAmount,
        scheduledMonthlySubsidyCredit: subsidyAmount,
        subsidyEligibilityStatus,
        estimatedNetOutOfPocketMonthly: netMonthly,
        estimatedNetOutOfPocketMonthlyMin: costEstimate.min,
        estimatedNetOutOfPocketMonthlyMax: costEstimate.max,
        costEstimateBasis,
        rateStatus: privatePayRateUnpublished
          ? 'unverified_private_pay_rate'
          : (postCreditConflict ? 'conflicting_rate_and_aid_data' : rate.status),
        rateNotes: site.rateNotes || '',
        schedule: site.schedule || [],
        description: site.description || '',
        licenseNumber: site.licenseNumber,
        licenseNumbers,
        ccldFacilityUrls: licenseNumbers.map(ccldFacilityUrl).filter(Boolean),
        licenseStatus,
        ccldVerificationStatus,
        inspectionDataStatus,
        safetySummary: ccld?.safetySummary || 'CCLD inspection history is unavailable or incomplete.',
        ccldInspection: ccld,
        diaperingAccommodated: diaperingStatus === 'confirmed',
        diaperingStatus,
        pottyTrainingStatus,
        diaperingFitStatus,
        diaperingEvidenceScore: reportCareEvidence
          ? (site.diaperingEvidenceScore ?? (diaperingStatus === 'confirmed' ? 100 : 25))
          : null,
        pottyTrainingEvidenceScore: reportCareEvidence
          ? (site.pottyTrainingEvidenceScore ?? (pottyTrainingStatus === 'confirmed' ? 100 : 25))
          : null,
        diaperingEvidenceSource: site.diaperingEvidenceSource ||
          supportEvidence.diaperingEvidenceSource ||
          (diaperingStatus === 'confirmed' ? 'Provider detail record' : null),
        pottyTrainingEvidenceSource: site.pottyTrainingEvidenceSource ||
          supportEvidence.pottyTrainingEvidenceSource ||
          (pottyTrainingStatus === 'confirmed' ? 'Provider detail record' : null),
        distanceMiles: proximity.distanceMiles,
        proximityRating: proximity.proximityRating,
        proximityLevel: proximity.proximityLevel,
        isImmediateNeighborhood: proximity.isImmediateNeighborhood,
        _hasCompleteRate: hasCompleteRate,
        _ccldVerified: ccldVerified,
        _diaperingVerified: diaperingFitStatus === 'confirmed' || diaperingFitStatus === 'not_required'
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
    .filter((candidate) => !candidate._diaperingVerified)
    .sort((a, b) => (a.distanceMiles ?? 99) - (b.distanceMiles ?? 99));

  const publicCandidates = (candidates) => candidates.map(({
    _hasCompleteRate,
    _ccldVerified,
    _diaperingVerified,
    ...candidate
  }) => candidate);

  return {
    childAgeYears,
    childIsPottyTrained: childIsPottyTrained ?? null,
    ageCategory,
    subsidyBenefitTier: activeTier,
    monthlySubsidyDiscount: subsidyAmount,
    potentialMonthlySubsidyDiscount: subsidyAmount,
    monthlySubsidyDiscountBasis: activeTier === 'privatePay'
      ? 'No ELFA credit assumed.'
      : 'Potential DEC credit; applied to a provider only when its detail record lists the selected tier.',
    // DEC documents behind the tier and credit amounts. Provider facts come from CareWait and CCLD.
    subsidySources: ELFA_SOURCE_LIST,
    targetBudgetMonthly,
    homeLocation: userLoc || null,
    preferredLanguage: preferredLanguage || 'Any',
    programTypePreference: programType,
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
