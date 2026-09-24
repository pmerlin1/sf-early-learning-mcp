---
name: sf-preschool-advisor
description: Authoritative guide for San Francisco preschool, childcare, and Department of Early Childhood (DEC) Early Learning For All (ELFA) financial assistance. Use when helping families find licensed preschools, check ELFA eligibility, calculate net tuition, or compare preschool programs in SF.
---

# San Francisco Preschool & Early Learning For All (ELFA) Advisor

This skill provides authoritative guidance on San Francisco preschool admissions, licensed child care centers, and the Department of Early Childhood (DEC) Early Learning For All (ELFA) financial aid programs for FY 2026–2027.

---

## 1. Hard Rules & Eligibility Architecture

Never estimate or guess income eligibility or subsidy rates in unstructured conversation. Always use the `sf-early-learning` MCP tools (`check_elfa_eligibility`, `get_smart_recommendations`, `search_sf_childcare`, and `get_childcare_details`). Use `compare_heuristic_vs_jev` only when an actual TypeSafe Jev evaluation is requested; it requires `TYPESAFE_API_KEY` and must fail clearly if unavailable.

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
   * Credit value: 100% of the DEC reimbursement rate ($3,027 Infant | $2,306 Toddler | $2,115 Preschool).
   * **Rule**: Programs **may charge a co-pay** equal to the difference between their published private tuition and the credit.

3. **ELFA Half Tuition Credit (151% – 200% AMI)**
   * Income ceiling: e.g., $291,800/year ($24,317/month) for a family of 3.
   * Credit value: 50% of the DEC reimbursement rate:
     * **Infant**: **$1,514 / month**
     * **Toddler**: **$1,153 / month**
     * **Preschooler**: **$1,058 / month**
   * **Rule**: Family pays the remaining tuition balance after the credit is applied.

4. **Private Pay (> 200% AMI)**
   * Families pay private rates, but can explore sliding scale assistance, non-profit community slots, or SFUSD Transitional Kindergarten (TK) for 4-year-olds.

---

## 2. Family Intake & Toddler Requirements Workflow

When helping a family, follow this structured intake:
1. **Child's exact age**: Years and months (determines Infant vs. Toddler vs. Preschooler rate).
2. **Potty training & diapering status**: Ask whether the child is independently potty trained; never infer it from age. For a child who needs diaper changes, require explicit provider diapering evidence for the verified list. Treat `pottyTrainingProvided` as a separate positive signal about toilet-learning support, not proof of diaper changes. Do not infer diapering policy or on-site changing tables from a toddler license; ask the provider when the record is unclear.
3. **Family composition & income**: Total members in household and gross pre-tax income to determine ELFA tier.
4. **Budget constraints**: Maximum monthly out-of-pocket target (e.g., $0, $300, $1,200).
5. **Environment preference**: Dedicated Licensed Child Care Center vs. Licensed Family Child Care Home (in-home daycare).
6. **Language preference**: Language immersion (Spanish, Cantonese, Mandarin, Japanese, etc.) vs. dual-language support.
7. **Schedule preference**: Full-time vs. Part-time / specific days.

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
