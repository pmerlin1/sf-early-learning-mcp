import { ELFA_INCOME_TABLE_FY26_27, ELFA_RATES_FY26_27 } from './constants.js';

export function calculateEligibility({ familySize, monthlyIncome, annualIncome, childAgeYears }) {
  const size = Math.max(1, Math.min(8, Math.round(Number(familySize) || 3)));
  const monthly = monthlyIncome !== undefined ? Number(monthlyIncome) : (Number(annualIncome) / 12);
  const annual = annualIncome !== undefined ? Number(annualIncome) : (Number(monthlyIncome) * 12);

  const table = ELFA_INCOME_TABLE_FY26_27[size] || ELFA_INCOME_TABLE_FY26_27[8];

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
    explanation = `Your monthly income of $${monthly.toFixed(0)} is between 111% and 150% AMI (up to $${table.fullMonthly}/mo for a family of ${size}). You qualify for a monthly credit equal to 100% of the DEC reimbursement rate. Programs may charge a co-pay if private tuition exceeds the credit.`;
  } else if (monthly <= table.halfMonthly) {
    tier = 'elfaHalfCredit';
    tierName = 'ELFA Half Tuition Credit (151-200% AMI)';
    copayAllowed = true;
    explanation = `Your monthly income of $${monthly.toFixed(0)} is between 151% and 200% AMI (up to $${table.halfMonthly}/mo for a family of ${size}). You qualify for a monthly discount equal to 50% of the DEC reimbursement rate. You pay the remaining balance.`;
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
    familySize: size,
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
    explanation,
    thresholds: {
      freeTuitionMonthlyCeiling: table.freeMonthly,
      fullCreditMonthlyCeiling: table.fullMonthly,
      halfCreditMonthlyCeiling: table.halfMonthly
    }
  };
}
