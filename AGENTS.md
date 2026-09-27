# Project Instructions for AI Agents

This file provides instructions and context for AI coding agents working on this project.

<!-- BEGIN BEADS INTEGRATION v:1 profile:full hash:f2c52d34 -->
## Issue Tracking with bd (beads)

**IMPORTANT**: This project uses **bd (beads)** for ALL issue tracking. Do NOT use markdown TODOs, task lists, or other tracking methods.

### Why bd?

- Dependency-aware: Track blockers and relationships between issues
- Git-friendly: Dolt-powered version control with native sync
- Agent-optimized: JSON output, ready work detection, discovered-from links
- Prevents duplicate tracking systems and confusion

### Quick Start

**Check for ready work:**

```bash
bd ready --json
```

**Create new issues:**

```bash
bd create "Issue title" --description="Detailed context" -t bug|feature|task -p 0-4 --json
bd create "Issue title" --description="What this issue is about" -p 1 --deps discovered-from:bd-123 --json
```

**Claim and update:**

```bash
bd update <id> --claim --json
bd update bd-42 --priority 1 --json
```

**Complete work:**

```bash
bd close bd-42 --reason "Completed" --json
```

### Issue Types

- `bug` - Something broken
- `feature` - New functionality
- `task` - Work item (tests, docs, refactoring)
- `epic` - Large feature with subtasks
- `chore` - Maintenance (dependencies, tooling)

### Priorities

- `0` - Critical (security, data loss, broken builds)
- `1` - High (major features, important bugs)
- `2` - Medium (default, nice-to-have)
- `3` - Low (polish, optimization)
- `4` - Backlog (future ideas)

### Workflow for AI Agents

1. **Check ready work**: `bd ready` shows unblocked issues
2. **Claim your task atomically**: `bd update <id> --claim`
3. **Work on it**: Implement, test, document
4. **Discover new work?** Create linked issue:
   - `bd create "Found bug" --description="Details about what was found" -p 1 --deps discovered-from:<parent-id>`
5. **Complete**: `bd close <id> --reason "Done"`

### Quality
- Use `--acceptance` and `--design` fields when creating issues
- Use `--validate` to check description completeness

### Lifecycle
- `bd defer <id>` / `bd supersede <id>` for issue management
- `bd stale` / `bd orphans` / `bd lint` for hygiene
- `bd human <id>` to flag for human decisions
- `bd formula list` / `bd mol pour <name>` for structured workflows

### Sync

bd stores issue history in Dolt:

- Each write auto-commits to Dolt history
- Do not treat `.beads/issues.jsonl` as the sync protocol

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/SYNC_CONCEPTS.md for details and anti-patterns.

### Important Rules

- ✅ Use bd for ALL task tracking
- ✅ Always use `--json` flag for programmatic use
- ✅ Link discovered work with `discovered-from` dependencies
- ✅ Check `bd ready` before asking "what should I work on?"
- ❌ Do NOT create markdown TODO lists
- ❌ Do NOT use external issue trackers
- ❌ Do NOT duplicate tracking systems

For more details, see README.md and docs/QUICKSTART.md.

## Agent Context Profiles

The managed Beads block is task-tracking guidance, not permission to override repository, user, or orchestrator instructions.

- **Conservative (default)**: Use `bd` for task tracking. Do not run git commits, git pushes, or Dolt remote sync unless explicitly asked. At handoff, report changed files, validation, and suggested next commands.
- **Minimal**: Keep tool instruction files as pointers to `bd prime`; use the same conservative git policy unless active instructions say otherwise.
- **Team-maintainer**: Only when the repository explicitly opts in, agents may close beads, run quality gates, commit, and push as part of session close. A current "do not commit" or "do not push" instruction still wins.

## Session Completion

This protocol applies when ending a Beads implementation workflow. It is subordinate to explicit user, repository, and orchestrator instructions.

1. **File issues for remaining work** - Create beads for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **Handle git/sync by active profile**:
   ```bash
   # Conservative/minimal/default: report status and proposed commands; wait for approval.
   git status

   # Team-maintainer opt-in only, unless current instructions forbid it:
   git pull --rebase
   git push
   git status
   ```
5. **Hand off** - Summarize changes, validation, issue status, and any blocked sync/commit/push step

**Critical rules:**
- Explicit user or orchestrator instructions override this Beads block.
- Do not commit or push without clear authority from the active profile or the current user request.
- If a required sync or push is blocked, stop and report the exact command and error.

<!-- END BEADS INTEGRATION -->


## Issue Tracking in This Repository

This repository has no Dolt remote. Issues travel with git in `.beads/issues.jsonl`, which bd re-exports after changes (`export.auto: true`, at most once a minute).

- After cloning: `bd bootstrap` imports the issues from that file.
- Before committing issue changes: `bd export -o .beads/issues.jsonl`, so the file is current.
- Ignore the "no Dolt remote configured" warning. Do not add a remote or run `bd dolt push` unless the maintainer asks.

## Build & Test

```bash
npm install
npm test               # node --test test/*.test.js; no network, every service is faked
npm start              # MCP server over stdio
node test/test-server.js   # live smoke test against CareWait, CCLD, and Jev
```

- `get_smart_recommendations` and the live smoke test need `TYPESAFE_API_KEY` in the environment. The eligibility, search, details, and licensing tools do not.
- To exercise the tools the way a client does, connect to `src/index.js` over stdio with `@modelcontextprotocol/sdk`'s `Client` and `StdioClientTransport`.

## Architecture Overview

An MCP server for San Francisco's Early Learning For All (ELFA) childcare assistance. Code gathers and verifies facts; TypeSafe Jev ranks the verified programs.

- `src/index.js`: MCP tool definitions, handlers, and the `family_intake_interview` prompt.
- `src/eligibility.js`, `src/constants.js`: DEC's FY 2026–27 income ceilings, credit amounts, and source citations.
- `src/carewait-client.js`: CareWait search and provider details. `src/ccld-client.js`, `src/ccld-utils.js`: state licensing (CCLD) records and their summaries.
- `src/recommendations.js`: the `get_smart_recommendations` pipeline: search, details and CCLD checks, cost math, Jev scoring, result lists, and `priceSummary`.
- `src/jev-eval.js`: Jev System One questions and the weighted composite. `src/recommendation-utils.js`, `src/geo-utils.js`: rates, credits, and distance.
- `src/family-intake.js`: intake questions mapped to tool parameters.
- `.opencode/skills/sf-preschool-advisor/SKILL.md`: how agents present results.

## Conventions & Patterns

- Unknown data stays unknown: a missing rate, CCLD record, or Jev answer is never treated as zero or clean.
- Jev rates only verified facts, and nothing substitutes local scores when Jev is unavailable.
- Tests inject fakes (`search`, `getDetails`, and `evaluate` in `getRecommendations`; `clientFactory` in `evaluateCandidatesWithJev`), so `npm test` never touches the network.
- Keep each `get_smart_recommendations` response under 50 KB: opencode shows an agent only the first 50 KB of a tool result.
- Never commit secrets. `TYPESAFE_API_KEY` comes from the environment.
