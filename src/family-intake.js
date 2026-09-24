export const FAMILY_INTAKE_REQUIRED_FIELDS = [
  'childAge',
  'pottyTraining',
  'familySize',
  'income',
  'neighborhood',
  'schedule',
  'programType',
  'language',
  'budget'
];

export const FAMILY_INTAKE_FIRST_ROUND_FIELDS = [
  'childAge',
  'pottyTraining',
  'familySize',
  'neighborhood',
  'schedule',
  'programType'
];

export const FAMILY_INTAKE_QUESTIONS = [
  {
    id: 'childAge',
    header: 'Child age',
    question: "How old is your child? (This sets infant vs toddler vs preschooler rates.)",
    options: [
      { label: 'Under 2 (infant)', description: '0–24 months' },
      { label: '2 years old (toddler)', description: '24–36 months' },
      { label: '3–5 (preschooler)', description: '36 months to kindergarten' }
    ]
  },
  {
    id: 'pottyTraining',
    header: 'Potty training',
    question: 'Is the child independently potty trained? Never infer this from age. Needed to gate diaper-change support.',
    options: [
      { label: 'Not potty trained', description: 'Needs diaper changes; require documented diapering support' },
      { label: 'Independently potty trained', description: 'No diapering gate required' },
      { label: 'Unknown / in progress', description: 'Treat as needing diapering verification' }
    ]
  },
  {
    id: 'familySize',
    header: 'Family size',
    question: 'How many people are in the household (parents/caregivers + children under 18)?',
    options: [
      { label: '2 people', description: 'e.g. 1 parent + 1 child' },
      { label: '3 people', description: 'e.g. 2 parents + 1 child' },
      { label: '4 people', description: 'e.g. 2 parents + 2 children' },
      { label: '5+ people', description: 'Larger household' }
    ]
  },
  {
    id: 'income',
    header: 'Household income',
    question: 'Gross annual household income (before taxes)? This sets the ELFA tier.',
    options: [
      { label: 'Up to 110% AMI', description: 'Free Tuition ELFA — $0 co-pay' },
      { label: '111–150% AMI', description: 'Full Credit ELFA; co-pay allowed' },
      { label: '151–200% AMI', description: 'Half Credit ELFA' },
      { label: 'Over 200% AMI', description: 'Private pay' }
    ]
  },
  {
    id: 'neighborhood',
    header: 'Neighborhood',
    question: 'Which SF zip or neighborhood should be prioritized?',
    options: [
      { label: 'Richmond / 94121', description: 'Outer/Inner Richmond' },
      { label: 'Sunset / 94122', description: 'Inner/Outer Sunset' },
      { label: 'Mission / 94110', description: 'Mission, Bernal' },
      { label: 'Downtown / SOMA', description: '94103, 94105, 94102' },
      { label: 'Citywide', description: 'No neighborhood preference' }
    ]
  },
  {
    id: 'schedule',
    header: 'Schedule',
    question: 'Full-time or part-time?',
    options: [
      { label: 'Full-time', description: 'Weekday full-day care' },
      { label: 'Part-time', description: 'Shorter hours or fewer days' }
    ]
  },
  {
    id: 'programType',
    header: 'Daycare type',
    question: 'Licensed child care center (preschool) or licensed family child care home (in-home daycare)?',
    options: [
      { label: 'Licensed center', description: 'Dedicated preschool / child care center' },
      { label: 'Family child care home', description: 'Licensed in-home daycare' },
      { label: 'Either is fine', description: 'Show both types' }
    ]
  },
  {
    id: 'language',
    header: 'Language',
    question: 'Any language immersion preference?',
    options: [
      { label: 'No preference', description: 'English or any language is fine' },
      { label: 'Mandarin', description: 'Mandarin immersion or bilingual' },
      { label: 'Cantonese', description: 'Cantonese immersion or bilingual' },
      { label: 'Spanish', description: 'Spanish immersion or bilingual' }
    ]
  },
  {
    id: 'budget',
    header: 'Monthly budget',
    question: 'Maximum out-of-pocket per month after any ELFA credit?',
    options: [
      { label: '$0', description: 'Need fully covered / free slot' },
      { label: 'Up to $500', description: 'Low co-pay' },
      { label: 'Up to $1,200', description: 'Moderate co-pay' },
      { label: 'Budget flexible', description: 'Prioritize fit over price' }
    ]
  }
];

export function getFirstRoundIntakeQuestions() {
  return FAMILY_INTAKE_QUESTIONS.filter((question) =>
    FAMILY_INTAKE_FIRST_ROUND_FIELDS.includes(question.id)
  );
}

export function missingFirstRoundIntakeFields(answeredFieldIds = []) {
  const answered = new Set(answeredFieldIds);
  return FAMILY_INTAKE_FIRST_ROUND_FIELDS.filter((id) => !answered.has(id));
}

export function buildFamilyIntakePrompt() {
  return `You are an expert San Francisco Early Childhood and Preschool Advisor.

Collect ALL of the following before searching CareWait or calling get_smart_recommendations. Put the first-round fields in the FIRST Question() call. Do not omit potty training or daycare type from that first round, even if the family already gave age, neighborhood, or schedule.

First Question() call (required together):
1. Child's exact age (years and months, e.g., 2.1 years = 25 months).
2. Potty training: independently potty trained, not potty trained, or unknown. Never infer this from age.
3. Family size (parents/caregivers and dependent children under 18).
4. Preferred San Francisco neighborhood or zip code.
5. Schedule: Full-time vs Part-time / Half-day / specific days.
6. Daycare type: Licensed Child Care Center vs Licensed Family Child Care Home vs either.

Follow-up Question() call if still missing:
7. Gross annual or monthly income (to determine ELFA tier: 0-110% AMI Free, 111-150% AMI Full Credit, 151-200% AMI Half Credit).
8. Maximum out-of-pocket monthly budget (e.g. $0, $500, $1,200).
9. Language immersion preference (Spanish, Mandarin, Cantonese, French, Japanese, or none).

Do not start provider search until items 1–6 are answered. Pass childIsPottyTrained and programType into get_smart_recommendations.`;
}
