# Workspace Conventions

Common rules for all skills and sub-agents.

## Workspace Structure

```
workspace-root/          <- this is the initial cwd
├── project-a/
│   ├── BUSINESS.md
│   ├── SALES_STRATEGY.md
│   └── ...
└── project-b/
    └── ...
```

All project data (prospects, outreach logs, responses, evaluations) is stored on the server and accessed via MCP tools (`mcp__plugin_lead-ace_api__*`). There is no local database.

## Command Execution Rules

- **Do not use cd.** Run all bash commands from the workspace root.
- Reference files inside project directories using the `$0` prefix, e.g., `$0/BUSINESS.md`.
- Local utility tools are in `${CLAUDE_PLUGIN_ROOT}/scripts/` (e.g., `fetch_url.py`).

## MCP Tool Error Handling

If any MCP tool call returns a "Project not found" error, instruct the user to run `/setup` first and abort the current skill.
