import test from 'node:test';
import assert from 'node:assert/strict';
import {
  haversineDistanceMiles,
  evaluateProximity,
  getNearbyZipCodes,
  SF_ZIP_CENTROIDS
} from '../src/geo-utils.js';
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

test('nearby zip codes for neighborhood searches', async (t) => {
  await t.test('covers every San Francisco ZCTA, so no neighborhood is skipped', () => {
    const sfZctas = [
      94102, 94103, 94104, 94105, 94107, 94108, 94109, 94110, 94111, 94112, 94114, 94115, 94116,
      94117, 94118, 94121, 94122, 94123, 94124, 94127, 94129, 94130, 94131, 94132, 94133, 94134,
      94158
    ];
    for (const zip of sfZctas) assert.ok(SF_ZIP_CENTROIDS[zip], 'missing centroid for ' + zip);
  });

  await t.test('lists the home zip first, then zips in order of distance', () => {
    const zips = getNearbyZipCodes(94121, 3.8);
    assert.equal(zips[0], 94121);
    const home = SF_ZIP_CENTROIDS[94121];
    const distances = zips.map((zip) => haversineDistanceMiles(
      home.lat, home.lon, SF_ZIP_CENTROIDS[zip].lat, SF_ZIP_CENTROIDS[zip].lon
    ));
    assert.deepEqual(distances, [...distances].sort((a, b) => a - b));
    assert.ok(distances.every((distance) => distance <= 3.8));
    assert.ok(!zips.includes(94124), 'Bayview is a cross-town commute from the Outer Richmond');
  });

  await t.test('reaches neighbors that were missing from the centroid table', () => {
    assert.ok(getNearbyZipCodes(94116, 2.5).includes(94127), 'West Portal borders Parkside');
    const potreroHill = getNearbyZipCodes(94107, 2.5);
    for (const zip of [94104, 94105, 94111]) assert.ok(potreroHill.includes(zip), String(zip));
    assert.equal(getNearbyZipCodes(94127, 1.2)[0], 94127);
  });

  await t.test('returns null for a location it cannot place', () => {
    assert.equal(getNearbyZipCodes(undefined), null);
    assert.equal(getNearbyZipCodes(94015), null);
  });
});
