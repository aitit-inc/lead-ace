# LeadAce E2E test harness

Run `/lead-ace` and other plugin skills inside a Docker container, against the **real** LeadAce backend, sending **real** emails to a developer-controlled inbox. Lets the assistant exercise skill chain orchestration end-to-end without polluting production data or accidentally emailing real prospects.

For the full operational workflow (when to run, how to interpret output, how to pair with Worker logs, how to clean up between runs), see the project skill (referenced from the repo `CLAUDE.md`). This README only covers the harness mechanics.

## Strategy

- **Real Gmail send.** No dry-run / stub paths. The harness drives the same code that prod users hit.
- **Dedicated test tenant per plan tier.** Five separate Google accounts (one per plan: free / starter / pro / scale / unlimited), signed up at `app.leadace.ai`. Tier definitions live in `e2e/accounts.local.json` (gitignored — copy from `accounts.local.json.example`). Selected at runtime via `TIER=<tier>`.
- **Per-tier Docker volume.** `run.sh` sets `COMPOSE_PROJECT_NAME=lead-ace-e2e-${TIER}` so Claude Code login state and MCP OAuth tokens are isolated per tier. First run of each tier requires its own login + OAuth flow.
- **Personal aliases as recipients.** Use Gmail sub-addressing (`leouno12+001@gmail.com`, `leouno12+002@gmail.com`, …) when registering test prospects. Each alias is a unique row per the `prospects.email` unique constraint, but Gmail routes them all to a single inbox you control. Visual confirmation is automatic.
- **Re-test by deleting log rows.** Removing the `outreach_logs` row (and resetting `project_prospects.status` back to `'new'`) restores both the daily and lifetime quota — they're computed as `COUNT(*) WHERE status = 'sent'`. See the project skill for the exact SQL.

## What this catches

- Skill loading: every SKILL.md frontmatter, allowed-tools, and reference link valid
- Skill chain orchestration: `/lead-ace <URL>` correctly delegates onboarding → strategy → daily-cycle
- MCP tool wiring: every tool the skill calls exists, has the expected schema, and the backend accepts the payload
- Gmail send path including OAuth refresh, unsubscribe attachment, sender alias / display-name handling
- Quota / plan-tier enforcement (real, not simulated)

## What this does NOT catch

- Stripe webhook timing
- Headless browser side effects (`claude-in-chrome` is not configured in the container)
- Anything requiring host-keychain access (macOS keychain is not reachable inside Docker)

## Pre-requisites

- Docker Desktop running
- An Anthropic subscription account (Claude Pro / Max / Team) for Claude Code login. The first `login` run signs in interactively; the credentials are persisted to a tier-namespaced Docker volume (`/root/.claude`), so subsequent runs do not need an API key or further sign-in.
- A test tenant + test Google account (one-time setup)

## One-time setup

1. Build the image:

   ```bash
   docker compose -f e2e/docker-compose.yml build
   ```

2. Copy the accounts template and fill in your tier-specific Gmail addresses + tenant IDs:

   ```bash
   cp e2e/accounts.local.json.example e2e/accounts.local.json
   # edit e2e/accounts.local.json
   ```

3. **Per tier you want to test**, sign in to Claude Code inside the container (persisted to a tier-namespaced volume):

   ```bash
   TIER=<tier> ./e2e/login.sh
   # inside the container:  claude   (sign in interactively, then exit)
   ```

   The wrapper sets `COMPOSE_PROJECT_NAME=lead-ace-e2e-<tier>` so the resulting `claude-state` volume is named per tier and stays isolated from other tiers.

4. **Per tier**, authorize the LeadAce MCP server:

   ```bash
   TIER=<tier> ./e2e/oauth.sh
   ```

   Inside the resulting interactive Claude session, type `/setup` (or any prompt that triggers an MCP call). Claude prints a `https://mcp.leadace.ai/authorize?...` URL — open it in your host browser, sign in with **that tier's** Google account, and click Allow. The browser is redirected to `http://localhost:47291/callback?...`; the harness publishes that port back to the container so Claude Code completes the handshake automatically. Tokens persist in `lead-ace-e2e-<tier>_claude-state`. After confirmation, `/exit` then `exit` to leave.

   The fixed callback port (47291) is set via `MCP_OAUTH_CALLBACK_PORT` and published to the host's loopback in `docker-compose.yml`, because Docker Desktop on macOS does not bridge a random in-container port to the host browser.

## Running

### Standard onboarding-chain smoke (recommended)

```bash
TIER=unlimited ./e2e/smoke.sh                       # https://leadace.ai (default)
TIER=unlimited ./e2e/smoke.sh https://example.com   # custom URL
TIER=unlimited SKIP_CLEANUP=1 ./e2e/smoke.sh        # keep the project for manual inspection
```

`smoke.sh` runs `/lead-ace <url>` headless with a prompt that pre-resolves every interactive Q&A (`env_check` defaults to `unsure`, sender values become placeholders, no outreach is sent). It parses the project id printed on the last line of the result and runs `/delete-project <id>` to leave the tenant clean. JSON outputs go to `e2e/output/smoke-${TIER}-leadace-*.json` and `smoke-${TIER}-cleanup-*.json`. Exit codes: `0` all good, `1` `/lead-ace` failed, `2` couldn't parse project id, `3` cleanup failed.

### Arbitrary scenarios

```bash
TIER=<tier> ./e2e/run.sh "<claude prompt>"
```

`TIER` defaults to `free` if unset. Allowed: `free`, `starter`, `pro`, `scale`, `unlimited`. `MAX_BUDGET_USD` overrides the `--max-budget-usd` cap (default `1.50`).

The wrapper passes:
- `--plugin-dir /repo/plugin` — load LeadAce plugin from the bind-mounted repo (no marketplace install needed)
- `--add-dir /repo` — allow tool access to the repo
- `--settings /repo/e2e/settings.json` — minimal allowlist for `mcp__api__*` and shell utilities
- `--setting-sources user` — ignore the project-level `.claude/settings.json` so the harness is isolated
- `--permission-mode dontAsk` — respect the allowlist; deny everything else without prompting
- `--max-budget-usd $MAX_BUDGET_USD` — cap per run (default 1.50; this is an API-equivalent figure, not a real charge when the container is signed in via subscription)
- `--output-format json` — structured output for assertions
- `--no-session-persistence` — clean run, no session pollution

Output JSON is emitted to stdout. Capture it with `> e2e/output/run-$(date +%s).json` to inspect later.

### A note on cost

`total_cost_usd` in the JSON output is the API-equivalent value calculated from token usage, *not* a charge. When the container is logged in via a Claude subscription (Pro/Max/Team), running `claude` consumes the subscription's rate quota and is not billed per token. The harness explicitly relies on subscription auth (no `ANTHROPIC_API_KEY` is exported) so `total_cost_usd` reads as informational only.

## Known gaps

- **MCP OAuth refresh**: in Test mode (gcp), refresh tokens expire after 7 days. If the harness fails with 401/412 after a week of inactivity, re-run the OAuth flow.
- **Bind-mount on macOS**: read-only, performant for small repos but not optimized for large file trees.

## Cleanup

```bash
# Wipe a single tier's login + MCP state
TIER=<tier> docker compose -f e2e/docker-compose.yml down -v

# List all tier volumes
docker volume ls | grep lead-ace-e2e-
```

For per-test cleanup (deleting outreach_logs rows so you can re-test the same prospect / restore quota), see the project skill.
