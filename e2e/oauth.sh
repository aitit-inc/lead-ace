#!/usr/bin/env bash
# One-time interactive MCP OAuth completion for a given plan tier.
#
# Usage:
#   TIER=unlimited ./e2e/oauth.sh
#
# Why this exists: by default Claude Code picks a random ephemeral port for the
# MCP OAuth callback server. On macOS Docker Desktop a host browser cannot
# reach that random port inside the container. The compose file pins the port
# (MCP_OAUTH_CALLBACK_PORT=47291) and publishes it to the host's loopback, so
# the redirected `http://localhost:47291/callback?code=...` lands back inside
# the container and Claude Code completes the OAuth handshake automatically.
#
# Steps:
#   1. Run this script.
#   2. At the Claude prompt, type `/setup` (or any prompt that triggers an MCP call).
#   3. Open the printed `https://mcp.leadace.ai/authorize?...` URL in your host browser.
#   4. Sign in with the test tier's Google account, click Allow.
#   5. The browser returns to `http://localhost:47291/callback?...` — you should
#      see a brief success page (or the Claude session resumes on its own).
#   6. Verify the assistant continues past the `/setup` flow without "MCP needs
#      authorization" prompts.
#   7. Type `/exit` then `exit` to leave the container; the refresh token is
#      persisted to the tier-namespaced volume.
#
# Multi-tier note: only one tier can hold port 47291 at a time. Run OAuth setup
# for each tier serially, not in parallel.

set -euo pipefail

TIER="${TIER:-free}"
COMPOSE_FILE="$(dirname "$0")/docker-compose.yml"

case "$TIER" in
  free|starter|pro|scale|unlimited) ;;
  *)
    echo "ERROR: TIER='$TIER' is not one of: free, starter, pro, scale, unlimited" >&2
    exit 1
    ;;
esac

export COMPOSE_PROJECT_NAME="lead-ace-e2e-${TIER}"

exec docker compose -f "$COMPOSE_FILE" run --rm \
  --service-ports \
  harness \
  --plugin-dir /repo/plugin \
  --add-dir /repo \
  --settings /repo/e2e/settings.json \
  --setting-sources user \
  --permission-mode dontAsk
