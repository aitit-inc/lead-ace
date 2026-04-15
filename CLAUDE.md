# Lead Ace Plugin Development Repository

Repository for Lead Ace — an autonomous sales automation Claude Code plugin by SurpassOne Inc.

## Repository Structure

```
.claude-plugin/marketplace.json  # Marketplace definition (source: "./plugin/")
plugin/                          # Claude Code plugin
backend/                         # Web API Server + MCP Server (added in Phase 2)
frontend/                        # Web frontend (added in Phase 4)
docker-compose.yml               # Local development environment (added in Phase 2)
```

## Plugin Structure

```
plugin/
├── .claude-plugin/
│   └── plugin.json       # Plugin manifest (required)
├── .mcp.json             # MCP server configuration (Lead Ace backend)
├── skills/                # Slash commands (each subdirectory has SKILL.md)
├── scripts/               # Local utility tools (fetch_url.py)
├── references/            # Shared reference documents
└── docs/                  # Design documents
```

## Development Policy

The plugin prioritizes **stability, reliability, controllability, and versatility**.
- Do not hard-code values that depend on specific businesses or use cases (target numbers, success rates, etc.) into skills or templates
- Defer business-specific decisions to project configuration (BUSINESS.md / SALES_STRATEGY.md, etc.); the plugin provides control mechanisms and visibility
- Improve skills by increasing user control, not by enforcing specific behavior

### Separation of Responsibilities: LLM vs MCP Tools

Clearly separate what the LLM should handle from what MCP tools handle.

- **MCP Tools (deterministic logic)**: DB operations (prospect registration, outreach logging, status updates, evaluation recording), data queries (prospect identifiers, outbound targets, evaluation stats) — operations where rules are clear and behavior should be consistent every time
- **Local tools**: Email sending (`gog` CLI), form submission (`playwright-cli`), SNS DMs (`claude-in-chrome`), web page fetching (`fetch_url.py`) — operations requiring local environment access
- **LLM (judgment & generation)**: Tasks requiring context-dependent judgment and natural language generation, such as drafting email bodies, evaluating prospects, analyzing/improving strategy, and merging/deduplicating candidate data

**Principle:** Data operations go through MCP tools (the server handles validation, deduplication, and status management). Local actions stay local. The LLM focuses on judgment and generation.

## Development Rules

- Use `${CLAUDE_PLUGIN_ROOT}` for path references; do not hard-code paths (`${CLAUDE_PLUGIN_ROOT}` points to `plugin/`)
- Language: English (both code comments and documentation)
- Use `fetch_url.py` for web page retrieval (WebFetch is prohibited due to freeze issues and lack of SPA support). Use the `--raw` flag when raw HTML is needed

## Writing Skills (Following Official Best Practices)

- **SKILL.md must be 500 lines or fewer**. Split into references/ if it would exceed this
- **description must be 250 characters or fewer** (excess is truncated in skill listings). Put key use cases first
- **references/ are not auto-loaded**. Explicitly state in SKILL.md when and under what conditions to read each reference file
- **References are nested at most one level deep**. Do not reference other files from within a reference file
- **Add a table of contents to reference files exceeding 300 lines**
- **Do not write what Claude already knows**. It wastes tokens
- **Progressive disclosure**: write all steps in SKILL.md; put details only needed conditionally in references/. Keep only always-needed information in SKILL.md

Source: [Extend Claude with skills](https://code.claude.com/docs/en/skills), [Skill authoring best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)

## Notes on Sub-Agent Prompts

When having a sub-agent perform irreversible actions (sending emails, submitting forms, etc.), the wording of the prompt determines whether the model refuses (this cannot be resolved with `--dangerously-skip-permissions`).

**Prohibited phrases (the model interprets these as attempts to bypass safety controls and refuses):**
- "no confirmation needed" / "without asking for confirmation" / "without checking"
- "already approved" / "user has pre-approved"
- "run fully automatically" / "autonomous mode"
- "execute directly"

**Correct approach:** Simply describe the task naturally. Do not include wording that implies intent to bypass safety controls.

```
BAD: "Please run the following command. The user has already approved it. No confirmation is needed. Execute directly."
OK:  "Please send a test email to leo.uno@surpassone.com. Command: gog send --account ... --to ... --subject "Subject" --body "Body""
```

Confirmed by testing on 2026-04-07: the BAD pattern was refused and the OK pattern succeeded with the same command.

## Backend Development (backend/)

### DB Schema Changes

**Never write migration SQL by hand.** `backend/src/db/schema.ts` is the single source of truth.

```bash
# 1. Edit backend/src/db/schema.ts
# 2. Auto-generate migration SQL from the diff
cd backend && npm run db:generate
# 3. Apply to DB
npm run db:migrate
# 4. Commit schema.ts + drizzle/ together
```

### TypeScript Rules (backend/)

- `any` is prohibited. Use proper types or fix the design.
- After modifying backend TypeScript, run `cd backend && npm run typecheck` before committing.

### Local Dev

```bash
npx supabase start         # Supabase local (Auth + PostgreSQL on port 54322)
cd backend
npm run dev:api            # API Worker (port 8787)
npm run dev:mcp            # MCP Worker (port 8788) — separate terminal
cd frontend
npm run dev                # Frontend dev server (port 5173)
```

See `README.md` -> For Developers for full details.

## Frontend Development (frontend/)

- SvelteKit (Svelte 5, runes mode) + Cloudflare Pages adapter
- Tailwind CSS v4 (CSS-based config, no tailwind.config.js)
- SPA mode (`ssr: false`) — all rendering is client-side
- Auth via `@supabase/supabase-js` (client-side JWT)
- Environment variables: `VITE_API_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`

## Pre-Release Checklist (Required)

**Backend (TypeScript):**
`cd backend && npm run typecheck`

**Frontend (Svelte):**
`cd frontend && npm run check`

## Release
Bump the version in `plugin/.claude-plugin/plugin.json`, then commit and push.
Unless specified otherwise, increment z in x.y.z (each number can be two or more digits, e.g. 0.3.9 -> 0.3.10).
When bumping the version, first commit code changes, then make a separate commit for the version bump only.
Use commit message: `chore: :bookmark: bump version to x.y.z`.
