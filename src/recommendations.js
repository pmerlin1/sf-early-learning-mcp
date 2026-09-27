import { searchProfiles, getSiteDetails } from './carewait-client.js';
import { calculateEligibility } from './eligibility.js';
import { ELFA_RATES_FY26_27, ELFA_SOURCE_LIST } from './constants.js';
import { evaluateProximity } from './geo-utils.js';
import { ccldFacilityUrl, isVerifiedLicensedFacility } from './ccld-utils.js';
import {
  assertJevConfigured,
  evaluateCandidatesWithJev,
  jevCompositeWeights,
  summarizeJevScoring
} from './jev-eval.js';
import {
  checkClassroomAge,
  detectRateBasis,
  getCareSupportEvidence,
  getProviderSubsidyEligibility,
  getPublishedMonthlyRate,
  isRateSafeForBudget,
  estimateOutOfPocket
} from './recommendation-utils.js';

// "Either" means either licensed setting. License-exempt programs have no CCLD record to
// verify, so they are left out rather than crowding licensed programs out of the batch.
const LICENSED_PROGRAM_TYPES = ['licensedCenter', 'licensedFamilyChildCare'];

const SEARCH_PAGE_SIZE = 50;
const SEARCH_CONCURRENCY = 5;
const DETAIL_CONCURRENCY = Math.max(1, Math.floor(Number(process.env.SFEL_LOOKUP_CONCURRENCY) || 16));
// OpenCode truncates tool results around 50 KB; ten rows leave room for summaries and failures.
export const RECOMMENDATION_PAGE_SIZE = 10;

const byDistance = (a, b) => (a.distanceMiles ?? 99) - (b.distanceMiles ?? 99);

// Highest Jev composite first; ties go to the closer program, then the cheaper one. Programs
// Jev could not score follow the scored ones.
const byJevComposite = (a, b) =>
  (b.jev?.compositeScore ?? -1) - (a.jev?.compositeScore ?? -1) ||
  byDistance(a, b) ||
  a.estimatedNetOutOfPocketMonthly - b.estimatedNetOutOfPocketMonthly;

// Jev's verdicts in words a family can read in a table.
const RECOMMENDATION_LABELS = {
  top_tier: 'Top pick',
  strong_alternative: 'Strong option',
  caution_flagged: 'Review first',
  unsuitable: 'Poor fit',
  needs_verification: 'Needs verification'
};

const roundTo2 = (value) => (Number.isFinite(value) ? Number(value.toFixed(2)) : null);

// Some providers paste whole fee schedules into their rate notes; get_childcare_details keeps
// the full text.
const RATE_NOTES_LIMIT = 200;
const PUBLIC_FAILURE_TEXT_LIMIT = 160;

function compactFailure(failure) {
  const compacted = { ...failure };
  for (const key of ['error', 'reason']) {
    if (typeof compacted[key] === 'string' && compacted[key].length > PUBLIC_FAILURE_TEXT_LIMIT) {
      compacted[key] = compacted[key].slice(0, PUBLIC_FAILURE_TEXT_LIMIT) + '…';
      compacted[`${key}Truncated`] = true;
    }
  }
  return compacted;
}

function priceRange(values) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
  return { min: sorted[0], median: Math.round(median), max: sorted[sorted.length - 1] };
}

// What an agent needs to present each program. Jev saw the full record, including the
// provider's description; get_childcare_details and get_state_licensing_record return the rest.
// Keeping each program small keeps the whole list in one readable tool result.
function publicCandidate({
  _hasCompleteRate,
  _ccldVerified,
  description,
  location,
  ccldInspection,
  financialAid,
  ...candidate
}) {
  const rateNotes = String(candidate.rateNotes || '');
  const compact = (value, limit) => {
    const text = String(value || '');
    return text.length > limit ? text.slice(0, limit) + '…' : text;
  };
  const jev = candidate.jev ? { ...candidate.jev } : null;
  // coverage.jevFailed is the canonical place for the reason; avoid repeating it on every
  // failed Jev row as well as in the global coverage summary.
  if (jev?.status === 'failed') delete jev.error;

  return {
    entityId: candidate.entityId,
    name: candidate.name,
    address: candidate.address,
    zipCode: candidate.zipCode,
    phone: candidate.phone,
    email: candidate.email,
    website: candidate.website,
    programType: candidate.programType,
    languages: candidate.languages,
    financialAid: (financialAid || []).map((aid) => (aid && typeof aid === 'object' ? aid.code : aid)),
    programs: candidate.programs,
    ageFitStatus: candidate.ageFitStatus,
    grossMonthlyTuition: candidate.grossMonthlyTuition,
    grossMonthlyTuitionMin: candidate.grossMonthlyTuitionMin,
    grossMonthlyTuitionMax: candidate.grossMonthlyTuitionMax,
    rateBasis: candidate.rateBasis,
    monthlySubsidyCredit: candidate.monthlySubsidyCredit,
    monthlySubsidyCreditAppliedToRate: candidate.monthlySubsidyCreditAppliedToRate,
    scheduledMonthlySubsidyCredit: candidate.scheduledMonthlySubsidyCredit,
    subsidyEligibilityStatus: candidate.subsidyEligibilityStatus,
    estimatedNetOutOfPocketMonthly: candidate.estimatedNetOutOfPocketMonthly,
    estimatedNetOutOfPocketMonthlyMin: candidate.estimatedNetOutOfPocketMonthlyMin,
    estimatedNetOutOfPocketMonthlyMax: candidate.estimatedNetOutOfPocketMonthlyMax,
    costEstimateBasis: compact(candidate.costEstimateBasis, 120),
    rateStatus: candidate.rateStatus,
    rateNotes: rateNotes.length > RATE_NOTES_LIMIT ? rateNotes.slice(0, RATE_NOTES_LIMIT) + '…' : rateNotes,
    schedule: candidate.schedule,
    licenseNumber: candidate.licenseNumber,
    licenseNumbers: candidate.licenseNumbers,
    ccldFacilityUrls: candidate.ccldFacilityUrls,
    licenseStatus: candidate.licenseStatus,
    ccldVerificationStatus: candidate.ccldVerificationStatus,
    inspectionDataStatus: candidate.inspectionDataStatus,
    safetySummary: compact(candidate.safetySummary, 120),
    ccldInspection: ccldInspection
      ? {
          rating: ccldInspection.rating ?? null,
          status: ccldInspection.status ?? null,
          totalTypeA: ccldInspection.totalTypeA ?? null,
          totalTypeB: ccldInspection.totalTypeB ?? null,
          complaintVisits: ccldInspection.complaintVisits ?? null,
          substantiatedAllegations: ccldInspection.substantiatedAllegations ?? null,
          lastVisitDate: ccldInspection.lastVisitDate ?? null
        }
      : null,
    diaperingStatus: candidate.diaperingStatus,
    pottyTrainingStatus: candidate.pottyTrainingStatus,
    diaperingFitStatus: candidate.diaperingFitStatus,
    diaperingEvidenceScore: candidate.diaperingEvidenceScore,
    pottyTrainingEvidenceScore: candidate.pottyTrainingEvidenceScore,
    diaperingEvidenceSource: candidate.diaperingEvidenceSource,
    pottyTrainingEvidenceSource: candidate.pottyTrainingEvidenceSource,
    distanceMiles: candidate.distanceMiles,
    proximityRating: candidate.proximityRating,
    ...(jev ? { jev } : {})
  };
}

function jevSummaryFor(judgment) {
  if (!judgment) return null;
  if (judgment.source !== 'jev_live_api') {
    return {
      status: judgment.source === 'jev_failed' ? 'failed' : judgment.source,
      error: judgment.error ?? null,
      compositeScore: null
    };
  }
  const scoreFor = {
    location: judgment.locationConvenienceScore,
    safety: judgment.safetyScore,
    budget: judgment.budgetFitScore,
    immersion: judgment.immersionFitScore
  };
  return {
    status: 'scored',
    compositeScore: judgment.compositeScore,
    compositeCoverage: judgment.compositeCoverage,
    missingScoreCriteria: judgment.missingScoreCriteria,
    // Expected 0-3 rubric scores for the criteria in the composite.
    scores: Object.fromEntries(Object.keys(judgment.compositeWeights || {}).map((criterion) => [
      criterion,
      scoreFor[criterion] == null ? null : Number(Number(scoreFor[criterion]).toFixed(2))
    ])),
    recommendation: judgment.recommendationChoice,
    recommendationLabel: RECOMMENDATION_LABELS[judgment.recommendationChoice] ?? null,
    recommendationConfidence: roundTo2(judgment.confidence),
    recommendationProbabilities: judgment.probabilities
      ? Object.fromEntries(Object.entries(judgment.probabilities).map(([label, p]) => [label, roundTo2(p)]))
      : null
  };
}

async function mapWithConcurrency(items, concurrency, fn) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

function describeError(error) {
  const name = error?.name || 'Error';
  const status = error?.status == null ? '' : ` (HTTP ${error.status})`;
  return `${name}${status}: ${String(error?.message || error).slice(0, 300)}`;
}

async function searchAllPages(search, filter, onProgress) {
  const pages = [];
  let requestsFinished = 0;
  let programsFound = 0;
  const report = (totalPages) => onProgress?.({
    stage: 'searching',
    searchPagesFinished: requestsFinished,
    searchPagesTotal: totalPages,
    programsFound
  });
  const fetchPage = async (pageIndex) => {
    const response = await search({
      ...filter,
      skip: pageIndex * SEARCH_PAGE_SIZE,
      take: SEARCH_PAGE_SIZE
    });
    return {
      pageIndex,
      items: Array.isArray(response?.items) ? response.items : [],
      total: response?.total,
      error: null
    };
  };

  let first;
  try {
    first = await fetchPage(0);
  } catch (error) {
    throw error;
  }
  pages.push(first);
  requestsFinished = 1;
  programsFound = first.items.length;
  const parsedTotal = first.total == null || first.total === '' ? null : Number(first.total);
  const reportedTotal = Number.isFinite(parsedTotal) && parsedTotal >= 0
    ? Math.floor(parsedTotal)
    : null;

  if (reportedTotal !== null) {
    const pageCount = Math.max(1, Math.ceil(reportedTotal / SEARCH_PAGE_SIZE));
    report(pageCount);
    const laterPages = await mapWithConcurrency(
      Array.from({ length: pageCount - 1 }, (_, index) => index + 1),
      SEARCH_CONCURRENCY,
      async (pageIndex) => {
        try {
          const result = await fetchPage(pageIndex);
          requestsFinished += 1;
          programsFound += result.items.length;
          report(pageCount);
          return result;
        } catch (error) {
          requestsFinished += 1;
          report(pageCount);
          return { pageIndex, items: [], error };
        }
      }
    );
    pages.push(...laterPages);
  } else {
    // When CareWait omits a total, continue until a short page proves that the scan is done.
    // If pagination stops advancing, surface an incomplete scan instead of looping forever.
    const seenIds = new Set(first.items.map((item) => item?.entityId).filter(Boolean));
    report(null);
    while (pages.at(-1).items.length === SEARCH_PAGE_SIZE) {
      const pageIndex = pages.length;
      try {
        const result = await fetchPage(pageIndex);
        const newIds = new Set(result.items
          .map((item) => item?.entityId)
          .filter((entityId) => entityId && !seenIds.has(entityId)));
        for (const entityId of newIds) seenIds.add(entityId);
        pages.push(result);
        requestsFinished += 1;
        programsFound += result.items.length;
        if (result.items.length > 0 && newIds.size === 0) {
          result.error = new Error(
            'CareWait pagination returned programs but no new IDs; the search is incomplete.'
          );
        }
      } catch (error) {
        pages.push({ pageIndex, items: [], error });
        requestsFinished += 1;
      }
      report(null);
      if (pages.at(-1).error) break;
    }
  }

  const collect = () => {
    const items = [];
    const seen = new Set();
    let duplicateMatches = 0;
    for (const page of pages.slice().sort((a, b) => a.pageIndex - b.pageIndex)) {
      for (const item of page.items) {
        if (!item?.entityId || seen.has(item.entityId)) {
          duplicateMatches += 1;
          continue;
        }
        seen.add(item.entityId);
        items.push(item);
      }
    }
    return { items, duplicateMatches };
  };

  let collected = collect();
  const needsRecovery = pages.some((page) => page.error) ||
    (reportedTotal !== null && collected.items.length !== reportedTotal);
  let retriedMissingRanges = false;
  if (needsRecovery && reportedTotal !== null) {
    // Retry the search ranges once if any page failed or CareWait's unique count disagrees.
    retriedMissingRanges = true;
    const pageCount = Math.max(1, Math.ceil(reportedTotal / SEARCH_PAGE_SIZE));
    const retries = await mapWithConcurrency(
      Array.from({ length: pageCount }, (_, index) => index),
      SEARCH_CONCURRENCY,
      async (pageIndex) => {
        try {
          const result = await fetchPage(pageIndex);
          requestsFinished += 1;
          programsFound += result.items.length;
          report(pageCount);
          return result;
        } catch (error) {
          requestsFinished += 1;
          report(pageCount);
          return { pageIndex, items: [], error };
        }
      }
    );
    const retryByIndex = new Map(retries.map((page) => [page.pageIndex, page]));
    for (let index = 0; index < pages.length; index += 1) {
      if (retryByIndex.has(pages[index].pageIndex)) pages[index] = retryByIndex.get(pages[index].pageIndex);
    }
    collected = collect();
  }

  const errors = pages.filter((page) => page.error).map((page) => ({
    skip: page.pageIndex * SEARCH_PAGE_SIZE,
    error: describeError(page.error)
  }));
  const inferredTotal = reportedTotal === null && !errors.length &&
    collected.duplicateMatches === 0 && pages.at(-1)?.items.length < SEARCH_PAGE_SIZE
    ? collected.items.length
    : null;
  const total = reportedTotal ?? inferredTotal;
  return {
    items: collected.items,
    total,
    reportedTotal,
    pagesRequested: requestsFinished,
    pagesSucceeded: pages.filter((page) => !page.error).length,
    errors,
    duplicateMatches: collected.duplicateMatches,
    retriedMissingRanges,
    complete: total !== null && collected.items.length === total && errors.length === 0
  };
}

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

async function buildRecommendations(
  params = {},
  { search = searchProfiles, getDetails = getSiteDetails, evaluate, onProgress } = {}
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
  } = params;

  const childMonths = Number(childAgeYears) * 12;
  if (!Number.isFinite(childMonths) || childMonths < 0) {
    throw new Error('childAgeYears must be a non-negative number.');
  }
  if (!Number.isFinite(Number(targetBudgetMonthly)) || Number(targetBudgetMonthly) < 0) {
    throw new Error('targetBudgetMonthly must be a non-negative number.');
  }
  // Recommendations are Jev's: without a key, fail before any provider lookups.
  if (!evaluate) assertJevConfigured();
  const scoreWithJev = evaluate || evaluateCandidatesWithJev;

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
  const userLoc = homeZipCode || homeLocation;
  const searchFilter = {
    ageYears: Math.floor(childAgeYears),
    programType: programType === 'any' ? LICENSED_PROGRAM_TYPES : programType,
    financialAid: activeTier !== 'privatePay' ? [activeTier] : undefined,
    language: preferredLanguage,
    schedule: schedule ? [schedule] : undefined
  };

  onProgress?.({ stage: 'searching', programsFound: 0, programsChecked: 0, programsScored: 0 });
  const searchResult = await searchAllPages(search, searchFilter, onProgress);
  const candidateBatch = searchResult.items;
  const searchScope = {
    citywide: true,
    zipCodes: [],
    locationPrioritized: Boolean(userLoc),
    careWaitMatches: searchResult.total
  };
  const detailLookupsFailed = [];
  const programProcessingFailed = [];
  const ccldUnavailable = [];
  const excluded = {
    classroomAgeDoesNotFit: 0,
    preferredLanguageNotListed: 0
  };
  let programsChecked = 0;
  onProgress?.({
    stage: 'checking_providers',
    programsFound: candidateBatch.length,
    programsTotal: searchResult.total,
    programsChecked,
    programsScored: 0
  });

  const detailedCandidates = (await mapWithConcurrency(
    candidateBatch,
    DETAIL_CONCURRENCY,
    async (item) => {
      let site;
      try {
        site = await getDetails(item.entityId);
      } catch (error) {
        const warning = {
          entityId: item.entityId,
          reason: 'provider_details_lookup_failed',
          error: describeError(error)
        };
        detailLookupsFailed.push(warning);
        return null;
      }
      if (!site) {
        const warning = {
          entityId: item.entityId,
          reason: 'provider_details_missing',
          error: 'CareWait returned no provider detail record.'
        };
        detailLookupsFailed.push(warning);
        return null;
      }

      programsChecked += 1;
      onProgress?.({
        stage: 'checking_providers',
        programsFound: candidateBatch.length,
        programsTotal: searchResult.total,
        programsChecked,
        programsScored: 0
      });

      try {
      const inspections = Array.isArray(site.ccldInspections)
        ? site.ccldInspections
        : (site.ccldInspection ? [site.ccldInspection] : []);
      for (const record of inspections) {
        if (record?.verificationStatus === 'unavailable' || record?.inspectionDataStatus === 'unavailable') {
          ccldUnavailable.push({
            entityId: item.entityId,
            licenseNumber: record.licenseNumber || null,
            reason: record.safetySummary || 'CCLD inspection lookup unavailable.'
          });
        }
      }

      const ageFit = checkClassroomAge(childMonths, site.programsOffered);
      if (ageFit.status === 'incompatible') {
        excluded.classroomAgeDoesNotFit += 1;
        return null;
      }

      if (preferredLanguage) {
        const preferred = String(preferredLanguage).toLowerCase();
        const siteLanguages = (Array.isArray(site.languages) ? site.languages : [])
          .map((language) => String(language).toLowerCase());
        const description = String(site.description || '').toLowerCase();
        const name = String(site.name || '').toLowerCase();
        const hasLanguage = siteLanguages.some((language) => language.includes(preferred)) ||
          description.includes(preferred) ||
          name.includes(preferred);
        if (!hasLanguage) {
          excluded.preferredLanguageNotListed += 1;
          return null;
        }
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
        // Diapering accommodation is tracked for informational reference and tours; it does not
        // gate preschool options since CareWait accommodation flags are rarely populated (<2%).
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
        const proximity = evaluateProximity(site.zipCode, site.location, userLoc);
        const licenseNumbers = site.licenseNumbers || (site.licenseNumber ? [site.licenseNumber] : []);

        return {
          entityId: site.entityId,
          name: site.name,
          address: site.address,
          zipCode: site.zipCode,
          location: site.location,
          phone: site.phone,
          email: site.email,
          website: site.website || '',
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
          _ccldVerified: ccldVerified
        };
      } catch (error) {
        programProcessingFailed.push({
          entityId: item.entityId,
          reason: 'provider_details_processing_failed',
          error: describeError(error)
        });
        excluded.providerDetailsCouldNotBeProcessed =
          (excluded.providerDetailsCouldNotBeProcessed || 0) + 1;
        return null;
      }
    }
  )).filter(Boolean);

  const eligibleCandidates = detailedCandidates.filter((candidate) => candidate._ccldVerified);
  const rateVerified = eligibleCandidates.filter((candidate) =>
    candidate.ageFitStatus === 'compatible' &&
    candidate._hasCompleteRate &&
    candidate.estimatedNetOutOfPocketMonthly !== null
  );

  // Code settles the facts: a current license with a complete CCLD record, classroom age fit,
  // and a published rate. Jev then scores every program that passes, within budget or not, and
  // its composite sets the order of both lists.
  const withinBudgetPool = rateVerified
    .filter((candidate) => candidate.estimatedNetOutOfPocketMonthly <= targetBudgetMonthly)
    .sort(byDistance);
  const overBudgetPool = rateVerified
    .filter((candidate) => candidate.estimatedNetOutOfPocketMonthly > targetBudgetMonthly)
    .sort(byDistance);
  const toScore = [...withinBudgetPool, ...overBudgetPool];
  const jevPreferences = {
    targetBudgetMonthly,
    preferredLanguage,
    childAgeYears,
    homeZipCode,
    homeLocation,
    programType
  };
  let programsScored = 0;
  onProgress?.({
    stage: 'scoring_with_jev',
    programsFound: candidateBatch.length,
    programsTotal: searchResult.total,
    programsChecked,
    programsScored,
    programsToScore: toScore.length
  });
  let judgments = [];
  if (toScore.length > 0) {
    try {
      const results = await scoreWithJev(toScore, jevPreferences, {
        onProgress: (progress) => {
          programsScored = progress.programsScored ?? programsScored;
          onProgress?.({
            stage: 'scoring_with_jev',
            programsFound: candidateBatch.length,
            programsTotal: searchResult.total,
            programsChecked,
            programsScored,
            programsToScore: toScore.length
          });
        }
      });
      judgments = Array.isArray(results) ? results : [];
    } catch (error) {
      judgments = toScore.map((candidate) => ({
        candidateEntityId: candidate.entityId,
        candidateName: candidate.name,
        source: 'jev_failed',
        error: describeError(error),
        compositeScore: null
      }));
    }
  }
  const returnedJudgmentIds = new Set(judgments.map((judgment) => judgment.candidateEntityId));
  for (const candidate of toScore) {
    if (!returnedJudgmentIds.has(candidate.entityId)) {
      judgments.push({
        candidateEntityId: candidate.entityId,
        candidateName: candidate.name,
        source: 'jev_failed',
        error: 'Jev returned no judgment for this program.',
        compositeScore: null
      });
    }
  }
  programsScored = judgments.length;
  onProgress?.({
    stage: 'scoring_with_jev',
    programsFound: candidateBatch.length,
    programsTotal: searchResult.total,
    programsChecked,
    programsScored,
    programsToScore: toScore.length
  });
  const judgmentById = new Map(judgments.map((judgment) => [judgment.candidateEntityId, judgment]));
  const withJev = (candidate) => ({
    ...candidate,
    jev: jevSummaryFor(judgmentById.get(candidate.entityId))
  });

  const withinBudget = withinBudgetPool
    .map(withJev)
    .sort(byJevComposite);
  const stretchOptions = overBudgetPool
    .map(withJev)
    .sort(byJevComposite);

  const unverifiedSafety = detailedCandidates
    .filter((candidate) => !candidate._ccldVerified)
    .sort(byDistance);

  const unverifiedRates = detailedCandidates
    .filter((candidate) => candidate._ccldVerified && (
      !candidate._hasCompleteRate || candidate.estimatedNetOutOfPocketMonthly == null
    ))
    .sort(byDistance);

  const unverifiedAge = detailedCandidates
    .filter((candidate) =>
      candidate._ccldVerified &&
      candidate._hasCompleteRate &&
      candidate.estimatedNetOutOfPocketMonthly != null &&
      candidate.ageFitStatus === 'unknown'
    )
    .sort(byDistance);

  // Keep the same priority as the family-facing skill when this full result is paged.
  const lists = {
    recommendations: withinBudget,
    stretchOptions,
    unverifiedSafetyCandidates: unverifiedSafety,
    unverifiedRateCandidates: unverifiedRates,
    unverifiedAgeCandidates: unverifiedAge
  };
  const listTotals = Object.fromEntries(Object.entries(lists).map(([name, candidates]) => [name, candidates.length]));
  const listedPrograms = Object.values(listTotals).reduce((sum, count) => sum + count, 0);
  const excludedPrograms = Object.values(excluded).reduce((sum, count) => sum + count, 0);
  const jevFailed = judgments
    .filter((judgment) => judgment.source === 'jev_failed')
    .map((judgment) => ({
      entityId: judgment.candidateEntityId,
      name: judgment.candidateName,
      reason: judgment.error || 'Jev returned no score.'
    }));
  const coverage = {
    careWaitMatches: searchResult.total,
    careWaitMatchesRetrieved: candidateBatch.length,
    programsChecked,
    detailLookupsFailedCount: detailLookupsFailed.length,
    ccldUnavailableCount: ccldUnavailable.length,
    jevFailedCount: jevFailed.length,
    programProcessingFailedCount: programProcessingFailed.length,
    excluded,
    detailLookupsFailed,
    ccldUnavailable,
    jevFailed,
    searchPages: {
      requested: searchResult.pagesRequested,
      succeeded: searchResult.pagesSucceeded,
      reportedTotal: searchResult.reportedTotal,
      uniqueMatches: candidateBatch.length,
      shortfall: searchResult.total == null
        ? null
        : Math.max(0, searchResult.total - candidateBatch.length),
      overage: searchResult.total == null
        ? null
        : Math.max(0, candidateBatch.length - searchResult.total),
      duplicateMatches: searchResult.duplicateMatches,
      retriedMissingRanges: searchResult.retriedMissingRanges,
      failures: searchResult.errors
    },
    programProcessingFailed,
    unclassifiedPrograms: Math.max(0, programsChecked - listedPrograms - excludedPrograms),
    complete: searchResult.complete &&
      programsChecked === candidateBatch.length &&
      detailLookupsFailed.length === 0 &&
      programProcessingFailed.length === 0 &&
      ccldUnavailable.length === 0 &&
      jevFailed.length === 0 &&
      listedPrograms + excludedPrograms === programsChecked
  };

  // The local market for this age group, from every program checked (not only recommended
  // ones), so families can see what tuition typically is before and after their credit.
  const priced = detailedCandidates.filter((candidate) =>
    candidate._hasCompleteRate && candidate.grossMonthlyTuition != null
  );
  const knownNetCost = detailedCandidates.filter((candidate) =>
    candidate._hasCompleteRate && candidate.estimatedNetOutOfPocketMonthly != null
  );
  const priceSummary = {
    basis: 'Upper end of the published CareWait rate for this age group at each program checked. ' +
      'Programs that publish only what families pay after the ELFA credit are left out of the ranges.',
    programsWithPublishedTuition: priced.length,
    grossMonthly: priceRange(priced.map((candidate) => candidate.grossMonthlyTuition)),
    netMonthly: priceRange(priced.map((candidate) => candidate.estimatedNetOutOfPocketMonthly)),
    // Every checked program with a known net cost, including ones whose licensing needs review.
    programsWithinBudget: knownNetCost.filter((candidate) =>
      candidate.estimatedNetOutOfPocketMonthly <= targetBudgetMonthly
    ).length
  };

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
    // The whole city is searched; the family's location affects distance and Jev ranking only.
    searchScope,
    preferredLanguage: preferredLanguage || 'Any',
    programTypePreference: programType,
    totalFound: candidateBatch.length,
    coverage,
    priceSummary,
    jevScoring: {
      method: 'TypeSafe Jev System One rates each verified program on a 0-3 rubric per criterion; ' +
        'recommendations and stretch options are ranked by the weighted composite (0-1) of those ratings.',
      weights: jevCompositeWeights(jevPreferences),
      ...summarizeJevScoring(judgments),
      candidatesNotScored: Math.max(0, rateVerified.length - toScore.length) +
        judgments.filter((judgment) => judgment.source === 'jev_failed').length
    },
    listTotals,
    ...lists
  };
}

/** Build the full, internal result. Services may be injected by offline tests. */
export function buildAllRecommendations(params = {}, services = {}) {
  return buildRecommendations(params, services);
}

/** Backwards-compatible one-page entry point for direct callers. */
export async function getRecommendations(params = {}, services = {}) {
  const result = await buildRecommendations(params, services);
  return paginateRecommendations(result, params.page ?? 1);
}

const RECOMMENDATION_LIST_ORDER = [
  'recommendations',
  'stretchOptions',
  'unverifiedSafetyCandidates',
  'unverifiedRateCandidates',
  'unverifiedAgeCandidates'
];

/** Return one compact page while keeping the full search summaries on every page. */
export function paginateRecommendations(result, requestedPage = 1) {
  const page = Number(requestedPage);
  if (!Number.isInteger(page) || page < 1) {
    throw new Error('page must be a positive integer starting at 1.');
  }

  const uniqueLists = Object.fromEntries(RECOMMENDATION_LIST_ORDER.map((name) => [name, []]));
  const seen = new Set();
  const ordered = [];
  for (const listName of RECOMMENDATION_LIST_ORDER) {
    for (const candidate of result?.[listName] || []) {
      if (!candidate?.entityId || seen.has(candidate.entityId)) continue;
      seen.add(candidate.entityId);
      ordered.push({ listName, candidate });
    }
  }

  const totalPrograms = ordered.length;
  const programPages = Math.ceil(totalPrograms / RECOMMENDATION_PAGE_SIZE);
  // Detail and processing failures do not have a normal recommendation row, so page their
  // coverage records too. This keeps a widespread outage visible without exceeding the tool
  // display limit or silently dropping the failed provider ids.
  const coverageFailureCount = Math.max(
    (result?.coverage?.detailLookupsFailed || []).length,
    (result?.coverage?.programProcessingFailed || []).length
  );
  const failurePages = Math.ceil(coverageFailureCount / RECOMMENDATION_PAGE_SIZE);
  const searchPageFailures = result?.coverage?.searchPages?.failures || [];
  const searchFailurePages = Math.ceil(searchPageFailures.length / RECOMMENDATION_PAGE_SIZE);
  const totalPages = Math.max(1, programPages, failurePages, searchFailurePages);
  const start = (page - 1) * RECOMMENDATION_PAGE_SIZE;
  for (const { listName, candidate } of ordered.slice(start, start + RECOMMENDATION_PAGE_SIZE)) {
    uniqueLists[listName].push(publicCandidate(candidate));
  }
  const listTotals = Object.fromEntries(RECOMMENDATION_LIST_ORDER.map((name) => [
    name,
    ordered.filter((item) => item.listName === name).length
  ]));

  // Jev failures already appear in coverage.jevFailed with their program ids and reasons.
  // summarizeJevScoring also carries a copy, so omit that duplicate from each public page.
  const jevScoring = result?.jevScoring
    ? Object.fromEntries(Object.entries(result.jevScoring).filter(([key]) => key !== 'failures'))
    : result?.jevScoring;
  const pageEntityIds = new Set(ordered.slice(start, start + RECOMMENDATION_PAGE_SIZE)
    .map(({ candidate }) => candidate.entityId));
  // Failure totals remain global and identical across pages. Per-program CCLD and Jev details
  // travel with the page containing that program so a dense search doesn't repeat them.
  const coverage = result?.coverage
    ? {
        ...result.coverage,
        failureDetailsPage: page,
        failureDetailsPages: failurePages,
        detailLookupsFailedCount: result.coverage.detailLookupsFailedCount ??
          (result.coverage.detailLookupsFailed || []).length,
        ccldUnavailableCount: result.coverage.ccldUnavailableCount ??
          (result.coverage.ccldUnavailable || []).length,
        jevFailedCount: result.coverage.jevFailedCount ??
          (result.coverage.jevFailed || []).length,
        programProcessingFailedCount: result.coverage.programProcessingFailedCount ??
          (result.coverage.programProcessingFailed || []).length,
        detailLookupsFailed: (result.coverage.detailLookupsFailed || [])
          .slice(start, start + RECOMMENDATION_PAGE_SIZE).map(compactFailure),
        programProcessingFailed: (result.coverage.programProcessingFailed || [])
          .slice(start, start + RECOMMENDATION_PAGE_SIZE).map(compactFailure),
        ccldUnavailable: (result.coverage.ccldUnavailable || [])
          .filter((failure) => pageEntityIds.has(failure.entityId)).map(compactFailure),
        jevFailed: (result.coverage.jevFailed || [])
          .filter((failure) => pageEntityIds.has(failure.entityId)).map(compactFailure),
        searchPages: result.coverage.searchPages
          ? {
              ...result.coverage.searchPages,
              failuresCount: result.coverage.searchPages.failuresCount ?? searchPageFailures.length,
              failuresPage: page,
              failuresPages: searchFailurePages,
              failures: searchPageFailures
                .slice(start, start + RECOMMENDATION_PAGE_SIZE).map(compactFailure)
            }
          : result.coverage.searchPages
      }
    : result?.coverage;

  return {
    ...result,
    coverage,
    jevScoring,
    page,
    pageSize: RECOMMENDATION_PAGE_SIZE,
    totalPages,
    totalPrograms,
    listTotals,
    ...uniqueLists
  };
}
