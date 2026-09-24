#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema
} from '@modelcontextprotocol/sdk/types.js';

import { calculateEligibility } from './eligibility.js';
import { searchProfiles, getSiteDetails } from './carewait-client.js';
import { getRecommendations } from './recommendations.js';
import { evaluateCandidatesWithJev } from './jev-eval.js';
import { runHeuristicVsJevComparison } from './ab-test.js';
import { getFacilityDetail } from './ccld-client.js';
import { buildFamilyIntakePrompt } from './family-intake.js';
import {
  ELFA_RATES_FY26_27,
  ELFA_INCOME_TABLE_FY26_27,
  LANGUAGE_MAP,
  FINANCIAL_ASSISTANCE_MAP
} from './constants.js';

const server = new Server(
  {
    name: 'sf-early-learning-for-all',
    version: '1.0.0'
  },
  {
    capabilities: {
      tools: {},
      prompts: {}
    }
  }
);

// Register Tool Definitions
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'check_elfa_eligibility',
        description:
          'Calculate San Francisco Early Learning For All (ELFA) financial assistance eligibility, income tier (Free 0-110% AMI, Full Credit 111-150% AMI, Half Credit 151-200% AMI), exact monthly subsidy amounts, and co-pay rules for a family.',
        inputSchema: {
          type: 'object',
          properties: {
            familySize: {
              type: 'number',
              description: 'Total number of family members (parents/caregivers and dependent children under 18)'
            },
            monthlyIncome: {
              type: 'number',
              description: 'Gross monthly household income before taxes and deductions'
            },
            annualIncome: {
              type: 'number',
              description: 'Gross annual household income before taxes'
            },
            childAgeYears: {
              type: 'number',
              description: 'Age of the child in years (e.g., 2.1 for 2 years and 1 month)'
            }
          },
          required: ['familySize']
        }
      },
      {
        name: 'search_sf_childcare',
        description:
          'Search the official San Francisco CareWait database of over 500 licensed early care and preschool programs with real-time filters.',
        inputSchema: {
          type: 'object',
          properties: {
            ageYears: {
              type: 'number',
              description: 'Age of the child in years (e.g. 2 for 2-year-old)'
            },
            programType: {
              type: 'string',
              enum: ['licensedCenter', 'licensedFamilyChildCare', 'licenseExemptCenterSchoolCamp', 'any'],
              description: 'Type of program: licensedCenter (preschool center), licensedFamilyChildCare (in-home), or any'
            },
            financialAid: {
              type: 'array',
              items: { type: 'string' },
              description:
                'Financial assistance types accepted (e.g., ["halfCreditELFA"], ["freeTuitionELFA"], ["fullCreditELFA"], ["cctr"], ["headStart"], ["csppFullDay"])'
            },
            language: {
              type: 'string',
              description: 'Language taught or immersion language (e.g. "Spanish", "Mandarin", "Cantonese", "French", "Japanese")'
            },
            schedule: {
              type: 'string',
              enum: ['partTime', 'fullTime'],
              description: 'Schedule preference: partTime or fullTime'
            },
            hours: {
              type: 'string',
              description: 'Specific hours (e.g., daytimeCare, schoolHours, beforeCare, afterCare)'
            },
            openingsOnly: {
              type: 'boolean',
              description: 'If true, only returns programs that currently have open spots'
            },
            zipCodes: {
              type: 'array',
              items: { type: 'number' },
              description: 'List of San Francisco zip codes to restrict search to'
            },
            skip: { type: 'number', description: 'Pagination offset (default 0)' },
            take: { type: 'number', description: 'Number of results to return (default 20, max 50)' }
          }
        }
      },
      {
        name: 'get_childcare_details',
        description:
          'Retrieve complete details for a specific SF childcare or preschool center by its entityId, including exact tuition rates table by age group, programs, schedule, languages, contact info, and ELFA subsidy notes.',
        inputSchema: {
          type: 'object',
          properties: {
            entityId: {
              type: 'string',
              description: 'The entityId of the provider'
            }
          },
          required: ['entityId']
        }
      },
      {
        name: 'get_smart_recommendations',
        description:
          'Recommendation engine: combines child age and toilet-training status, family size, income/known benefit tier, max out-of-pocket budget, language immersion preferences, and facility type. Applies ELFA credits only when the provider detail record lists the selected tier; unknown provider eligibility never becomes an assumed credit.',
        inputSchema: {
          type: 'object',
          properties: {
            childAgeYears: {
              type: 'number',
              description: 'Age of the child in years (e.g., 2.1)'
            },
            childIsPottyTrained: {
              type: 'boolean',
              description: 'Optional. Whether this child is independently potty trained; omit if unknown. If false (toddler or preschool age), or omitted for a toddler, diaper-change support must be explicitly documented to qualify as verified.'
            },
            familySize: {
              type: 'number',
              description: 'Total number of family members'
            },
            monthlyIncome: {
              type: 'number',
              description: 'Gross monthly household income'
            },
            annualIncome: {
              type: 'number',
              description: 'Gross annual household income'
            },
            benefitTier: {
              type: 'string',
              enum: ['privatePay', 'halfCreditELFA', 'fullCreditELFA', 'freeTuitionELFA'],
              description: 'Known tier; without income or tier data, privatePay is assumed so no subsidy is counted'
            },
            targetBudgetMonthly: {
              type: 'number',
              description: 'Maximum desired out-of-pocket monthly cost (e.g. 1200 or 0)'
            },
            preferredLanguage: {
              type: 'string',
              description: 'Preferred language immersion (e.g. "Spanish", "Mandarin", "Cantonese", "French")'
            },
            homeZipCode: {
              type: 'number',
              description: 'Family home zip code (e.g. 94121) to prioritize immediate neighborhood facilities and calculate exact commute distance'
            },
            programType: {
              type: 'string',
              enum: ['licensedCenter', 'licensedFamilyChildCare'],
              description: 'Default is licensedCenter (dedicated preschool center)'
            },
            schedule: {
              type: 'string',
              enum: ['partTime', 'fullTime'],
              description: 'Schedule preference'
            },
            maxResults: {
              type: 'number',
              description: 'Number of top recommendations to return (default 10)'
            }
          },
          required: ['childAgeYears']
        }
      },
      {
        name: 'get_elfa_rates_and_rules',
        description:
          'Get authoritative San Francisco Department of Early Childhood (DEC) official FY 2026-2027 reimbursement rates, income eligibility tables, and program rules.',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'compare_heuristic_vs_jev',
        description:
          'Compares a transparent rule-based budget heuristic with TypeSafe Jev System One evaluations. Requires TYPESAFE_API_KEY; this tool does not call a generative LLM.',
        inputSchema: {
          type: 'object',
          properties: {
            childAgeYears: {
              type: 'number',
              description: 'Age of the child in years (default 2.1)'
            },
            childIsPottyTrained: {
              type: 'boolean',
              description: 'Optional. Whether this child is independently potty trained; omit if unknown'
            },
            familySize: {
              type: 'number',
              description: 'Family size (default 3)'
            },
            monthlyIncome: {
              type: 'number',
              description: 'Gross monthly household income to determine the ELFA tier'
            },
            annualIncome: {
              type: 'number',
              description: 'Gross annual household income to determine the ELFA tier'
            },
            benefitTier: {
              type: 'string',
              enum: ['privatePay', 'halfCreditELFA', 'fullCreditELFA', 'freeTuitionELFA'],
              description: 'Known tier; defaults to privatePay so no subsidy is assumed'
            },
            targetBudgetMonthly: {
              type: 'number',
              description: 'Target monthly budget (default 1200)'
            },
            preferredLanguage: {
              type: 'string',
              description: 'Preferred language immersion (e.g. Spanish, Mandarin, French)'
            },
            homeZipCode: {
              type: 'number',
              description: 'Family home zip code (e.g. 94121) to calculate distance and score location convenience'
            },
            candidateCount: {
              type: 'number',
              description: 'Number of candidates to evaluate in the A/B matrix (default 5)'
            }
          }
        }
      },
      {
        name: 'get_state_licensing_record',
        description:
          'Retrieve official California Community Care Licensing Division (CCLD) state inspection history, capacity, complaint visits, substantiated allegations, Type A/B violations, and official comments for a child care facility by license number.',
        inputSchema: {
          type: 'object',
          properties: {
            licenseNumber: {
              type: 'string',
              description: 'The California child care facility license number (e.g. "384001291")'
            }
          },
          required: ['licenseNumber']
        }
      }
    ]
  };
});

// Register Prompts
server.setRequestHandler(ListPromptsRequestSchema, async () => {
  return {
    prompts: [
      {
        name: 'family_intake_interview',
        description:
          'A structured guide for interviewing a San Francisco family. The first question round must include child age, potty training, family size, neighborhood, schedule, and daycare type (licensed center vs family child care home).'
      }
    ]
  };
});

server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  if (request.params.name === 'family_intake_interview') {
    return {
      description: 'Family Intake Guide for San Francisco Early Learning For All',
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: buildFamilyIntakePrompt()
          }
        }
      ]
    };
  }
  throw new Error(`Prompt not found: ${request.params.name}`);
});

// Handle Tool Calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'check_elfa_eligibility': {
        const result = calculateEligibility(args || {});
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
        };
      }

      case 'search_sf_childcare': {
        const result = await searchProfiles(args || {});
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
        };
      }

      case 'get_childcare_details': {
        const result = await getSiteDetails(args?.entityId);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
        };
      }

      case 'get_smart_recommendations': {
        const result = await getRecommendations(args || {});
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
        };
      }

      case 'get_elfa_rates_and_rules': {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  ratesFY2627: ELFA_RATES_FY26_27,
                  incomeEligibilityCeilings: ELFA_INCOME_TABLE_FY26_27,
                  languages: LANGUAGE_MAP,
                  financialAssistancePrograms: FINANCIAL_ASSISTANCE_MAP,
                  rulesSummary: [
                    'ELFA Free Tuition (0-110% AMI): 100% free enrollment; programs CANNOT charge any co-pays or fees.',
                    'ELFA Full Tuition Credit (111-150% AMI): Monthly credit equal to 100% of DEC rate ($3,027 Infant, $2,306 Toddler, $2,115 Preschooler); programs may charge a co-pay equal to private tuition minus credit.',
                    'ELFA Half Tuition Credit (151-200% AMI): Monthly credit equal to 50% of DEC rate ($1,514 Infant, $1,153 Toddler, $1,058 Preschooler); family pays remaining tuition.',
                    'Over 200% AMI: Private pay, though some programs offer sliding scales or district TK for 4-year-olds.',
                    'Age Groups: Infant = 0-24 months; Toddler = 24-36 months; Preschooler = 3-5 years (36-60+ months).'
                  ]
                },
                null,
                2
              )
            }
          ]
        };
      }

      case 'compare_heuristic_vs_jev':
      case 'compare_llm_vs_jev':
      case 'compare_gemini_vs_jev': {
        const result = await runHeuristicVsJevComparison(args || {});
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
        };
      }

      case 'get_state_licensing_record': {
        const result = await getFacilityDetail(args?.licenseNumber);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return {
      isError: true,
      content: [{ type: 'text', text: `Error: ${error.message}` }]
    };
  }
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('SF Early Learning For All MCP Server running on stdio');
}

main().catch((err) => {
  console.error('Fatal server error:', err);
  process.exit(1);
});
