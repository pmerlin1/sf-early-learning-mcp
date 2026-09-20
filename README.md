# SF Early Learning For All (ELFA) & CareWait MCP Server

An authoritative [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server for navigating San Francisco's **Department of Early Childhood (DEC)** preschool network, **Early Learning For All (ELFA)** financial subsidies, and real-time **CareWait** database searches.

Includes a **TypeSafe Jev System One** decision engine and **A/B evaluation matrix** comparing deterministic probability scoring against generative LLM judgments (Gemini).

---

## Features

- **Live CareWait Search**: Search 500+ licensed San Francisco preschools and child care centers with real-time filters for age, language immersion, facility type, schedule (full-time vs part-time), and subsidy programs.
- **Authoritative FY 2026–2027 SF DEC Rules**: Embedded rate tables, HUD AMI / California SMI ceilings, age bracket definitions (Infant, Toddler, Preschool), and strict co-pay limits.
- **Automated Net Out-of-Pocket Calculation**: Automatically calculates family subsidy discounts and estimates true monthly net tuition (`Math.max(0, grossTuition - subsidy)`).
- **TypeSafe Jev System One Integration**: Leverages TypeSafe's Jev model (`@typesafe-ai/sdk`) for typed decision primitives (`score`, `choice`, `noul`) to rank options with calibrated confidence rather than hallucinated generative text.
- **A/B Human Evaluation Tool**: Side-by-side comparison matrix of Gemini narrative recommendations vs Jev System One probability distributions.

---

## San Francisco ELFA Subsidy Tiers (FY 2026–2027)

| Tier | Household Income (HUD AMI) | Infant (0–24 mo) | Toddler (24–36 mo) | Preschool (3–5 yr) | Co-pay Rules |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Free Tuition** | **0% – 110% AMI** (≤$160,500/yr for family of 3) | **$3,027 / mo** | **$2,306 / mo** | **$2,115 / mo** | **No co-pays or fees allowed** |
| **Full Tuition Credit** | **111% – 150% AMI** ($160,501–$218,850/yr for family of 3) | **$3,027 / mo** | **$2,306 / mo** | **$2,115 / mo** | Co-pay = Tuition − credit |
| **Half Tuition Credit** | **151% – 200% AMI** ($218,851–$291,800/yr for family of 3) | **$1,514 / mo** | **$1,153 / mo** | **$1,058 / mo** | Family pays remaining tuition |

---

## Available MCP Tools

### 1. `check_elfa_eligibility`
Computes exact ELFA financial assistance tier, monthly discount credits, and co-pay rules given family size, income, and child age.

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
All-in-one recommendation engine: takes budget, language, schedule, and benefit tier, computes net out-of-pocket costs, and returns an affordably ranked shortlist of preschool centers.

### 5. `compare_gemini_vs_jev`
Runs an A/B evaluation benchmark: feeds candidate options and family constraints to both Gemini (narrative reasoning) and TypeSafe Jev System One (probabilistic decision model) to produce a structured human-evaluation comparison matrix.

### 6. `get_elfa_rates_and_rules`
Returns the raw authoritative FY 2026–2027 Department of Early Childhood rate schedules, income ceilings, and regulatory guidelines.

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
