import {
  ELFA_CREDIT_BASIS,
  ELFA_INCOME_TABLE_FY26_27,
  ELFA_RATES_FY26_27,
  ELFA_SOURCE_LIST,
  FINANCIAL_ASSISTANCE_MAP,
  LANGUAGE_MAP,
  LARGEST_ELFA_FAMILY_SIZE
} from './constants.js';

const usd = (amount) => '$' + amount.toLocaleString('en-US');

/**
 * Payload for the get_elfa_rates_and_rules tool: DEC's FY 2026-2027 rates, income ceilings,
 * and rules, with the DEC documents they come from.
 */
export function getElfaRatesAndRules() {
  const fullTime = ELFA_RATES_FY26_27.fullTimeMonthlyReimbursement;
  const half = ELFA_RATES_FY26_27.halfCreditMonthly;
  return {
    ratesFY2627: ELFA_RATES_FY26_27,
    incomeEligibilityCeilings: ELFA_INCOME_TABLE_FY26_27,
    languages: LANGUAGE_MAP,
    financialAssistancePrograms: FINANCIAL_ASSISTANCE_MAP,
    rulesSummary: [
      'ELFA Free Tuition (0-110% AMI): 100% free enrollment; programs CANNOT charge any co-pays or fees.',
      'ELFA Full Tuition Credit (111-150% AMI): Monthly credit equal to 100% of DEC\'s full-time rate (' +
        usd(fullTime.infant.rate) + ' Infant, ' + usd(fullTime.toddler.rate) + ' Toddler, ' +
        usd(fullTime.preschool.rate) + ' Preschooler); programs may charge a co-pay equal to private tuition minus credit.',
      'ELFA Half Tuition Credit (151-200% AMI): Monthly credit equal to 50% of DEC\'s full-time rate (' +
        usd(half.infant) + ' Infant, ' + usd(half.toddler) + ' Toddler, ' + usd(half.preschool) +
        ' Preschooler); family pays remaining tuition.',
      'Part-time care: ' + ELFA_CREDIT_BASIS,
      'Over 200% AMI: Private pay, though some programs offer sliding scales or district TK for 4-year-olds.',
      'Age Groups: Infant = 0-24 months; Toddler = 24-36 months; Preschooler = 3-5 years (36-60+ months).',
      'Income ceilings cover families of 1 to ' + LARGEST_ELFA_FAMILY_SIZE + '. DEC uses the 2-person ' +
        'figures for 1-person families and repeats the 11-person ELFA figures for 12-person families.'
    ],
    sources: ELFA_SOURCE_LIST
  };
}

export function calculateEligibility({ familySize, monthlyIncome, annualIncome, childAgeYears }) {
  const householdSize = Math.max(1, Math.round(Number(familySize) || 3));
  // DEC publishes ceilings only up to LARGEST_ELFA_FAMILY_SIZE. A larger household is checked
  // against that row and flagged, because its actual ceilings would be higher.
  const size = Math.min(LARGEST_ELFA_FAMILY_SIZE, householdSize);
  const monthly = monthlyIncome !== undefined ? Number(monthlyIncome) : (Number(annualIncome) / 12);
  const annual = annualIncome !== undefined ? Number(annualIncome) : (Number(monthlyIncome) * 12);

  const table = ELFA_INCOME_TABLE_FY26_27[size];

  let tier = 'privatePay';
  let tierName = 'Private Pay (Over 200% AMI)';
  let copayAllowed = true;
  let explanation = '';

  if (monthly <= table.cctrMonthly) {
    tier = 'cctrStateAndElfaFree';
    tierName = 'State CCTR / CSPP & ELFA Free Tuition (0-85% SMI / 0-110% AMI)';
    copayAllowed = false;
    explanation = `Your monthly income of $${monthly.toFixed(0)} is at or below the state CCTR/CSPP ceiling ($${table.cctrMonthly}/mo) and ELFA Free Tuition ceiling ($${table.freeMonthly}/mo). You qualify for 100% free early childhood education with zero co-pays.`;
  } else if (monthly <= table.freeMonthly) {
    tier = 'elfaFreeTuition';
    tierName = 'ELFA Free Tuition (0-110% AMI)';
    copayAllowed = false;
    explanation = `Your monthly income of $${monthly.toFixed(0)} is within 110% AMI (up to $${table.freeMonthly}/mo for a family of ${size}). You are eligible for 100% free enrollment at ANY ELFA program with ZERO co-pays.`;
  } else if (monthly <= table.fullMonthly) {
    tier = 'elfaFullCredit';
    tierName = 'ELFA Full Tuition Credit (111-150% AMI)';
    copayAllowed = true;
    explanation = `Your monthly income of $${monthly.toFixed(0)} is between 111% and 150% AMI (up to $${table.fullMonthly}/mo for a family of ${size}). You qualify for a monthly credit equal to 100% of DEC's full-time reimbursement rate for your child's age group, for full-time or part-time care. Programs may charge a co-pay if private tuition exceeds the credit.`;
  } else if (monthly <= table.halfMonthly) {
    tier = 'elfaHalfCredit';
    tierName = 'ELFA Half Tuition Credit (151-200% AMI)';
    copayAllowed = true;
    explanation = `Your monthly income of $${monthly.toFixed(0)} is between 151% and 200% AMI (up to $${table.halfMonthly}/mo for a family of ${size}). You qualify for a monthly credit equal to 50% of DEC's full-time reimbursement rate for your child's age group, for full-time or part-time care. You pay the remaining balance.`;
  } else {
    tier = 'privatePay';
    tierName = 'Over 200% AMI (Private Pay)';
    copayAllowed = true;
    explanation = `Your monthly income of $${monthly.toFixed(0)} exceeds 200% AMI ($${table.halfMonthly}/mo for a family of ${size}). You do not qualify for ELFA subsidies, but you can explore sliding-scale or district TK programs.`;
  }

  // Determine age category and credit amounts
  let ageCategory = 'preschool';
  let fullMonthlyReimbursement = ELFA_RATES_FY26_27.fullTimeMonthlyReimbursement.preschool.rate;
  let partTimeMonthlyReimbursement = ELFA_RATES_FY26_27.partTimeMonthlyReimbursement.preschool.rate;
  let monthlyCreditAmount = 0;

  if (childAgeYears !== undefined) {
    const ageMonths = Number(childAgeYears) * 12;
    if (ageMonths < 24) {
      ageCategory = 'infant';
      fullMonthlyReimbursement = ELFA_RATES_FY26_27.fullTimeMonthlyReimbursement.infant.rate;
      partTimeMonthlyReimbursement = ELFA_RATES_FY26_27.partTimeMonthlyReimbursement.infant.rate;
    } else if (ageMonths < 36) {
      ageCategory = 'toddler';
      fullMonthlyReimbursement = ELFA_RATES_FY26_27.fullTimeMonthlyReimbursement.toddler.rate;
      partTimeMonthlyReimbursement = ELFA_RATES_FY26_27.partTimeMonthlyReimbursement.toddler.rate;
    } else {
      ageCategory = 'preschool';
      fullMonthlyReimbursement = ELFA_RATES_FY26_27.fullTimeMonthlyReimbursement.preschool.rate;
      partTimeMonthlyReimbursement = ELFA_RATES_FY26_27.partTimeMonthlyReimbursement.preschool.rate;
    }
  }

  if (tier === 'elfaFreeTuition' || tier === 'cctrStateAndElfaFree') {
    monthlyCreditAmount = fullMonthlyReimbursement; // 100% free
  } else if (tier === 'elfaFullCredit') {
    monthlyCreditAmount = fullMonthlyReimbursement;
  } else if (tier === 'elfaHalfCredit') {
    monthlyCreditAmount = ELFA_RATES_FY26_27.halfCreditMonthly[ageCategory];
  }

  return {
    familySize: householdSize,
    thresholdFamilySize: size,
    ...(householdSize > size ? {
      familySizeNote: 'DEC publishes income ceilings for families of up to ' + size + ' people. ' +
        'This family of ' + householdSize + ' was checked against the ' + size + '-person ceilings, ' +
        'which can understate its eligibility; confirm the tier with DEC or a resource and referral agency.'
    } : {}),
    monthlyIncome: monthly,
    annualIncome: annual,
    childAgeYears: childAgeYears !== undefined ? Number(childAgeYears) : null,
    ageCategory,
    tier,
    tierName,
    copayAllowed,
    monthlyCreditAmount,
    fullReimbursementRate: fullMonthlyReimbursement,
    partTimeReimbursementRate: partTimeMonthlyReimbursement,
    creditBasis: ELFA_CREDIT_BASIS,
    explanation,
    thresholds: {
      freeTuitionMonthlyCeiling: table.freeMonthly,
      fullCreditMonthlyCeiling: table.fullMonthly,
      halfCreditMonthlyCeiling: table.halfMonthly
    },
    sources: ELFA_SOURCE_LIST
  };
}
