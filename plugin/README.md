# LeadAce

Autonomous lead generation plugin for Claude Code. Builds prospect lists, runs
outbound outreach, and iterates on strategy — all hands-free.

## For Users

### Prerequisites

- Claude Code
- A LeadAce account (sign up at https://app.leadace.ai)
- Gmail MCP — for sending and checking emails
- claude-in-chrome MCP — for form submission and SNS DMs

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

### Connect to the LeadAce MCP Server

LeadAce stores all project data and templates in the cloud. The plugin talks
to the cloud through an MCP server. After installing the plugin, configure the
server URL once per machine:

1. **Sign up or log in** at https://app.leadace.ai (Free tier requires no card).
2. **Set the MCP server URL.** In your shell profile (`~/.zshrc`, `~/.bashrc`,
   or your IDE's terminal env):

   ```bash
   export LEADACE_MCP_URL=https://mcp.leadace.ai/mcp
   ```

   Restart Claude Code so the plugin's `.mcp.json` picks up the variable.
3. **Authorize the connection.** The first time the plugin calls a LeadAce
   tool, Claude Code opens a browser window to https://mcp.leadace.ai for OAuth
   sign-in (uses the same email and password as the web app). Approve the
   request; the token is cached locally for subsequent runs.

#### Self-hosting

If you run the backend yourself (`docker compose up`), point at your local URL
instead:

```bash
export LEADACE_MCP_URL=http://localhost:8788/mcp
```

#### Troubleshooting

- **`MCP server unreachable`** — check that `LEADACE_MCP_URL` is exported in
  the shell that launched Claude Code, and that you can `curl ${LEADACE_MCP_URL%/mcp}/health`.
- **Browser asks to sign in repeatedly** — the cached token expired or was
  cleared. Re-running any LeadAce command kicks off a fresh OAuth flow.
- **`401 Unauthorized` from a tool** — your Supabase session may have expired.
  Sign out of `app.leadace.ai`, sign in again, then re-authorize when the
  plugin prompts.

### Usage

Run the slash commands in sequence as a pipeline. The first argument is the
project name you chose at `/setup`.

| Command | Description |
|---|---|
| `/setup <name>` | Create a LeadAce project (cloud-managed) |
| `/strategy <name>` | Define sales and marketing strategy |
| `/build-list <name>` | Build a prospect list via web search |
| `/outbound <name>` | Reach out via email, form, or SNS DM |
| `/check-results <name>` | Check and record responses |
| `/evaluate <name>` | Run PDCA improvement based on data analysis |
| `/daily-cycle <name> [count]` | Daily loop: check-results → outbound + build-list |
| `/delete-project <name>` | Delete the project and all its data |

There are no local files to manage — projects, prospects, outreach logs,
responses, and strategy documents all live in the LeadAce cloud.

### Basic Flow

```
/setup my-product
/strategy my-product        # Interactively enter business info
/build-list my-product      # Collect prospects via web search
/outbound my-product        # Run automated outbound sales
/check-results my-product   # Check responses
/evaluate my-product        # Analyze results and auto-improve strategy
```

After initial setup, use `/daily-cycle` to automate daily sales activities:

```
/daily-cycle my-product      # check replies → ~30 outreach → replenish list
/daily-cycle my-product 50   # specify count
/evaluate my-product         # improve strategy about once a week
```

Review prospects, outreach logs, responses, and quotas in the web app at
https://app.leadace.ai.

---

## License

This plugin is provided under a proprietary license from SurpassOne Inc. See
[LICENSE](../../LICENSE) for details.

- **Free trial:** 1 project, 30 prospect registrations and 10 outreach actions (lifetime)
- **Paid plans** start at $29/month. Manage your subscription from the web app.

---

## For Developers

The plugin lives at `plugin/` in the [aitit-inc/lead-ace](https://github.com/aitit-inc/lead-ace)
monorepo. Backend (Cloudflare Workers + Supabase) and frontend (SvelteKit on
Cloudflare Pages) are in `backend/` and `frontend/`.

```
plugin/
├── .claude-plugin/plugin.json   # Manifest
├── .mcp.json                    # MCP server config (uses LEADACE_MCP_URL)
├── skills/                      # Slash commands (each directory contains SKILL.md)
├── scripts/fetch_url.py         # Local web fetch helper
└── references/                  # Shared reference docs
```

- Each skill's behavior is defined in `skills/<name>/SKILL.md`
- Use `${CLAUDE_PLUGIN_ROOT}` to reference the plugin root from scripts
- Domain knowledge (templates, guidelines, frameworks) lives in the cloud as
  `master_documents` and is fetched at runtime via `get_master_document`

For local development and self-hosting, see the repository
[CLAUDE.md](../CLAUDE.md) and [docs/deploy.md](../docs/deploy.md).
