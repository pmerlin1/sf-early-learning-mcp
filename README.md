# SF Early Learning For All (ELFA) & CareWait MCP Server

An independent [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server for San Francisco's **Early Learning For All (ELFA)** childcare assistance. It checks a family's eligibility against the **Department of Early Childhood (DEC)** tables, searches licensed programs in SF's **CareWait** listings, checks each one's state licensing record, and ranks the results with **TypeSafe Jev**.

Code gathers and verifies the facts. Jev (System One) then rates each verified program on commute, licensing record, budget fit, and language immersion, and recommendations are ranked by the weighted composite of those ratings.

> **Not official.** This project is not affiliated with or endorsed by DEC, CareWait, or the California Community Care Licensing Division (CCLD), and it is not an authoritative source. Its costs and rankings are estimates: confirm eligibility with DEC, and tuition, openings, and ELFA participation with each provider.

---

## Features

- **Live CareWait Search**: Search 500+ licensed San Francisco preschools and child care centers with real-time filters for age, language immersion, facility type, schedule (full-time vs part-time), and subsidy programs.
- **FY 2026–2027 SF DEC Rules**: Embedded rate tables, HUD AMI / California SMI ceilings, age bracket definitions (Infant, Toddler, Preschool), and strict co-pay limits, with citations to the DEC source documents.
- **Net Out-of-Pocket Estimates**: Applies the applicable credit to a published tuition rate, uses the conservative end of a known range for budget fit, and leaves blank or incomplete rates unverified.
- **Jev-Ranked Recommendations**: TypeSafe Jev System One rates every verified program through TypeSafe's JavaScript SDK, using typed `score` and `choice` questions, and recommendations are ranked by the weighted composite. Requires `TYPESAFE_API_KEY`; without it, `get_smart_recommendations` returns an error rather than ranking programs another way. Jev's ratings are model judgments over verified facts; they do not replace CCLD records, DEC's eligibility rules, or a provider's confirmation.

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
Fetches complete provider details by `entityId`: licensed classrooms, age limits in months, full infant/toddler/preschool tuition rate schedules, contact info (phone, email, and the provider's `website`), and DEC contract notes.

### 4. `get_smart_recommendations`
The recommendation engine checks every CareWait match across San Francisco, fetches its details and CCLD record, and uses TypeSafe Jev to score every program that passes the fact checks. It takes child age, budget, language, schedule, income or benefit tier, daycare type (`licensedCenter`, `licensedFamilyChildCare`, or `any`; centers when omitted), and optional potty-training status. Code applies the checks described in [How Recommendations Are Made](#how-recommendations-are-made). The family's home zip affects distance and Jev's commute rating; it does not limit the search. Both Jev-ranked lists (`recommendations` within budget and `stretchOptions` over it) are sorted by Jev's composite. Verification candidates follow in the order described by the skill.

Results contain at most 10 provider rows per page to keep each tool response below common client display limits; this is response pagination, not a cap on the search or result set. Clients must read every page through `totalPages` to access every matching program. Pass `page` (1-based, default 1) to read later pages; `listTotals`, `totalPrograms`, and `totalPages` describe the full search. Detail, processing, and search-page failures are also paged in chunks of 10, even when a page contains no provider rows. Summary counts, `priceSummary`, `jevScoring`, and `coverage.complete` are stable across pages. Per-program CCLD and Jev failure details appear on the page containing that program. Global failure counts remain stable. Each program carries a `jev` block (composite, 0–3 ratings, recommendation with a plain-language label, and probabilities). `coverage` reports the CareWait total, how many programs were checked, exclusions, and any detail, CCLD, or Jev failures.

A large search runs in the background so each MCP call stays below the client's 60-second timeout. If the tool returns `status: "in_progress"`, call it again with the same search parameters; it joins the existing search and reports progress or the finished page. The completed result is cached for 30 minutes, so requesting another page does not repeat the search or Jev calls. Requires `TYPESAFE_API_KEY`. Missing provider aid data never becomes an assumed credit, and the DEC documents behind the credit amounts are returned in `subsidySources`.

### 5. `get_elfa_rates_and_rules`
Returns the FY 2026–2027 rate schedules, income ceilings (families of 1–12), and program rules as published by the Department of Early Childhood, with the DEC source documents in `sources`.

### 6. `get_state_licensing_record`
Direct integration with the **California Community Care Licensing Division (CCLD)** transparency database: retrieves inspection histories, capacity, complaint visits, substantiated allegations, Type A/B violations, and licensing conditions by license number. Each record includes `ccldFacilityUrl`, the facility's public CCLD page, for citation.

## MCP Prompt: `family_intake_interview`

A two-round family interview generated from `src/family-intake.js`:

1. **First round, asked together:** child age in years and months, potty training, family size, neighborhood or zip, schedule, and daycare type (licensed center, family child care home, or either).
2. **Follow-up round:** household income, monthly budget, and language preference.

Each answer is mapped to a tool parameter. For example, "not sure" about potty training omits `childIsPottyTrained`, and "either" daycare type becomes `programType: "any"`. Income is offered as dollar ranges for the family's household size, taken from the FY 2026–2027 ceilings, never as AMI percentages.

---

## How Recommendations Are Made

Facts stay in deterministic code; Jev makes the judgment calls.

1. **Gather and verify (code)**: The search works outward from the family's zip code, as described above, and loads each program's CareWait details and CCLD records. A program must then pass these checks:
   - Current CCLD license status and complete inspection data. Missing or incomplete records are unknown, not clean. Providers with several licenses (e.g. separate infant and preschool licenses) are checked on every license, and the most severe finding is reported.
   - Facility type matching (dedicated commercial center vs in-home).
   - Exact classroom age compatibility in months. Missing age data is surfaced for review.
   - Published rate and provider-confirmed ELFA tier before placement in verified recommendations. Diapering accommodation is reported per provider (`diaperingFitStatus`) as a question for parents to confirm on tours, but is excluded from code-enforced gating and Jev composite scoring because CareWait provider records rarely populate the field (<2%). A missing aid list or rate note that conflicts with the provider's tier list is routed for verification.
   - Per-provider `monthlySubsidyCredit` is the credit listed for that provider and tier; `monthlySubsidyCreditAppliedToRate` is the amount actually subtracted. Already post-credit rates show zero subtracted to prevent double-discounting. `scheduledMonthlySubsidyCredit` is the DEC schedule reference when provider acceptance is not confirmed.

   Programs that fail a check are listed for follow-up (`unverifiedSafetyCandidates`, `unverifiedRateCandidates`, `unverifiedAgeCandidates`) and are never sent to Jev, which is not asked to rate missing data.

2. **Score (Jev)**: Every program that passes the fact checks goes to TypeSafe Jev System One, six calls at a time, with up to four SDK retries for transient failures. Successful judgments are cached for 30 minutes by program and family profile. Jev rates each one on a 0–3 rubric:
   - **Commute**: straight-line distance from the home zip code, when one is given.
   - **Licensing record**: the verified CCLD citations, complaint visits, and substantiated allegations.
   - **Budget fit**: the net monthly cost against the family's budget.
   - **Language immersion**: depth of immersion in the requested language, when one is given.

   Jev also picks an overall recommendation (`top_tier`, `strong_alternative`, `caution_flagged`, `unsuitable`, or `needs_verification`), with probabilities.

3. **Rank (composite)**: Each rating is divided by 3 and weighted, with the weights renormalized over the criteria that apply:
   - With a location: **Location 30%, Safety 30%, Budget 25%, Immersion 15%**.
   - Without a location: **Safety 40%, Budget 35%, Immersion 25%**.
   - With no language preference, immersion drops out and the other weights scale up.

   A missing Jev answer lowers `compositeCoverage` instead of counting as zero. A program Jev could not score stays in its list, after the scored ones, with `jev.status: "failed"`; its error appears in `coverage.jevFailed`. `jevScoring.candidatesNotScored` is zero unless a Jev call fails. Cached judgments do not add their old token usage to the current search's totals.

Full-city search time and Jev cost scale with the number of matches. In the September 26, 2026 benchmark, fetching details and CCLD records for 516 programs took 25.2 seconds with 16 requests in flight. Jev averaged about 1,500 input and 125 output tokens per program; scoring 250 programs uses roughly 375,000 input tokens. `coverage.complete` is true only when all matches were retrieved and checked and no stage failed.

CareWait's `100` / `25` accommodation evidence values are ordinal signals, not likelihoods: `100` means that specific accommodation is explicitly listed and `25` means it is not confirmed. Diaper changes and potty-training support use separate values; a potty-training flag never confirms diaper changing.

---

## Installation & Setup

### Requirements
- Node.js >= 22.0.0 (CI tests Node 22 and 24 LTS)

```bash
git clone https://github.com/pmerlin1/sf-early-learning-mcp.git
cd sf-early-learning-mcp
npm install
npm test
```

### CI and Releases

Pull requests and pushes to `main` run `npm ci`, the test suite, and an npm dependency audit in GitHub Actions. Dependabot checks npm packages and pinned GitHub Actions weekly. To publish a source release, push a `v<package.json version>` tag (for example, `v1.0.0`); the release workflow reruns the checks, packages the project, and attaches the tarball to a GitHub Release. The project has no hosted runtime or deployment target, so this release workflow publishes a downloadable package rather than deploying a service.

Recommendations need a [TypeSafe AI](https://typesafe.ai) API key (see the [TypeSafe docs](https://docs.typesafe.ai/)). Set `TYPESAFE_API_KEY` in the MCP server's environment as shown below. The eligibility, search, details, and licensing tools work without it.

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

Once configured in your AI client (OpenCode, Claude, Cursor), try these copy-paste prompts. Before recommending, the agent asks whatever the prompt leaves out (age in months, potty training, household size, schedule, daycare type, income range, budget, and language), then returns tables ranked by Jev.

### 1. The Intake Interview
> *"I have a 2-year-old child, and live in San Francisco zip 94102. Walk me through the Early Learning For All (ELFA) options, check my eligibility, and recommend preschools based on my budget and language immersion."*

### 2. Language Immersion Near Home
> *"We have the ELFA Half Tuition Credit for our 2-year-old and live in North Beach (94133). Which licensed centers (not home-based) near us offer Cantonese immersion for under $1,200 a month out of pocket?"*

### 3. Income Eligibility Check
> *"We are a family of 4 living in San Francisco with a gross monthly income of $15,000. Do we qualify for ELFA Free Tuition or the Full Credit? What is our monthly voucher amount for a 2-year-old toddler and a 4-year-old preschooler?"*

### 4. See Jev's Reasoning
> *"Our 3-year-old has the ELFA Full Tuition Credit and we live in the Mission (94110). Rank Spanish immersion programs, centers or family child care, that would cost us under $500 a month, and show the Jev ratings behind each ranking: commute, licensing record, budget fit, and immersion."*

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
- **CI Checks**: GitHub Actions runs the unit tests and dependency audit on pull requests and pushes to `main`.
- **Dependency Updates**: Dependabot checks npm packages and GitHub Actions weekly, with a cooldown for routine version updates.
- **Secret and SAST Scanning**: No repository-managed scanner is configured yet; add one before treating the CCSF standard's security scanning guidance as fully met.
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
