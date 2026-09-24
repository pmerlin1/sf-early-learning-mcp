import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateEligibility, getElfaRatesAndRules } from '../src/eligibility.js';
import {
  ELFA_INCOME_TABLE_FY26_27,
  ELFA_RATES_FY26_27,
  ELFA_SOURCE_LIST,
  LARGEST_ELFA_FAMILY_SIZE
} from '../src/constants.js';

test('calculateEligibility - Income Tiers and Copay Rules', async (t) => {
  await t.test('Tier 1: Free Tuition (0-110% AMI) has zero copay', () => {
    // Family of 3 ceiling is $13,375/mo ($160,500/yr)
    const result = calculateEligibility({ familySize: 3, monthlyIncome: 13000, childAgeYears: 2.1 });
    assert.equal(result.tier, 'elfaFreeTuition');
    assert.equal(result.copayAllowed, false);
    assert.equal(result.monthlyCreditAmount, 2306); // Full toddler rate
  });

  await t.test('Tier 2: Full Tuition Credit (111-150% AMI) allows copay', () => {
    // Family of 3 between $13,376 and $18,238
    const result = calculateEligibility({ familySize: 3, monthlyIncome: 16000, childAgeYears: 2.1 });
    assert.equal(result.tier, 'elfaFullCredit');
    assert.equal(result.copayAllowed, true);
    assert.equal(result.monthlyCreditAmount, 2306);
  });

  await t.test('Tier 3: Half Tuition Credit (151-200% AMI) awards 50% DEC rate', () => {
    // Family of 3 between $18,239 and $24,317
    const result = calculateEligibility({ familySize: 3, monthlyIncome: 22000, childAgeYears: 2.1 });
    assert.equal(result.tier, 'elfaHalfCredit');
    assert.equal(result.copayAllowed, true);
    assert.equal(result.monthlyCreditAmount, 1153); // Toddler half credit
  });

  await t.test('Over 200% AMI results in Private Pay', () => {
    const result = calculateEligibility({ familySize: 3, monthlyIncome: 26000, childAgeYears: 2.1 });
    assert.equal(result.tier, 'privatePay');
    assert.equal(result.monthlyCreditAmount, 0);
  });

  await t.test('State CCTR / CSPP 85% SMI ceiling recognized', () => {
    // Family of 3 CCTR ceiling is $8,054
    const result = calculateEligibility({ familySize: 3, monthlyIncome: 7500, childAgeYears: 2.1 });
    assert.equal(result.tier, 'cctrStateAndElfaFree');
    assert.equal(result.copayAllowed, false);
  });
});

test('calculateEligibility - household sizes on DEC\'s income sheet', async (t) => {
  await t.test('a family of 10 is checked against its own ceilings, not the 8-person ones', () => {
    // DEC FY 2026-27 Free Tuition ceilings: $263,900/yr for 10 people, $235,350/yr for 8.
    const result = calculateEligibility({ familySize: 10, annualIncome: 250000, childAgeYears: 2.1 });
    assert.equal(result.tier, 'elfaFreeTuition');
    assert.equal(result.familySize, 10);
    assert.equal(result.thresholdFamilySize, 10);
    assert.equal(result.thresholds.freeTuitionMonthlyCeiling, 21992);
    assert.equal(result.familySizeNote, undefined);
  });

  await t.test('uses the state CCTR ceiling published for larger families', () => {
    // DEC FY 2026-27: the 12-person CCTR ceiling is $14,455/month.
    assert.equal(calculateEligibility({ familySize: 12, monthlyIncome: 14400 }).tier, 'cctrStateAndElfaFree');
    assert.equal(calculateEligibility({ familySize: 12, monthlyIncome: 14500 }).tier, 'elfaFreeTuition');
  });

  await t.test('flags a family larger than DEC publishes instead of silently shrinking it', () => {
    assert.equal(LARGEST_ELFA_FAMILY_SIZE, 12);
    const result = calculateEligibility({ familySize: 14, annualIncome: 300000 });
    assert.equal(result.familySize, 14);
    assert.equal(result.thresholdFamilySize, 12);
    assert.equal(result.thresholds.freeTuitionMonthlyCeiling, ELFA_INCOME_TABLE_FY26_27[12].freeMonthly);
    assert.match(result.familySizeNote, /up to 12 people/);
    assert.match(result.familySizeNote, /family of 14/);
  });
});

test('ELFA results cite DEC documents', async (t) => {
  const sourceUrls = ELFA_SOURCE_LIST.map((source) => source.url);

  await t.test('eligibility results carry the credit basis and the DEC sources', () => {
    const result = calculateEligibility({ familySize: 3, monthlyIncome: 22000, childAgeYears: 2.1 });
    assert.deepEqual(result.sources.map((source) => source.url), sourceUrls);
    assert.match(result.creditBasis, /full-time reimbursement rate/);
    assert.match(result.creditBasis, /same for part-time care/);
    assert.match(result.explanation, /50% of DEC's full-time reimbursement rate/);
  });

  await t.test('rates and rules credit part-time care the same and cite each document', () => {
    const rules = getElfaRatesAndRules();
    assert.deepEqual(rules.sources.map((source) => source.url), sourceUrls);
    assert.ok(rules.rulesSummary.some((rule) =>
      rule.includes("100% of DEC's full-time rate ($3,027 Infant, $2,306 Toddler, $2,115 Preschooler)")));
    assert.ok(rules.rulesSummary.some((rule) =>
      rule.includes("50% of DEC's full-time rate ($1,514 Infant, $1,153 Toddler, $1,058 Preschooler)")));
    assert.ok(rules.rulesSummary.some((rule) =>
      rule.startsWith('Part-time care:') && rule.includes('same for part-time care')));
    assert.equal(rules.incomeEligibilityCeilings[12].halfAnnual, 505800);
  });

  await t.test('cites the current DEC documents with their publication dates', () => {
    assert.deepEqual(sourceUrls, [
      'https://media.api.sf.gov/documents/Early_Learning_For_All_Rates_FY_26-27.pdf',
      'https://media.api.sf.gov/documents/State_CDE-CDSS_and_ELFA_Family_Income_Eligibility_FY_26-27_1.pdf',
      'https://www.sf.gov/eligibility-for-free-or-low-cost-preschool-and-child-care'
    ]);
    for (const source of ELFA_SOURCE_LIST) {
      assert.equal(source.published, '2026-07-01');
      assert.match(source.accessed, /^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

test('calculateEligibility - Age Category Transitions', async (t) => {
  await t.test('Under 24 months is Infant ($1,514 half credit)', () => {
    const res = calculateEligibility({ familySize: 3, monthlyIncome: 20000, childAgeYears: 1.5 });
    assert.equal(res.ageCategory, 'infant');
    assert.equal(res.monthlyCreditAmount, 1514);
  });

  await t.test('24 to 36 months is Toddler ($1,153 half credit)', () => {
    const res = calculateEligibility({ familySize: 3, monthlyIncome: 20000, childAgeYears: 2.1 });
    assert.equal(res.ageCategory, 'toddler');
    assert.equal(res.monthlyCreditAmount, 1153);
  });

  await t.test('36 months and older is Preschool ($1,058 half credit)', () => {
    const res = calculateEligibility({ familySize: 3, monthlyIncome: 20000, childAgeYears: 3.5 });
    assert.equal(res.ageCategory, 'preschool');
    assert.equal(res.monthlyCreditAmount, 1058);
  });
});
