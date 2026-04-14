# lead-ace

Autonomous lead generation plugin for Claude Code.
Builds prospect lists, runs outbound outreach, and iterates on strategy — all hands-free.

## For Users

### Prerequisites

- Claude Code
- SQLite3
- Gmail MCP (for sending and checking emails)
- claude-in-chrome MCP (for form filling and SNS operations)

### Installation

Run the following in Claude Code:

```
/plugin marketplace add aitit-inc/lead-ace
/plugin install lead-ace@lead-ace
```

To update:

```
/plugin marketplace update
/plugin update lead-ace@lead-ace
```

### Usage

Run the following slash commands in pipeline order:

| Command | Description |
|---|---|
| `/setup <dir>` | Initialize project (DB and directory setup) |
| `/strategy <dir>` | Define sales & marketing strategy |
| `/build-list <dir>` | Build prospect list via web search |
| `/outbound <dir>` | Outreach via email, forms, and SNS DMs |
| `/check-results <dir>` | Check and record responses |
| `/evaluate <dir>` | Improve strategy based on data analysis (PDCA) |
| `/daily-cycle <dir> [count]` | Auto-run daily cycle (check-results → outbound + build-list) |
| `/delete-project <dir>` | Unregister project and delete data |

`<dir>` is a subdirectory name per product/service (e.g. `product-a-sales`).
The database (`data.db`) is shared at the project root; knowledge files are stored in subdirectories.

### Basic Flow

```
/setup my-product
/strategy my-product        # Enter business info interactively → generates BUSINESS.md, SALES_STRATEGY.md
/build-list my-product      # Collect prospects via web search
/outbound my-product        # Automated outbound sales
/check-results my-product   # Check responses
/evaluate my-product        # Analyze results and auto-improve strategy
```

After initial setup, use `/daily-cycle` to automate daily sales activities:

```
/daily-cycle my-product      # Run daily: check replies → 30 outreach → replenish list
/daily-cycle my-product 50   # Specify count
/evaluate my-product         # Improve strategy weekly
```

---

## License

This plugin is provided under a proprietary license by SurpassOne Inc.

- **Free tier:** Up to 1 project
- **Paid tier:** Unlimited projects. License keys available at https://leadace.surpassone.com

You will be prompted for a license key when running `/setup`. Skip it for the free tier.

---

## For Developers

### Plugin Structure

```
plugin/                          # Claude Code plugin
├── .claude-plugin/plugin.json   # Manifest
├── skills/                      # Slash commands (each directory has SKILL.md)
├── scripts/                     # Shared scripts (DB init, query execution, etc.)
├── migrations/                  # DB migrations
└── docs/                        # Design documents
backend/                         # Web API Server + MCP Server (Cloudflare Workers)
frontend/                        # Web frontend (Cloudflare Pages)
```

- Skill specs are in `plugin/skills/<name>/SKILL.md`
- Detailed templates and guidelines are in `plugin/skills/<name>/references/`
- Use `${CLAUDE_PLUGIN_ROOT}` to reference the plugin root in scripts

### DB Schema

Defined in `backend/src/db/schema.ts` (Drizzle ORM, PostgreSQL). This is the **single source of truth** for the schema.

**Never write migration SQL by hand.** Edit `schema.ts` and generate automatically:

```bash
cd backend

# 1. Edit src/db/schema.ts (add/modify tables, columns, enums...)

# 2. Auto-generate a migration file from the diff
npm run db:generate
# → creates drizzle/XXXX_description.sql automatically

# 3. Apply pending migrations to the DB
npm run db:migrate
```

Commit `src/db/schema.ts` and the new `drizzle/` files together.

### Backend Local Development

```bash
# Start local PostgreSQL + API Worker + MCP Worker
docker compose up

# Apply migrations (first time only, or after schema changes)
cd backend
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/leadace" npm run db:migrate

# Type check
cd backend && npm run typecheck
```

API Worker runs on `http://localhost:8787`, MCP Worker on `http://localhost:8788`.

Copy `backend/.dev.vars.example` → `backend/.dev.vars` to configure local secrets.

### Plugin Local Development

```bash
# Launch Claude Code in this repo directory to auto-load skills
claude

# Or specify as a plugin from another project
claude --plugin-dir /path/to/this/repo
```
