---
name: setup
description: "This skill should be used when the user asks to \"set up\", \"create a new project\", \"initialize\", \"start a project\", or wants to set up a new sales project. Creates a project on the server and sets up the local workspace."
argument-hint: "<project-directory-name>"
allowed-tools:
  - Bash
  - Read
  - Write
  - AskUserQuestion
  - mcp__plugin_lead-ace_api__setup_project
---

# Setup - Project Initial Setup

A skill that creates a new Lead Ace sales project. Registers the project on the server and sets up the local workspace directory.

## Steps

### 1. Verify Arguments

- Project directory name: `$0` (required. Example: `product-a-sales`)

Return an error if `$0` is empty.

### 2. Environment Check

Run the following command to verify availability of required tools:

```bash
git --version 2>&1 && git remote -v 2>&1; echo "---"; which gog 2>&1 && gog version 2>&1; echo "---"; playwright-cli --version 2>&1
```

Inform the user of the results:

**If git is unavailable / remote repository is not set:**
Warn the user that daily-cycle's automatic commit and push will not work. Usage is still possible.

**If gog is unavailable:**
Email auto-sending is not possible. If Gmail MCP is available, drafts can be created but sending will be manual.

**For Gmail MCP / playwright-cli / Claude in Chrome:**
Inform the user of the following dependencies:
- **Gmail MCP** (`gmail_search_messages` etc.): Required for reply checking in /check-results and draft creation. Without it, reply checking must be done manually
- **playwright-cli**: Required for form submission in /outbound. If not installed, only prospects with email addresses will be targeted
- **Claude in Chrome**: Required for SNS DM sending in /outbound and SNS reply checking in /check-results. Without it, SNS channel cannot be used
- **If both gog and Gmail MCP are unavailable**: Email sending and draft creation are both impossible, making the outbound feature effectively unusable -- state this clearly

### 3. Create Project on Server

Call `mcp__plugin_lead-ace_api__setup_project` with `projectId: "$0"`.

Handle errors:
- **Project limit reached** -> "Free plan allows 1 project. Delete the existing project with /delete-project or upgrade your plan." Then **abort**.
- **Project ID already exists** -> "Project '$0' already exists. Continuing with local setup."

### 4. Create Subdirectory

Create a directory with the specified name directly under the workspace root:

```bash
mkdir -p "$0"
```

Skip if it already exists.

### 5. Create .gitignore

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

### 6. Completion Report

Report the following:
- Project registration status
- Created directory path
- Guide the user to run `/strategy` as the next step
