 // California Department of Social Services (CDSS)
 // Community Care Licensing Division (CCLD) Transparency API Client

import { ccldFacilityUrl, summarizeInspectionRecord } from './ccld-utils.js';
import { createAsyncTtlCache, isCacheEnabled } from './async-cache.js';
import { fetchWithRetry } from './http-retry.js';

const CCLD_DETAIL_URL = 'https://www.ccld.dss.ca.gov/transparencyapi/api/FacilityDetail';
const CCLD_SEARCH_URL = 'https://www.ccld.dss.ca.gov/transparencyapi/api/FacilitySearch';

const FACILITY_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const facilityCache = createAsyncTtlCache({
  ttlMs: FACILITY_CACHE_TTL_MS,
  maxEntries: 4000,
  shouldCache: (record) => record?.verificationStatus === 'verified'
});

const unavailableRecord = (licenseNumber, verificationStatus, summary) => ({
  licenseNumber,
  ccldFacilityUrl: ccldFacilityUrl(licenseNumber),
  verificationStatus,
  inspectionDataStatus: 'unavailable',
  status: null,
  rating: 'unknown',
  safetySummary: summary,
  totalTypeA: null,
  totalTypeB: null,
  complaintVisits: null,
  substantiatedAllegations: null
});

/**
 * Fetch detailed state licensing and inspection records for a facility by California license number.
 */
async function fetchFacilityDetail(cleanLic, retryOptions = {}) {
  const url = CCLD_DETAIL_URL + '/' + cleanLic;
  try {
    const response = await fetchWithRetry(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    }, retryOptions);

    if (!response.ok) {
      return unavailableRecord(
        cleanLic,
        'unavailable',
        'CCLD lookup unavailable (HTTP ' + response.status + ').'
      );
    }

    const data = await response.json();
    const f = data?.FacilityDetail;

    if (!f) {
      return unavailableRecord(
        cleanLic,
        'not_found',
        'No CCLD facility record was returned for this license.'
      );
    }

    const result = {
      licenseNumber: cleanLic,
      facilityName: f.FACILITYNAME || '',
      ccldFacilityUrl: ccldFacilityUrl(cleanLic),
      ...summarizeInspectionRecord(f)
    };

    return result;
  } catch (err) {
    console.error('CCLD lookup error for license ' + cleanLic + ':', err.message);
    const attempts = err.attempts || 1;
    const lastStatus = err.status == null ? '' : ' (last response HTTP ' + err.status + ')';
    return unavailableRecord(
      cleanLic,
      'unavailable',
      'CCLD lookup failed after ' + attempts + ' attempt' + (attempts === 1 ? '' : 's') +
        lastStatus + '; inspection history could not be verified.'
    );
  }
}

/** Fetch a facility record, caching only verified records for six hours. */
export function getFacilityDetail(licenseNumber, retryOptions = {}) {
  if (!licenseNumber) return Promise.resolve(null);
  const cleanLic = String(licenseNumber).trim();
  return facilityCache.getOrLoad(
    cleanLic,
    () => fetchFacilityDetail(cleanLic, retryOptions),
    isCacheEnabled()
  );
}

/**
 * Search CCLD child care centers by zip code and/or facility name.
 * facType 850 = Child Care Center
 */
export async function searchFacilities({ zipCode, facilityName, facType = '850' } = {}, retryOptions = {}) {
  const params = new URLSearchParams({
    facType: facType || '850',
    facility: facilityName || '',
    Street: '',
    city: 'San Francisco',
    zip: zipCode ? String(zipCode) : '',
    county: 'San Francisco',
    facnum: ''
  });

  const url = CCLD_SEARCH_URL + '?' + params.toString();
  try {
    const res = await fetchWithRetry(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    }, retryOptions);
    if (!res.ok) return [];
    const data = await res.json();
    return data.FACILITYARRAY || [];
  } catch (e) {
    console.error('CCLD search error:', e.message);
    throw e;
  }
}
