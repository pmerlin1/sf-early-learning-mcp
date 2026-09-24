import {
  ELFA_FAMILY_SIZES,
  ELFA_INCOME_TABLE_FY26_27,
  LARGEST_ELFA_FAMILY_SIZE
} from './constants.js';

/**
 * Canonical family intake, rendered into the MCP `family_intake_interview` prompt.
 * `question` and option labels are written for parents. `agentNote`, `parameter`, and each
 * option's `value` tell the agent how an answer becomes a tool parameter: a `value` of null
 * means "omit the parameter", and an option without a `value` needs a more specific answer.
 */

export const FAMILY_INTAKE_FIRST_ROUND_FIELDS = [
  'childAge',
  'pottyTraining',
  'familySize',
  'neighborhood',
  'schedule',
  'programType'
];

export const FAMILY_INTAKE_FOLLOW_UP_FIELDS = ['income', 'budget', 'language'];

export const FAMILY_INTAKE_REQUIRED_FIELDS = [
  ...FAMILY_INTAKE_FIRST_ROUND_FIELDS,
  ...FAMILY_INTAKE_FOLLOW_UP_FIELDS
];

export const FAMILY_INTAKE_QUESTIONS = [
  {
    id: 'childAge',
    header: 'Child age',
    question: 'How old is your child, in years and months?',
    parameter: 'childAgeYears',
    agentNote: 'Classroom age fit is checked in months, so pass years plus months / 12 ' +
      '(2 years 3 months = 2.25). If the family picks an age band, ask for the months before searching.',
    options: [
      { label: 'Under 2 (infant)', description: '0–24 months' },
      { label: '2 years (toddler)', description: '24–36 months' },
      { label: '3–5 years (preschooler)', description: '36 months to kindergarten' }
    ]
  },
  {
    id: 'pottyTraining',
    header: 'Potty training',
    question: 'Is your child independently potty trained?',
    parameter: 'childIsPottyTrained',
    agentNote: 'Never infer this from age. When it is unknown, omit the parameter; a toddler is ' +
      'then held to documented diaper-change support.',
    options: [
      { label: 'Not potty trained', description: 'Still needs diaper changes', value: false },
      { label: 'Independently potty trained', description: 'Uses the toilet without help', value: true },
      { label: 'In progress or not sure', description: 'We will look for diaper-change support', value: null }
    ]
  },
  {
    id: 'familySize',
    header: 'Family size',
    question: 'How many people are in your household (parents or caregivers plus children under 18)?',
    parameter: 'familySize',
    agentNote: 'Household size sets the ELFA income ceilings used in the follow-up round.',
    options: [
      { label: '2 people', description: 'e.g. 1 parent + 1 child', value: 2 },
      { label: '3 people', description: 'e.g. 2 parents + 1 child', value: 3 },
      { label: '4 people', description: 'e.g. 2 parents + 2 children', value: 4 },
      { label: '5 or more', description: 'Tell us the exact number' }
    ]
  },
  {
    id: 'neighborhood',
    header: 'Neighborhood',
    question: 'Which San Francisco zip code or neighborhood should we search near?',
    parameter: 'homeZipCode',
    agentNote: 'Pass a 5-digit San Francisco zip code; if the family names a neighborhood, confirm its zip.',
    options: [
      { label: 'Richmond (94121)', description: 'Inner and Outer Richmond', value: 94121 },
      { label: 'Sunset (94122)', description: 'Inner and Outer Sunset', value: 94122 },
      { label: 'Mission (94110)', description: 'Mission and Bernal Heights', value: 94110 },
      { label: 'Anywhere in SF', description: 'No location preference', value: null }
    ]
  },
  {
    id: 'schedule',
    header: 'Schedule',
    question: 'Do you need full-time or part-time care?',
    parameter: 'schedule',
    agentNote: 'Net-cost estimates use full-time ELFA credit amounts; for part-time care, confirm ' +
      'the credit with the provider before quoting a co-pay.',
    options: [
      { label: 'Full-time', description: 'Full weekday care', value: 'fullTime' },
      { label: 'Part-time', description: 'Shorter days or fewer days a week', value: 'partTime' }
    ]
  },
  {
    id: 'programType',
    header: 'Daycare type',
    question: 'Would you prefer a licensed child care center, a licensed family child care home ' +
      '(in-home daycare), or either?',
    parameter: 'programType',
    agentNote: 'Always pass the answer: omitting programType limits results to centers.',
    options: [
      { label: 'Licensed center', description: 'Dedicated preschool or child care center', value: 'licensedCenter' },
      { label: 'Family child care home', description: 'Licensed in-home daycare', value: 'licensedFamilyChildCare' },
      { label: 'Either is fine', description: 'Show both', value: 'any' }
    ]
  },
  {
    id: 'income',
    header: 'Household income',
    question: 'What is your total household income before taxes?',
    parameter: 'annualIncome',
    agentNote: 'Offer the dollar ranges for the family\'s household size listed below, never AMI ' +
      'percentages. An exact amount goes to annualIncome or monthlyIncome; a range answer maps to ' +
      'benefitTier. Confirm the tier with check_elfa_eligibility rather than estimating it.',
    options: []
  },
  {
    id: 'budget',
    header: 'Monthly budget',
    question: 'What is the most you could pay out of pocket each month, after any ELFA credit?',
    parameter: 'targetBudgetMonthly',
    agentNote: 'If this is omitted, get_smart_recommendations assumes $1,200, so ask a flexible ' +
      'family for the most they would consider.',
    options: [
      { label: '$0', description: 'Only fully covered care', value: 0 },
      { label: 'Up to $500', description: 'Low co-pay', value: 500 },
      { label: 'Up to $1,200', description: 'Moderate co-pay', value: 1200 },
      { label: 'Flexible', description: 'Tell us the most you would consider' }
    ]
  },
  {
    id: 'language',
    header: 'Language',
    question: 'Do you want a language immersion or bilingual program?',
    parameter: 'preferredLanguage',
    options: [
      { label: 'No preference', description: 'English or any language', value: null },
      { label: 'Mandarin', description: 'Mandarin immersion or bilingual', value: 'Mandarin' },
      { label: 'Cantonese', description: 'Cantonese immersion or bilingual', value: 'Cantonese' },
      { label: 'Spanish', description: 'Spanish immersion or bilingual', value: 'Spanish' }
    ]
  }
];

const QUESTIONS_BY_ID = Object.fromEntries(
  FAMILY_INTAKE_QUESTIONS.map((question) => [question.id, question])
);

export function getFirstRoundIntakeQuestions() {
  return FAMILY_INTAKE_FIRST_ROUND_FIELDS.map((id) => QUESTIONS_BY_ID[id]);
}

export function getFollowUpIntakeQuestions() {
  return FAMILY_INTAKE_FOLLOW_UP_FIELDS.map((id) => QUESTIONS_BY_ID[id]);
}

export function missingFirstRoundIntakeFields(answeredFieldIds = []) {
  const answered = new Set(answeredFieldIds);
  return FAMILY_INTAKE_FIRST_ROUND_FIELDS.filter((id) => !answered.has(id));
}

const usd = (amount) => '$' + String(amount).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/**
 * Income answer options in dollars for one household size, from the published FY 2026-2027
 * annual ceilings. Each option's value is the benefitTier it corresponds to.
 */
export function buildIncomeOptions(familySize) {
  const size = Math.max(1, Math.min(LARGEST_ELFA_FAMILY_SIZE, Math.round(Number(familySize) || 0)));
  const row = ELFA_INCOME_TABLE_FY26_27[size];
  return [
    { label: 'Up to ' + usd(row.freeAnnual), description: 'ELFA Free Tuition', value: 'freeTuitionELFA' },
    {
      label: usd(row.freeAnnual + 1) + '–' + usd(row.fullAnnual),
      description: 'ELFA Full Tuition Credit',
      value: 'fullCreditELFA'
    },
    {
      label: usd(row.fullAnnual + 1) + '–' + usd(row.halfAnnual),
      description: 'ELFA Half Tuition Credit',
      value: 'halfCreditELFA'
    },
    { label: 'Over ' + usd(row.halfAnnual), description: 'Private pay', value: 'privatePay' }
  ];
}

function describeOption(question, option) {
  const label = '"' + option.label + '"';
  if (!Object.hasOwn(option, 'value')) return label;
  if (option.value === null) return label + ' → omit ' + question.parameter;
  return label + ' → ' + question.parameter + ': ' + JSON.stringify(option.value);
}

function renderQuestion(question, number) {
  const lines = [number + '. ' + question.header + ': "' + question.question + '"'];
  if (question.options.length > 0) {
    lines.push('   Answers: ' + question.options.map((option) => describeOption(question, option)).join('; ') + '.');
  }
  if (question.agentNote) lines.push('   Note: ' + question.agentNote);
  return lines.join('\n');
}

function renderIncomeCeilings() {
  const lines = [];
  for (const size of ELFA_FAMILY_SIZES) {
    const ranges = buildIncomeOptions(size)
      .map((option) => option.description + ' ' + option.label.replace(/^Up to /, 'up to ').replace(/^Over /, 'over '))
      .join('; ');
    const previous = lines[lines.length - 1];
    if (previous && previous.ranges === ranges) {
      previous.last = size;
    } else {
      lines.push({ first: size, last: size, ranges });
    }
  }
  return lines.map(({ first, last, ranges }) =>
    '- ' + (first === last ? first : first + '–' + last) + (last === 1 ? ' person' : ' people') + ': ' + ranges
  ).join('\n');
}

export function describeFamilyIntakePrompt() {
  return 'Structured interview for a San Francisco family. The first question round asks ' +
    getFirstRoundIntakeQuestions().map((question) => question.header.toLowerCase()).join(', ') +
    ' together; a follow-up round covers ' +
    getFollowUpIntakeQuestions().map((question) => question.header.toLowerCase()).join(', ') + '.';
}

export function buildFamilyIntakePrompt() {
  const firstRound = getFirstRoundIntakeQuestions();
  const followUp = getFollowUpIntakeQuestions();

  return [
    'You are an expert San Francisco Early Childhood and Preschool Advisor.',
    '',
    'Ask every first-round question the family has not already answered, all in ONE question call. ' +
      'Potty training and daycare type are the easiest to skip; never leave them for later. ' +
      'Do not search CareWait or call get_smart_recommendations until every first-round answer is in.',
    '',
    'First round (ask together):',
    ...firstRound.map((question, index) => renderQuestion(question, index + 1)),
    '',
    'Follow-up round (ask together, only what is still missing):',
    ...followUp.map((question, index) => renderQuestion(question, firstRound.length + index + 1)),
    '',
    'ELFA annual income ranges (FY 2026-2027) by household size:',
    renderIncomeCeilings(),
    'Range answers map to benefitTier: ' + buildIncomeOptions(3)
      .map((option) => option.description + ' → "' + option.value + '"')
      .join('; ') + '.',
    'DEC publishes ceilings for families of up to ' + LARGEST_ELFA_FAMILY_SIZE + ' people; for a ' +
      'larger family, check_elfa_eligibility uses the ' + LARGEST_ELFA_FAMILY_SIZE + '-person ceilings ' +
      'and returns a familySizeNote to pass on.',
    '',
    'Then call get_smart_recommendations with every mapped answer, including childIsPottyTrained ' +
      'and programType, and verify licensing with the CCLD fields it returns.'
  ].join('\n');
}
