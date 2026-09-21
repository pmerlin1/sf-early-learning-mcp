// California Department of Social Services (CDSS)
// Community Care Licensing Division (CCLD) Transparency API Client

const CCLD_DETAIL_URL = 'https://www.ccld.dss.ca.gov/transparencyapi/api/FacilityDetail';
const CCLD_SEARCH_URL = 'https://www.ccld.dss.ca.gov/transparencyapi/api/FacilitySearch';

const cache = new Map();

/**
 * Fetch detailed state licensing and inspection records for a facility by California license number.
 */
export async function getFacilityDetail(licenseNumber) {
  if (!licenseNumber) return null;
  const cleanLic = String(licenseNumber).trim();
  if (cache.has(cleanLic)) {
    return cache.get(cleanLic);
  }

  const url = `${CCLD_DETAIL_URL}/${cleanLic}`;
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    const f = data.FacilityDetail || {};

    const typeAFromInsp = Number(f.NBRINSPTYPA) || 0;
    const typeAFromCmplt = Number(f.NBRCMPLTTYPA) || 0;
    const totalTypeA = typeAFromInsp + typeAFromCmplt + (Number(f.TOTTYPEA) || 0);

    const typeBFromInsp = Number(f.NBRINSPTYPB) || 0;
    const typeBFromCmplt = Number(f.NBRCMPLTTYPB) || 0;
    const totalTypeB = typeBFromInsp + typeBFromCmplt + (Number(f.TOTTYPEB) || 0);

    const complaintVisits = Number(f.NBRCMPLTVISITS) || Number(f.TOTCMPVISITS) || 0;
    const substantiatedAllegations = Number(f.TOTSUBALG) || 0;

    let rating = 'pristine';
    let safetySummary = 'Zero citations or complaints ever recorded.';

    if (totalTypeA > 0 || substantiatedAllegations > 0) {
      rating = 'caution';
      safetySummary = `Caution: ${totalTypeA} Type A citations and/or ${substantiatedAllegations} substantiated complaint allegations.`;
    } else if (totalTypeB > 2 || complaintVisits > 2) {
      rating = 'notable_citations';
      safetySummary = `Notice: ${totalTypeB} Type B citations and ${complaintVisits} complaint visits on file.`;
    } else if (totalTypeB > 0 || complaintVisits > 0) {
      rating = 'minor_findings';
      safetySummary = `Minor findings: ${totalTypeB} Type B citations (routine/records) and ${complaintVisits} complaint visits (unsubstantiated).`;
    }

    const result = {
      licenseNumber: cleanLic,
      facilityName: f.FACILITYNAME || '',
      status: f.STATUS || 'Licensed',
      capacity: Number(f.CAPACITY) || null,
      lastVisitDate: f.LASTVISITDATE || 'N/A',
      complaintVisits,
      substantiatedAllegations,
      totalTypeA,
      totalTypeB,
      rating,
      safetySummary,
      comments: (f.COMMENTS || '') + (f.COMMENTS2 ? ' ' + f.COMMENTS2 : ''),
      isToddlerOptionExplicit: /toddler/i.test((f.COMMENTS || '') + (f.COMMENTS2 || ''))
    };

    cache.set(cleanLic, result);
    return result;
  } catch (err) {
    console.error(`CCLD lookup error for license ${cleanLic}:`, err.message);
    return null;
  }
}

/**
 * Search CCLD child care centers by zip code and/or facility name.
 * facType 850 = Child Care Center
 */
export async function searchFacilities({ zipCode, facilityName, facType = '850' } = {}) {
  const params = new URLSearchParams({
    facType: facType || '850',
    facility: facilityName || '',
    Street: '',
    city: 'San Francisco',
    zip: zipCode ? String(zipCode) : '',
    county: 'San Francisco',
    facnum: ''
  });

  const url = `${CCLD_SEARCH_URL}?${params.toString()}`;
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.FACILITYARRAY || [];
  } catch (e) {
    console.error('CCLD search error:', e.message);
    return [];
  }
}
