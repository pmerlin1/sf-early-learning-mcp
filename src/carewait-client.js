import {
  CAREWAIT_API_KEY,
  CAREWAIT_SEARCH_URL,
  CAREWAIT_SITE_URL,
  LANGUAGE_MAP,
  LANGUAGE_NAME_TO_CODE,
  PROGRAM_TYPES,
  FINANCIAL_ASSISTANCE_MAP
} from './constants.js';
import { getFacilityDetail } from './ccld-client.js';
import { combineInspectionRecords } from './ccld-utils.js';
import { getCareSupportEvidence } from './recommendation-utils.js';

const ALL_SF_ZIPS = [
  94016, 94101, 94106, 94112, 94119, 94121, 94131, 94133, 94135, 94138, 94141, 94143, 94156, 94163, 94175, 94199,
  94103, 94105, 94115, 94116, 94125, 94126, 94129, 94130, 94139, 94142, 94145, 94147, 94153, 94154, 94160, 94171,
  94172, 94102, 94108, 94117, 94134, 94151, 94159, 94161, 94162, 94107, 94109, 94111, 94120, 94124, 94132, 94140,
  94144, 94146, 94150, 94158, 94177, 94188, 94013, 94104, 94110, 94114, 94118, 94122, 94123, 94127, 94136, 94137,
  94152, 94155, 94164
];

export async function searchProfiles(options = {}) {
  const {
    ageYears,
    programType,
    financialAid,
    language,
    schedule,
    hours,
    curriculum,
    openingsOnly,
    zipCodes,
    skip = 0,
    take = 50
  } = options;

  const query = {
    CareWait2WorkspaceId: ['6a10084583739fa8573ea07f'],
    ages: [],
    schedule: [],
    calendar: [],
    hours: [],
    additionalInfo: [],
    accommodations: [],
    programType: [],
    availability: [],
    financialAid: [],
    language: [],
    education: [],
    version: [2, 3],
    'pin.zipCode': (zipCodes && zipCodes.length > 0) ? zipCodes.map(Number) : ALL_SF_ZIPS
  };

  if (ageYears !== undefined) {
    const ageNum = Math.floor(Number(ageYears));
    if (!isNaN(ageNum)) {
      query.ages = [String(ageNum)];
    }
  }

  if (programType) {
    // 'any' means no program-type restriction. Sent as-is, CareWait treats it as an unknown
    // type and returns zero results.
    const types = (Array.isArray(programType) ? programType : [programType])
      .filter((type) => type && type !== 'any');
    query.programType = types.map(t => PROGRAM_TYPES[t] || t);
  }

  if (financialAid) {
    const aids = Array.isArray(financialAid) ? financialAid : [financialAid];
    query.financialAid = aids;
  }

  if (language) {
    const langs = Array.isArray(language) ? language : [language];
    query.language = langs.map(l => {
      const code = LANGUAGE_NAME_TO_CODE[l.toLowerCase()];
      return code || l;
    });
  }

  if (schedule) {
    const scheds = Array.isArray(schedule) ? schedule : [schedule];
    query.schedule = scheds;
  }

  if (hours) {
    const hrs = Array.isArray(hours) ? hours : [hours];
    query.hours = hrs;
  }

  if (curriculum) {
    const currs = Array.isArray(curriculum) ? curriculum : [curriculum];
    query.education = currs;
  }

  if (openingsOnly) {
    query.availability = ['1100']; // Openings Now
  }

  const payload = {
    boundingBox: [-122.4194155, 37.7749295],
    query,
    sort: null,
    fields: null,
    skip,
    take,
    seedNumber: 1990044526
  };

  const response = await fetch(CAREWAIT_SEARCH_URL, {
    method: 'POST',
    headers: {
      'x-api-key': CAREWAIT_API_KEY,
      'content-type': 'application/json',
      accept: 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`CareWait search failed with status ${response.status}: ${await response.text()}`);
  }

  const result = await response.json();
  const total = result.total ? result.total.value : 0;
  const items = (result.data || []).map(hit => {
    const s = hit._source || {};
    return {
      entityId: s.entityId,
      programName: s.programName,
      programType: s.programType,
      minAge: s.minAge,
      maxAge: s.maxAge,
      address: s.pin ? s.pin.address : '',
      zipCode: s.pin ? s.pin.zipCode : '',
      description: s.programDescription || '',
      licenseNumbers: s.licenseNumbers || []
    };
  });

  return { total, items, skip, take };
}

/**
 * Extract every California facility license number from a CareWait profile.
 * CareWait returns `license` as an array of objects
 * (e.g. [{ facilityNumber: "384002962", facilityStatus: "licensed", ... }]), and
 * providers with separate infant and preschool licenses list one entry per license.
 * Older or search-index shapes may provide plain strings or `licenseNumbers`.
 * Only digit strings are returned, so an object can never be sent to CCLD.
 */
export function extractLicenseNumbers(profile) {
  const toList = (value) => (Array.isArray(value) ? value : (value == null ? [] : [value]));
  const candidates = [
    ...toList(profile?.license).map((entry) =>
      entry && typeof entry === 'object'
        ? (entry.facilityNumber ?? entry.licenseNumber ?? entry.number)
        : entry
    ),
    ...toList(profile?.licenseNumbers)
  ];

  const numbers = [];
  for (const candidate of candidates) {
    const value = candidate == null ? '' : String(candidate).trim();
    if (/^\d{6,12}$/.test(value) && !numbers.includes(value)) numbers.push(value);
  }
  return numbers;
}

export function extractLicenseNumber(profile) {
  return extractLicenseNumbers(profile)[0] || null;
}

export async function getSiteDetails(entityId) {
  const url = `${CAREWAIT_SITE_URL}/${entityId}`;
  const response = await fetch(url, {
    headers: {
      'x-api-key': CAREWAIT_API_KEY,
      accept: 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error(`CareWait site details failed with status ${response.status}: ${await response.text()}`);
  }

  const json = await response.json();
  const prof = json.data ? json.data.profile : null;
  if (!prof) return null;

  const languagesTaught = (prof.language || []).map(code => LANGUAGE_MAP[code] || code);
  const financialAidList = (prof.financialAid || []).map(code => ({
    code,
    name: FINANCIAL_ASSISTANCE_MAP[code] || code
  }));
  const careSupportEvidence = getCareSupportEvidence(prof.accommodations || []);
  const licenseNumbers = extractLicenseNumbers(prof);
  const ccldInspections = (await Promise.all(
    licenseNumbers.map((licenseNumber) => getFacilityDetail(licenseNumber))
  )).filter(Boolean);

  // Parse rates
  const rates = prof.rates || {};
  const infantMonthly = rates.infants && rates.infants.monthly;
  const toddlerMonthly = rates.toddler && rates.toddler.monthly;
  const preschoolMonthly = rates.preschool && rates.preschool.monthly;

  return {
    entityId: prof.entityId,
    name: prof.programName,
    programType: prof.programType,
    address: prof.address ? prof.address.formattedAddress : '',
    zipCode: prof.address ? prof.address.zip : '',
    location: {
      lat: prof.address?.latitude ? Number(prof.address.latitude) : (prof.address?.location?.coordinates ? Number(prof.address.location.coordinates[1]) : null),
      lon: prof.address?.longitude ? Number(prof.address.longitude) : (prof.address?.location?.coordinates ? Number(prof.address.location.coordinates[0]) : null)
    },
    phone: prof.phoneNumber || '',
    email: prof.email || '',
    // The provider's own site, for checking tuition that CareWait leaves blank.
    website: prof.website || '',
    description: prof.programDescription || '',
    languages: languagesTaught,
    financialAid: financialAidList,
    financialAidStatus: Array.isArray(prof.financialAid) ? 'listed' : 'unknown',
    programsOffered: (prof.program || []).map(p => ({
      name: p.name,
      minAgeMonths: Number(p.minAge),
      maxAgeMonths: Number(p.maxAge),
      schedule: p.schedule || [],
      hours: p.hours || [],
      languages: (p.language || []).map(c => LANGUAGE_MAP[c] || c)
    })),
    monthlyRates: {
      infant: {
        min: infantMonthly && infantMonthly.minExists ? Number(infantMonthly.min) : null,
        max: infantMonthly && infantMonthly.maxExists ? Number(infantMonthly.max) : null
      },
      toddler: {
        min: toddlerMonthly && toddlerMonthly.minExists ? Number(toddlerMonthly.min) : null,
        max: toddlerMonthly && toddlerMonthly.maxExists ? Number(toddlerMonthly.max) : null
      },
      preschool: {
        min: preschoolMonthly && preschoolMonthly.minExists ? Number(preschoolMonthly.min) : null,
        max: preschoolMonthly && preschoolMonthly.maxExists ? Number(preschoolMonthly.max) : null
      }
    },
    rateNotes: rates.notes || '',
    schedule: prof.schedule || [],
    hours: prof.hours || [],
    accommodations: prof.accommodations || [],
    activities: prof.activities || [],
    licenseNumber: licenseNumbers[0] || null,
    licenseNumbers,
    ccldInspection: combineInspectionRecords(ccldInspections),
    ccldInspections,
    ...careSupportEvidence,
    diaperingAccommodated: careSupportEvidence.diaperingStatus === 'confirmed'
  };
}
