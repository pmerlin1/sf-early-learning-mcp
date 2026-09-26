// San Francisco Geolocation & Proximity Utilities

export const SF_ZIP_CENTROIDS = {
  94121: { lat: 37.7777, lon: -122.4847, neighborhood: 'Outer Richmond' },
  94118: { lat: 37.7825, lon: -122.4578, neighborhood: 'Inner Richmond / Presidio Heights' },
  94122: { lat: 37.7587, lon: -122.4847, neighborhood: 'Sunset' },
  94116: { lat: 37.7441, lon: -122.4847, neighborhood: 'Parkside / Outer Sunset' },
  94115: { lat: 37.7877, lon: -122.4384, neighborhood: 'Pacific Heights / Western Addition' },
  94117: { lat: 37.7702, lon: -122.4437, neighborhood: 'Haight-Ashbury / Cole Valley' },
  94114: { lat: 37.7587, lon: -122.4357, neighborhood: 'Castro / Noe Valley' },
  94110: { lat: 37.7509, lon: -122.4153, neighborhood: 'Mission / Bernal Heights' },
  94109: { lat: 37.7925, lon: -122.4217, neighborhood: 'Nob Hill / Russian Hill / Polk' },
  94133: { lat: 37.8003, lon: -122.4087, neighborhood: 'North Beach / Chinatown' },
  94108: { lat: 37.7915, lon: -122.4077, neighborhood: 'Chinatown / Financial District' },
  94102: { lat: 37.7797, lon: -122.4192, neighborhood: 'Hayes Valley / Tenderloin / Civic Center' },
  94103: { lat: 37.7725, lon: -122.4117, neighborhood: 'South of Market (SOMA)' },
  94107: { lat: 37.7658, lon: -122.3957, neighborhood: 'Potrero Hill / Mission Bay' },
  94124: { lat: 37.7312, lon: -122.3887, neighborhood: 'Bayview / Hunters Point' },
  94134: { lat: 37.7196, lon: -122.4097, neighborhood: 'Visitacion Valley / Portola' },
  94112: { lat: 37.7247, lon: -122.4437, neighborhood: 'Excelsior / Ingleside' },
  94132: { lat: 37.7212, lon: -122.4777, neighborhood: 'Lake Merced / Parkmerced' },
  94123: { lat: 37.7997, lon: -122.4384, neighborhood: 'Marina / Cow Hollow' },
  94129: { lat: 37.7987, lon: -122.4647, neighborhood: 'Presidio' },
  94131: { lat: 37.7447, lon: -122.4437, neighborhood: 'Twin Peaks / Glen Park' },
  94158: { lat: 37.7712, lon: -122.3917, neighborhood: 'Mission Bay' },
  // Census 2020 ZCTA internal points. A zip missing from this table is left out of every
  // neighborhood search, so each San Francisco ZCTA needs an entry.
  94104: { lat: 37.7914, lon: -122.4021, neighborhood: 'Financial District' },
  94105: { lat: 37.7896, lon: -122.3931, neighborhood: 'Rincon Hill / South Beach / Transbay' },
  94111: { lat: 37.7994, lon: -122.3984, neighborhood: 'Embarcadero / Jackson Square' },
  94127: { lat: 37.7360, lon: -122.4572, neighborhood: 'West Portal / St. Francis Wood / Miraloma' },
  94130: { lat: 37.8207, lon: -122.3695, neighborhood: 'Treasure Island / Yerba Buena Island' }
};

/**
 * Calculates Haversine distance in statute miles between two coordinate pairs.
 */
export function haversineDistanceMiles(lat1, lon1, lat2, lon2) {
  if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) return null;
  const toRad = deg => (deg * Math.PI) / 180;
  const R = 3958.8; // Earth radius in miles

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Number((R * c).toFixed(2));
}

/**
 * Resolves coordinates for a location descriptor (zip code, address, or coordinates).
 */
export function resolveCoordinates(input) {
  if (!input) return null;
  if (typeof input === 'object' && input.lat != null && input.lon != null) {
    return { lat: Number(input.lat), lon: Number(input.lon) };
  }
  const zipMatch = String(input).match(/\b941\d{2}\b/);
  if (zipMatch) {
    const zip = Number(zipMatch[0]);
    if (SF_ZIP_CENTROIDS[zip]) {
      return SF_ZIP_CENTROIDS[zip];
    }
  }
  return null;
}

/**
 * Evaluates proximity and returns distance in miles, level (0 to 3), and description.
 */
export function evaluateProximity(facilityZip, facilityCoords, homeLocation) {
  const homeCoords = resolveCoordinates(homeLocation);
  if (!homeCoords) {
    return {
      distanceMiles: null,
      proximityLevel: 2, // Neutral default
      proximityRating: 'Unspecified location',
      isImmediateNeighborhood: false
    };
  }

  let facLat = null;
  let facLon = null;

  if (facilityCoords && facilityCoords.lat != null && facilityCoords.lon != null) {
    facLat = Number(facilityCoords.lat);
    facLon = Number(facilityCoords.lon);
  } else if (facilityZip && SF_ZIP_CENTROIDS[facilityZip]) {
    facLat = SF_ZIP_CENTROIDS[facilityZip].lat;
    facLon = SF_ZIP_CENTROIDS[facilityZip].lon;
  }

  if (facLat == null || facLon == null) {
    return {
      distanceMiles: null,
      proximityLevel: 1.5,
      proximityRating: 'Approximate San Francisco',
      isImmediateNeighborhood: false
    };
  }

  const dist = haversineDistanceMiles(homeCoords.lat, homeCoords.lon, facLat, facLon);
  const sameZip = facilityZip && String(facilityZip) === String(homeLocation);

  // Proximity levels:
  // Level 3: Immediate neighborhood (< 1.2 miles or same zip code)
  // Level 2: Adjacent neighborhood (1.2 to 2.5 miles)
  // Level 1: Moderate cross-town commute (2.5 to 4.5 miles)
  // Level 0: Long commute / opposite side of town (> 4.5 miles)
  let level = 0.0;
  let rating = 'Cross-town commute';

  if (sameZip || dist <= 1.2) {
    level = 3.0;
    rating = dist <= 0.5 ? 'Walking distance (< 0.5 mi)' : `Immediate neighborhood (${dist} mi)`;
  } else if (dist <= 2.5) {
    level = 2.2;
    rating = `Adjacent neighborhood (${dist} mi)`;
  } else if (dist <= 4.5) {
    level = 1.2;
    rating = `Moderate commute across town (${dist} mi)`;
  } else {
    level = 0.3;
    rating = `Long commute across town (${dist} mi)`;
  }

  return {
    distanceMiles: dist,
    proximityLevel: level,
    proximityRating: rating,
    isImmediateNeighborhood: sameZip || dist <= 1.2
  };
}

/**
 * Returns San Francisco zip codes whose centroid lies within a straight-line radius
 * (in statute miles) of a home zip code or coordinate pair, closest first.
 * Returns null when the home location cannot be resolved.
 */
export function getNearbyZipCodes(homeLocation, maxDistanceMiles = 3.5) {
  const homeCoords = resolveCoordinates(homeLocation);
  if (!homeCoords) return null;

  return Object.entries(SF_ZIP_CENTROIDS)
    .map(([zip, data]) => {
      const dist = haversineDistanceMiles(homeCoords.lat, homeCoords.lon, data.lat, data.lon);
      return { zip: Number(zip), dist };
    })
    .filter(({ dist }) => dist !== null && dist <= maxDistanceMiles)
    .sort((a, b) => a.dist - b.dist)
    .map(({ zip }) => zip);
}
