import test from 'node:test';
import assert from 'node:assert/strict';
import { getFacilityDetail, searchFacilities } from '../src/ccld-client.js';

test('CCLD Transparency Client - State Licensing & Inspections', async (t) => {
  await t.test('Fetches real facility inspection record for Kai Ming Geary (#384001291)', async () => {
    const detail = await getFacilityDetail('384001291');
    assert.ok(detail);
    assert.equal(detail.licenseNumber, '384001291');
    assert.equal(detail.status, 'Licensed');
    assert.equal(detail.capacity, 49);
    assert.equal(detail.totalTypeA, 0);
    assert.equal(detail.totalTypeB, 0);
    assert.equal(detail.substantiatedAllegations, 0);
    assert.equal(detail.rating, 'pristine');
    assert.equal(detail.isToddlerOptionExplicit, true);
  });

  await t.test('Searches child care facilities in 94121', async () => {
    const list = await searchFacilities({ zipCode: 94121 });
    assert.ok(Array.isArray(list));
    assert.ok(list.length > 0);
    const hasKaiMing = list.some(f => f.FACILITYNAME.includes('KAI MING'));
    assert.ok(hasKaiMing);
  });
});
