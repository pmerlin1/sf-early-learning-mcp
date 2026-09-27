import test from 'node:test';
import assert from 'node:assert/strict';
import { searchProfiles, getSiteDetails } from '../src/carewait-client.js';
import { getFacilityDetail, searchFacilities } from '../src/ccld-client.js';

const zeroFindings = {
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

function jsonResponse(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json', ...headers }
  });
}

function siteResponse(entityId, licenseNumber) {
  return jsonResponse({
    data: {
      profile: {
        entityId,
        programName: 'Cache Fixture ' + entityId,
        programType: 'licensedCenter',
        address: { formattedAddress: '1 Main Street', zip: '94102', latitude: '37.78', longitude: '-122.42' },
        license: [{ facilityNumber: licenseNumber }],
        program: [{ name: 'Toddler', minAge: '24', maxAge: '36', language: [] }],
        rates: { toddler: { monthly: { minExists: true, min: '1000', maxExists: true, max: '1200' } } },
        language: [],
        financialAid: [],
        schedule: [],
        accommodations: []
      }
    }
  });
}

const noWait = async () => {};
const retryOptions = { sleep: noWait, random: () => 0 };

test('CareWait and CCLD clients use the retry helper and cache successful details', async (t) => {
  await t.test('CareWait search retries and preserves its skip/take page', async () => {
    let calls = 0;
    const result = await searchProfiles({ ageYears: 2, skip: 100, take: 50 }, {
      ...retryOptions,
      fetchImpl: async (_url, options) => {
        calls += 1;
        const body = JSON.parse(options.body);
        assert.equal(body.skip, 100);
        assert.equal(body.take, 50);
        return calls === 1
          ? new Response('', { status: 429 })
          : jsonResponse({ total: { value: 101 }, data: [{ _source: { entityId: 'paged-provider' } }] });
      }
    });
    assert.equal(calls, 2);
    assert.equal(result.total, 101);
    assert.equal(result.items[0].entityId, 'paged-provider');
  });

  await t.test('CCLD detail lookup retries a 503 and returns the verified record', async () => {
    let calls = 0;
    const result = await getFacilityDetail('384009871', {
      ...retryOptions,
      fetchImpl: async () => (++calls < 3
        ? new Response('', { status: 503 })
        : jsonResponse({ FacilityDetail: zeroFindings }))
    });
    assert.equal(calls, 3);
    assert.equal(result.verificationStatus, 'verified');
    assert.equal(result.totalTypeA, 0);
  });

  await t.test('CCLD search retries instead of turning a transient failure into an empty list', async () => {
    let calls = 0;
    const result = await searchFacilities({ zipCode: '94102' }, {
      ...retryOptions,
      fetchImpl: async () => (++calls === 1
        ? new Response('', { status: 429 })
        : jsonResponse({ FACILITYARRAY: [{ FACILITYNAME: 'Found' }] }))
    });
    assert.equal(calls, 2);
    assert.deepEqual(result, [{ FACILITYNAME: 'Found' }]);
  });

  await t.test('does not cache a CCLD failure and states the exhausted attempt count', async () => {
    const licenseNumber = '384009872';
    let calls = 0;
    const originalError = console.error;
    console.error = () => {};
    try {
      const fetchImpl = async () => { calls += 1; return new Response('', { status: 503 }); };
      const first = await getFacilityDetail(licenseNumber, {
        ...retryOptions, fetchImpl, maxAttempts: 2
      });
      const second = await getFacilityDetail(licenseNumber, {
        ...retryOptions, fetchImpl, maxAttempts: 2
      });
      assert.equal(calls, 4);
      assert.equal(first.verificationStatus, 'unavailable');
      assert.match(first.safetySummary, /failed after 2 attempts/);
      assert.equal(second.verificationStatus, 'unavailable');
    } finally {
      console.error = originalError;
    }
  });

  await t.test('reuses successful CareWait and CCLD details across repeated lookups', async () => {
    const entityId = 'cache-fixture-' + Date.now();
    const licenseNumber = '384009873';
    let carewaitCalls = 0;
    let ccldCalls = 0;
    const originalCacheSetting = process.env.SFEL_CACHE;
    process.env.SFEL_CACHE = 'on';
    const fetchImpl = async (url) => {
      if (String(url).includes('/FacilityDetail/')) {
        ccldCalls += 1;
        return jsonResponse({ FacilityDetail: zeroFindings });
      }
      carewaitCalls += 1;
      return siteResponse(entityId, licenseNumber);
    };
    try {
      const first = await getSiteDetails(entityId, { ...retryOptions, fetchImpl });
      const second = await getSiteDetails(entityId, { ...retryOptions, fetchImpl });
      assert.equal(first.entityId, entityId);
      assert.equal(second.ccldInspection.verificationStatus, 'verified');
      assert.equal(carewaitCalls, 1);
      assert.equal(ccldCalls, 1);
    } finally {
      if (originalCacheSetting === undefined) delete process.env.SFEL_CACHE;
      else process.env.SFEL_CACHE = originalCacheSetting;
    }
  });

  await t.test('retries unavailable CCLD data on a later CareWait detail lookup', async () => {
    const entityId = 'cache-retry-fixture-' + Date.now();
    const licenseNumber = '384009874';
    let carewaitCalls = 0;
    let ccldCalls = 0;
    const originalCacheSetting = process.env.SFEL_CACHE;
    process.env.SFEL_CACHE = 'on';
    const fetchImpl = async (url) => {
      if (String(url).includes('/FacilityDetail/')) {
        ccldCalls += 1;
        return ccldCalls === 1
          ? new Response('', { status: 503 })
          : jsonResponse({ FacilityDetail: zeroFindings });
      }
      carewaitCalls += 1;
      return siteResponse(entityId, licenseNumber);
    };
    const originalError = console.error;
    console.error = () => {};
    try {
      const first = await getSiteDetails(entityId, { ...retryOptions, fetchImpl, maxAttempts: 1 });
      const second = await getSiteDetails(entityId, { ...retryOptions, fetchImpl, maxAttempts: 1 });
      assert.equal(first.ccldInspection.verificationStatus, 'unavailable');
      assert.equal(second.ccldInspection.verificationStatus, 'verified');
      assert.equal(carewaitCalls, 2);
      assert.equal(ccldCalls, 2);
    } finally {
      console.error = originalError;
      if (originalCacheSetting === undefined) delete process.env.SFEL_CACHE;
      else process.env.SFEL_CACHE = originalCacheSetting;
    }
  });
});
