---
name: sf-preschool-advisor
description: Guide for San Francisco preschool, childcare, and Department of Early Childhood (DEC) Early Learning For All (ELFA) financial assistance, using an independent MCP server whose recommendations are ranked by TypeSafe Jev. Use when helping families find licensed preschools, check ELFA eligibility, calculate net tuition, or compare preschool programs in SF.
---

# San Francisco Preschool & Early Learning For All (ELFA) Advisor

This skill guides agents through San Francisco preschool options, licensed child care, and DEC's Early Learning For All (ELFA) financial aid for FY 2026–2027. The `sf-early-learning` tools are an independent project, not affiliated with DEC; their answers are estimates for families to confirm, not official determinations.

---

## 1. Hard Rules & Eligibility Architecture

Never estimate or guess income eligibility or subsidy rates in unstructured conversation. Always use the `sf-early-learning` MCP tools (`check_elfa_eligibility`, `get_smart_recommendations`, `search_sf_childcare`, and `get_childcare_details`).

`get_smart_recommendations` scores and ranks programs with TypeSafe Jev and requires `TYPESAFE_API_KEY`. If it returns the missing-key error, tell the family that recommendations need Jev and that the server's `TYPESAFE_API_KEY` must be set, and offer the eligibility, search, details, and licensing tools meanwhile. Never rank programs yourself as a substitute for Jev.

**Not official.** When presenting eligibility or recommendations, say once that this is an independent tool, not an official DEC service, and that families should confirm eligibility with DEC and tuition, openings, and ELFA participation with each provider.

**Cite DEC's documents.** The rates and rules in this skill come from DEC's FY 2026–27 documents:
* [Early Learning For All Rates – FY 2026–2027](https://media.api.sf.gov/documents/Early_Learning_For_All_Rates_FY_26-27.pdf): credit amounts and reimbursement rates.
* [FY 2026–2027 San Francisco Family Income Eligibility](https://media.api.sf.gov/documents/State_CDE-CDSS_and_ELFA_Family_Income_Eligibility_FY_26-27_1.pdf): income ceilings for families of 1–12.
* [SF.gov eligibility page](https://www.sf.gov/eligibility-for-free-or-low-cost-preschool-and-child-care): tier definitions and co-pay rules.

`check_elfa_eligibility` and `get_elfa_rates_and_rules` return these in `sources`; `get_smart_recommendations` returns them in `subsidySources`. When a family asks where a number or rule comes from, cite the matching document by title and URL. Do not cite legacy.sfdec.org, which still shows FY 2025–26 figures.

Treat a provider's published tuition as the gross rate and ELFA as a separate funding credit applied to that rate. ELFA acceptance does not establish tuition or guarantee a funded opening. If CareWait rates are blank or incomplete, do not infer a rate from ELFA, DEC, Head Start, or other funding notes. When public web access is available, check the provider's own current tuition page and cite its URL and access date. Do not rely on search snippets or third-party directories for a verified price. If the provider's page does not state a current price for the relevant age group and schedule, mark the rate as unverified. Do not fill the gap with "typical" or market price ranges.

Apply an ELFA credit only when the provider detail record lists the family's tier (`freeTuitionELFA`, `fullCreditELFA`, or `halfCreditELFA`). A search filter is not enough. A missing aid list is unknown; a list with only Head Start, CSPP, CCTR, or other programs does not establish ELFA eligibility. If a rate note says prices are after an ELFA offset but the detail record does not confirm the tier, treat the rate basis as conflicting and ask for verification. For confirmed ELFA providers whose published amounts are already after credit, `get_smart_recommendations` reports `rateBasis: "post_credit"` and does not subtract again.

### Age Group Definitions (Strict)
* **Infants**: 0 to 24 months
* **Toddlers**: 24 to 36 months (e.g. a 2.1-year-old is 25.2 months = Toddler)
* **Preschoolers**: 36 months to Kindergarten entry (3 to 5 years)

### ELFA Financial Assistance Tiers (FY 2026–2027)

1. **ELFA Free Tuition (0% – 110% AMI)**
   * Income ceiling: e.g., $160,500/year ($13,375/month) for a family of 3.
   * **Rule**: Programs **cannot** charge families in this tier any co-pays, tuition, or supplemental registration fees. Care is 100% free.
   * Full reimbursement paid by DEC: Infant $3,027/mo | Toddler $2,306/mo | Preschool $2,115/mo.

2. **ELFA Full Tuition Credit (111% – 150% AMI)**
   * Income ceiling: e.g., $218,850/year ($18,238/month) for a family of 3.
   * Credit value: 100% of DEC's full-time reimbursement rate ($3,027 Infant | $2,306 Toddler | $2,115 Preschool).
   * **Rule**: Programs **may charge a co-pay** equal to the difference between their published private tuition and the credit.

3. **ELFA Half Tuition Credit (151% – 200% AMI)**
   * Income ceiling: e.g., $291,800/year ($24,317/month) for a family of 3.
   * Credit value: 50% of DEC's full-time reimbursement rate:
     * **Infant**: **$1,514 / month**
     * **Toddler**: **$1,153 / month**
     * **Preschooler**: **$1,058 / month**
   * **Rule**: Family pays the remaining tuition balance after the credit is applied.

4. **Private Pay (> 200% AMI)**
   * Families pay private rates, but can explore sliding scale assistance, non-profit community slots, or SFUSD Transitional Kindergarten (TK) for 4-year-olds.

**Part-time care gets the same credit.** DEC defines both credits against its full-time rate and publishes one credit amount per age group. The part-time rates on DEC's rate sheet are listed only to calculate funding gaps between state vouchers and ELFA rates. Never quote a smaller credit for part-time care.

---

## 2. Family Intake & Toddler Requirements Workflow

Ask in two rounds. The `sf-early-learning` MCP prompt `family_intake_interview` renders the same questions with answer-to-parameter mappings and the income ranges for each household size.

**Round 1: a single `Question()` call containing every first-round question the family has not already answered.** Potty training and daycare type are the easiest to skip; never leave them for later. Do not search CareWait or call `get_smart_recommendations` until all six are answered.

1. **Child's exact age**: Years and months. This determines the Infant, Toddler, or Preschooler rate, and classroom fit is checked in months. If the family picks an age band, ask for the months.
2. **Potty training & diapering status**: Ask whether the child is independently potty trained; never infer it from age. Diapering accommodation is tracked as an informational checklist item for parent tours; it does **not** gate preschool options or eliminate verified facilities, because CareWait provider records rarely populate the diapering flag (<2% of listings). Pass `childIsPottyTrained: false` or `true`; omit it when the answer is unknown.
3. **Family size**: Parents or caregivers plus dependent children under 18.
4. **Neighborhood / zip**: Pass a 5-digit San Francisco zip code as `homeZipCode`. The search starts from it, and Jev rates each program's commute from it; without one, commute is left out of the ranking.
5. **Schedule**: Full-time vs. part-time. This filters programs; it does not change the ELFA credit (see "Part-time care gets the same credit" above).
6. **Daycare type**: Licensed child care center, licensed family child care home (in-home daycare), or either. Always pass `programType` (`licensedCenter`, `licensedFamilyChildCare`, or `any`); omitting it limits results to centers.

**Round 2: a single `Question()` call for whatever is still missing.**

7. **Household income**: Gross pre-tax income. Offer dollar ranges for the family's household size (from `get_elfa_rates_and_rules`), never AMI percentages, and confirm the tier with `check_elfa_eligibility`.
8. **Budget**: Maximum monthly out-of-pocket target (e.g., $0, $500, $1,200). It splits the results into within budget and over budget, and Jev rates budget fit against it. If it is omitted, `get_smart_recommendations` assumes $1,200.
9. **Language preference**: Language immersion (Spanish, Cantonese, Mandarin, Japanese, etc.) vs. dual-language support. Jev rates immersion only when a language is given; "no preference" drops it from the ranking.

---

## 3. State Licensing & Safety Verification (CCLD)

Always cross-reference facilities with the official California Community Care Licensing Division (CCLD) using `get_state_licensing_record`. Citation totals combine inspection, complaint, and other visits. Report the category the tool returns; do not name facilities from memory:
* **Clear (`pristine`)**: licensed, with no citations or complaint visits in the CCLD public record.
* **Minor findings**: licensed, no Type A citations and no substantiated allegations, with 1–2 Type B citations or complaint visits.
* **Notable citations**: more than 2 Type B citations or complaint visits.
* **Caution**: any Type A citation, any substantiated allegation, or a status other than Licensed. Flag these explicitly for parents before recommending.
* **Unknown**: missing or incomplete CCLD data. This is never a clean record.

Do not describe citations as routine, minor, or resolved unless the CCLD report text says so; link the facility's CCLD page instead. Every licensing record includes that page as `ccldFacilityUrl`, and `get_smart_recommendations` lists one per license in `ccldFacilityUrls`; cite those rather than constructing a link.

Providers can hold more than one CCLD license (for example, separate infant and preschool licenses). `get_childcare_details` and `get_smart_recommendations` check every license on the CareWait profile, report the most severe finding, and treat the provider as unverified if any license record is missing or incomplete. When calling `get_state_licensing_record` directly, check each number in `licenseNumbers`.

---

## 4. Decision Model: Code-Verified Facts, Jev-Ranked Recommendations

Code gathers and verifies the facts and applies the hard checks: current license status with a complete CCLD record, exact classroom age fit, a published price, and a provider-confirmed subsidy tier before any credit is applied. Diapering accommodation is reported informationally for tours; it neither filters nor scores results, because <2% of provider records populate the flag. Missing or incomplete CCLD data is unknown, never a clean record: those programs are listed as needing verification, and Jev does not score them.

`get_smart_recommendations` then sends every program that passes (up to 25; within-budget ones first) to TypeSafe Jev System One. Jev rates each one on a 0–3 rubric for commute (with a home zip code), licensing record, budget fit, and immersion in the requested language (only when one is given), and picks an overall recommendation: `top_tier`, `strong_alternative`, `caution_flagged`, `unsuitable`, or `needs_verification`. The tool combines the ratings into a weighted composite from 0 to 1 and orders `recommendations` (within budget) and `stretchOptions` (over budget) by it. Each program carries a `jev` block (`compositeScore`, `scores`, `recommendation`), and `jevScoring` reports the model, weights, counts, and token usage.

**Composite weights**, renormalized over the criteria that apply (`jevScoring.weights` has the ones used):
* With a home zip code: Location **30%**, Safety **30%**, Budget **25%**, Immersion **15%**.
* Without one: Safety **40%**, Budget **35%**, Immersion **25%**.
* With no language preference, immersion drops out and the other weights scale up.

A missing Jev answer is not a zero: the composite is computed over the ratings Jev returned, and `compositeCoverage` and `missingScoreCriteria` show what is missing. If `jev.status` is `failed`, say that Jev could not score that program; never supply a score yourself. Jev's ratings and verdicts are model judgments over verified facts; they do not remove factual uncertainty or replace CCLD records, DEC's rules, or a provider's confirmation.

A Free Tuition estimate of $0 is conditional on confirmed ELFA eligibility and an available funded enrollment slot.

CareWait's 100/25 evidence values are ordinal evidence signals, not probabilities: 100 means the matching accommodation is explicitly listed; 25 means the listing does not confirm it. Diaper changes and potty-training support have separate signals. A 100 for potty-training support must not be shown as 100 for diaper changes.

---

## 5. Mandatory Response Presentation: Recommendation Tables

Whenever presenting preschool or child care options to a family, **always present them in Markdown tables** with these columns:

| Name | Address / Distance | Language | CCLD Record | Cost | Jev |
| :--- | :--- | :--- | :--- | :--- | :--- |

* **Name**: The provider name, linked to its `website` when CareWait lists one.
* **Address / Distance**: Street address and `distanceMiles`, the straight-line distance from the center of the family's zip code, e.g. "0.5 mi (straight line)". It is not a driving or transit distance.
* **Language**: The languages the provider lists (`languages`). Write "Not listed" when the list is empty; do not assume English or infer immersion from the program name.
* **CCLD Record**: The Section 3 category for `ccldInspection.rating` (Clear, Minor findings, Notable citations, Caution, or Unknown), then each license number linked to its entry in `ccldFacilityUrls`.
* **Cost**: Gross monthly tuition, the credit actually applied (`monthlySubsidyCreditAppliedToRate`), and the net estimate (`estimatedNetOutOfPocketMonthly`, or `estimatedNetOutOfPocketMonthlyMin`–`Max` for a published range). When `rateBasis` is `post_credit`, gross tuition is not published and the amount shown is already after the credit; never subtract the credit again. A Free Tuition $0 is conditional on an approved award and a funded slot. Write "Unpublished" rather than estimating a missing rate.
* **Jev**: The composite (`jev.compositeScore`, two decimals) and Jev's verdict (`jev.recommendation`), e.g. "0.93, top tier". In the verification tables, which Jev does not score, write "Not scored".

Use one table per list returned by `get_smart_recommendations`, skip empty ones, and show each provider once, in the first table that applies:
1. **Recommended**: `recommendations` (within budget, with a verified rate and CCLD record), in the order returned, which is Jev's ranking.
2. **Over budget**: `stretchOptions`, also in Jev's order.
3. **Needs licensing verification**: `unverifiedSafetyCandidates`. Never move these into the tables above.
4. **Programs Requiring Tuition Verification**: `unverifiedRateCandidates`.
5. **Confirm classroom age**: `unverifiedAgeCandidates`.

Say which area was searched: `searchScope.zipCodes` lists the zip codes, closest first. If `searchScope.citywide` is true, say that programs from across the city were added because fewer than 10 matched nearby or no zip code was given.

Below the Recommended table, explain the ranking in a sentence or two from `jev.scores`: what put the top program first, and which rating pulled down any program that is closer or cheaper than those above it (for example, a Type A citation lowers the licensing-record rating). When the family asks why a program ranks where it does, show its four ratings.

End with the independence note from Section 1.

When the child needs diaper changes (`childIsPottyTrained: false`, or unknown for a toddler), add one line below the tables naming the programs whose `diaperingFitStatus` is `confirmed`, and suggest asking the others about diaper changes on a tour. Missing diapering data never removes or demotes a program.

---

## 6. Web Enrichment for Candidate Tuition

After `get_smart_recommendations` returns, fill tuition gaps for the closest rows in the tuition-verification table, including centers that publish only a preschool rate for a toddler:
1. CareWait and CCLD stay the source for licensing, location, and ELFA participation; the provider's site only fills in tuition.
2. Open the provider's `website` from its CareWait record with `webfetch` or a browser. If the record has no website, say so rather than guessing a URL. Do not take prices from search snippets or third-party directories (Section 1).
3. When the page states a current price for the child's age group and schedule:
   * Subtract the ELFA credit only if the provider's detail record lists the family's tier (`subsidyEligibilityStatus: "eligible"`) and the page does not say the price is already after the credit. Otherwise show the price with no credit and say why.
   * Cite the page URL and access date in the Cost cell, and say whether the net price is within the family's budget. Keep the row in the tuition-verification table with "Not scored (price from provider site)" in the Jev column: Jev ranks only programs whose prices the tool had, so never place these rows in the Jev-ranked tables or estimate a score for them.
4. When the page gives no current price for that age group and schedule, or fees depend on a funded slot (such as Head Start, CSPP, or CCTR), keep the row in the tuition-verification table with the provider's phone and email. Do not estimate.
