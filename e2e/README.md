# LeadAce E2E test harness

Run `/lead-ace` and other plugin skills inside a Docker container, against the **real** LeadAce backend, sending **real** emails to a developer-controlled inbox. Lets the assistant exercise skill chain orchestration end-to-end without polluting production data or accidentally emailing real prospects.

For the full operational workflow (when to run, how to interpret output, how to pair with Worker logs, how to clean up between runs), see the project skill (referenced from the repo `CLAUDE.md`). This README only covers the harness mechanics.

## Strategy

- **Real Gmail send.** No dry-run / stub paths. The harness drives the same code that prod users hit.
- **Dedicated test tenant.** A separate Google account signed up at `app.leadace.ai`, on Free plan, with no real prospects. Quota caps the blast radius (5/day, 50 lifetime).
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
- `ANTHROPIC_API_KEY` exported in your shell (Claude Code in the container authenticates via API key, not keychain)
- A test tenant + test Google account (one-time setup)

## One-time setup

1. Build the image:

   ```bash
   docker compose -f e2e/docker-compose.yml build
   ```

2. Sign in to Claude Code inside the container (persisted to the `claude-state` volume):

   ```bash
   docker compose -f e2e/docker-compose.yml run --rm login
   # inside the container:  claude   (sign in interactively, then exit)
   ```

3. Authorize the LeadAce MCP server. The first `/lead-ace` run will print an `https://mcp.leadace.ai/authorize?...` URL; open it in your host browser and complete the OAuth flow with your **test tenant's** Google account. Tokens persist in the `claude-state` volume.

## Running

```bash
./e2e/run.sh "<claude prompt>"
```

The wrapper passes:
- `--plugin-dir /repo/plugin` — load LeadAce plugin from the bind-mounted repo (no marketplace install needed)
- `--add-dir /repo` — allow tool access to the repo
- `--settings /repo/e2e/settings.json` — minimal allowlist for `mcp__api__*` and shell utilities
- `--setting-sources user` — ignore the project-level `.claude/settings.json` so the harness is isolated
- `--permission-mode dontAsk` — respect the allowlist; deny everything else without prompting
- `--max-budget-usd 0.50` — cap API spend per run
- `--output-format json` — structured output for assertions
- `--no-session-persistence` — clean run, no session pollution

Output JSON is emitted to stdout. Capture it with `> e2e/output/run-$(date +%s).json` to inspect later.

## Known gaps

- **MCP OAuth refresh**: in Test mode (gcp), refresh tokens expire after 7 days. If the harness fails with 401/412 after a week of inactivity, re-run the OAuth flow.
- **Bind-mount on macOS**: read-only, performant for small repos but not optimized for large file trees.

## Cleanup

```bash
# Wipe the persisted login + MCP state to start over from scratch
docker compose -f e2e/docker-compose.yml down -v
```

For per-test cleanup (deleting outreach_logs rows so you can re-test the same prospect / restore quota), see the project skill.
