# SF Early Learning For All (ELFA) & CareWait MCP Server

An authoritative [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server for navigating San Francisco's **Department of Early Childhood (DEC)** preschool network, **Early Learning For All (ELFA)** financial subsidies, and real-time **CareWait** database searches.

Includes a **TypeSafe Jev System One** evaluator and a comparison matrix for Jev's live model judgments versus a transparent local budget heuristic.

---

## Features

- **Live CareWait Search**: Search 500+ licensed San Francisco preschools and child care centers with real-time filters for age, language immersion, facility type, schedule (full-time vs part-time), and subsidy programs.
- **Authoritative FY 2026–2027 SF DEC Rules**: Embedded rate tables, HUD AMI / California SMI ceilings, age bracket definitions (Infant, Toddler, Preschool), and strict co-pay limits, with citations to the DEC source documents.
- **Net Out-of-Pocket Estimates**: Applies the applicable credit to a published tuition rate, uses the conservative end of a known range for budget fit, and leaves blank or incomplete rates unverified.
- **TypeSafe Jev System One Integration**: Uses TypeSafe's JavaScript SDK with typed `score` and `choice` questions. Jev judgments require `TYPESAFE_API_KEY`; they do not replace official records or deterministic eligibility checks.
- **Heuristic Comparison Tool**: Compares Jev's live model output with a rule-based budget heuristic. No generative LLM is called.

---

## San Francisco ELFA Subsidy Tiers (FY 2026–2027)

| Tier | Household Income (HUD AMI) | Infant (0–24 mo) | Toddler (24–36 mo) | Preschool (3–5 yr) | Co-pay Rules |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Free Tuition** | **0% – 110% AMI** (≤$160,500/yr for family of 3) | **$3,027 / mo** | **$2,306 / mo** | **$2,115 / mo** | **No co-pays or fees allowed** |
| **Full Tuition Credit** | **111% – 150% AMI** ($160,501–$218,850/yr for family of 3) | **$3,027 / mo** | **$2,306 / mo** | **$2,115 / mo** | Co-pay = Tuition − credit |
| **Half Tuition Credit** | **151% – 200% AMI** ($218,851–$291,800/yr for family of 3) | **$1,514 / mo** | **$1,153 / mo** | **$1,058 / mo** | Family pays remaining tuition |

Credits are a percentage of DEC's full-time reimbursement rate, so they are the same for part-time care. DEC lists part-time rates only to calculate funding gaps between state vouchers and ELFA rates. Income ceilings for families of 1–12 are in DEC's income eligibility sheet; see [Sources](#sources).

---

## Available MCP Tools

### 1. `check_elfa_eligibility`
Computes exact ELFA financial assistance tier, monthly credit amount, and co-pay rules given family size (1–12), income, and child age, and returns the DEC documents it relies on in `sources`.

### 2. `search_sf_childcare`
Queries the live SF CareWait database with rich filters:
- `ageYears`: e.g., `2.1`
- `programType`: `licensedCenter` (preschool center), `licensedFamilyChildCare` (home daycare), or `any`
- `financialAid`: `["halfCreditELFA"]`, `["freeTuitionELFA"]`, `["cctr"]`, `["csppFullDay"]`, etc.
- `language`: `Spanish`, `Mandarin`, `Cantonese`, `French`, `Japanese`, etc.
- `schedule`: `partTime`, `fullTime`
- `openingsOnly`: Boolean filter for programs with immediate vacancies.
- `zipCodes`: List of San Francisco zip codes.

### 3. `get_childcare_details`
Fetches complete provider details by `entityId`: licensed classrooms, age limits in months, full infant/toddler/preschool tuition rate schedules, contact info, and DEC contract notes.

### 4. `get_smart_recommendations`
All-in-one recommendation engine: takes budget, language, schedule, benefit tier, daycare type (`licensedCenter`, `licensedFamilyChildCare`, or `any`; centers when omitted), and optional potty-training status; verifies the selected ELFA tier against provider details before applying a credit; and returns an affordably ranked shortlist of licensed programs. Missing provider aid data never becomes an assumed credit. The DEC documents behind the credit amounts are returned in `subsidySources`.

With a home zip code, the search works outward in rings (about 1.2, 2.5, and 3.8 miles, straight line), fetching every page of each ring until 50 providers are queued for detail and CCLD checks, so the closest programs are always evaluated first. It widens to all of San Francisco only when fewer than 10 programs match nearby, and adds those after the nearby ones. `searchScope` reports the zip codes searched and whether the search went citywide.

### 5. `compare_heuristic_vs_jev`
Compares the local rule-based budget heuristic with TypeSafe Jev System One. Requires `TYPESAFE_API_KEY` and returns an error if the live Jev evaluation cannot run; no simulated Jev fallback is provided.

### 6. `get_elfa_rates_and_rules`
Returns the raw authoritative FY 2026–2027 Department of Early Childhood rate schedules, income ceilings (families of 1–12), and program rules, with the DEC source documents in `sources`.

### 7. `get_state_licensing_record`
Direct integration with the **California Community Care Licensing Division (CCLD)** transparency database: retrieves official inspection histories, capacity, complaint visits, substantiated allegations, Type A/B violations, and licensing conditions by license number. Each record includes `ccldFacilityUrl`, the facility's public CCLD page, for citation.

## MCP Prompt: `family_intake_interview`

A two-round family interview generated from `src/family-intake.js`:

1. **First round, asked together:** child age in years and months, potty training, family size, neighborhood or zip, schedule, and daycare type (licensed center, family child care home, or either).
2. **Follow-up round:** household income, monthly budget, and language preference.

Each answer is mapped to a tool parameter. For example, "not sure" about potty training omits `childIsPottyTrained`, and "either" daycare type becomes `programType: "any"`. Income is offered as dollar ranges for the family's household size, taken from the FY 2026–2027 ceilings, never as AMI percentages.

---

## Eligibility Gates and TypeSafe Jev Scoring

Hard factual checks stay in application code. Jev supplies model judgments for the structured scoring dimensions:

1. **Verified Requirements (Deterministic Gates)**:
   - Current CCLD license status and complete inspection data. Missing or incomplete records are unknown, not clean. Providers with several licenses (e.g. separate infant and preschool licenses) are checked on every license, and the most severe finding is reported.
   - Facility type matching (dedicated commercial center vs in-home).
   - Exact classroom age compatibility in months. Missing age data is surfaced for review.
   - Published rate and provider-confirmed ELFA tier before placement in verified recommendations. Diapering accommodation is reported per provider (`diaperingFitStatus`) as a question for parents to confirm on tours, but is excluded from code-enforced gating and Jev composite scoring because CareWait provider records rarely populate the field (<2%). A missing aid list or rate note that conflicts with the provider's tier list is routed for verification.
   - Per-provider `monthlySubsidyCredit` is the credit listed for that provider and tier; `monthlySubsidyCreditAppliedToRate` is the amount actually subtracted. Already post-credit rates show zero subtracted to prevent double-discounting. `scheduledMonthlySubsidyCredit` is the DEC schedule reference when provider acceptance is not confirmed.

2. **Graded Decision Scoring (TypeSafe Jev Primitives)**:
   - With a location: **Location 30%, Safety 30%, Budget 25%, Immersion 15%** (diapering excluded).
   - Without a location: **Safety 40%, Budget 35%, Immersion 25%** (diapering excluded).

3. Jev returns a typed recommendation choice and probabilities. The application also computes a weighted composite from Jev's available score answers; if answers are missing, the composite is reweighted over scored dimensions and includes a coverage value and missing-dimension list. The choice is a separate model judgment, not a verdict derived mechanically from that composite.

CareWait's `100` / `25` accommodation evidence values are ordinal signals, not likelihoods: `100` means that specific accommodation is explicitly listed and `25` means it is not confirmed. Diaper changes and potty-training support use separate values; a potty-training flag never confirms diaper changing.

---

## Installation & Setup

### Requirements
- Node.js >= 20.0.0

```bash
git clone https://github.com/your-username/sf-early-learning-mcp.git
cd sf-early-learning-mcp
npm install
npm test
```

### Configuration in OpenCode (`opencode.json`)

Add to your `opencode.json` (global `~/.config/opencode/opencode.json` or project-local `./opencode.json`):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "sf-early-learning": {
      "type": "local",
      "command": [
        "node",
        "/absolute/path/to/sf-early-learning-mcp/src/index.js"
      ],
      "enabled": true,
      "environment": {
        "TYPESAFE_API_KEY": "{env:TYPESAFE_API_KEY}"
      }
    }
  }
}
```

### Configuration in Claude Desktop / Claude Code

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "sf-early-learning": {
      "command": "node",
      "args": ["/absolute/path/to/sf-early-learning-mcp/src/index.js"],
      "env": {
        "TYPESAFE_API_KEY": "your-typesafe-key-here"
      }
    }
  }
}
```

---

## Recommended Prompts to Start

Once configured in your AI client (OpenCode, Claude, Cursor), try these copy-paste prompts:

### 1. The Intake Interview
> *"I have a 2-year-old child and live in San Francisco. Walk me through the Early Learning For All (ELFA) options, check my eligibility, and recommend preschools based on my budget and language preference."*

### 2. Low Out-of-Pocket Language Immersion
> *"We have the ELFA Half Tuition Credit for our 2.1-year-old toddler. Can you find licensed preschool centers (not home-based) offering Spanish or Cantonese/Mandarin immersion where our out-of-pocket tuition is under $400/month?"*

### 3. Income Eligibility Check
> *"We are a family of 4 living in San Francisco with a gross monthly income of $15,000. Do we qualify for ELFA Free Tuition or the Full Credit? What is our monthly voucher amount for a 2-year-old toddler and a 4-year-old preschooler?"*

### 4. Compare the Budget Heuristic with Jev
> *"Compare the rule-based budget heuristic with TypeSafe Jev for Spanish immersion preschool centers in San Francisco with a target budget of $200/month."*

---

## How Net Cost Is Calculated

Examples for a toddler (24–36 months) in the Half Tuition Credit tier ($1,153/month credit):

| What CareWait publishes for the toddler age group | Estimated net monthly cost |
| :--- | :--- |
| A gross tuition range of $0–$1,383 | **$230** ($1,383 − $1,153; the upper end of the range is used for budget fit) |
| An amount the provider's notes say is charged *after* the ELFA credit, e.g. $0–$1,153 | **Up to $1,153** (the credit is not subtracted a second time) |
| A blank rate, or only a preschool rate | **Unknown**; the rate is unverified until confirmed on the provider's own site or by the provider |
| Any rate, with the family in the Free Tuition tier (0–110% AMI) | **$0**, conditional on an approved ELFA award and an available funded slot |

The credit applies only at providers whose CareWait financial-aid list includes the family's ELFA tier. It is the same for part-time care.

---

## Sources

DEC figures and rules come from these FY 2026–2027 documents, published July 1, 2026 and accessed September 24, 2026:

- [Early Learning For All Rates – Fiscal Year 2026–2027](https://media.api.sf.gov/documents/Early_Learning_For_All_Rates_FY_26-27.pdf): reimbursement rates and monthly credit amounts. Its footnote says part-time rates are listed only to calculate funding gaps between state vouchers and ELFA rates.
- [FY 2026–2027 San Francisco Family Income Eligibility](https://media.api.sf.gov/documents/State_CDE-CDSS_and_ELFA_Family_Income_Eligibility_FY_26-27_1.pdf): State CCTR/CSPP and ELFA income ceilings for families of 1–12.
- [Eligibility for free or low-cost preschool and child care](https://www.sf.gov/eligibility-for-free-or-low-cost-preschool-and-child-care) (SF.gov): tier definitions and co-pay rules.

DEC posts both FY 2026–2027 sheets on its [rates page](https://www.sf.gov/early-learning-for-all-rates-fiscal-year-2026-2027). The older legacy.sfdec.org page still shows FY 2025–2026 figures. Provider tuition comes from CareWait, and licensing records from the California CCLD transparency API.

---

## Security, SAST & Verification

- **TypeSafe Credential**: Jev requires `TYPESAFE_API_KEY` in the environment. The CareWait API key is a public client credential used by the provider's browser-facing service.
- **Dependency Audit**: Verified with `npm audit` (0 vulnerabilities).
- **Pre-commit Hooks**: Enforces automated secret scanning and unit test validation before any commit.
- **Deterministic Logic**: Income brackets and credit arithmetic are executed in code; unknown prices and incomplete licensing records remain explicitly unverified.

---

## Testing

Run unit tests and verification suite:

```bash
npm test
```

Run headlessly via OpenCode:

```bash
opencode run "Using the sf-early-learning MCP, check ELFA eligibility for a family of 3 with monthly income of $18000 and a 2.1-year-old child"
```

---

## License

[MIT](LICENSE) © 2026 Paul Merlin
