---
paths:
  - "plugin/.claude-plugin/plugin.json"
---

# Releasing

## Version bump

- Bump `plugin/.claude-plugin/plugin.json`. Default: z+1 in x.y.z (each part can be ≥2 digits: 0.3.9 → 0.3.10).
- Two commits: code change first, then a separate `chore: :bookmark: bump version to x.y.z` for the bump alone.

## Deploy

Single push to `main` is the default. CI deploys backend (Workers + Pages); the plugin bump goes live through the marketplace as soon as it lands on `main`.

For backend changes that **break** the running plugin (drop / rename DB column, remove an MCP tool, change a required argument), push order does not save users who are still on the old plugin and have not yet run `/plugin update`. The right tool is **backend backwards-compatibility for one release cycle**, then removing the old shape in a later release.

## MIN_PLUGIN_VERSION

`backend/src/mcp/index.ts` defines `MIN_PLUGIN_VERSION`. The `/setup` skill calls `get_server_version`, reads `plugin/.claude-plugin/plugin.json`, and aborts with a `/plugin update` message if the plugin is older.

Bump `MIN_PLUGIN_VERSION` to the **just-released** plugin version **only when** the backend now requires plugin behavior the old plugin lacks — e.g.:

- Removed an MCP tool the plugin still calls
- Renamed or removed a required field on an existing tool
- Changed response shape in a way the plugin parses
- Dropped a backwards-compat shim from a prior cycle

Do **not** bump `MIN_PLUGIN_VERSION` for additive changes (new tool, new optional field). The point is to give old-plugin users a clear fix-it message instead of a cryptic tool error.

A staging environment is still tracked as a future task in `docs/tasks.local.md`.
