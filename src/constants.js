// Authoritative San Francisco Department of Early Childhood (DEC) Data
// Fiscal Year 2026-2027 (July 1, 2026 - June 30, 2027)

export const ELFA_RATES_FY26_27 = {
  fiscalYear: '2026-2027',
  effectiveDates: 'July 1, 2026 - June 30, 2027',
  fullTimeMonthlyReimbursement: {
    infant: { minAgeMonths: 0, maxAgeMonths: 24, rate: 3027, annual: 36324 },
    toddler: { minAgeMonths: 24, maxAgeMonths: 36, rate: 2306, annual: 27672 },
    preschool: { minAgeMonths: 36, maxAgeMonths: 60, rate: 2115, annual: 25380 }
  },
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

// Income Eligibility Ceilings (HUD AMI / California SMI published May/June 2026)
export const ELFA_INCOME_TABLE_FY26_27 = {
  // Family Size -> { cctr85SmiMonthly, cctr85SmiAnnual, cspp100SmiMonthly, cspp100SmiAnnual, free110AmiMonthly, free110AmiAnnual, full150AmiMonthly, full150AmiAnnual, half200AmiMonthly, half200AmiAnnual }
  1: { freeMonthly: 11888, freeAnnual: 142650, fullMonthly: 16213, fullAnnual: 194550, halfMonthly: 21617, halfAnnual: 259400, cctrMonthly: 7119, csppMonthly: 8376 },
  2: { freeMonthly: 11888, freeAnnual: 142650, fullMonthly: 16213, fullAnnual: 194550, halfMonthly: 21617, halfAnnual: 259400, cctrMonthly: 7119, csppMonthly: 8376 },
  3: { freeMonthly: 13375, freeAnnual: 160500, fullMonthly: 18238, fullAnnual: 218850, halfMonthly: 24317, halfAnnual: 291800, cctrMonthly: 8054, csppMonthly: 9476 },
  4: { freeMonthly: 14859, freeAnnual: 178300, fullMonthly: 20263, fullAnnual: 243150, halfMonthly: 27017, halfAnnual: 324200, cctrMonthly: 9636, csppMonthly: 11337 },
  5: { freeMonthly: 16046, freeAnnual: 192550, fullMonthly: 21884, fullAnnual: 262600, halfMonthly: 29175, halfAnnual: 350100, cctrMonthly: 11178, csppMonthly: 13151 },
  6: { freeMonthly: 17238, freeAnnual: 206850, fullMonthly: 23509, fullAnnual: 282100, halfMonthly: 31342, halfAnnual: 376100, cctrMonthly: 12720, csppMonthly: 14965 },
  7: { freeMonthly: 18425, freeAnnual: 221100, fullMonthly: 25125, fullAnnual: 301500, halfMonthly: 33500, halfAnnual: 402000, cctrMonthly: 13009, csppMonthly: 15305 },
  8: { freeMonthly: 19613, freeAnnual: 235350, fullMonthly: 26746, fullAnnual: 320950, halfMonthly: 35659, halfAnnual: 427900, cctrMonthly: 13298, csppMonthly: 15645 }
};

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
