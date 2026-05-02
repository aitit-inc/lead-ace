#!/usr/bin/env bash
# One-time interactive Claude Code login for a given plan tier.
#
# Usage:
#   TIER=unlimited ./e2e/login.sh
#
# Sign in interactively when the container drops you into bash:
#   $ claude              # opens Claude Code login flow
#   ... sign in via browser ...
#   /exit                 # leave Claude Code
#   $ exit                # leave the container; state is persisted
#
# The persisted credentials live in the tier-namespaced Docker volume
# `lead-ace-e2e-${TIER}_claude-state` so each tier has its own login.

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

exec docker compose -f "$COMPOSE_FILE" run --rm login
