---
name: delete-project
description: "This skill should be used when the user asks to \"delete a project\", \"remove a project\", \"unregister a project\", or wants to delete a registered project. Removes from ~/.leadace/projects and also deletes the corresponding records from local data.db."
argument-hint: "<project-directory-name>"
allowed-tools:
  - Bash
  - Read
  - AskUserQuestion
---

# Delete Project - Project Deletion

A skill that unregisters a registered project from `~/.leadace/projects` and optionally deletes its data from the local data.db.

## Steps

### 1. Verify Arguments

- Project directory name: `$0` (required)

Return an error if `$0` is empty.

### 2. Global Unregistration

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/license.py unregister "$(pwd)/$0"
```

- Result is `UNREGISTERED` → "Project '$0' has been unregistered."
- Result is `NOT_FOUND` → Display "Project '$0' is not registered." and exit

### 3. Confirm Local Data Deletion

Use AskUserQuestion to ask: "Do you also want to delete this project's data from local data.db? (The directory will remain.)"

### 4. Delete Local Data (only if user confirms)

Delete the project's records from data.db in a single transaction:

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/delete_project.py data.db "$0"
```

Note: Records in the prospects table are not deleted as they may be reused by other projects.

### 5. Completion Report

- Result of unregistration
- Whether data was deleted
- Note that the directory still remains
