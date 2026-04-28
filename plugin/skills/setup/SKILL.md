---
name: setup
description: "This skill should be used when the user asks to \"set up\", \"start\", \"initialize\", \"connect\", \"first time\", \"onboard\", or wants to start using LeadAce. Verifies the LeadAce connection (MCP, Gmail, local tools), lists or creates a project, and saves the environment status for downstream skills."
argument-hint: "[project-name]"
allowed-tools:
  - Bash
  - Read
  - AskUserQuestion
  - mcp__plugin_lead-ace_api__get_server_version
  - mcp__plugin_lead-ace_api__list_projects
  - mcp__plugin_lead-ace_api__setup_project
  - mcp__plugin_lead-ace_api__get_gmail_status
  - mcp__plugin_lead-ace_api__save_document
---

# Setup - First-time Onboarding & Environment Check

A skill that verifies all LeadAce connections (cloud MCP, Gmail SaaS, local tools), surfaces what is and is not available, picks or creates a project, and stores the environment status so that subsequent skills (`/strategy`, `/build-list`, `/outbound`, `/daily-cycle`, etc.) can rely on it without re-asking.

Run this skill the first time you use LeadAce, and re-run it whenever your local tools or Gmail connection status change.

## Steps

### 1. Verify MCP Connection & Plugin Version

#### 1-1. Server version & plugin compatibility

Call `mcp__plugin_lead-ace_api__get_server_version`. The response is a JSON object `{ serverVersion, minPluginVersion }`.

Then read the local plugin's version: `Read` `${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json` and take the `version` field.

Compare semver component-by-component (split on `.`, parse each as integer, compare lexicographically). If the plugin version is **less than** `minPluginVersion`, **abort** with:

> Your LeadAce plugin is too old (v<plugin-version>) for the current backend (requires ≥ v<minPluginVersion>). Run `/plugin update lead-ace@lead-ace` and then re-run `/setup`.

Otherwise continue.

#### 1-2. Auth & reachability

Call `mcp__plugin_lead-ace_api__list_projects`. A successful response proves three things at once: the MCP server is reachable, the OAuth token is valid, and the user is authenticated.

If the call fails, abort and instruct the user:
- If the error mentions network/unreachable -> "Cannot reach the LeadAce MCP server. Check network access to https://mcp.leadace.ai (or the value of `LEADACE_MCP_URL` for self-hosters)."
- If the error mentions auth/401 -> "MCP authentication failed. Sign in again at https://app.leadace.ai, then re-run /setup; the plugin will re-prompt the OAuth flow."

Display the existing projects (name + id) returned by the call; an empty list is fine.

### 2. Environment Check

Run automatic detection and ask the user only what cannot be detected.

#### 2-1. Gmail SaaS connection (auto)
Call `mcp__plugin_lead-ace_api__get_gmail_status`. Record `connected` (boolean) and `email` (when connected).

If not connected, instruct the user: "Sign in at https://app.leadace.ai with Google (Settings -> Connect Google) to enable email sending, then re-run /setup. Without this, no emails can be sent." This does not abort the skill -- the user can still proceed with form-only or SNS-only outreach.

#### 2-2. Gmail MCP (claude.ai built-in) (ask)
Use AskUserQuestion to ask: "Have you connected the Gmail MCP in claude.ai? (Required for reply checking in /check-results and for auto-drafting replies to positive responses.)" — options: `yes` / `no` / `unsure`.

#### 2-3. Claude in Chrome extension (ask)
Use AskUserQuestion to ask: "Are you using the Claude in Chrome extension? (Required for contact-form submission and SNS DMs in /outbound, plus SNS reply checking in /check-results.)" — options: `yes` / `no` / `unsure`.

### 3. Pick or Create a Project

If the user passed `$0` (a project name):
- If it matches an existing project from step 1 -> use it as-is
- If it does not exist -> call `mcp__plugin_lead-ace_api__setup_project` with `name: "$0"`
  - On `Project limit reached` -> tell the user "Free plan allows 1 project. Delete the existing one with /delete-project or upgrade your plan." and **abort**.

If `$0` is empty:
- If exactly one project exists -> use it.
- If multiple exist -> ask the user via AskUserQuestion which one to use, with one option per project plus a `Create new` option.
- If none exist or the user picks `Create new` -> ask the user for a project name in plain text (do not use AskUserQuestion for free-text input), then call `setup_project` with `name: <answer>`.

Hold the chosen project name in `PROJECT_NAME` for the remaining steps.

### 4. Save Environment Status

Build a markdown document summarizing the environment, then save it via `mcp__plugin_lead-ace_api__save_document` with `projectId: PROJECT_NAME` and `slug: "env_status"`. This is the source of truth that `/strategy` and other skills read — do not skip this step.

Document template:

```markdown
# Environment & Tool Status

Captured: <YYYY-MM-DD HH:MM> via /setup.

| Capability | Status | Detail |
|---|---|---|
| LeadAce MCP | connected | (verified by list_projects) |
| Gmail send (SaaS) | connected / not connected | <email when connected> |
| Gmail MCP (replies) | yes / no / unsure | answered via AskUserQuestion |
| Claude in Chrome (forms + SNS) | yes / no / unsure | answered via AskUserQuestion |

## Channel availability implied by the above

- Email: <available / unavailable — Gmail SaaS connection required>
- Form submission: <available / unavailable — Claude in Chrome required>
- SNS DM: <available / unavailable — Claude in Chrome required>
- Reply checking: <automated via Gmail MCP / manual fallback>
```

### 5. Completion Report

Print a short, scannable summary:
- Project in use (`PROJECT_NAME`)
- The capability table (same as the saved doc)
- An explicit list of any missing capabilities and what each blocks
- Next step: "Run `/strategy PROJECT_NAME` to define your sales and marketing strategy."

If the Gmail SaaS connection was missing, surface that as the most prominent fix-it line, since it is the most common reason `/outbound` fails later.
