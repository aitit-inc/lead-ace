# LeadAce Plugin Development Repository

Repository for LeadAce — an autonomous sales automation Claude Code plugin by SurpassOne Inc.

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
├── .mcp.json             # MCP server configuration (LeadAce backend)
├── skills/                # Slash commands (each subdirectory has SKILL.md)
├── scripts/               # Local utility tools (fetch_url.py)
├── references/            # Shared reference documents
└── docs/                  # Design documents
```

## Development Policy

The plugin prioritizes **stability, reliability, controllability, and versatility**.
- Do not hard-code values that depend on specific businesses or use cases (target numbers, success rates, etc.) into skills or templates
- Defer business-specific decisions to project configuration (stored as documents in the DB: business, sales_strategy, etc.); the plugin provides control mechanisms and visibility
- Improve skills by increasing user control, not by enforcing specific behavior

### Separation of Responsibilities: LLM vs MCP Tools

Clearly separate what the LLM should handle from what MCP tools handle.

- **MCP Tools (deterministic logic)**: DB operations (prospect registration, outreach logging, status updates, evaluation recording, document storage), data queries (prospect identifiers, outbound targets, evaluation stats, document retrieval), master document retrieval (templates, guidelines, frameworks via `get_master_document`) — operations where rules are clear and behavior should be consistent every time
- **Local tools**: Email sending (`gog` CLI), form submission (`playwright-cli`), SNS DMs (`claude-in-chrome`), web page fetching (`fetch_url.py`) — operations requiring local environment access
- **LLM (judgment & generation)**: Tasks requiring context-dependent judgment and natural language generation, such as drafting email bodies, evaluating prospects, analyzing/improving strategy, and merging/deduplicating candidate data

**Principle:** Data operations go through MCP tools (the server handles validation, deduplication, and status management). Local actions stay local. The LLM focuses on judgment and generation.

## Plan Tiers & Limits

Subscription is managed via Stripe. The API enforces limits based on user plan.

| | Free (trial) | Starter $29/mo | Pro $79/mo | Scale $199/mo |
|---|---|---|---|---|
| Projects | 1 | 1 | 5 | Unlimited |
| Outreach actions | 10 (lifetime) | 1,500/mo | 10,000/mo | Unlimited |
| Prospect registration | 30 (lifetime) | — | — | — |

- **Free limits are lifetime** (one-time trial, not monthly reset). Paid limits reset monthly.
- **Outreach actions** = `record_outreach` with `status: "sent"`. Failed attempts do not count.
- **Quota enforcement**: `get_outbound_targets` returns `min(requested, remainingQuota, availableTargets)`. When quota is 0, returns empty list with upgrade message. `record_outreach` also guards as a safety net.
- **Billing**: Stripe Checkout for new subscriptions, Stripe Customer Portal for upgrades/downgrades/cancellation. No billing UI in our app.
- **Self-host**: code is open source on GitHub. Users run their own Supabase + Cloudflare deploy (see [plugin/docs/self-host.md](plugin/docs/self-host.md)). No quota enforcement difference — the same plan-limits code runs; defaults to Free.

## Multi-Tenancy

All data is isolated by tenant. Each user auto-gets a tenant on first API access.

- **`tenants`** table: auto-created per user (1 user = 1 tenant for now, expandable to teams later)
- **`tenant_members`**: links users to tenants (currently 1:1, future: many-to-1)
- **All data tables** have `tenant_id` column — queries always filter by tenant
- **Auth middleware** resolves `userId → tenantId` via `tenant_members` on every request (runs as `postgres`, bypasses RLS)
- **RLS middleware** wraps each request in a transaction: `SET LOCAL ROLE app_rls` + `set_config('app.tenant_id', ...)` — database-level defense-in-depth
- **`app_rls` role**: non-login role with RLS policies enforced. All 11 tenant-scoped tables have `tenant_isolation` policy. `master_documents` has no RLS (global data)
- **`projects`**: `id` is auto-generated nanoid (PK), `name` is user-provided (`UNIQUE(tenant_id, name)`)
- **`organizations`** PK is auto-increment `id` (not domain). `UNIQUE(tenant_id, domain)` ensures per-tenant dedup. Stores only domain, name, websiteUrl (no country/address/industry/overview)
- **Unique constraints** (email, form URL) are scoped to tenant
- **Prospect registration** requires at least one contact channel (email, contactFormUrl, or snsAccounts)
- **Route handlers** use `c.get('db')` (the RLS-wrapped transaction), never `createDb()` directly. Only auth middleware and stripe webhook use raw `createDb()`

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

Local dev flow:

```bash
# 1. Edit backend/src/db/schema.ts
# 2. Auto-generate migration SQL from the diff
cd backend && npm run db:generate
# 3. Apply to local DB
npm run db:migrate
# 4. Commit schema.ts + drizzle/ together
```

For applying migrations (and the `master_documents` seed) to the **production** Supabase DB, follow [plugin/docs/deploy.md §2](plugin/docs/deploy.md). Use the **Session Pooler** URL (port 5432), NOT the Transaction Pooler (port 6543) — DDL like `CREATE ROLE` fails silently through the transaction pooler. Never run `db:migrate` from CI.

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
