---
name: lead-ace
description: "Use when `/lead-ace` is typed with a free-form question or instruction not covered by a specific skill. Also for \"what can LeadAce do\", \"list skills\", \"LeadAce version\", \"LeadAce overview\". Returns version, project list, and skill catalog."
argument-hint: "[free-form question or instruction]"
allowed-tools:
  - Bash
  - Read
  - mcp__plugin_lead-ace_api__get_server_version
  - mcp__plugin_lead-ace_api__list_projects
---

# Lead-Ace - General Catch-All Skill

A general-purpose entry point for LeadAce. Use it when the user types `/lead-ace` with a free-form question or instruction that does not match any of the specific skills (`/build-list`, `/outbound`, `/strategy`, ...). It can also be invoked with no argument as an overview / status command.

## Steps

### 1. Gather Context (always)

Run these in parallel:

- **Plugin version**: `Read` `${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json` and take the `version` field.
- **Server version + min plugin**: call `mcp__plugin_lead-ace_api__get_server_version`. Response shape: `{ serverVersion, minPluginVersion }`.
- **Project list**: call `mcp__plugin_lead-ace_api__list_projects`. The list may be empty.
- **Current date/time**: `Bash` `date '+%Y-%m-%d %H:%M %Z'`.

If `get_server_version` or `list_projects` fails:
- network/unreachable -> "Cannot reach the LeadAce MCP server. Check network access to https://mcp.leadace.ai (or `LEADACE_MCP_URL` for self-hosters)."
- auth/401 -> "MCP authentication failed. Sign in again at https://app.leadace.ai, then retry."

Compare the plugin version to `minPluginVersion` (split on `.`, parse each as integer, compare component-wise). If the plugin version is **less than** `minPluginVersion`, surface a prominent warning recommending `/plugin update lead-ace@lead-ace`, but continue answering — do not abort.

Hold the values for the rest of the skill:
- `PLUGIN_VERSION`, `SERVER_VERSION`, `MIN_PLUGIN_VERSION`
- `PROJECTS` (array of `{ id, name, ... }`)
- `NOW` (the date string)

### 2. Branch on Argument

#### 2a. No argument -> Overview Mode

Print a single, scannable section in this order:

1. **Header**: `LeadAce overview - <NOW>`
2. **Version line**: `Plugin v<PLUGIN_VERSION> | Server v<SERVER_VERSION> | Required >= v<MIN_PLUGIN_VERSION>`
   - If plugin is behind, append: ` (UPGRADE: run /plugin update lead-ace@lead-ace)`
3. **Projects**: bullet list of `name (id)`. If empty, write `(no projects yet — start with /setup or /strategy)`.
4. **Skill catalog** (use the table in section 3 below verbatim, then print the self-host footer line that follows the table).
5. **Suggested next step** based on state:
   - 0 projects -> "Run `/setup` to verify your environment and create your first project."
   - >= 1 project, no recent activity assumed -> "Run `/daily-cycle <project-name>` for the daily run, or `/strategy <project-name>` to refine the plan."

Then stop. Do not invent additional analysis the user did not ask for.

#### 2b. With argument -> Free-form Mode

The user has typed `/lead-ace <something>`. Treat `$0` as the request. Do NOT invoke another skill internally.

Respond to the request directly, using the context from step 1 as grounding. Common patterns:

- **Status / "what's going on"**: produce the overview from 2a, then add a one-line interpretation tied to the request.
- **"How do I X"**: point to the right skill from the catalog (section 3) and explain when to use it. If no skill fits, answer from general LeadAce knowledge (CLAUDE.md, docs/) and say so.
- **"Tell me about my project Y"**: list what is and is not in `PROJECTS`. Suggest `/setup` for environment status or `/evaluate <project>` for performance.
- **Maps cleanly to an existing skill**: say so explicitly. Example: "That sounds like `/build-list <project>` - want to run it?" Do not silently shortcut.
- **Out of scope**: if the request is unrelated to LeadAce (e.g. "write me a poem"), say so politely in one line and stop.

Keep the response short. The user invoked a catch-all; they want a direct answer, not a project audit.

### 3. Skill Catalog (use verbatim in overview, reference in free-form)

| Skill | One-line purpose |
|---|---|
| `/setup` | Verify MCP/Gmail/local-tool connectivity and pick or create a project. Re-run when environment changes. |
| `/strategy` | Interactive Q&A to author or update `BUSINESS.md` and `SALES_STRATEGY.md` for a project. |
| `/build-list` | Web-search-driven prospect collection based on the project's strategy; registers candidates in the DB. |
| `/import-prospects` | Load prospects from a file (CSV / Excel / SQLite / text) — either as tenant assets or linked to a project. |
| `/match-prospects` | Pull existing tenant-wide prospects into a project that fits the targeting. |
| `/outbound` | Execute outreach (email / contact form / SNS DM) against the project's prospect list. |
| `/check-results` | Detect replies and scheduling notifications, record them as `responses`. |
| `/evaluate` | Analyze response-rate data and propose strategy / targeting / messaging improvements. |
| `/daily-cycle` | Orchestrate `check-results -> evaluate -> outbound` (and `/build-list` when the list runs low) for a project. |
| `/setup-cron` | Install an OS-level schedule (LaunchAgent / Task Scheduler / cron) that runs `/daily-cycle` daily. |
| `/delete-project` | Permanently delete a project and its data from the server. |
| `/lead-ace` | This skill — general LeadAce catch-all for ad-hoc questions and overview. |

**Footer line (always print after the catalog in overview mode):** `LeadAce is open source — host it yourself on Cloudflare + Supabase: https://github.com/aitit-inc/lead-ace/blob/main/docs/self-host.md`

Keep this catalog up to date when adding or removing skills.
