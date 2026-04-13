---
name: setup
description: "This skill should be used when the user asks to \"set up\", \"create a new project\", \"initialize\", \"start a project\", or wants to set up a new sales project. Initializes the SQLite database and creates a subdirectory for the sales project."
argument-hint: "<project-directory-name>"
allowed-tools:
  - Bash
  - Read
  - Write
  - AskUserQuestion
---

# Setup - Project Initial Setup

A skill that performs the initial setup for a sales project. Initializes the SQLite database and creates a subdirectory for each product/service.

**Prerequisite:** Follow the conventions in `${CLAUDE_PLUGIN_ROOT}/references/workspace-conventions.md` (data.db location and no-cd rule).

## Steps

### 1. Verify Arguments

- Project directory name: `$0` (required. Example: `product-a-sales`)

Return an error if `$0` is empty.

### 2. Environment Check

Run the following command to verify availability of required tools:

```bash
python3 --version 2>&1 && python3 -c "import sqlite3; print('sqlite3: ok')" 2>&1; echo "---"; git --version 2>&1 && git remote -v 2>&1; echo "---"; which gog 2>&1 && gog version 2>&1; echo "---"; playwright-cli --version 2>&1
```

Inform the user of the results:

**If python3 is unavailable (critical):**
Since all plugin functionality depends on python3, inform the user they cannot use the plugin until python3 is installed and **abort** setup.

**If git is unavailable / remote repository is not set:**
Warn the user that daily-cycle's automatic commit and push will not work, creating a **risk of data loss** for data.db and reports. Usage is still possible.

**If gog is unavailable:**
Email auto-sending is not possible. If Gmail MCP is available, drafts can be created but sending will be manual.

**For Gmail MCP / playwright-cli / Claude in Chrome:**
Inform the user of the following dependencies:
- **Gmail MCP** (`gmail_search_messages` etc.): Required for reply checking in /check-results and draft creation in /check-results. Without it, reply checking must be done manually
- **playwright-cli**: Required for form submission in /outbound. Verify with `playwright-cli --version`. If not installed, only prospects with email addresses will be targeted
- **Claude in Chrome**: Required for SNS DM sending in /outbound and SNS reply checking in /check-results. Without it, SNS channel cannot be used
- **If both gog and Gmail MCP are unavailable**: Email sending and draft creation are both impossible, making the outbound feature effectively unusable — state this clearly

### 3. License Check

Check if adding a project is permitted:

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/license.py check-can-add "$(pwd)/$0"
```

Process based on result:

- **`PAID`** → Continue as-is
- **`FREE_OK`** → Display "Registering as free tier (1 project)" and continue
- **`FREE_LIMIT`** → Display "Free tier is limited to 1 project. Please enter a license key or delete an existing project with /delete-project." Use AskUserQuestion to prompt key entry (can skip)
  - If user enters a key: Run `python3 ${CLAUDE_PLUGIN_ROOT}/scripts/license.py save-key "<entered key>"`
  - Result is `VALID` → Display "License key is valid. Registering as paid tier." and continue
  - Result is `INVALID` → Display "License key is invalid." and **abort**
  - If user skips → **abort**
- **`ALREADY_REGISTERED`** → "This project is already registered. Continuing."

### 4. Database Initialization

Only run the initialization script if `data.db` does not already exist at the workspace root:

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/init_db.py
```

Skip if DB already exists and report accordingly.

### 5. Create Subdirectory

Create a directory with the specified name directly under the workspace root:

```bash
mkdir -p "$0"
```

Skip if it already exists.

### 5b. Create .gitignore

Only create `.gitignore` at the workspace root if it does not already exist:

```bash
if [ ! -f .gitignore ]; then
  cat > .gitignore << 'EOF'
.env
.env.*
*.key
credentials*.json
client_secret*.json
.tmp/
.DS_Store
EOF
fi
```

Skip if it already exists (do not overwrite the user's settings).

### 6. Register Project

Register the project in the `projects` table in the DB:

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/init_db.py data.db --register-project "$0"
```

### 7. Global Registration

Register the project path in `~/.leadace/projects`:

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/license.py register "$(pwd)/$0"
```

### 8. Completion Report

Report the following:
- Database status (newly created or existing)
- Created directory path
- Guide the user to run `/strategy` as the next step
