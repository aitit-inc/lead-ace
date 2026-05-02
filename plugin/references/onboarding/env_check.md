# Environment Check & Project Selection

Shared procedure for verifying the LeadAce environment, picking or creating a project, and persisting environment status. Used by `/setup` (interactive) and `/lead-ace` (URL-driven onboarding chain).

The caller (the SKILL.md that `Read`s this file) provides:
- The user-facing framing and tone (interactive Q&A vs minimal-prompt chain)
- An optional `$0` argument (project name)
- An optional `$URL` (the user's homepage URL; used by `/lead-ace` for project naming)

This procedure is authoritative — execute the steps verbatim. Tools used: `mcp__plugin_lead-ace_api__*`, `Read`, `AskUserQuestion`, `Bash`.

## Step 1. Verify MCP Connection & Plugin Version

### 1-1. Server version & plugin compatibility

Call `mcp__plugin_lead-ace_api__get_server_version`. The response is `{ serverVersion, minPluginVersion }`.

`Read` `${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json` and take the `version` field.

Compare semver component-by-component (split on `.`, parse each as integer, compare lexicographically). If the plugin version is **less than** `minPluginVersion`, **abort** with:

> Your LeadAce plugin is too old (v<plugin-version>) for the current backend (requires ≥ v<minPluginVersion>). Run `/plugin update lead-ace@lead-ace` and then re-run the current command.

Otherwise continue. Hold `SERVER_VERSION`, `PLUGIN_VERSION`, `MIN_PLUGIN_VERSION`.

### 1-2. Auth & reachability

Call `mcp__plugin_lead-ace_api__list_projects`. Success proves: MCP reachable, OAuth token valid, user authenticated. Hold the result as `PROJECTS`.

If the call fails:
- Network/unreachable → "Cannot reach the LeadAce MCP server. Check network access to https://mcp.leadace.ai (or `LEADACE_MCP_URL` for self-hosters)." Abort.
- Auth/401 → "MCP authentication failed. Sign in again at https://app.leadace.ai, then retry; the plugin will re-prompt the OAuth flow." Abort.

## Step 2. Environment Detection

Run automatic detection first, then ask the user only what cannot be detected.

### 2-1. Gmail SaaS connection (auto)

Call `mcp__plugin_lead-ace_api__get_gmail_status`. Record `connected` (boolean) and `email` (when connected) as `GMAIL_STATUS`.

If not connected: "Sign in at https://app.leadace.ai with Google (Settings → Connect Google) to enable email sending. Without this, no emails can be sent — you can still proceed with form-only or SNS-only outreach." Do **not** abort.

### 2-2. Gmail MCP (claude.ai built-in) — ask

Use `AskUserQuestion`: "Have you connected the Gmail MCP in claude.ai? (Required for reply checking in `/check-results` and for auto-drafting replies to positive responses.)" — options: `yes` / `no` / `unsure`. Record as `GMAIL_MCP`.

### 2-3. Claude in Chrome extension — ask

Use `AskUserQuestion`: "Are you using the Claude in Chrome extension? (Required for contact-form submission and SNS DMs in `/outbound`, plus SNS reply checking in `/check-results`.)" — options: `yes` / `no` / `unsure`. Record as `CHROME_EXT`.

**Caller may relax these prompts**: when invoked from `/lead-ace`'s onboarding chain, the caller can default to `unsure` for 2-2 and 2-3 without asking, to keep the chain flowing. The user can re-run `/setup` later for explicit confirmation. State this assumption in the completion report (Step 5) when applied.

## Step 3. Pick or Create a Project

### 3-1. With `$0` (project name provided)

- If `$0` matches an existing project from `PROJECTS` → use it as-is. Set `PROJECT_NAME = $0`.
- If `$0` does not exist → call `mcp__plugin_lead-ace_api__setup_project` with `name: "$0"`.
  - On `Project limit reached` → tell the user "Free plan allows 1 project. Delete the existing one with `/delete-project` or upgrade your plan." and **abort**.
  - Set `PROJECT_NAME = $0`.

### 3-2. Without `$0`

- If exactly one project exists → use it. Set `PROJECT_NAME` to that.
- If multiple exist → ask via `AskUserQuestion` which to use, with one option per project plus `Create new`.
- If none exist or user picks `Create new`:
  - **If `$URL` is provided** (onboarding chain): derive a default name from the URL (`https://example.com` → `Example`). Confirm with the user in 1 line; suffix with a number if the name conflicts.
  - **If `$URL` is not provided**: ask the user for a project name in plain text (do not use `AskUserQuestion` for free-text input).
  - Then call `setup_project` with `name: <answer>`. Set `PROJECT_NAME`.

## Step 4. Save Environment Status

Build a markdown document and save via `mcp__plugin_lead-ace_api__save_document` with `projectId: PROJECT_NAME` and `slug: "env_status"`. This is the source of truth that `/strategy` and other skills read — do not skip.

Document template (substitute the fields from `GMAIL_STATUS`, `GMAIL_MCP`, `CHROME_EXT`, and the current local time):

```markdown
# Environment & Tool Status

Captured: <YYYY-MM-DD HH:MM> via /setup or /lead-ace.

| Capability | Status | Detail |
|---|---|---|
| LeadAce MCP | connected | (verified by list_projects) |
| Gmail send (SaaS) | connected / not connected | <email when connected> |
| Gmail MCP (replies) | yes / no / unsure | from user |
| Claude in Chrome (forms + SNS) | yes / no / unsure | from user |

## Channel availability implied by the above

- Email: <available / unavailable — Gmail SaaS connection required>
- Form submission: <available / unavailable — Claude in Chrome required>
- SNS DM: <available / unavailable — Claude in Chrome required>
- Reply checking: <automated via Gmail MCP / manual fallback>
```

Use `Bash` `date '+%Y-%m-%d %H:%M %Z'` for the timestamp.

## Step 5. Hand-off to caller

Return control to the caller with:
- `PROJECT_NAME`
- `GMAIL_STATUS`, `GMAIL_MCP`, `CHROME_EXT` (for downstream use)
- A 4-line capability summary the caller can include in its completion report:
  - Project in use (`PROJECT_NAME`)
  - Email send: <available / unavailable>
  - Form / SNS: <available / unavailable>
  - Most prominent missing capability (if any), with the fix-it action

The caller composes its own user-facing completion message; this procedure does not print one.
