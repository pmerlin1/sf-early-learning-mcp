import test from 'node:test';
import assert from 'node:assert/strict';
import { getFacilityDetail } from '../src/ccld-client.js';
import { ccldFacilityUrl, summarizeInspectionRecord } from '../src/ccld-utils.js';

const completeZeroFindingsRecord = {
  STATUS: 'Licensed',
  CAPACITY: '49',
  LASTVISITDATE: '2026-01-01',
  NBRINSPTYPA: '0',
  NBRCMPLTTYPA: '0',
  NBROTHERTYPA: '0',
  TOTTYPEA: '0',
  NBRINSPTYPB: '0',
  NBRCMPLTTYPB: '0',
  NBROTHERTYPB: '0',
  TOTTYPEB: '0',
  NBRCMPLTVISITS: '0',
  TOTSUBALG: '0'
};

test('CCLD record quality distinguishes zero findings from missing findings', async (t) => {
  await t.test('labels complete all-zero data as clear', () => {
    const result = summarizeInspectionRecord(completeZeroFindingsRecord);
    assert.equal(result.verificationStatus, 'verified');
    assert.equal(result.inspectionDataStatus, 'complete');
    assert.equal(result.rating, 'pristine');
    assert.equal(result.totalTypeA, 0);
    assert.equal(result.totalTypeB, 0);
  });

  await t.test('keeps missing citation counts unknown', () => {
    const result = summarizeInspectionRecord({
      STATUS: 'Licensed',
      NBRINSPTYPA: null,
      NBRCMPLTTYPA: null,
      NBROTHERTYPA: null,
      TOTTYPEA: null,
      NBRINSPTYPB: null,
      NBRCMPLTTYPB: null,
      NBROTHERTYPB: null,
      TOTTYPEB: null,
      NBRCMPLTVISITS: null,
      TOTCMPVISITS: null,
      TOTSUBALG: null
    });
    assert.equal(result.verificationStatus, 'verified');
    assert.equal(result.inspectionDataStatus, 'incomplete');
    assert.equal(result.rating, 'unknown');
    assert.equal(result.totalTypeA, null);
    assert.match(result.safetySummary, /unavailable or incomplete/);
  });

  await t.test('does not call a non-licensed facility pristine', () => {
    const result = summarizeInspectionRecord({
      ...completeZeroFindingsRecord,
      STATUS: 'Closed'
    });
    assert.equal(result.rating, 'caution');
    assert.match(result.safetySummary, /not currently confirmed as licensed/);
  });

  await t.test('reports a CCLD HTTP failure as unavailable, not zero citations', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response('', { status: 503 });
    try {
      const result = await getFacilityDetail('fixture-unavailable-license');
      assert.equal(result.verificationStatus, 'unavailable');
      assert.equal(result.inspectionDataStatus, 'unavailable');
      assert.equal(result.status, null);
      assert.equal(result.rating, 'unknown');
      assert.equal(result.totalTypeA, null);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test('CCLD facility page links', async (t) => {
  await t.test('links a license number to its public CCLD page', () => {
    assert.equal(ccldFacilityUrl('384004339'),
      'https://www.ccld.dss.ca.gov/carefacilitysearch/FacDetail/384004339');
    assert.equal(ccldFacilityUrl(' 384004339 '),
      'https://www.ccld.dss.ca.gov/carefacilitysearch/FacDetail/384004339');
  });

  await t.test('never builds a link from a value that is not a license number', () => {
    assert.equal(ccldFacilityUrl('fixture-license'), null);
    assert.equal(ccldFacilityUrl('[object Object]'), null);
    assert.equal(ccldFacilityUrl(null), null);
  });

  await t.test('keeps the page link when the CCLD lookup fails, so the family can check it', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response('', { status: 503 });
    try {
      const result = await getFacilityDetail('384000001');
      assert.equal(result.verificationStatus, 'unavailable');
      assert.equal(result.ccldFacilityUrl,
        'https://www.ccld.dss.ca.gov/carefacilitysearch/FacDetail/384000001');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
