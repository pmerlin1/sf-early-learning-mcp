import test from 'node:test';
import assert from 'node:assert/strict';
import { getRecommendations } from '../src/recommendations.js';
import { ELFA_SOURCE_LIST } from '../src/constants.js';
import {
  checkClassroomAge,
  estimateOutOfPocket,
  getPublishedMonthlyRate
} from '../src/recommendation-utils.js';

const licensedInspection = {
  verificationStatus: 'verified',
  inspectionDataStatus: 'complete',
  status: 'Licensed',
  totalTypeA: 0,
  totalTypeB: 0,
  complaintVisits: 0,
  substantiatedAllegations: 0,
  safetySummary: 'Complete CCLD record with no findings.'
};

const provider = {
  entityId: 'fixture-provider',
  name: 'Fixture Spanish Center',
  address: '1 Main Street',
  zipCode: '94121',
  location: { lat: 37.7777, lon: -122.4847 },
  programType: 'licensedCenter',
  languages: ['Spanish'],
  financialAid: [
    { code: 'freeTuitionELFA', name: 'ELFA Free Tuition (0-110% AMI)' },
    { code: 'fullCreditELFA', name: 'ELFA Full Tuition Credit (111-150% AMI)' },
    { code: 'halfCreditELFA', name: 'ELFA Half Tuition Credit (151-200% AMI)' }
  ],
  financialAidStatus: 'listed',
  description: 'Spanish immersion',
  programsOffered: [{ name: 'Toddler', minAgeMonths: 18, maxAgeMonths: 36 }],
  monthlyRates: { toddler: { min: 1383, max: 1500 } },
  rateNotes: '',
  schedule: ['fullTime'],
  licenseNumber: 'fixture-license',
  ccldInspection: licensedInspection,
  diaperingStatus: 'confirmed',
  diaperingAccommodated: true
};

// Stands in for Jev: a scored judgment per program, with composites looked up by entityId.
// `calls` records which programs were sent and with what preferences.
function fakeJev(composites = {}, calls = []) {
  return async (candidates, preferences) => {
    calls.push({ ids: candidates.map((candidate) => candidate.entityId), preferences });
    return candidates.map((candidate) => {
      const composite = composites[candidate.entityId] ?? 0.8;
      if (composite === 'failed') {
        return {
          candidateEntityId: candidate.entityId,
          candidateName: candidate.name,
          source: 'jev_failed',
          error: 'APIConnectionError: socket hang up',
          compositeScore: null
        };
      }
      return {
        candidateEntityId: candidate.entityId,
        candidateName: candidate.name,
        source: 'jev_live_api',
        model: 'fixture-jev',
        usage: { input_tokens: 100, output_tokens: 10 },
        locationConvenienceScore: 2.5,
        safetyScore: 3,
        budgetFitScore: 2,
        immersionFitScore: 2.75,
        recommendationChoice: 'strong_alternative',
        confidence: 0.7,
        probabilities: { strong_alternative: 0.7 },
        compositeScore: composite,
        compositeCoverage: 1,
        compositeWeights: { location: 0.3, safety: 0.3, budget: 0.25, immersion: 0.15 },
        missingScoreCriteria: []
      };
    });
  };
}

async function recommendForProvider(site, options = {}) {
  return getRecommendations(
    {
      childAgeYears: 2.1,
      benefitTier: 'halfCreditELFA',
      targetBudgetMonthly: 400,
      preferredLanguage: 'Spanish',
      ...options
    },
    {
      search: async () => ({ items: [{ entityId: 'fixture-provider' }] }),
      getDetails: async () => ({ ...provider, ...site }),
      evaluate: fakeJev()
    }
  );
}

// Several providers near 94121; each site overrides the shared fixture.
async function recommendFrom(sites, params = {}, evaluate = fakeJev()) {
  const byId = new Map(sites.map((site) => [site.entityId, { ...provider, ...site }]));
  return getRecommendations(
    {
      childAgeYears: 2.1,
      benefitTier: 'halfCreditELFA',
      targetBudgetMonthly: 400,
      preferredLanguage: 'Spanish',
      homeZipCode: 94121,
      ...params
    },
    {
      search: async () => ({
        items: sites.map((site) => ({ entityId: site.entityId, zipCode: provider.zipCode }))
      }),
      getDetails: async (entityId) => byId.get(entityId),
      evaluate
    }
  );
}

// About 0.35 miles north of the fixture location per step.
const northOfHome = (steps) => ({ lat: provider.location.lat + steps * 0.005, lon: provider.location.lon });
const withinBudgetRate = { toddler: { min: 1383, max: 1383 } };
const overBudgetRate = { toddler: { min: 2000, max: 2000 } };

test('exact classroom age compatibility', async (t) => {
  await t.test('excludes a 25.2-month-old from a 33-month classroom', () => {
    const result = checkClassroomAge(2.1 * 12, [
      { minAgeMonths: 33, maxAgeMonths: 60 }
    ]);
    assert.equal(result.status, 'incompatible');
  });

  await t.test('accepts a child exactly at a classroom age boundary', () => {
    const result = checkClassroomAge(33, [
      { minAgeMonths: 33, maxAgeMonths: 60 }
    ]);
    assert.equal(result.status, 'compatible');
  });

  await t.test('returns unknown when exact classroom age data is absent', () => {
    assert.equal(checkClassroomAge(25.2, []).status, 'unknown');
    assert.equal(checkClassroomAge(25.2, [
      { minAgeMonths: null, maxAgeMonths: null }
    ]).status, 'unknown');
  });
});

test('published-rate and subsidy calculations preserve unknowns', async (t) => {
  await t.test('does not use a preschool rate as a toddler rate', () => {
    const rate = getPublishedMonthlyRate({
      toddler: { min: null, max: null },
      preschool: { min: 2100, max: 2100 }
    }, 'toddler');
    assert.equal(rate.status, 'unverified_blank_rates');
    assert.equal(rate.conservativeGross, null);
    assert.equal(estimateOutOfPocket(rate, 1153).estimate, null);
  });

  await t.test('uses the high end of a rate range for strict budget fit', () => {
    const rate = getPublishedMonthlyRate({
      toddler: { min: 1383, max: 1500 }
    }, 'toddler');
    const cost = estimateOutOfPocket(rate, 1153);
    assert.equal(rate.status, 'verified_range');
    assert.equal(rate.conservativeGross, 1500);
    assert.equal(cost.min, 230);
    assert.equal(cost.max, 347);
    assert.equal(cost.estimate, 347);
  });

  await t.test('does not treat a one-sided minimum as a verified maximum', () => {
    const rate = getPublishedMonthlyRate({
      toddler: { min: 1300, max: null }
    }, 'toddler');
    assert.equal(rate.status, 'partial_rate');
    assert.equal(estimateOutOfPocket(rate, 1153).estimate, null);
  });

  await t.test('keeps gross tuition distinct from a conditional free-tier copay', () => {
    const rate = getPublishedMonthlyRate({
      preschool: { min: 2100, max: 2100 }
    }, 'preschool');
    const cost = estimateOutOfPocket(rate, 1800, true);
    assert.equal(rate.conservativeGross, 2100);
    assert.equal(cost.estimate, 0);
    assert.equal(cost.basis, 'free_tuition_policy_conditional');
  });

  await t.test('an ELFA note cannot manufacture a missing gross rate', () => {
    const rate = getPublishedMonthlyRate({
      toddler: { min: null, max: null }
    }, 'toddler');
    assert.equal(rate.status, 'unverified_blank_rates');
    assert.equal(rate.conservativeGross, null);
  });
});

test('recommendation output quarantines unverified facts', async (t) => {
  await t.test('does not assume ELFA credit when no income or benefit tier is supplied', async () => {
    const result = await recommendForProvider({}, { benefitTier: undefined });
    assert.equal(result.subsidyBenefitTier, 'privatePay');
    assert.equal(result.monthlySubsidyDiscount, 0);
  });

  await t.test('does not apply an ELFA credit when provider details do not list the tier', async () => {
    const result = await recommendForProvider({
      financialAid: [{ code: 'cctr', name: 'General Child Care and Development' }]
    }, { targetBudgetMonthly: 1600 });
    const option = result.recommendations[0];
    assert.equal(option.subsidyEligibilityStatus, 'not_listed');
    assert.equal(option.monthlySubsidyCredit, 0);
    assert.equal(option.scheduledMonthlySubsidyCredit, 1153);
    assert.equal(option.estimatedNetOutOfPocketMonthly, 1500);
    assert.match(option.costEstimateBasis, /does not list the selected ELFA tier/);
  });

  await t.test('does not present a free-tier copay when the provider does not list free ELFA', async () => {
    const result = await recommendForProvider({
      financialAid: [{ code: 'cctr', name: 'General Child Care and Development' }]
    }, {
      benefitTier: 'freeTuitionELFA',
      targetBudgetMonthly: 1600
    });
    const option = result.recommendations[0];
    assert.equal(option.subsidyEligibilityStatus, 'not_listed');
    assert.equal(option.estimatedNetOutOfPocketMonthly, 1500);
    assert.equal(option.monthlySubsidyCredit, 0);
  });

  await t.test('missing provider aid data remains unknown and no credit is assumed', async () => {
    const result = await recommendForProvider({
      financialAid: undefined,
      financialAidStatus: 'unknown'
    }, { targetBudgetMonthly: 1600 });
    const option = result.recommendations[0];
    assert.equal(option.subsidyEligibilityStatus, 'unknown');
    assert.equal(option.monthlySubsidyCredit, 0);
    assert.equal(option.estimatedNetOutOfPocketMonthly, 1500);
  });

  await t.test('does not estimate post-credit rates when provider aid conflicts with the requested tier', async () => {
    const result = await recommendForProvider({
      financialAid: [{ code: 'cctr', name: 'General Child Care and Development' }],
      rateNotes: 'Tuition is the amount after any ELFA tuition credit offset.',
      monthlyRates: { toddler: { min: 0, max: 1153 } }
    });
    assert.equal(result.recommendations.length, 0);
    assert.equal(result.unverifiedRateCandidates[0].rateStatus, 'conflicting_rate_and_aid_data');
    assert.equal(result.unverifiedRateCandidates[0].estimatedNetOutOfPocketMonthly, null);
  });

  await t.test('reports a missing private-pay rate, not an ELFA conflict, at post-credit providers', async () => {
    const result = await recommendForProvider({
      rateNotes: 'Tuition is the amount after any ELFA tuition credit offset.',
      monthlyRates: { toddler: { min: 0, max: 1153 } }
    }, { benefitTier: 'privatePay' });
    const option = result.unverifiedRateCandidates[0];
    assert.equal(result.recommendations.length, 0);
    assert.equal(option.rateStatus, 'unverified_private_pay_rate');
    assert.equal(option.estimatedNetOutOfPocketMonthly, null);
    assert.match(option.costEstimateBasis, /private-pay tuition is not published/);
    assert.doesNotMatch(option.costEstimateBasis, /selected ELFA tier/);
  });

  await t.test('tracks diaper evidence informationally without gating recommendations', async () => {
    const site = {
      diaperingStatus: 'unknown',
      diaperingAccommodated: false,
      pottyTrainingStatus: 'confirmed',
      pottyTrainingEvidenceScore: 100,
      pottyTrainingEvidenceSource: 'CareWait: pottyTrainingProvided'
    };
    const needsDiapers = await recommendForProvider(site);
    assert.equal(needsDiapers.recommendations.length, 1);
    assert.equal(needsDiapers.recommendations[0].diaperingFitStatus,
      'potty_training_only_diapering_unconfirmed');
    assert.equal(needsDiapers.recommendations[0].pottyTrainingStatus, 'confirmed');
    assert.equal('unverifiedDiaperingCandidates' in needsDiapers, false,
      'no list suggests these programs were excluded');

    const toiletTrained = await recommendForProvider(site, { childIsPottyTrained: true });
    assert.equal(toiletTrained.recommendations.length, 1);
    assert.equal(toiletTrained.recommendations[0].diaperingFitStatus, 'not_required');
  });

  await t.test('reports diapering status for a preschool-age child who is not potty trained', async () => {
    const preschoolSite = {
      programsOffered: [{ name: 'Preschool', minAgeMonths: 36, maxAgeMonths: 60 }],
      monthlyRates: { preschool: { min: 1383, max: 1383 } },
      diaperingStatus: 'unknown',
      diaperingAccommodated: false
    };
    const preschooler = { childAgeYears: 3.5, targetBudgetMonthly: 1000 };

    const notTrained = await recommendForProvider(preschoolSite, {
      ...preschooler,
      childIsPottyTrained: false
    });
    assert.equal(notTrained.ageCategory, 'preschool');
    assert.equal(notTrained.recommendations.length, 1);
    assert.equal(notTrained.recommendations[0].diaperingFitStatus, 'unknown');
    assert.equal(notTrained.recommendations[0].diaperingEvidenceScore, 25);

    const trained = await recommendForProvider(preschoolSite, {
      ...preschooler,
      childIsPottyTrained: true
    });
    assert.equal(trained.recommendations.length, 1);
    assert.equal(trained.recommendations[0].diaperingFitStatus, 'not_required');
    assert.equal(trained.recommendations[0].diaperingEvidenceScore, null);

    const confirmedDiapering = await recommendForProvider({
      ...preschoolSite,
      diaperingStatus: 'confirmed',
      diaperingAccommodated: true
    }, { ...preschooler, childIsPottyTrained: false });
    assert.equal(confirmedDiapering.recommendations.length, 1);
    assert.equal(confirmedDiapering.recommendations[0].diaperingFitStatus, 'confirmed');
  });

  await t.test('uses the conservative posted rate and requires a complete CCLD record', async () => {
    const result = await recommendForProvider({});
    assert.equal(result.recommendations.length, 1);
    assert.equal(result.recommendations[0].grossMonthlyTuition, 1500);
    assert.equal(result.recommendations[0].estimatedNetOutOfPocketMonthly, 347);
    assert.equal(result.recommendations[0].ccldVerificationStatus, 'verified');
  });

  await t.test('keeps a blank rate unknown even when notes mention ELFA', async () => {
    const result = await recommendForProvider({
      monthlyRates: { toddler: { min: null, max: null } },
      rateNotes: 'Accepts ELFA'
    });
    assert.equal(result.recommendations.length, 0);
    assert.equal(result.unverifiedRateCandidates[0].rateStatus, 'unverified_blank_rates');
    assert.equal(result.unverifiedRateCandidates[0].grossMonthlyTuition, null);
    assert.equal(result.unverifiedRateCandidates[0].estimatedNetOutOfPocketMonthly, null);
  });

  await t.test('routes missing CCLD data to the safety-review list', async () => {
    const result = await recommendForProvider({ ccldInspection: null });
    assert.equal(result.recommendations.length, 0);
    assert.equal(result.unverifiedSafetyCandidates[0].ccldVerificationStatus, 'unavailable');
    assert.equal(result.unverifiedSafetyCandidates[0].licenseStatus, null);
  });

  await t.test('excludes the Wah Mei age range for a 25.2-month-old', async () => {
    const result = await recommendForProvider({
      programsOffered: [{ name: 'Preschool', minAgeMonths: 33, maxAgeMonths: 60 }]
    });
    assert.equal(result.totalFound, 0);
    assert.equal(result.recommendations.length, 0);
  });

  await t.test('shows free-tier copay as conditional without inventing gross tuition', async () => {
    const result = await recommendForProvider(
      {
        monthlyRates: { toddler: { min: null, max: null } },
        rateNotes: 'Accepts ELFA'
      },
      { benefitTier: 'freeTuitionELFA', targetBudgetMonthly: 0 }
    );
    const candidate = result.unverifiedRateCandidates[0];
    assert.equal(result.monthlySubsidyDiscount, 2306);
    assert.equal(candidate.grossMonthlyTuition, null);
    assert.equal(candidate.estimatedNetOutOfPocketMonthly, 0);
    assert.match(candidate.costEstimateBasis, /conditional/);
    assert.equal(candidate.rateStatus, 'unverified_blank_rates');
  });
});

test('recommendations carry citations for follow-up questions', async (t) => {
  await t.test('cite the DEC documents behind the credit amounts', async () => {
    const result = await recommendForProvider({});
    assert.deepEqual(result.subsidySources, ELFA_SOURCE_LIST);
  });

  await t.test('link every license to its public CCLD page', async () => {
    const result = await recommendForProvider({
      licenseNumber: '384004450',
      licenseNumbers: ['384004450', '384004449']
    });
    assert.deepEqual(result.recommendations[0].ccldFacilityUrls, [
      'https://www.ccld.dss.ca.gov/carefacilitysearch/FacDetail/384004450',
      'https://www.ccld.dss.ca.gov/carefacilitysearch/FacDetail/384004449'
    ]);
  });

  await t.test('pass along the provider website for tuition checks', async () => {
    const listed = await recommendForProvider({ website: 'https://fixture.example/tuition' });
    assert.equal(listed.recommendations[0].website, 'https://fixture.example/tuition');
    const unlisted = await recommendForProvider({});
    assert.equal(unlisted.recommendations[0].website, '');
  });
});

test('daycare type preference reaches the provider search', async (t) => {
  const run = async (options) => {
    let searchFilter;
    const result = await getRecommendations(
      { childAgeYears: 2.1, targetBudgetMonthly: 5000, ...options },
      {
        search: async (filter) => {
          searchFilter = filter;
          return { items: [] };
        },
        getDetails: async () => null,
        evaluate: fakeJev()
      }
    );
    return { result, searchFilter };
  };

  await t.test('searches both licensed settings when the family accepts either type', async () => {
    const { result, searchFilter } = await run({ programType: 'any' });
    assert.deepEqual(searchFilter.programType, ['licensedCenter', 'licensedFamilyChildCare']);
    assert.equal(result.programTypePreference, 'any');
  });

  await t.test('searches only family child care homes when that is the answer', async () => {
    const { result, searchFilter } = await run({ programType: 'licensedFamilyChildCare' });
    assert.equal(searchFilter.programType, 'licensedFamilyChildCare');
    assert.equal(result.programTypePreference, 'licensedFamilyChildCare');
  });

  await t.test('reports the licensed-center default when no preference is passed', async () => {
    const { result, searchFilter } = await run({});
    assert.equal(searchFilter.programType, 'licensedCenter');
    assert.equal(result.programTypePreference, 'licensedCenter');
  });
});

// Stands in for CareWait search: filters by zip, pages with skip/take, and returns matches in
// index order rather than by distance, as CareWait's fixed pseudo-random order does.
function fakeCareWait(zipCounts) {
  const index = zipCounts.flatMap(([zip, count]) => Array.from({ length: count }, (_, i) => ({
    entityId: zip + '-' + i,
    zipCode: String(zip)
  })));
  const calls = [];
  const search = async (filter) => {
    calls.push(filter);
    const matches = filter.zipCodes
      ? index.filter((item) => filter.zipCodes.includes(Number(item.zipCode)))
      : index;
    const skip = filter.skip ?? 0;
    const take = filter.take ?? 50;
    return { total: matches.length, items: matches.slice(skip, skip + take) };
  };
  return { search, calls };
}

async function providerBatchFor(zipCounts, params = {}) {
  const { search, calls } = fakeCareWait(zipCounts);
  const requested = [];
  const result = await getRecommendations(
    { childAgeYears: 2.1, targetBudgetMonthly: 5000, ...params },
    {
      search,
      getDetails: async (entityId) => {
        requested.push(entityId);
        return null;
      },
      evaluate: fakeJev()
    }
  );
  return { result, calls, requested };
}

const zipOf = (entityId) => Number(entityId.split('-')[0]);

test('neighborhood search evaluates the closest programs', async (t) => {
  await t.test('keeps every home-zip program when the neighborhood exceeds one page', async () => {
    // Farther zips come first in CareWait's order, so a single page would miss the home zip.
    const { result, calls, requested } = await providerBatchFor(
      [[94102, 30], [94109, 30], [94116, 30], [94121, 21]],
      { homeZipCode: 94121 }
    );
    assert.deepEqual(calls[0].zipCodes, [94121]);
    assert.equal(requested.length, 50);
    assert.ok(requested.slice(0, 21).every((id) => zipOf(id) === 94121));
    assert.equal(requested.filter((id) => zipOf(id) === 94116).length, 29);
    assert.ok(!requested.some((id) => zipOf(id) === 94102 || zipOf(id) === 94109));
    assert.equal(result.searchScope.zipCodes[0], 94121);
    assert.ok(!result.searchScope.zipCodes.includes(94102), 'stops widening once the batch is full');
    assert.equal(result.searchScope.citywide, false);
  });

  await t.test('pages through a ring holding more than one page of programs', async () => {
    const { calls, requested } = await providerBatchFor([[94121, 75]], { homeZipCode: 94121 });
    assert.deepEqual(calls.map((call) => call.skip), [0, 50]);
    assert.equal(requested.length, 50);
    assert.equal(new Set(requested).size, 50);
  });

  await t.test('adds citywide programs after nearby ones instead of replacing them', async () => {
    const { result, requested } = await providerBatchFor(
      [[94124, 60], [94121, 3]],
      { homeZipCode: 94121 }
    );
    assert.deepEqual(requested.slice(0, 3), ['94121-0', '94121-1', '94121-2']);
    assert.equal(requested.length, 50);
    assert.equal(new Set(requested).size, requested.length);
    assert.equal(result.searchScope.citywide, true);
  });

  await t.test('searches citywide once when no location is given', async () => {
    const { result, calls, requested } = await providerBatchFor([[94121, 5]]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].zipCodes, undefined);
    assert.equal(requested.length, 5);
    assert.deepEqual(result.searchScope, { zipCodes: [], citywide: true });
  });
});

test('Jev scores and ranks the recommendations', async (t) => {
  await t.test('fails closed without a TypeSafe key, before any provider lookup', async () => {
    const original = process.env.TYPESAFE_API_KEY;
    delete process.env.TYPESAFE_API_KEY;
    let searches = 0;
    try {
      await assert.rejects(
        getRecommendations({ childAgeYears: 2.1, homeZipCode: 94121 }, {
          search: async () => {
            searches += 1;
            return { items: [] };
          }
        }),
        /TYPESAFE_API_KEY is required/
      );
      assert.equal(searches, 0);
    } finally {
      if (original !== undefined) process.env.TYPESAFE_API_KEY = original;
    }
  });

  await t.test('orders programs by the Jev composite, not by distance or price', async () => {
    const result = await recommendFrom([
      { entityId: 'near-and-cheaper', monthlyRates: withinBudgetRate },
      { entityId: 'farther-and-pricier', location: northOfHome(6) }
    ], {}, fakeJev({ 'near-and-cheaper': 0.55, 'farther-and-pricier': 0.91 }));

    const [first, second] = result.recommendations;
    assert.equal(first.entityId, 'farther-and-pricier');
    assert.ok(first.distanceMiles > second.distanceMiles);
    assert.ok(first.estimatedNetOutOfPocketMonthly > second.estimatedNetOutOfPocketMonthly);
    assert.equal(first.jev.status, 'scored');
    assert.equal(first.jev.compositeScore, 0.91);
    assert.equal(first.jev.recommendation, 'strong_alternative');
    assert.deepEqual(first.jev.scores, { location: 2.5, safety: 3, budget: 2, immersion: 2.75 });
  });

  await t.test('sends every verified program to Jev, within budget first, and nothing unverified', async () => {
    const calls = [];
    const result = await recommendFrom([
      { entityId: 'over-budget-nearby', monthlyRates: overBudgetRate },
      { entityId: 'within-budget-farther', location: northOfHome(4) },
      { entityId: 'no-ccld-record', ccldInspection: null },
      { entityId: 'unpublished-rate', monthlyRates: { toddler: { min: null, max: null } } }
    ], {}, fakeJev({}, calls));

    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].ids, ['within-budget-farther', 'over-budget-nearby']);
    assert.equal(calls[0].preferences.homeZipCode, 94121);
    assert.equal(calls[0].preferences.targetBudgetMonthly, 400);
    assert.equal(calls[0].preferences.preferredLanguage, 'Spanish');

    assert.deepEqual(result.recommendations.map((option) => option.entityId), ['within-budget-farther']);
    assert.deepEqual(result.stretchOptions.map((option) => option.entityId), ['over-budget-nearby']);
    assert.equal(result.stretchOptions[0].jev.status, 'scored');
    assert.equal(result.unverifiedSafetyCandidates[0].entityId, 'no-ccld-record');
    assert.equal(result.unverifiedSafetyCandidates[0].jev, undefined);
    assert.equal(result.unverifiedRateCandidates[0].entityId, 'unpublished-rate');
    assert.equal(result.unverifiedRateCandidates[0].jev, undefined);
  });

  await t.test('keeps a program Jev could not score, marked failed, after the scored ones', async () => {
    const result = await recommendFrom([
      { entityId: 'unscored' },
      { entityId: 'scored', location: northOfHome(3) }
    ], {}, fakeJev({ unscored: 'failed', scored: 0.4 }));

    assert.deepEqual(result.recommendations.map((option) => option.entityId), ['scored', 'unscored']);
    assert.equal(result.recommendations[1].jev.status, 'failed');
    assert.equal(result.recommendations[1].jev.compositeScore, null);
    assert.equal(result.jevScoring.candidatesFailed, 1);
    assert.match(result.jevScoring.failures[0].error, /socket hang up/);
  });

  await t.test('reports the Jev model, weights, counts, and token usage', async () => {
    const result = await recommendFrom([
      { entityId: 'a' },
      { entityId: 'b', location: northOfHome(2) }
    ]);

    assert.equal(result.jevScoring.model, 'fixture-jev');
    assert.equal(result.jevScoring.candidatesScored, 2);
    assert.equal(result.jevScoring.candidatesNotScored, 0);
    assert.deepEqual(result.jevScoring.usage, { input_tokens: 200, output_tokens: 20 });
    assert.deepEqual(result.jevScoring.weights,
      { location: 0.3, safety: 0.3, budget: 0.25, immersion: 0.15 });
    assert.match(result.jevScoring.method, /weighted composite/);
  });

  await t.test('scores at most 25 programs, within-budget ones before closer over-budget ones', async () => {
    const calls = [];
    const overBudget = Array.from({ length: 22 }, (_, index) => ({
      entityId: 'over-' + index,
      monthlyRates: overBudgetRate,
      location: northOfHome(index)
    }));
    const withinBudget = Array.from({ length: 5 }, (_, index) => ({
      entityId: 'within-' + index,
      location: northOfHome(30 + index)
    }));
    const result = await recommendFrom([...overBudget, ...withinBudget], {}, fakeJev({}, calls));

    assert.equal(calls[0].ids.length, 25);
    assert.deepEqual(calls[0].ids.slice(0, 5), ['within-0', 'within-1', 'within-2', 'within-3', 'within-4']);
    assert.equal(result.jevScoring.candidatesNotScored, 2);
    assert.ok(!calls[0].ids.includes('over-21'), 'the farthest over-budget programs are left out');
  });

  await t.test('does not call Jev when no program passes the fact checks', async () => {
    const calls = [];
    const result = await recommendFrom([{ entityId: 'no-ccld-record', ccldInspection: null }], {},
      fakeJev({}, calls));
    assert.equal(calls.length, 0);
    assert.equal(result.recommendations.length, 0);
    assert.equal(result.jevScoring.candidatesScored, 0);
  });
});
