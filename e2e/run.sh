#!/usr/bin/env bash
# Run a /lead-ace headless invocation through the e2e harness.
#
# Usage:
#   TIER=pro ./e2e/run.sh "/lead-ace https://example.com"
#
# TIER selects which plan-tier test account to act as. Each tier has its own
# Docker volume namespace (via COMPOSE_PROJECT_NAME) so Claude Code login and
# MCP OAuth state are isolated per tier. Allowed values match keys in
# e2e/accounts.local.json: free, starter, pro, scale, unlimited.
# Defaults to "free" if unset.
#
# Pre-reqs:
#   1. ANTHROPIC_API_KEY exported in shell.
#   2. e2e/accounts.local.json exists (copy from accounts.local.json.example
#      and fill in tenant_id per tier).
#   3. One-time login completed inside the container for the chosen tier:
#        TIER=<tier> docker compose -f e2e/docker-compose.yml run --rm login
#        # inside container: claude  (sign in with that tier's Google account)
#        # exit
#   4. One-time MCP authorize completed by running any /lead-ace prompt once
#      with the same TIER and following the OAuth URL.

set -euo pipefail

PROMPT="${1:?usage: TIER=<tier> $0 \"<claude prompt>\"}"
TIER="${TIER:-free}"
COMPOSE_FILE="$(dirname "$0")/docker-compose.yml"

case "$TIER" in
  free|starter|pro|scale|unlimited) ;;
  *)
    echo "ERROR: TIER='$TIER' is not one of: free, starter, pro, scale, unlimited" >&2
    exit 1
    ;;
esac

if [[ -z "${ANTHROPIC_API_KEY:-}" ]]; then
  echo "ERROR: ANTHROPIC_API_KEY is not set in the environment." >&2
  exit 1
fi

mkdir -p "$(dirname "$0")/output"

export COMPOSE_PROJECT_NAME="lead-ace-e2e-${TIER}"

exec docker compose -f "$COMPOSE_FILE" run --rm \
  -T \
  harness \
  --plugin-dir /repo/plugin \
  --add-dir /repo \
  --settings /repo/e2e/settings.json \
  --setting-sources user \
  --permission-mode dontAsk \
  --max-budget-usd 0.50 \
  --output-format json \
  --no-session-persistence \
  --print \
  "$PROMPT"
