---
name: sf-preschool-advisor
description: Authoritative guide for San Francisco preschool, childcare, and Department of Early Childhood (DEC) Early Learning For All (ELFA) financial assistance. Use when helping families find licensed preschools, check ELFA eligibility, calculate net tuition, or compare preschool programs in SF.
---

# San Francisco Preschool & Early Learning For All (ELFA) Advisor

This skill provides authoritative guidance on San Francisco preschool admissions, licensed child care centers, and the Department of Early Childhood (DEC) Early Learning For All (ELFA) financial aid programs for FY 2026–2027.

---

## 1. Hard Rules & Eligibility Architecture

Never estimate or guess income eligibility or subsidy rates in unstructured conversation. Always use the `sf-early-learning` MCP tools (`check_elfa_eligibility`, `get_smart_recommendations`, `search_sf_childcare`, and `get_childcare_details`). Use `compare_heuristic_vs_jev` only when an actual TypeSafe Jev evaluation is requested; it requires `TYPESAFE_API_KEY` and must fail clearly if unavailable.

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
2. **Potty training & diapering status**: Ask whether the child is independently potty trained; never infer it from age. For a child who needs diaper changes, require explicit provider diapering evidence for the verified list. Treat `pottyTrainingProvided` as a separate positive signal about toilet-learning support, not proof of diaper changes. Do not infer diapering policy or on-site changing tables from a toddler license; ask the provider when the record is unclear. Pass `childIsPottyTrained: false` or `true`; omit it when the answer is unknown.
3. **Family size**: Parents or caregivers plus dependent children under 18.
4. **Neighborhood / zip**: Pass a 5-digit San Francisco zip code as `homeZipCode`.
5. **Schedule**: Full-time vs. part-time. This filters programs; it does not change the ELFA credit (see "Part-time care gets the same credit" above).
6. **Daycare type**: Licensed child care center, licensed family child care home (in-home daycare), or either. Always pass `programType` (`licensedCenter`, `licensedFamilyChildCare`, or `any`); omitting it limits results to centers.

**Round 2: a single `Question()` call for whatever is still missing.**

7. **Household income**: Gross pre-tax income. Offer dollar ranges for the family's household size (from `get_elfa_rates_and_rules`), never AMI percentages, and confirm the tier with `check_elfa_eligibility`.
8. **Budget**: Maximum monthly out-of-pocket target (e.g., $0, $500, $1,200). If it is omitted, `get_smart_recommendations` assumes $1,200.
9. **Language preference**: Language immersion (Spanish, Cantonese, Mandarin, Japanese, etc.) vs. dual-language support.

---

## 3. State Licensing & Safety Verification (CCLD)

Always cross-reference facilities with the official California Community Care Licensing Division (CCLD) using `get_state_licensing_record`. Citation totals combine inspection, complaint, and other visits. Report the category the tool returns; do not name facilities from memory:
* **Clear (`pristine`)**: licensed, with no citations or complaint visits in the CCLD public record.
* **Minor findings**: licensed, no Type A citations and no substantiated allegations, with 1–2 Type B citations or complaint visits.
* **Notable citations**: more than 2 Type B citations or complaint visits.
* **Caution**: any Type A citation, any substantiated allegation, or a status other than Licensed. Flag these explicitly for parents before recommending.
* **Unknown**: missing or incomplete CCLD data. This is never a clean record.

Do not describe citations as routine, minor, or resolved unless the CCLD report text says so; link the facility's CCLD page instead.

Providers can hold more than one CCLD license (for example, separate infant and preschool licenses). `get_childcare_details` and `get_smart_recommendations` check every license on the CareWait profile, report the most severe finding, and treat the provider as unverified if any license record is missing or incomplete. When calling `get_state_licensing_record` directly, check each number in `licenseNumbers`.

---

## 4. Decision Model & Meta Composite Scoring (TypeSafe Jev)

Use code-enforced gates for current license status, exact classroom age fit, verified price, provider-confirmed subsidy tier, and required diaper-change support. A child explicitly marked potty trained does not need the diapering gate. The gate applies when the family says the child is not potty trained (toddler or preschool age) and when a toddler's status is unknown. An unknown status for a preschool-age child is not gated, so always ask rather than infer it from age. Missing or incomplete CCLD data is unknown, never a clean record; show it as needing verification and do not place that facility in the verified recommendations.

Use `get_smart_recommendations` to calculate net cost from a published rate and the applicable credit. A Free Tuition estimate of $0 is conditional on confirmed ELFA eligibility and an available funded enrollment slot. Do not claim that Jev eliminates factual uncertainty: its typed scores and choice probabilities are model judgments, not substitutes for official records.

Use `compare_heuristic_vs_jev` for the rule-based budget heuristic versus a live TypeSafe Jev evaluation. If Jev is unavailable, state that the comparison could not be completed; do not manufacture a Jev score or confidence value.

CareWait's 100/25 evidence values are ordinal evidence signals, not probabilities: 100 means the matching accommodation is explicitly listed; 25 means the listing does not confirm it. Diaper changes and potty-training support have separate signals. A 100 for potty-training support must not be shown as 100 for diaper changes. Jev receives those source facts; a missing Jev score is not a zero and its composite must show the coverage used.

**Composite scoring weights**:
* With a family location: Location **25%**, Safety **25%**, Budget **25%**, Immersion **15%**, Diapering **10%**.
* Without a family location: Safety **35%**, Budget **30%**, Immersion **25%**, Diapering **10%**.
