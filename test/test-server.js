import { calculateEligibility } from '../src/eligibility.js';
import { searchProfiles, getSiteDetails } from '../src/carewait-client.js';
import { getRecommendations } from '../src/recommendations.js';

async function runTests() {
  console.log('--- TEST 1: calculateEligibility ---');
  // Family of 3, income $18,000/mo (within 150% AMI -> Full Credit)
  const fullEl = calculateEligibility({ familySize: 3, monthlyIncome: 18000, childAgeYears: 2.1 });
  console.log('Family of 3, $18k/mo -> Tier:', fullEl.tier, '| Credit:', fullEl.monthlyCreditAmount, '| Age Category:', fullEl.ageCategory);

  // Family of 3, income $22,000/mo (within 200% AMI -> Half Credit)
  const halfEl = calculateEligibility({ familySize: 3, monthlyIncome: 22000, childAgeYears: 2.1 });
  console.log('Family of 3, $22k/mo -> Tier:', halfEl.tier, '| Credit:', halfEl.monthlyCreditAmount, '| Age Category:', halfEl.ageCategory);

  console.log('\n--- TEST 2: searchProfiles ---');
  const searchRes = await searchProfiles({
    ageYears: 2,
    programType: 'licensedCenter',
    financialAid: ['halfCreditELFA'],
    language: 'Spanish',
    take: 5
  });
  console.log('Found Spanish immersion centers accepting ELFA Half Credit:', searchRes.total);
  for (const s of searchRes.items) {
    console.log(`- ${s.programName} (${s.zipCode})`);
  }

  console.log('\n--- TEST 3: getSiteDetails ---');
  if (searchRes.items.length > 0) {
    const details = await getSiteDetails(searchRes.items[0].entityId);
    console.log(`Details for ${details.name}:`);
    console.log(`- Languages:`, details.languages);
    console.log(`- Phone:`, details.phone);
    console.log(`- Monthly Rates:`, details.monthlyRates);
  }

  console.log('\n--- TEST 4: Jev-ranked recommendations for 2.1 yo near 94110, $1200 budget, Spanish ---');
  // Requires TYPESAFE_API_KEY: get_smart_recommendations fails closed without Jev.
  const recs = await getRecommendations({
    childAgeYears: 2.1,
    benefitTier: 'halfCreditELFA',
    targetBudgetMonthly: 1200,
    preferredLanguage: 'Spanish',
    homeZipCode: 94110,
    programType: 'licensedCenter',
    maxResults: 5
  });
  const { jevScoring } = recs;
  console.log(`Found ${recs.totalFound} programs; Jev (${jevScoring.model}) scored ${jevScoring.candidatesScored}, weights ${JSON.stringify(jevScoring.weights)}`);
  for (const r of recs.recommendations) {
    console.log(`- ${r.name} | Jev ${r.jev?.compositeScore} (${r.jev?.recommendation}) | ${r.distanceMiles} mi | Net: $${r.estimatedNetOutOfPocketMonthly}/mo | Phone: ${r.phone}`);
  }

  console.log('\nAll tests passed successfully!');
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
