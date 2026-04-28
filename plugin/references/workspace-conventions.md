# Workspace Conventions

Common rules for all skills and sub-agents.

## Data Storage

All project data is stored on the server and accessed via MCP tools (`mcp__plugin_lead-ace_api__*`). There are no local project directories or databases.

- **Structured data** (prospects, outreach logs, responses, evaluations): Dedicated MCP tools (`add_prospects`, `record_outreach`, etc.)
- **Documents** (business info, sales strategy, search notes): `get_document` / `save_document` MCP tools with slugs: `business`, `sales_strategy`, `search_notes`
- **Master documents** (templates, guidelines, frameworks): `get_master_document` MCP tool with slugs like `tpl_business`, `tpl_email_guidelines`, etc. These are shared across all users and updated centrally
- **Local files**: Only plugin SKILL.md files, local-operation references (claude-in-chrome-guide, form-filling), and scripts in `${CLAUDE_PLUGIN_ROOT}/`

## Command Execution Rules

- **Do not use cd.** Run all bash commands from the workspace root.
- Local utility tools are in `${CLAUDE_PLUGIN_ROOT}/scripts/` (e.g., `fetch_url.py`).

## MCP Tool Error Handling

If any MCP tool call returns a "Project not found" error, instruct the user to run `/setup` first and abort the current skill.
