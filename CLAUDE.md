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
├── skills/                # Slash commands (each subdirectory has SKILL.md)
├── scripts/               # Helper scripts (to be removed in Phase 3)
├── migrations/            # DB migrations (to be removed in Phase 3)
├── references/            # Shared reference documents
└── docs/                  # Design documents
```

## Development Policy

The plugin prioritizes **stability, reliability, controllability, and versatility**.
- Do not hard-code values that depend on specific businesses or use cases (target numbers, success rates, etc.) into skills or templates
- Defer business-specific decisions to project configuration (BUSINESS.md / SALES_STRATEGY.md, etc.); the plugin provides control mechanisms and visibility
- Improve skills by increasing user control, not by enforcing specific behavior

### Separation of Responsibilities: LLM vs Scripts

Clearly separate what the LLM should handle from what should be fixed in scripts.

- **Scripts (deterministic logic)**: DB operations, email sending, status updates, validation, data formatting — operations where rules are clear and behavior should be consistent every time. Do not have the LLM write SQL or compose commands directly; execute through dedicated scripts
- **LLM (judgment & generation)**: Tasks requiring context-dependent judgment and natural language generation, such as drafting email bodies, evaluating prospects, and analyzing/improving strategy

**Principle:** Offload tasks the LLM should not do (deterministic, repetitive, accuracy-critical) to scripts, and let the LLM focus on judgment and generation. In skill SKILL.md files, document how to call scripts (command and arguments), not internal implementation details.

## Development Rules

- Use `${CLAUDE_PLUGIN_ROOT}` for path references; do not hard-code paths (`${CLAUDE_PLUGIN_ROOT}` points to `plugin/`)
- Language: English (both code comments and documentation)
- All scripts must be written in Python (shell scripts and JS are prohibited)
- Use `argparse` for all Python script CLI interfaces (do not use `sys.argv` directly)
- Use `fetch_url.py` for web page retrieval (WebFetch is prohibited due to freeze issues and lack of SPA support). Use the `--raw` flag when raw HTML is needed
- Type definitions must be thorough in Python scripts. `any` is prohibited. Avoid type casts; let types be inferred correctly
- After modifying Python scripts, run `cd plugin/scripts && npx pyright && python3 test_imports.py` before committing to pass type checks and import tests (module-level assertions)

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
docker compose up -d       # PostgreSQL (port 5432)
cd backend
npm run dev:api            # API Worker (port 8787)
npm run dev:mcp            # MCP Worker (port 8788) — separate terminal
```

See `README.md` → For Developers for full details.

## DB Migrations (plugin/scripts/)

- Place `NNN_description.py` files in `plugin/migrations/` (NNN is a 3-digit sequential number)
- Each file implements `def up(conn: sqlite3.Connection) -> None:`. Write idempotently (use `IF NOT EXISTS`, etc.)
- `preflight.py` automatically applies pending migrations before each skill run (tracked via the `applied_migrations` table)
- Call `preflight.py` in step 0 of every skill (registration check + migration)

### Relationship Between sales-db.sql and Migrations

**`sales-db.sql` always represents the "full, up-to-date schema".** When adding changes via migration, apply the same changes to `sales-db.sql`.

- **New users**: `init_db.py` → `sales-db.sql` creates the complete schema → all migrations are no-ops (they are idempotent)
- **Existing users**: `preflight.py` → pending migrations are applied incrementally

This approach means that to understand the full schema, you only need to read **`sales-db.sql`** (no need to trace through migration files).

## Scheduled Removal of Temporary Skills and Scripts

- **To be removed at v0.6.0 release**: `plugin/skills/data-migration-v050/`, `plugin/scripts/link_organization.py`, `plugin/scripts/mark_org_lookup_status.py`, and the `link_organization` and `mark_org_lookup_status` lines from `plugin/scripts/test_imports.py`

## Pre-Release Checklist (Required)

**Plugin (Python):**
`cd plugin/scripts && npx pyright && python3 test_imports.py`

**Backend (TypeScript):**
`cd backend && npm run typecheck`

## Release
Bump the version in `plugin/.claude-plugin/plugin.json`, then commit and push.
Unless specified otherwise, increment z in x.y.z (each number can be two or more digits, e.g. 0.3.9 → 0.3.10).
When bumping the version, first commit code changes, then make a separate commit for the version bump only.
Use commit message: `chore: :bookmark: bump version to x.y.z`.
