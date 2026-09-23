import test from 'node:test';
import assert from 'node:assert/strict';
import { haversineDistanceMiles, evaluateProximity, SF_ZIP_CENTROIDS } from '../src/geo-utils.js';
import { rankCandidates } from '../src/recommendation-utils.js';

test('Geolocation & Proximity Evaluation', async (t) => {
  await t.test('Calculates Haversine distance correctly', () => {
    // 94121 (Outer Richmond) to 94118 (Presidio Heights) is ~1.5 miles
    const r1 = SF_ZIP_CENTROIDS[94121];
    const r2 = SF_ZIP_CENTROIDS[94118];
    const dist = haversineDistanceMiles(r1.lat, r1.lon, r2.lat, r2.lon);
    assert.ok(dist >= 1.0 && dist <= 2.0);
  });

  await t.test('Evaluates immediate neighborhood for same zip code', () => {
    const prox = evaluateProximity(94121, SF_ZIP_CENTROIDS[94121], 94121);
    assert.equal(prox.proximityLevel, 3.0);
    assert.equal(prox.isImmediateNeighborhood, true);
  });

  await t.test('Penalizes cross-town commute (e.g. Richmond 94121 to Bayview 94124)', () => {
    const prox = evaluateProximity(94124, SF_ZIP_CENTROIDS[94124], 94121);
    assert.ok(prox.distanceMiles > 5.0);
    assert.ok(prox.proximityLevel <= 1.0);
    assert.equal(prox.isImmediateNeighborhood, false);
  });

  await t.test('prioritizes a substantially closer center over a cheaper distant one', () => {
    const candidates = [
      { name: 'Distant and cheap', distanceMiles: 6, estimatedNetOutOfPocketMonthly: 100 },
      { name: 'Nearby and pricier', distanceMiles: 2, estimatedNetOutOfPocketMonthly: 400 }
    ];
    const ranked = rankCandidates(candidates, 94121);
    assert.equal(ranked[0].name, 'Nearby and pricier');
  });
});
