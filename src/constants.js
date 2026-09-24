// San Francisco Department of Early Childhood (DEC) data for fiscal year 2026-2027
// (July 1, 2026 - June 30, 2027). The rates and income ceilings below come from the DEC
// documents in ELFA_SOURCES_FY26_27. legacy.sfdec.org still shows FY 2025-2026 figures,
// so it is not cited.

export const ELFA_SOURCES_FY26_27 = {
  rates: {
    title: 'Early Learning For All Rates - Fiscal Year 2026-2027',
    publisher: 'San Francisco Department of Early Childhood (DEC)',
    url: 'https://media.api.sf.gov/documents/Early_Learning_For_All_Rates_FY_26-27.pdf',
    published: '2026-07-01',
    accessed: '2026-09-24',
    supports: 'DEC full-time and part-time reimbursement rates and the monthly ELFA credit amounts'
  },
  incomeEligibility: {
    title: 'FY 2026-2027 San Francisco Family Income Eligibility (State CDE-CDSS and ELFA)',
    publisher: 'San Francisco Department of Early Childhood (DEC)',
    url: 'https://media.api.sf.gov/documents/State_CDE-CDSS_and_ELFA_Family_Income_Eligibility_FY_26-27_1.pdf',
    published: '2026-07-01',
    accessed: '2026-09-24',
    supports: 'State CCTR and CSPP and ELFA income ceilings for families of 1 to 12'
  },
  tierRules: {
    title: 'Eligibility for free or low-cost preschool and child care',
    publisher: 'San Francisco Department of Early Childhood (DEC), on SF.gov',
    url: 'https://www.sf.gov/eligibility-for-free-or-low-cost-preschool-and-child-care',
    published: '2026-07-01',
    accessed: '2026-09-24',
    supports: 'ELFA tier definitions (credits equal 100% or 50% of DEC\'s full-time reimbursement rate) and co-pay rules'
  }
};

export const ELFA_SOURCE_LIST = Object.values(ELFA_SOURCES_FY26_27);

export const ELFA_CREDIT_BASIS =
  'ELFA credits equal 100% (Full Tuition Credit) or 50% (Half Tuition Credit) of DEC\'s full-time ' +
  'reimbursement rate for the child\'s age group, and DEC publishes one credit amount per age group, ' +
  'so the credit is the same for part-time care. The part-time rates on DEC\'s rate sheet are listed ' +
  'only to calculate funding gaps between state vouchers and ELFA rates.';

export const ELFA_RATES_FY26_27 = {
  fiscalYear: '2026-2027',
  effectiveDates: 'July 1, 2026 - June 30, 2027',
  fullTimeMonthlyReimbursement: {
    infant: { minAgeMonths: 0, maxAgeMonths: 24, rate: 3027, annual: 36324 },
    toddler: { minAgeMonths: 24, maxAgeMonths: 36, rate: 2306, annual: 27672 },
    preschool: { minAgeMonths: 36, maxAgeMonths: 60, rate: 2115, annual: 25380 }
  },
  // DEC lists part-time rates only to calculate funding gaps between state vouchers and ELFA
  // rates. They are not family credits; see ELFA_CREDIT_BASIS.
  partTimeMonthlyReimbursement: {
    infant: { minAgeMonths: 0, maxAgeMonths: 24, rate: 1669, annual: 20028 },
    toddler: { minAgeMonths: 24, maxAgeMonths: 36, rate: 1281, annual: 15372 },
    preschool: { minAgeMonths: 36, maxAgeMonths: 60, rate: 1270, annual: 15240 }
  },
  halfCreditMonthly: {
    infant: 1514,
    toddler: 1153,
    preschool: 1058
  }
};

// Gross income ceilings by family size, from DEC's "FY 2026-2027 San Francisco Family Income
// Eligibility" sheet:
//   cctrMonthly: State CCTR (85% SMI)   csppMonthly: State CSPP (100% SMI)
//   free*: ELFA Free Tuition (110% AMI)   full*: ELFA Full Tuition Credit (150% AMI)
//   half*: ELFA Half Tuition Credit (200% AMI)
// DEC combines 1- and 2-person families into one row using the 2-person figures, and its
// 12-person ELFA figures repeat the 11-person figures.
export const ELFA_INCOME_TABLE_FY26_27 = {
  1: { freeMonthly: 11888, freeAnnual: 142650, fullMonthly: 16213, fullAnnual: 194550, halfMonthly: 21617, halfAnnual: 259400, cctrMonthly: 7119, csppMonthly: 8376 },
  2: { freeMonthly: 11888, freeAnnual: 142650, fullMonthly: 16213, fullAnnual: 194550, halfMonthly: 21617, halfAnnual: 259400, cctrMonthly: 7119, csppMonthly: 8376 },
  3: { freeMonthly: 13375, freeAnnual: 160500, fullMonthly: 18238, fullAnnual: 218850, halfMonthly: 24317, halfAnnual: 291800, cctrMonthly: 8054, csppMonthly: 9476 },
  4: { freeMonthly: 14859, freeAnnual: 178300, fullMonthly: 20263, fullAnnual: 243150, halfMonthly: 27017, halfAnnual: 324200, cctrMonthly: 9636, csppMonthly: 11337 },
  5: { freeMonthly: 16046, freeAnnual: 192550, fullMonthly: 21884, fullAnnual: 262600, halfMonthly: 29175, halfAnnual: 350100, cctrMonthly: 11178, csppMonthly: 13151 },
  6: { freeMonthly: 17238, freeAnnual: 206850, fullMonthly: 23509, fullAnnual: 282100, halfMonthly: 31342, halfAnnual: 376100, cctrMonthly: 12720, csppMonthly: 14965 },
  7: { freeMonthly: 18425, freeAnnual: 221100, fullMonthly: 25125, fullAnnual: 301500, halfMonthly: 33500, halfAnnual: 402000, cctrMonthly: 13009, csppMonthly: 15305 },
  8: { freeMonthly: 19613, freeAnnual: 235350, fullMonthly: 26746, fullAnnual: 320950, halfMonthly: 35659, halfAnnual: 427900, cctrMonthly: 13298, csppMonthly: 15645 },
  9: { freeMonthly: 20805, freeAnnual: 249650, fullMonthly: 28371, fullAnnual: 340450, halfMonthly: 37825, halfAnnual: 453900, cctrMonthly: 13587, csppMonthly: 15985 },
  10: { freeMonthly: 21992, freeAnnual: 263900, fullMonthly: 29988, fullAnnual: 359850, halfMonthly: 39984, halfAnnual: 479800, cctrMonthly: 13876, csppMonthly: 16325 },
  11: { freeMonthly: 23184, freeAnnual: 278200, fullMonthly: 31613, fullAnnual: 379350, halfMonthly: 42150, halfAnnual: 505800, cctrMonthly: 14166, csppMonthly: 16665 },
  12: { freeMonthly: 23184, freeAnnual: 278200, fullMonthly: 31613, fullAnnual: 379350, halfMonthly: 42150, halfAnnual: 505800, cctrMonthly: 14455, csppMonthly: 17006 }
};

export const ELFA_FAMILY_SIZES = Object.keys(ELFA_INCOME_TABLE_FY26_27)
  .map(Number)
  .sort((a, b) => a - b);
export const LARGEST_ELFA_FAMILY_SIZE = ELFA_FAMILY_SIZES[ELFA_FAMILY_SIZES.length - 1];

export const LANGUAGE_MAP = {
  '00': 'English',
  '01': 'Spanish',
  '02': 'Vietnamese',
  '03': 'Chinese (Cantonese)',
  '04': 'Korean',
  '05': 'Tagalog',
  '06': 'Portuguese',
  '07': 'Chinese (Mandarin)',
  '08': 'Japanese',
  '09': 'Khmer',
  '11': 'Arabic',
  '12': 'Armenian',
  '15': 'Dutch',
  '16': 'Farsi',
  '17': 'French',
  '18': 'German',
  '19': 'Greek',
  '21': 'Hebrew',
  '22': 'Hindi',
  '29': 'Russian',
  '107': 'Italian',
  '-1': 'Other'
};

export const LANGUAGE_NAME_TO_CODE = {
  english: '00',
  spanish: '01',
  espanol: '01',
  vietnamese: '02',
  cantonese: '03',
  korean: '04',
  tagalog: '05',
  filipino: '05',
  portuguese: '06',
  mandarin: '07',
  chinese: '07', // default to Mandarin/Chinese
  japanese: '08',
  french: '17',
  german: '18',
  russian: '29',
  italian: '107'
};

export const FINANCIAL_ASSISTANCE_MAP = {
  freeTuitionELFA: 'ELFA Free Tuition (0-110% AMI)',
  fullCreditELFA: 'ELFA Full Tuition Credit (111-150% AMI)',
  halfCreditELFA: 'ELFA Half Tuition Credit (151-200% AMI)',
  acceptsStateSubsidies: 'Accepts State Subsidies',
  cctr: 'General Child Care and Development (CCTR - 85% SMI)',
  csppFullDay: 'State Preschool Full Day (CSPP - 100% SMI)',
  csppPartDay: 'State Preschool Part Day (CSPP - 100% SMI)',
  headStart: 'Head Start / Early Head Start',
  elop: 'Expanded Learning Opportunities Program (ELOP)',
  fcchen: 'Family Child Care Home Educational Network (FCCHEN)',
  militaryAssistance: 'Military Assistance',
  siblingDiscount: 'Sibling Discount',
  tk: 'Transitional Kindergarten (TK)',
  tuitionAssistance: 'Tuition Assistance / Sliding Scale'
};

// Daycare-type values accepted by get_smart_recommendations and compare_heuristic_vs_jev.
export const RECOMMENDATION_PROGRAM_TYPES = ['licensedCenter', 'licensedFamilyChildCare', 'any'];
export const SCHEDULE_TYPES = ['partTime', 'fullTime'];

export const PROGRAM_TYPES = {
  center: 'licensedCenter',
  licensedCenter: 'licensedCenter',
  preschool: 'licensedCenter',
  home: 'licensedFamilyChildCare',
  fcc: 'licensedFamilyChildCare',
  familyChildCare: 'licensedFamilyChildCare',
  licensedFamilyChildCare: 'licensedFamilyChildCare',
  exempt: 'licenseExemptCenterSchoolCamp'
};

export const CAREWAIT_API_KEY = process.env.CAREWAIT_API_KEY || 'lCnKwEqZed431Cjif22Zk4JOPEXzwE3e3kMTFPpQ';
export const CAREWAIT_SEARCH_URL = 'https://app.mycareconnect.io/api/public/search/profile/rd';
export const CAREWAIT_SITE_URL = 'https://app.mycareconnect.io/api/public/search/sites';
