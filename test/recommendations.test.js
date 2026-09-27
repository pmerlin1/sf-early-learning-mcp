import test from 'node:test';
import assert from 'node:assert/strict';
import { getRecommendations, paginateRecommendations } from '../src/recommendations.js';
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
    assert.equal(result.totalFound, 1);
    assert.equal(result.recommendations.length, 0);
    assert.equal(result.coverage.programsChecked, 1);
    assert.equal(result.coverage.excluded.classroomAgeDoesNotFit, 1);
    assert.equal(result.coverage.complete, true);
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

// Stands in for CareWait's citywide search: pages with skip/take and returns matches in
// index order rather than by distance, as CareWait's fixed pseudo-random order does.
function fakeCareWait(zipCounts) {
  const index = zipCounts.flatMap(([zip, count]) => Array.from({ length: count }, (_, i) => ({
    entityId: zip + '-' + i,
    zipCode: String(zip)
  })));
  const calls = [];
  const search = async (filter) => {
    calls.push(filter);
    const matches = index;
    const skip = filter.skip ?? 0;
    const take = filter.take ?? 50;
    return { total: matches.length, items: matches.slice(skip, skip + take) };
  };
  return { search, calls };
}

async function providerBatchFor(zipCounts, params = {}, detailProvider) {
  const { search, calls } = fakeCareWait(zipCounts);
  const requested = [];
  const result = await getRecommendations(
    { childAgeYears: 2.1, targetBudgetMonthly: 5000, ...params },
    {
      search,
      getDetails: async (entityId) => {
        requested.push(entityId);
        return detailProvider ? detailProvider(entityId) : null;
      },
      evaluate: fakeJev()
    }
  );
  return { result, calls, requested };
}

const zipOf = (entityId) => Number(entityId.split('-')[0]);

test('recommendation search checks every CareWait match citywide', async (t) => {
  await t.test('reads every page when CareWait omits its total', async () => {
    const matches = Array.from({ length: 57 }, (_, index) => ({ entityId: `no-total-${index}` }));
    const calls = [];
    const requested = [];
    const result = await getRecommendations(
      { childAgeYears: 2.1, targetBudgetMonthly: 5000 },
      {
        search: async (filter) => {
          calls.push(filter);
          return {
            items: matches.slice(filter.skip, filter.skip + filter.take)
          };
        },
        getDetails: async (entityId) => {
          requested.push(entityId);
          return { ...provider, entityId, ccldInspection: null };
        },
        evaluate: fakeJev()
      }
    );

    assert.deepEqual(calls.map((call) => call.skip), [0, 50]);
    assert.equal(requested.length, matches.length);
    assert.equal(new Set(requested).size, matches.length);
    assert.equal(result.coverage.careWaitMatches, matches.length);
    assert.equal(result.coverage.careWaitMatchesRetrieved, matches.length);
    assert.equal(result.coverage.searchPages.reportedTotal, null);
    assert.equal(result.coverage.searchPages.uniqueMatches, matches.length);
    assert.equal(result.coverage.complete, true);
  });

  await t.test('stops and reports incomplete coverage when a full page has no new IDs', async () => {
    const matches = Array.from({ length: 50 }, (_, index) => ({ entityId: `repeated-${index}` }));
    const calls = [];
    const result = await getRecommendations(
      { childAgeYears: 2.1, targetBudgetMonthly: 5000 },
      {
        search: async (filter) => {
          calls.push(filter);
          return { items: matches };
        },
        getDetails: async (entityId) => ({ ...provider, entityId, ccldInspection: null }),
        evaluate: fakeJev()
      }
    );

    assert.deepEqual(calls.map((call) => call.skip), [0, 50]);
    assert.equal(result.coverage.searchPages.uniqueMatches, matches.length);
    assert.equal(result.coverage.searchPages.duplicateMatches, matches.length);
    assert.match(result.coverage.searchPages.failures[0].error, /no new IDs/);
    assert.equal(result.coverage.searchPages.shortfall, null);
    assert.equal(result.coverage.complete, false);
  });

  await t.test('checks all 600 matches once with bounded detail concurrency', async () => {
    let inFlight = 0;
    let peak = 0;
    const { result, calls, requested } = await providerBatchFor(
      [[94102, 400], [94121, 200]],
      { homeZipCode: 94121 },
      async (entityId) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 1));
        inFlight -= 1;
        return {
          ...provider,
          entityId,
          zipCode: String(zipOf(entityId)),
          location: zipOf(entityId) === 94121
            ? { lat: 37.7777, lon: -122.4847 }
            : { lat: 37.7797, lon: -122.4192 },
          ccldInspection: null
        };
      }
    );
    assert.equal(calls.length, 12);
    assert.deepEqual(calls.map((call) => call.skip).sort((a, b) => a - b),
      [0, 50, 100, 150, 200, 250, 300, 350, 400, 450, 500, 550]);
    assert.equal(requested.length, 600);
    assert.equal(new Set(requested).size, 600);
    assert.ok(peak > 1);
    assert.ok(peak <= 16);
    assert.equal(result.searchScope.citywide, true);
    assert.equal(result.coverage.careWaitMatches, 600);
    assert.equal(result.coverage.careWaitMatchesRetrieved, 600);
    assert.equal(result.coverage.programsChecked, 600);
    assert.equal(result.unverifiedSafetyCandidates.length, 10);
    assert.equal(result.unverifiedSafetyCandidates[0].zipCode, '94121');
    assert.equal(result.coverage.complete, true);
    assert.equal(
      Object.values(result.listTotals).reduce((sum, count) => sum + count, 0) +
        Object.values(result.coverage.excluded).reduce((sum, count) => sum + count, 0),
      result.coverage.programsChecked
    );
  });

  await t.test('reports the CareWait shortfall after re-reading a mismatched result range', async () => {
    let calls = 0;
    const result = await getRecommendations({ childAgeYears: 2.1 }, {
      search: async () => {
        calls += 1;
        return {
          total: 3,
          items: [
            { entityId: 'short-1' },
            { entityId: 'short-2' }
          ]
        };
      },
      getDetails: async (entityId) => ({ ...provider, entityId, ccldInspection: null }),
      evaluate: fakeJev()
    });
    assert.equal(calls, 2, 'the missing range is retried once');
    assert.equal(result.coverage.careWaitMatches, 3);
    assert.equal(result.coverage.careWaitMatchesRetrieved, 2);
    assert.equal(result.coverage.searchPages.retriedMissingRanges, true);
    assert.equal(result.coverage.searchPages.shortfall, 1);
    assert.equal(result.coverage.complete, false);
  });

  await t.test('reports failed details and Jev attempts in coverage', async () => {
    const failedDetail = await getRecommendations({ childAgeYears: 2.1 }, {
      search: async () => ({ total: 1, items: [{ entityId: 'detail-error' }] }),
      getDetails: async () => { throw new Error('temporary CareWait failure'); },
      evaluate: fakeJev()
    });
    assert.equal(failedDetail.coverage.detailLookupsFailed.length, 1);
    assert.equal(failedDetail.coverage.detailLookupsFailed[0].entityId, 'detail-error');
    assert.equal(failedDetail.coverage.complete, false);

    const failedJev = await getRecommendations({ childAgeYears: 2.1 }, {
      search: async () => ({ total: 1, items: [{ entityId: 'jev-error' }] }),
      getDetails: async () => ({ ...provider, entityId: 'jev-error' }),
      evaluate: fakeJev({ 'jev-error': 'failed' })
    });
    assert.equal(failedJev.coverage.jevFailed.length, 1);
    assert.equal(failedJev.coverage.jevFailed[0].entityId, 'jev-error');
    assert.equal(failedJev.coverage.complete, false);
  });

  await t.test('counts a program excluded for language while reconciling all checked programs', async () => {
    const result = await getRecommendations({ childAgeYears: 2.1, preferredLanguage: 'Mandarin' }, {
      search: async () => ({
        total: 2,
        items: [{ entityId: 'mandarin' }, { entityId: 'no-mandarin' }]
      }),
      getDetails: async (entityId) => ({
        ...provider,
        entityId,
        languages: entityId === 'mandarin' ? ['Mandarin'] : ['Spanish']
      }),
      evaluate: fakeJev()
    });
    assert.equal(result.coverage.programsChecked, 2);
    assert.equal(result.coverage.excluded.preferredLanguageNotListed, 1);
    assert.equal(result.listTotals.stretchOptions, 1);
    assert.equal(result.coverage.complete, true);
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
    assert.equal(result.jevScoring.candidatesNotScored, 1);
    assert.match(result.coverage.jevFailed[0].reason, /socket hang up/);
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

  await t.test('scores every verified program, within-budget ones before over-budget ones', async () => {
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

    assert.equal(calls[0].ids.length, 27);
    assert.deepEqual(calls[0].ids.slice(0, 5), ['within-0', 'within-1', 'within-2', 'within-3', 'within-4']);
    assert.equal(result.jevScoring.candidatesNotScored, 0);
    assert.ok(calls[0].ids.includes('over-21'), 'the final over-budget program is scored');
  });

  await t.test('does not call Jev when no program passes the fact checks', async () => {
    const calls = [];
    const result = await recommendFrom([{ entityId: 'no-ccld-record', ccldInspection: null }], {},
      fakeJev({}, calls));
    assert.equal(calls.length, 0);
    assert.equal(result.recommendations.length, 0);
    assert.equal(result.jevScoring.candidatesScored, 0);
  });

  await t.test('labels Jev verdicts in plain words and rounds the probabilities', async () => {
    const result = await recommendFrom([{ entityId: 'a' }], {}, async (candidates) => {
      const [judgment] = await fakeJev()(candidates);
      return [{
        ...judgment,
        recommendationChoice: 'unsuitable',
        confidence: 0.654321,
        probabilities: { unsuitable: 0.654321, caution_flagged: 0.345679 }
      }];
    });
    const { jev } = result.recommendations[0];
    assert.equal(jev.recommendation, 'unsuitable');
    assert.equal(jev.recommendationLabel, 'Poor fit');
    assert.equal(jev.recommendationConfidence, 0.65);
    assert.deepEqual(jev.recommendationProbabilities, { unsuitable: 0.65, caution_flagged: 0.35 });
    assert.equal(jev.model, undefined, 'the model is reported once, in jevScoring');
  });
});

test('recommendation results stay compact and show the local market', async (t) => {
  await t.test('summarize published tuition before and after the credit', async () => {
    const result = await recommendFrom([
      { entityId: 'within-budget', monthlyRates: withinBudgetRate },
      { entityId: 'over-budget', monthlyRates: overBudgetRate, location: northOfHome(2) },
      {
        entityId: 'post-credit',
        rateNotes: 'Tuition is the amount after any ELFA tuition credit offset.',
        monthlyRates: { toddler: { min: 0, max: 1153 } },
        location: northOfHome(3)
      },
      { entityId: 'unpublished', monthlyRates: { toddler: { min: null, max: null } } }
    ]);

    const summary = result.priceSummary;
    // Gross ranges use each program's published amount; post-credit amounts are not gross.
    assert.equal(summary.programsWithPublishedTuition, 2);
    assert.deepEqual(summary.grossMonthly, { min: 1383, median: 1692, max: 2000 });
    assert.deepEqual(summary.netMonthly, { min: 230, median: 539, max: 847 });
    // Only the $230 program fits the $400 budget; the post-credit $1,153 counts but does not fit.
    assert.equal(summary.programsWithinBudget, 1);
    assert.match(summary.basis, /Upper end/);
  });

  await t.test('keep each program small while Jev still sees the full record', async () => {
    let seenByJev;
    const result = await recommendFrom([{
      entityId: 'a',
      description: 'Spanish immersion with a long marketing description.',
      rateNotes: 'Fee schedule. '.repeat(40)
    }], {}, async (candidates) => {
      seenByJev = candidates[0];
      return fakeJev()(candidates);
    });

    const option = result.recommendations[0];
    assert.equal(seenByJev.description, 'Spanish immersion with a long marketing description.');
    assert.equal(option.description, undefined);
    assert.equal(option.location, undefined);
    assert.deepEqual(Object.keys(option.ccldInspection), [
      'rating', 'status', 'totalTypeA', 'totalTypeB', 'complaintVisits', 'substantiatedAllegations', 'lastVisitDate'
    ]);
    assert.deepEqual(option.financialAid, ['freeTuitionELFA', 'fullCreditELFA', 'halfCreditELFA']);
    assert.equal(option.rateNotes.length, 201);
    assert.ok(option.rateNotes.endsWith('…'));
  });

  await t.test('pages all programs in priority order and keeps the full list totals', async () => {
    const sites = [
      ...Array.from({ length: 12 }, (_, i) => ({ entityId: 'within-' + i, location: northOfHome(i) })),
      ...Array.from({ length: 12 }, (_, i) => ({
        entityId: 'over-' + i, monthlyRates: overBudgetRate, location: northOfHome(i)
      })),
      ...Array.from({ length: 6 }, (_, i) => ({
        entityId: 'unpublished-' + i, monthlyRates: { toddler: { min: null, max: null } }
      }))
    ];

    const result = await recommendFrom(sites);
    assert.equal(result.page, 1);
    assert.equal(result.pageSize, 10);
    assert.equal(result.totalPages, 3);
    assert.equal(result.totalPrograms, 30);
    assert.equal(result.recommendations.length, 10);
    assert.equal(result.stretchOptions.length, 0);
    assert.equal(result.unverifiedRateCandidates.length, 0);
    assert.deepEqual(result.listTotals, {
      recommendations: 12,
      stretchOptions: 12,
      unverifiedSafetyCandidates: 0,
      unverifiedRateCandidates: 6,
      unverifiedAgeCandidates: 0
    });

    const next = await recommendFrom(sites, { page: 2 });
    assert.equal(next.page, 2);
    assert.equal(next.recommendations.length, 2);
    assert.equal(next.stretchOptions.length, 8);
    const last = await recommendFrom(sites, { page: 3 });
    assert.equal(last.page, 3);
    assert.equal(last.stretchOptions.length, 4);
    assert.equal(last.unverifiedRateCandidates.length, 6);
    const allIds = [result, next, last].flatMap((page) => [
      ...page.recommendations,
      ...page.stretchOptions,
      ...page.unverifiedRateCandidates
    ]).map((candidate) => candidate.entityId);
    assert.equal(allIds.length, 30);
    assert.equal(new Set(allIds).size, 30);
    assert.ok(Buffer.byteLength(JSON.stringify(result), 'utf8') < 50 * 1024);
    assert.equal(paginateRecommendations({ recommendations: [], stretchOptions: [] }, 3).recommendations.length, 0);
  });

  await t.test('prioritize licensing verification rows ahead of unpublished-rate rows', async () => {
    const sites = [
      ...Array.from({ length: 11 }, (_, i) => ({
        entityId: 'safety-' + i,
        monthlyRates: withinBudgetRate,
        ccldInspection: null
      })),
      ...Array.from({ length: 11 }, (_, i) => ({
        entityId: 'rate-' + i,
        monthlyRates: { toddler: { min: null, max: null } }
      }))
    ];

    const result = await recommendFrom(sites);
    assert.equal(result.unverifiedSafetyCandidates.length, 10);
    assert.equal(result.unverifiedRateCandidates.length, 0);
    assert.equal(result.unverifiedSafetyCandidates[0].entityId, 'safety-0');
    const next = await recommendFrom(sites, { page: 2 });
    assert.equal(next.unverifiedSafetyCandidates.length, 1);
    assert.equal(next.unverifiedRateCandidates.length, 9);
    assert.equal(next.unverifiedRateCandidates[0].entityId, 'rate-0');
    const last = await recommendFrom(sites, { page: 3 });
    assert.equal(last.unverifiedRateCandidates.length, 2);
    assert.equal(
      result.unverifiedSafetyCandidates.length + next.unverifiedSafetyCandidates.length +
        next.unverifiedRateCandidates.length + last.unverifiedRateCandidates.length,
      22
    );
  });

  await t.test('57 programs produce complete 10-row pages with no aggregate cap', () => {
    const full = {
      recommendations: Array.from({ length: 25 }, (_, i) => ({ entityId: 'recommended-' + i })),
      stretchOptions: Array.from({ length: 20 }, (_, i) => ({ entityId: 'stretch-' + i })),
      unverifiedSafetyCandidates: Array.from({ length: 12 }, (_, i) => ({ entityId: 'safety-' + i })),
      unverifiedRateCandidates: [],
      unverifiedAgeCandidates: []
    };
    const pages = [1, 2, 3, 4, 5, 6].map((page) => paginateRecommendations(full, page));
    const counts = pages.map((page) => [
      page.recommendations,
      page.stretchOptions,
      page.unverifiedSafetyCandidates,
      page.unverifiedRateCandidates,
      page.unverifiedAgeCandidates
    ].reduce((sum, list) => sum + list.length, 0));
    assert.deepEqual(counts, [10, 10, 10, 10, 10, 7]);
    const ids = pages.flatMap((page) => [
      ...page.recommendations,
      ...page.stretchOptions,
      ...page.unverifiedSafetyCandidates
    ]).map((candidate) => candidate.entityId);
    assert.equal(ids.length, 57);
    assert.equal(new Set(ids).size, 57);
    const pastEnd = paginateRecommendations(full, 7);
    assert.equal(pastEnd.totalPages, 6);
    assert.equal(pastEnd.totalPrograms, 57);
    assert.equal(pastEnd.recommendations.length + pastEnd.stretchOptions.length +
      pastEnd.unverifiedSafetyCandidates.length, 0);
  });

  await t.test('keeps global failure counts stable and pages per-program failure details', () => {
    const recommendations = Array.from({ length: 43 }, (_, index) => ({
      entityId: 'failed-jev-' + index,
      name: 'Program ' + index,
      jev: { status: 'failed' }
    }));
    const full = {
      recommendations,
      coverage: {
        jevFailed: recommendations.map(({ entityId, name }) => ({
          entityId,
          name,
          reason: 'Temporary Jev outage.'
        }))
      }
    };
    const pages = [1, 2, 3, 4, 5].map((page) => paginateRecommendations(full, page));
    const visibleFailureIds = pages.flatMap((page) => page.coverage.jevFailed.map((failure) => failure.entityId));

    assert.deepEqual(pages.map((page) => page.coverage.jevFailed.length), [10, 10, 10, 10, 3]);
    assert.deepEqual(pages.map((page) => page.coverage.jevFailedCount), [43, 43, 43, 43, 43]);
    assert.equal(new Set(visibleFailureIds).size, 43);
  });

  await t.test('pages detail failures even when no provider produced a normal result row', () => {
    const failures = Array.from({ length: 43 }, (_, index) => ({
      entityId: 'detail-failed-' + index,
      reason: 'provider_details_lookup_failed',
      error: 'CareWait detail request failed.'
    }));
    const full = {
      recommendations: [],
      stretchOptions: [],
      coverage: {
        careWaitMatches: 43,
        careWaitMatchesRetrieved: 43,
        programsChecked: 0,
        detailLookupsFailed: failures,
        searchPages: {
          failures: Array.from({ length: 23 }, (_, index) => ({
            skip: index * 50,
            error: 'CareWait page failed.'
          }))
        },
        complete: false
      }
    };
    const pages = [1, 2, 3, 4, 5].map((page) => paginateRecommendations(full, page));
    const visibleFailureIds = pages.flatMap((page) => page.coverage.detailLookupsFailed.map((failure) => failure.entityId));

    assert.deepEqual(pages.map((page) => page.coverage.detailLookupsFailed.length), [10, 10, 10, 10, 3]);
    assert.deepEqual(pages.map((page) => page.coverage.detailLookupsFailedCount), [43, 43, 43, 43, 43]);
    assert.deepEqual(pages.map((page) => page.coverage.searchPages.failures.length), [10, 10, 3, 0, 0]);
    assert.deepEqual(pages.map((page) => page.coverage.searchPages.failuresCount), [23, 23, 23, 23, 23]);
    assert.deepEqual(pages.map((page) => page.coverage.failureDetailsPage), [1, 2, 3, 4, 5]);
    assert.deepEqual(pages.map((page) => page.totalPages), [5, 5, 5, 5, 5]);
    assert.equal(new Set(visibleFailureIds).size, 43);
  });

  await t.test('keeps even a data-rich page below the 50 KB display limit', () => {
    const candidates = Array.from({ length: 20 }, (_, index) => ({
      entityId: 'large-' + index,
      name: 'Program ' + index,
      address: '123 Main Street, San Francisco, California 94121',
      zipCode: '94121',
      phone: '415-555-0123',
      email: 'families@example.org',
      website: 'https://example.org/programs',
      programType: 'licensedCenter',
      languages: ['Spanish', 'Mandarin'],
      financialAid: ['halfCreditELFA', 'fullCreditELFA'],
      programs: ['Toddler (18-36 mo)', 'Preschool (33-60 mo)'],
      ageFitStatus: 'compatible',
      grossMonthlyTuition: 3000,
      grossMonthlyTuitionMin: 2800,
      grossMonthlyTuitionMax: 3000,
      rateBasis: 'gross',
      monthlySubsidyCredit: 1847,
      monthlySubsidyCreditAppliedToRate: 1847,
      scheduledMonthlySubsidyCredit: 1847,
      subsidyEligibilityStatus: 'eligible',
      estimatedNetOutOfPocketMonthly: 1153,
      estimatedNetOutOfPocketMonthlyMin: 953,
      estimatedNetOutOfPocketMonthlyMax: 1153,
      costEstimateBasis: 'Provider-confirmed ELFA credit applied to the published tuition. '.repeat(8),
      rateStatus: 'verified',
      rateNotes: 'Rate details. '.repeat(40),
      schedule: ['fullTime'],
      licenseNumber: '123456789',
      licenseNumbers: ['123456789'],
      ccldFacilityUrls: ['https://www.ccld.dss.ca.gov/carefacilitysearch/Facility/Details/123456789'],
      licenseStatus: 'Licensed',
      ccldVerificationStatus: 'verified',
      inspectionDataStatus: 'complete',
      safetySummary: 'Complete inspection record. '.repeat(30),
      ccldInspection: {
        rating: 'Clear', status: 'Licensed', totalTypeA: 0, totalTypeB: 0,
        complaintVisits: 0, substantiatedAllegations: 0, lastVisitDate: '2026-01-01',
        safetySummary: 'Internal duplicate summary should not be copied.'
      },
      diaperingStatus: 'unknown',
      pottyTrainingStatus: 'confirmed',
      diaperingFitStatus: 'unknown',
      diaperingEvidenceScore: 25,
      pottyTrainingEvidenceScore: 100,
      diaperingEvidenceSource: 'CareWait provider details',
      pottyTrainingEvidenceSource: 'CareWait provider details',
      distanceMiles: 0.5,
      proximityRating: 3,
      jev: {
        status: 'failed',
        error: 'An error that is represented once in coverage. '.repeat(6),
        compositeScore: null
      },
      // Large internal-only values must never leak into the public provider row.
      location: { lat: 37.77, lon: -122.48 },
      description: 'x'.repeat(10_000),
      internalFutureField: 'y'.repeat(10_000)
    }));
    const result = paginateRecommendations({
      coverage: {
        careWaitMatches: 20,
        programsChecked: 20,
        detailLookupsFailed: Array.from({ length: 20 }, (_, index) => ({
          entityId: 'detail-error-' + index,
          reason: 'provider_details_lookup_failed',
          error: 'Request failed after 5 attempts for a CareWait details URL. '.repeat(5)
        })),
        jevFailed: candidates.map(({ entityId, name }) => ({ entityId, name, reason: 'Temporary Jev error.' })),
        complete: false
      },
      jevScoring: {
        candidatesScored: 0,
        candidatesFailed: 20,
        candidatesNotScored: 20,
        failures: candidates.map(({ entityId, name }) => ({ entityId, name, error: 'duplicate failure details' }))
      },
      recommendations: candidates
    });

    const serializedBytes = Buffer.byteLength(JSON.stringify(result), 'utf8');
    const componentBytes = Object.fromEntries(Object.entries(result).map(([key, value]) => [
      key,
      Buffer.byteLength(JSON.stringify(value), 'utf8')
    ]));
    assert.ok(serializedBytes < 50 * 1024, `Serialized page was ${serializedBytes} bytes: ${JSON.stringify(componentBytes)}`);
    assert.equal(result.jevScoring.failures, undefined);
    assert.equal(result.coverage.jevFailed.length, 10);
    assert.equal(result.coverage.detailLookupsFailed[0].errorTruncated, true);
    assert.equal(result.recommendations[0].description, undefined);
    assert.equal(result.recommendations[0].internalFutureField, undefined);
    assert.equal(result.recommendations[0].jev.error, undefined);
  });
});
