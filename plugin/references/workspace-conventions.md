# Workspace Conventions

Common rules for all skills and sub-agents.

## data.db Location

`data.db` is the **single shared DB located at the workspace root (the initial cwd)**. It does not exist inside project subdirectories.

```
workspace-root/          ← this is the initial cwd
├── data.db              ← shared DB (only here)
├── project-a/
│   ├── BUSINESS.md
│   └── SALES_STRATEGY.md
└── project-b/
    └── ...
```

## Datetime Timezone

When handling datetimes in SQLite, always use **`datetime('now', 'localtime')`**. Do not use `datetime('now')` as it returns UTC.

```sql
-- Correct
DEFAULT (datetime('now', 'localtime'))
updated_at = datetime('now', 'localtime')
datetime('now', 'localtime', '-6 days')

-- Prohibited
DEFAULT (datetime('now'))
updated_at = datetime('now')
```

## Command Execution Rules

- **Do not use cd.** Run all bash commands from the workspace root.
- `data.db` is always accessible via its relative path (since cwd is the workspace root).
- Reference files inside project directories using the `$0` prefix, e.g., `$0/BUSINESS.md`.
