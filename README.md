# lead-ace

Autonomous lead generation plugin for Claude Code.
Builds prospect lists, runs outbound outreach, and iterates on strategy — all hands-free.

## For Users

### Prerequisites

- Claude Code
- A LeadAce account at https://app.leadace.ai (Free tier — no card)
- Gmail MCP — for sending and checking emails
- claude-in-chrome MCP — for form filling and SNS DMs

### Installation

In Claude Code:

```
/plugin marketplace add aitit-inc/lead-ace
/plugin install lead-ace@lead-ace
```

To update later:

```
/plugin marketplace update
/plugin update lead-ace@lead-ace
```

### Connecting to LeadAce

After installing the plugin, set the MCP server URL once:

```bash
export LEADACE_MCP_URL=https://mcp.leadace.ai/mcp
```

Restart Claude Code. The first time the plugin calls a LeadAce tool, your
browser opens for OAuth sign-in to Supabase. See
[plugin/README.md](plugin/README.md) for details and troubleshooting.

### Usage

Run the slash commands in pipeline order. The first argument is your project
name (chosen at `/setup`).

| Command | Description |
|---|---|
| `/setup <name>` | Create a LeadAce project (cloud-managed) |
| `/strategy <name>` | Define sales & marketing strategy |
| `/build-list <name>` | Build prospect list via web search |
| `/outbound <name>` | Outreach via email, forms, and SNS DMs |
| `/check-results <name>` | Check and record responses |
| `/evaluate <name>` | Improve strategy based on data analysis (PDCA) |
| `/daily-cycle <name> [count]` | Auto-run daily cycle (check-results → outbound + build-list) |
| `/delete-project <name>` | Delete project and all its data |

Projects, prospects, outreach logs, and strategy documents live in the cloud
— there are no local files to manage. Review everything in the web app at
https://app.leadace.ai.

### Basic Flow

```
/setup my-product
/strategy my-product        # Enter business info interactively
/build-list my-product      # Collect prospects via web search
/outbound my-product        # Automated outbound sales
/check-results my-product   # Check responses
/evaluate my-product        # Analyze results and auto-improve strategy
```

After initial setup, use `/daily-cycle` to automate daily sales activities:

```
/daily-cycle my-product      # Run daily: check replies → ~30 outreach → replenish list
/daily-cycle my-product 50   # Specify count
/evaluate my-product         # Improve strategy weekly
```

---

## License

This plugin is provided under a proprietary license by SurpassOne Inc.

- **Free trial:** 1 project, 30 prospect registrations and 10 outreach actions (lifetime)
- **Paid plans** start at $29/month. Manage your subscription from the web app.
- **Self-host:** see [docs/self-host.md](docs/self-host.md) — running for your
  own use is allowed; redistributing as a hosted service to others is not.

---

## For Developers

### Repository layout

```
plugin/                          # Claude Code plugin
├── .claude-plugin/plugin.json   # Manifest
├── .mcp.json                    # MCP server config (uses LEADACE_MCP_URL)
├── skills/                      # Slash commands (each directory has SKILL.md)
├── scripts/fetch_url.py         # Local web fetch helper
└── references/                  # Shared reference docs
backend/                         # API + MCP servers (Cloudflare Workers, Hono, Drizzle)
frontend/                        # Web app (SvelteKit, Cloudflare Pages)
docs/                            # Project-wide docs (deploy runbook, self-host, architecture)
docker-compose.yml               # Bare Postgres for non-Supabase local dev
```

- Plugin conventions and the schema-change workflow: [CLAUDE.md](CLAUDE.md)
- Production deploy runbook: [docs/deploy.md](docs/deploy.md)
- Self-hosting and local dev: [docs/self-host.md](docs/self-host.md)

### Quick start (local dev)

```bash
npx supabase start                      # Auth + Postgres on ports 54321/54322
cd backend
cp .dev.vars.example .dev.vars          # then edit with `supabase status` values
npm install
npm run db:migrate
npx tsx scripts/seed-master-documents.ts

npm run dev:api                         # API → http://localhost:8787
npm run dev:mcp                         # MCP → http://localhost:8788  (separate terminal)

cd ../frontend
cp .env.example .env                    # set VITE_SUPABASE_* from `supabase status`
npm install
npm run dev                             # → http://localhost:5173
```

Pre-release checks:

```bash
cd backend && npm run typecheck
cd frontend && npm run check
```
