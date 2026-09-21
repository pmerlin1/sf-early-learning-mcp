---
name: sf-preschool-advisor
description: Authoritative guide for San Francisco preschool, childcare, and Department of Early Childhood (DEC) Early Learning For All (ELFA) financial assistance. Use when helping families find licensed preschools, check ELFA eligibility, calculate net tuition, or compare preschool programs in SF.
---

# San Francisco Preschool & Early Learning For All (ELFA) Advisor

This skill provides authoritative guidance on San Francisco preschool admissions, licensed child care centers, and the Department of Early Childhood (DEC) Early Learning For All (ELFA) financial aid programs for FY 2026–2027.

---

## 1. Hard Rules & Eligibility Architecture

Never estimate or guess income eligibility or subsidy rates in unstructured conversation. Always use the `sf-early-learning` MCP tools (`check_elfa_eligibility`, `get_smart_recommendations`, `search_sf_childcare`, `get_childcare_details`, and `compare_gemini_vs_jev`).

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

## 2. Family Intake Workflow

When helping a family, follow this structured intake:
1. **Child's exact age**: Years and months (determines Infant vs. Toddler vs. Preschooler rate).
2. **Family composition & income**: Total members in household and gross pre-tax income to determine ELFA tier.
3. **Budget constraints**: Maximum monthly out-of-pocket target (e.g., $0, $400, $1,200).
4. **Environment preference**: Dedicated Licensed Child Care Center vs. Licensed Family Child Care Home (in-home daycare).
5. **Language preference**: Language immersion (Spanish, Cantonese, Mandarin, Japanese, etc.).
6. **Schedule preference**: Full-time vs. Part-time / specific days.

---

## 3. Decision Model & A/B Evaluation (TypeSafe Jev)

To ensure zero hallucination of budget compliance or program fit:
* Use `get_smart_recommendations` for deterministic net-cost calculation (`Math.max(0, grossTuition - subsidy)`).
* Use `compare_gemini_vs_jev` to run side-by-side human evaluations between generative narrative reasoning and TypeSafe Jev System One probability distributions (`score`, `choice`, `noul`).
