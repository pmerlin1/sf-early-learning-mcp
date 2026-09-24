import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractLicenseNumber,
  extractLicenseNumbers,
  getSiteDetails,
  searchProfiles
} from '../src/carewait-client.js';
import {
  combineInspectionRecords,
  isVerifiedLicensedFacility,
  summarizeInspectionRecord
} from '../src/ccld-utils.js';
import {
  detectRateBasis,
  estimateOutOfPocket,
  getCareSupportEvidence,
  getProviderSubsidyEligibility,
  getPublishedMonthlyRate
} from '../src/recommendation-utils.js';
import { getRecommendations } from '../src/recommendations.js';

// Field values below mirror live CareWait and CCLD responses (September 2026).

test('CareWait license extraction', async (t) => {
  await t.test('reads facilityNumber from the array-of-objects shape CareWait returns', () => {
    const profile = {
      license: [{
        licenseUrl: 'https://www.ccld.dss.ca.gov/carefacilitysearch/FacDetail/384002962',
        facilityStatus: 'licensed',
        facilityNumber: '384002962',
        facilityType: 'dayCareCenter'
      }]
    };
    assert.equal(extractLicenseNumber(profile), '384002962');
  });

  await t.test('accepts plain strings and the licenseNumbers array', () => {
    assert.equal(extractLicenseNumber({ license: '384001291' }), '384001291');
    assert.equal(extractLicenseNumber({ licenseNumbers: ['384004863'] }), '384004863');
  });

  await t.test('never returns an object or a non-numeric value', () => {
    assert.equal(extractLicenseNumber({ license: [{ facilityStatus: 'licensed' }] }), null);
    assert.equal(extractLicenseNumber({ license: '[object Object]' }), null);
    assert.equal(extractLicenseNumber({}), null);
  });

  await t.test('returns every license for providers with separate infant and preschool licenses', () => {
    const profile = {
      license: [
        { facilityNumber: '384004105', facilityType: 'dayCareCenter', facilityStatus: 'licensed' },
        { facilityNumber: '384004104', facilityType: 'infantCenter', facilityStatus: 'licensed' }
      ],
      licenseNumbers: ['384004105']
    };
    assert.deepEqual(extractLicenseNumbers(profile), ['384004105', '384004104']);
    assert.equal(extractLicenseNumber(profile), '384004105');
    assert.deepEqual(extractLicenseNumbers({}), []);
  });
});

test('CareWait program type filter', async (t) => {
  const sentProgramTypes = async (programType) => {
    const originalFetch = globalThis.fetch;
    let query;
    globalThis.fetch = async (url, init) => {
      query = JSON.parse(init.body).query;
      return { ok: true, json: async () => ({ total: { value: 0 }, data: [] }) };
    };
    try {
      await searchProfiles({ programType });
    } finally {
      globalThis.fetch = originalFetch;
    }
    return query.programType;
  };

  await t.test('treats "any" as no program-type restriction instead of an unknown type', async () => {
    assert.deepEqual(await sentProgramTypes('any'), []);
    assert.deepEqual(await sentProgramTypes(['any']), []);
  });

  await t.test('sends each requested licensed setting', async () => {
    assert.deepEqual(await sentProgramTypes('licensedCenter'), ['licensedCenter']);
    assert.deepEqual(
      await sentProgramTypes(['licensedCenter', 'licensedFamilyChildCare']),
      ['licensedCenter', 'licensedFamilyChildCare']
    );
    assert.deepEqual(await sentProgramTypes('home'), ['licensedFamilyChildCare']);
  });
});

test('providers with several CCLD licenses', async (t) => {
  // YMCA SF Chinatown-Tung Lok lists two licenses; only the second has substantiated allegations.
  const ymcaRecords = {
    384004450: {
      FACILITYNAME: 'YMCA SF CHINATOWN-TUNGLOK EARLY LEARNING CENTER', STATUS: 'Licensed',
      NBRINSPTYPA: '0', NBRCMPLTTYPA: '0', NBROTHERTYPA: '0', TOTTYPEA: '0',
      NBRINSPTYPB: '1', NBRCMPLTTYPB: '0', NBROTHERTYPB: '1', TOTTYPEB: '0',
      NBRCMPLTVISITS: '0', TOTCMPVISITS: '0', TOTSUBALG: '0'
    },
    384004449: {
      FACILITYNAME: 'YMCA SF CHINATOWN-TUNGLOK EARLY LEARNING CENTER', STATUS: 'Licensed',
      NBRINSPTYPA: '0', NBRCMPLTTYPA: '0', NBROTHERTYPA: '0', TOTTYPEA: '0',
      NBRINSPTYPB: '0', NBRCMPLTTYPB: '2', NBROTHERTYPB: '2', TOTTYPEB: '2',
      NBRCMPLTVISITS: '2', TOTCMPVISITS: '2', TOTSUBALG: '2'
    }
  };
  const summarize = (licenseNumber) => ({
    licenseNumber,
    ...summarizeInspectionRecord(ymcaRecords[licenseNumber])
  });

  await t.test('reports the most severe license instead of the first one listed', () => {
    const combined = combineInspectionRecords([summarize('384004450'), summarize('384004449')]);
    assert.equal(summarize('384004450').rating, 'minor_findings');
    assert.equal(combined.rating, 'caution');
    assert.equal(combined.licenseNumber, '384004449');
    assert.equal(combined.substantiatedAllegations, 2);
    assert.equal(combined.licenseCount, 2);
    assert.match(combined.safetySummary, /^License 384004449 \(most severe of 2\): Caution/);
    assert.match(combined.safetySummary, /License 384004450: Minor findings/);
  });

  await t.test('does not verify a provider when any one of its licenses is unverified', () => {
    const unavailable = {
      licenseNumber: '384004104',
      verificationStatus: 'unavailable',
      inspectionDataStatus: 'unavailable',
      status: null,
      rating: 'unknown',
      safetySummary: 'CCLD lookup unavailable (HTTP 503).'
    };
    const combined = combineInspectionRecords([summarize('384004450'), unavailable]);
    assert.equal(isVerifiedLicensedFacility(combined), false);
    assert.equal(combined.licenseNumber, '384004104');
    assert.match(combined.safetySummary, /^License 384004104 \(not verified\)/);
  });

  await t.test('leaves single-license and missing records unchanged', () => {
    const single = summarize('384004450');
    assert.equal(combineInspectionRecords([single]), single);
    assert.equal(combineInspectionRecords([]), null);
    assert.equal(combineInspectionRecords([null]), null);
  });

  await t.test('provider details look up every license listed on the CareWait profile', async () => {
    const originalFetch = globalThis.fetch;
    const requestedLicenses = [];
    globalThis.fetch = async (url) => {
      const href = String(url);
      if (href.includes('/FacilityDetail/')) {
        const licenseNumber = href.split('/').pop();
        requestedLicenses.push(licenseNumber);
        return { ok: true, json: async () => ({ FacilityDetail: ymcaRecords[licenseNumber] }) };
      }
      return {
        ok: true,
        json: async () => ({
          data: {
            profile: {
              entityId: 'fixture-ymca-chinatown',
              programName: 'YMCA SF Chinatown-Tung Lok Early Learning Center',
              license: [
                { facilityNumber: '384004450', facilityStatus: 'licensed' },
                { facilityNumber: '384004449', facilityStatus: 'licensed' }
              ],
              financialAid: ['halfCreditELFA'],
              program: [],
              rates: {}
            }
          }
        })
      };
    };
    try {
      const site = await getSiteDetails('fixture-ymca-chinatown');
      assert.deepEqual(requestedLicenses.sort(), ['384004449', '384004450']);
      assert.equal(site.licenseNumber, '384004450');
      assert.deepEqual(site.licenseNumbers, ['384004450', '384004449']);
      assert.equal(site.ccldInspections.length, 2);
      assert.equal(site.ccldInspection.rating, 'caution');
      assert.equal(site.ccldInspection.licenseNumber, '384004449');
      assert.deepEqual(site.ccldInspections.map((record) => record.ccldFacilityUrl), [
        'https://www.ccld.dss.ca.gov/carefacilitysearch/FacDetail/384004450',
        'https://www.ccld.dss.ca.gov/carefacilitysearch/FacDetail/384004449'
      ]);
      assert.equal(site.ccldInspection.ccldFacilityUrl,
        'https://www.ccld.dss.ca.gov/carefacilitysearch/FacDetail/384004449');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test('provider subsidy eligibility and care evidence stay explicit', async (t) => {
  await t.test('matches the selected ELFA tier exactly and never promotes generic subsidies', () => {
    assert.equal(getProviderSubsidyEligibility(
      [{ code: 'halfCreditELFA', name: 'ELFA Half Tuition Credit (151-200% AMI)' }],
      'halfCreditELFA',
      'listed'
    ), 'eligible');
    assert.equal(getProviderSubsidyEligibility(
      [{ code: 'cctr', name: 'General Child Care and Development' }],
      'halfCreditELFA',
      'listed'
    ), 'not_listed');
    assert.equal(getProviderSubsidyEligibility(undefined, 'halfCreditELFA', 'unknown'), 'unknown');
    assert.equal(getProviderSubsidyEligibility([], 'halfCreditELFA', 'listed'), 'not_listed');
  });

  await t.test('keeps diaper changes and potty-training support on separate evidence scales', () => {
    const diaperingOnly = getCareSupportEvidence(['diapersProvided']);
    assert.equal(diaperingOnly.diaperingStatus, 'confirmed');
    assert.equal(diaperingOnly.diaperingEvidenceScore, 100);
    assert.equal(diaperingOnly.pottyTrainingStatus, 'unknown');
    assert.equal(diaperingOnly.pottyTrainingEvidenceScore, 25);

    const pottyTrainingOnly = getCareSupportEvidence(['pottyTrainingProvided']);
    assert.equal(pottyTrainingOnly.diaperingStatus, 'unknown');
    assert.equal(pottyTrainingOnly.diaperingEvidenceScore, 25);
    assert.equal(pottyTrainingOnly.pottyTrainingStatus, 'confirmed');
    assert.equal(pottyTrainingOnly.pottyTrainingEvidenceScore, 100);
  });

  await t.test('maps CareWait aid and both accommodation flags from provider details', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        data: {
          profile: {
            entityId: 'fixture-carewait-profile',
            programName: 'Fixture Center',
            financialAid: ['halfCreditELFA'],
            accommodations: ['pottyTrainingProvided'],
            program: [],
            rates: {}
          }
        }
      })
    });
    try {
      const site = await getSiteDetails('fixture-carewait-profile');
      assert.equal(site.financialAidStatus, 'listed');
      assert.deepEqual(site.financialAid, [{
        code: 'halfCreditELFA',
        name: 'ELFA Half Tuition Credit (151-200% AMI)'
      }]);
      assert.equal(site.diaperingStatus, 'unknown');
      assert.equal(site.diaperingEvidenceScore, 25);
      assert.equal(site.pottyTrainingStatus, 'confirmed');
      assert.equal(site.pottyTrainingEvidenceScore, 100);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test('CCLD citation totals', async (t) => {
  const zeros = {
    STATUS: 'Licensed',
    NBRINSPTYPA: '0', NBRCMPLTTYPA: '0', NBROTHERTYPA: '0', TOTTYPEA: '0',
    NBRINSPTYPB: '0', NBRCMPLTTYPB: '0', NBROTHERTYPB: '0', TOTTYPEB: '0',
    NBRCMPLTVISITS: '0', TOTCMPVISITS: '0', TOTSUBALG: '0'
  };

  await t.test('counts a Type A citation from an "other" visit (Kai Ming Geary record)', () => {
    const result = summarizeInspectionRecord({ ...zeros, NBROTHERTYPA: '1' });
    assert.equal(result.totalTypeA, 1);
    assert.equal(result.rating, 'caution');
  });

  await t.test('counts complaint citations once and includes other-visit citations (Sunshine record)', () => {
    const result = summarizeInspectionRecord({
      ...zeros,
      NBRINSPTYPB: '3', NBRCMPLTTYPB: '2', NBROTHERTYPB: '11', TOTTYPEB: '2',
      NBRCMPLTVISITS: '10', TOTCMPVISITS: '10', TOTSUBALG: '3'
    });
    assert.equal(result.totalTypeB, 16);
    assert.equal(result.rating, 'caution');
  });

  await t.test('keeps inspection Type A citations (Chibi Chan Too record)', () => {
    const result = summarizeInspectionRecord({ ...zeros, NBRINSPTYPA: '2', NBRINSPTYPB: '1' });
    assert.equal(result.totalTypeA, 2);
    assert.equal(result.totalTypeB, 1);
    assert.equal(result.rating, 'caution');
  });
});

test('provider-published post-credit amounts', async (t) => {
  const kaiMingNote = 'Kai Ming ELFA slots follow Department of Early Childhood published fee schedule 2026-2027. ' +
    'Each year, the amount may be different. The tuition shown above are the amount families will be paying ' +
    'after any ELFA tuition credit offset. ';

  await t.test('detects notes stating the rate is after the ELFA credit', () => {
    assert.equal(detectRateBasis(kaiMingNote), 'post_credit');
    assert.equal(detectRateBasis(''), 'gross');
    assert.equal(detectRateBasis('Sibling discount is applied to the oldest sibling enrolled in the program.'), 'gross');
    assert.equal(detectRateBasis('Tuition increases after July; ELFA accepted.'), 'gross');
  });

  await t.test('does not subtract the credit a second time', () => {
    const rate = getPublishedMonthlyRate({ toddler: { min: 0, max: 1153 } }, 'toddler');
    const estimate = estimateOutOfPocket(rate, 1153, false, 'post_credit');
    assert.equal(estimate.estimate, 1153);
    assert.equal(estimate.basis, 'provider_published_post_credit_amount');
  });

  await t.test('a half-credit toddler family is not shown $0 at a post-credit provider', async () => {
    const site = {
      entityId: 'fixture-kai-ming',
      name: 'Fixture Post-Credit Center',
      zipCode: '94133',
      location: null,
      programType: 'licensedCenter',
      languages: ['Chinese (Cantonese)'],
      description: '',
      programsOffered: [{ name: 'Toddler', minAgeMonths: 18, maxAgeMonths: 35 }],
      monthlyRates: { toddler: { min: 0, max: 1153 } },
      rateNotes: kaiMingNote,
      financialAid: [{ code: 'halfCreditELFA', name: 'ELFA Half Tuition Credit' }],
      financialAidStatus: 'listed',
      licenseNumber: '384002725',
      ccldInspection: {
        verificationStatus: 'verified',
        inspectionDataStatus: 'complete',
        status: 'Licensed',
        totalTypeA: 0, totalTypeB: 0, complaintVisits: 0, substantiatedAllegations: 0,
        safetySummary: 'fixture'
      },
      diaperingStatus: 'confirmed',
      diaperingAccommodated: true
    };
    const result = await getRecommendations(
      { childAgeYears: 2.1, benefitTier: 'halfCreditELFA', targetBudgetMonthly: 300 },
      {
        search: async () => ({ items: [{ entityId: site.entityId }] }),
        getDetails: async () => site
      }
    );
    assert.equal(result.recommendations.length, 0);
    assert.equal(result.stretchOptions.length, 1);
    const option = result.stretchOptions[0];
    assert.equal(option.estimatedNetOutOfPocketMonthly, 1153);
    assert.equal(option.monthlySubsidyCredit, 1153);
    assert.equal(option.monthlySubsidyCreditAppliedToRate, 0);
    assert.equal(option.grossMonthlyTuition, null);
    assert.equal(option.rateBasis, 'post_credit');
  });
});
