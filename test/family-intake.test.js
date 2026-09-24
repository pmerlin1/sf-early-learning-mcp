import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FAMILY_INTAKE_FIRST_ROUND_FIELDS,
  FAMILY_INTAKE_REQUIRED_FIELDS,
  FAMILY_INTAKE_QUESTIONS,
  buildFamilyIntakePrompt,
  getFirstRoundIntakeQuestions,
  missingFirstRoundIntakeFields
} from '../src/family-intake.js';

test('family intake first round includes potty training and daycare type', async (t) => {
  await t.test('required fields include potty training and program type', () => {
    assert.ok(FAMILY_INTAKE_REQUIRED_FIELDS.includes('pottyTraining'));
    assert.ok(FAMILY_INTAKE_REQUIRED_FIELDS.includes('programType'));
    assert.ok(FAMILY_INTAKE_FIRST_ROUND_FIELDS.includes('pottyTraining'));
    assert.ok(FAMILY_INTAKE_FIRST_ROUND_FIELDS.includes('programType'));
  });

  await t.test('first-round questions are age, potty, family size, neighborhood, schedule, daycare type', () => {
    assert.deepEqual(FAMILY_INTAKE_FIRST_ROUND_FIELDS, [
      'childAge',
      'pottyTraining',
      'familySize',
      'neighborhood',
      'schedule',
      'programType'
    ]);
    const ids = getFirstRoundIntakeQuestions().map((question) => question.id);
    assert.deepEqual(ids, FAMILY_INTAKE_FIRST_ROUND_FIELDS);
  });

  await t.test('potty-training question never infers status from age', () => {
    const potty = FAMILY_INTAKE_QUESTIONS.find((question) => question.id === 'pottyTraining');
    assert.ok(potty);
    assert.match(potty.question, /never infer this from age/i);
    assert.ok(potty.options.some((option) => /not potty trained/i.test(option.label)));
    assert.ok(potty.options.some((option) => /independently potty trained/i.test(option.label)));
  });

  await t.test('daycare-type question offers licensed center and family child care home', () => {
    const programType = FAMILY_INTAKE_QUESTIONS.find((question) => question.id === 'programType');
    assert.ok(programType);
    assert.match(programType.question, /family child care home/i);
    assert.ok(programType.options.some((option) => /licensed center/i.test(option.label)));
    assert.ok(programType.options.some((option) => /family child care home/i.test(option.label)));
  });

  await t.test('missingFirstRoundIntakeFields flags omitted potty training and daycare type', () => {
    const partial = missingFirstRoundIntakeFields([
      'childAge',
      'familySize',
      'neighborhood',
      'schedule'
    ]);
    assert.deepEqual(partial, ['pottyTraining', 'programType']);
    assert.deepEqual(missingFirstRoundIntakeFields(FAMILY_INTAKE_FIRST_ROUND_FIELDS), []);
  });

  await t.test('MCP intake prompt requires potty training and daycare type in round one', () => {
    const prompt = buildFamilyIntakePrompt();
    assert.match(prompt, /Potty training/i);
    assert.match(prompt, /Daycare type/i);
    assert.match(prompt, /Licensed Child Care Center vs Licensed Family Child Care Home/i);
    assert.match(prompt, /Do not omit potty training or daycare type/i);
    assert.match(prompt, /Do not start provider search until items 1–6 are answered/i);
    assert.match(prompt, /childIsPottyTrained/);
    assert.match(prompt, /programType/);
  });
});
