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

For backend changes that **break** the running plugin (drop / rename DB column, remove an MCP tool, change a required argument), push order does not save users who are still on the old plugin and have not yet run `/plugin update`. The right tool is **backend backwards-compatibility for one release cycle**, then removing the old shape in a later release. A staging environment and an MCP version-check endpoint are tracked as future tasks in `docs/tasks.local.md` to make this safer and more visible.
