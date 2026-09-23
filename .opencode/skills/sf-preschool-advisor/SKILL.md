---
name: sf-preschool-advisor
description: Authoritative guide for San Francisco preschool, childcare, and Department of Early Childhood (DEC) Early Learning For All (ELFA) financial assistance. Use when helping families find licensed preschools, check ELFA eligibility, calculate net tuition, or compare preschool programs in SF.
---

# San Francisco Preschool & Early Learning For All (ELFA) Advisor

This skill provides authoritative guidance on San Francisco preschool admissions, licensed child care centers, and the Department of Early Childhood (DEC) Early Learning For All (ELFA) financial aid programs for FY 2026–2027.

---

## 1. Hard Rules & Eligibility Architecture

Never estimate or guess income eligibility or subsidy rates in unstructured conversation. Always use the `sf-early-learning` MCP tools (`check_elfa_eligibility`, `get_smart_recommendations`, `search_sf_childcare`, and `get_childcare_details`). Use `compare_heuristic_vs_jev` only when an actual TypeSafe Jev evaluation is requested; it requires `TYPESAFE_API_KEY` and must fail clearly if unavailable.

Treat a provider's published tuition as the gross rate and ELFA as a separate funding credit applied to that rate. ELFA acceptance does not establish tuition or guarantee a funded opening. If CareWait rates are blank or incomplete, do not infer a rate from ELFA, DEC, Head Start, or other funding notes. When public web access is available, check the provider's own current tuition page and cite its URL and access date. Do not rely on search snippets or third-party directories for a verified price. If the provider's page does not state a current price for the relevant age group and schedule, mark the rate as unverified.

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
2. **Potty training & diapering status**: For toddlers under 36 months, independent potty training is unrealistic. Disqualify programs requiring independent toilet training (such as preschool-only licenses) and verify the center has a California Title 22 Toddler license with diaper changing tables on-site.
3. **Family composition & income**: Total members in household and gross pre-tax income to determine ELFA tier.
4. **Budget constraints**: Maximum monthly out-of-pocket target (e.g., $0, $300, $1,200).
5. **Environment preference**: Dedicated Licensed Child Care Center vs. Licensed Family Child Care Home (in-home daycare).
6. **Language preference**: Language immersion (Spanish, Cantonese, Mandarin, Japanese, etc.) vs. dual-language support.
7. **Schedule preference**: Full-time vs. Part-time / specific days.

---

## 3. State Licensing & Safety Verification (CCLD)

Always cross-reference facilities with the official California Community Care Licensing Division (CCLD) using `get_state_licensing_record`:
* **Pristine**: 0 citations, 0 complaints ever recorded (e.g. Kai Ming centers, Felton Learning Center).
* **Minor Technical Findings**: 1–2 isolated routine Type B recordkeeping or facility maintenance citations that are fully resolved (e.g. Chibi Chan Too). These receive a slight ding in Jev scoring but remain top-tier or strong alternatives.
* **Caution Flagged**: History of Type A citations (immediate health/safety hazards) or substantiated complaint allegations (e.g. Sunshine Preschool). Flag these explicitly for parents before recommending.

---

## 4. Decision Model & Meta Composite Scoring (TypeSafe Jev)

Use code-enforced gates for current license status, exact classroom age fit, verified price, and required diapering support. Missing or incomplete CCLD data is unknown, never a clean record; show it as needing verification and do not place that facility in the verified recommendations.

Use `get_smart_recommendations` to calculate net cost from a published rate and the applicable credit. A Free Tuition estimate of $0 is conditional on confirmed ELFA eligibility and an available funded enrollment slot. Do not claim that Jev eliminates factual uncertainty: its typed scores and choice probabilities are model judgments, not substitutes for official records.

Use `compare_heuristic_vs_jev` for the rule-based budget heuristic versus a live TypeSafe Jev evaluation. If Jev is unavailable, state that the comparison could not be completed; do not manufacture a Jev score or confidence value.

**Composite scoring weights**:
* With a family location: Location **25%**, Safety **25%**, Budget **25%**, Immersion **15%**, Diapering **10%**.
* Without a family location: Safety **35%**, Budget **30%**, Immersion **25%**, Diapering **10%**.
