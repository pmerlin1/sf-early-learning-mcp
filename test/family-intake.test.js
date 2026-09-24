import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateEligibility } from '../src/eligibility.js';
import {
  ELFA_FAMILY_SIZES,
  ELFA_INCOME_TABLE_FY26_27,
  RECOMMENDATION_PROGRAM_TYPES,
  SCHEDULE_TYPES
} from '../src/constants.js';
import {
  FAMILY_INTAKE_FIRST_ROUND_FIELDS,
  FAMILY_INTAKE_QUESTIONS,
  FAMILY_INTAKE_REQUIRED_FIELDS,
  buildFamilyIntakePrompt,
  buildIncomeOptions,
  describeFamilyIntakePrompt,
  getFirstRoundIntakeQuestions,
  getFollowUpIntakeQuestions,
  missingFirstRoundIntakeFields
} from '../src/family-intake.js';

const question = (id) => FAMILY_INTAKE_QUESTIONS.find((entry) => entry.id === id);
const valueFor = (id, label) => question(id).options.find((option) => option.label === label).value;
const usd = (amount) => '$' + amount.toLocaleString('en-US');

test('family intake rounds', async (t) => {
  await t.test('asks potty training and daycare type in the first round', () => {
    assert.deepEqual(FAMILY_INTAKE_FIRST_ROUND_FIELDS, [
      'childAge',
      'pottyTraining',
      'familySize',
      'neighborhood',
      'schedule',
      'programType'
    ]);
    assert.deepEqual(getFirstRoundIntakeQuestions().map((entry) => entry.id), FAMILY_INTAKE_FIRST_ROUND_FIELDS);
    assert.deepEqual(getFollowUpIntakeQuestions().map((entry) => entry.id), ['income', 'budget', 'language']);
  });

  await t.test('defines every required question exactly once', () => {
    const ids = FAMILY_INTAKE_QUESTIONS.map((entry) => entry.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.deepEqual([...ids].sort(), [...FAMILY_INTAKE_REQUIRED_FIELDS].sort());
  });

  await t.test('flags skipped potty-training and daycare-type answers', () => {
    assert.deepEqual(
      missingFirstRoundIntakeFields(['childAge', 'familySize', 'neighborhood', 'schedule']),
      ['pottyTraining', 'programType']
    );
    assert.deepEqual(missingFirstRoundIntakeFields(FAMILY_INTAKE_FIRST_ROUND_FIELDS), []);
  });
});

test('family intake answers map to tool parameters', async (t) => {
  await t.test('potty-training answers map to false, true, or an omitted parameter', () => {
    assert.equal(question('pottyTraining').parameter, 'childIsPottyTrained');
    assert.equal(valueFor('pottyTraining', 'Not potty trained'), false);
    assert.equal(valueFor('pottyTraining', 'Independently potty trained'), true);
    assert.equal(valueFor('pottyTraining', 'In progress or not sure'), null);
  });

  await t.test('daycare-type answers are values get_smart_recommendations accepts', () => {
    const values = question('programType').options.map((option) => option.value);
    assert.deepEqual(values, ['licensedCenter', 'licensedFamilyChildCare', 'any']);
    assert.ok(values.every((value) => RECOMMENDATION_PROGRAM_TYPES.includes(value)));
  });

  await t.test('schedule answers are accepted schedule values', () => {
    assert.ok(question('schedule').options.every((option) => SCHEDULE_TYPES.includes(option.value)));
  });

  await t.test('keeps agent instructions out of the text shown to parents', () => {
    for (const entry of FAMILY_INTAKE_QUESTIONS) {
      const parentText = [
        entry.question,
        ...entry.options.flatMap((option) => [option.label, option.description])
      ].join(' ');
      assert.doesNotMatch(parentText, /\b(infer\w*|parameters?|omit\w*)\b|get_smart|check_elfa/i, entry.id);
      assert.doesNotMatch(parentText, /\bAMI\b/, entry.id);
    }
  });

  await t.test('income ranges use the published ceilings and agree with the eligibility tiers', () => {
    assert.deepEqual(ELFA_FAMILY_SIZES, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    assert.deepEqual(buildIncomeOptions(15), buildIncomeOptions(12));
    for (const size of ELFA_FAMILY_SIZES) {
      const row = ELFA_INCOME_TABLE_FY26_27[size];
      const options = buildIncomeOptions(size);
      const tierAt = (annualIncome) => calculateEligibility({ familySize: size, annualIncome }).tier;

      assert.deepEqual(options.map((option) => option.value),
        ['freeTuitionELFA', 'fullCreditELFA', 'halfCreditELFA', 'privatePay']);
      assert.equal(options[0].label, 'Up to ' + usd(row.freeAnnual));
      assert.ok(options[1].label.endsWith(usd(row.fullAnnual)));
      assert.ok(options[2].label.endsWith(usd(row.halfAnnual)));
      assert.equal(options[3].label, 'Over ' + usd(row.halfAnnual));

      assert.equal(tierAt(row.freeAnnual), 'elfaFreeTuition', 'size ' + size);
      assert.equal(tierAt((row.freeAnnual + row.fullAnnual) / 2), 'elfaFullCredit', 'size ' + size);
      assert.equal(tierAt(row.fullAnnual), 'elfaFullCredit', 'size ' + size);
      assert.equal(tierAt((row.fullAnnual + row.halfAnnual) / 2), 'elfaHalfCredit', 'size ' + size);
      assert.equal(tierAt(row.halfAnnual), 'elfaHalfCredit', 'size ' + size);
      assert.equal(tierAt(row.halfAnnual + 1000), 'privatePay', 'size ' + size);
    }
  });
});

test('family intake MCP prompt', async (t) => {
  const prompt = buildFamilyIntakePrompt();

  await t.test('renders every question from the shared data, first round before follow-up', () => {
    const ordered = [...getFirstRoundIntakeQuestions(), ...getFollowUpIntakeQuestions()];
    const positions = ordered.map((entry) => prompt.indexOf('"' + entry.question + '"'));
    assert.ok(positions.every((position) => position >= 0));
    assert.deepEqual(positions, [...positions].sort((a, b) => a - b));

    const followUpStart = prompt.indexOf('Follow-up round');
    assert.ok(prompt.indexOf('"' + question('programType').question + '"') < followUpStart);
    assert.ok(prompt.indexOf('"' + question('income').question + '"') > followUpStart);
  });

  await t.test('spells out how answers become parameters', () => {
    assert.ok(prompt.includes('"Not potty trained" → childIsPottyTrained: false'));
    assert.ok(prompt.includes('"In progress or not sure" → omit childIsPottyTrained'));
    assert.ok(prompt.includes('"Either is fine" → programType: "any"'));
    assert.ok(prompt.includes('"Up to $500" → targetBudgetMonthly: 500'));
  });

  await t.test('lists dollar income ranges by household size and their benefit tiers', () => {
    assert.ok(prompt.includes('- 1–2 people: ELFA Free Tuition up to $142,650;'));
    assert.ok(prompt.includes('- 3 people: ELFA Free Tuition up to $160,500;'));
    assert.ok(prompt.includes('- 10 people: ELFA Free Tuition up to $263,900;'));
    assert.ok(prompt.includes('- 11–12 people: ELFA Free Tuition up to $278,200;'));
    assert.ok(prompt.includes('ELFA Half Tuition Credit → "halfCreditELFA"'));
    assert.match(prompt, /families of up to 12 people/);
  });

  await t.test('prompt listing names both rounds', () => {
    const description = describeFamilyIntakePrompt();
    assert.match(description, /potty training/);
    assert.match(description, /daycare type/);
    assert.match(description, /household income/);
  });
});
