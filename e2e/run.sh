#!/usr/bin/env bash
# Run a /lead-ace headless invocation through the e2e harness.
#
# Usage:
#   ./e2e/run.sh "/lead-ace https://example.com"
#
# Pre-reqs:
#   1. ANTHROPIC_API_KEY exported in shell.
#   2. One-time login completed inside the container:
#        docker compose -f e2e/docker-compose.yml run --rm login
#        # then inside container: claude  (interactive login)
#        # then: exit
#   3. One-time MCP authorize (api.leadace.ai) completed by running any /lead-ace
#      prompt once and following the OAuth URL.

set -euo pipefail

PROMPT="${1:?usage: $0 \"<claude prompt>\"}"
COMPOSE_FILE="$(dirname "$0")/docker-compose.yml"

mkdir -p "$(dirname "$0")/output"

if [[ -z "${ANTHROPIC_API_KEY:-}" ]]; then
  echo "ERROR: ANTHROPIC_API_KEY is not set in the environment." >&2
  exit 1
fi

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
