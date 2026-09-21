import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateEligibility } from '../src/eligibility.js';
import { ELFA_INCOME_TABLE_FY26_27, ELFA_RATES_FY26_27 } from '../src/constants.js';

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
