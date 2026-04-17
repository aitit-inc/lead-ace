# lead-ace

Autonomous lead generation plugin for Claude Code.
Builds prospect lists, runs outbound outreach, and iterates on strategy — all hands-free.

## For Users

### Prerequisites

- Claude Code
- SQLite3
- Gmail MCP (for sending and checking emails)
- claude-in-chrome MCP (for form submission and SNS operations)

### Installation

Run the following inside Claude Code:

```
/plugin marketplace add aitit-inc/claude-plugins
/plugin install lead-ace@surpassone-plugins
```

To update:

```
/plugin marketplace update
/plugin update lead-ace@surpassone-plugins
```

### Usage

Run the following slash commands in sequence as a pipeline.

| Command | Description |
|---|---|
| `/setup <dir>` | Initialize project (create DB and directories) |
| `/strategy <dir>` | Define sales and marketing strategy |
| `/build-list <dir>` | Build a prospect list via web search |
| `/outbound <dir>` | Reach out via email, form, or SNS DM |
| `/check-results <dir>` | Check and record responses |
| `/evaluate <dir>` | Run PDCA improvement based on data analysis |
| `/daily-cycle <dir> [count]` | Run daily cycle automatically (check-results → outbound + build-list) |
| `/delete-project <dir>` | Unregister project and delete its data |

`<dir>` is the subdirectory name for each product/service (e.g., `product-a-sales`).
The database (`data.db`) is shared at the project root; knowledge files are separated into subdirectories.

### Basic Flow

```
/setup my-product
/strategy my-product        # Interactively enter business info → generate BUSINESS.md, SALES_STRATEGY.md
/build-list my-product      # Collect prospects via web search
/outbound my-product        # Run automated outbound sales
/check-results my-product   # Check responses
/evaluate my-product        # Analyze results and auto-improve strategy
```

After the initial setup, use `/daily-cycle` to automate daily sales activities:

```
/daily-cycle my-product      # Run daily: check replies → 30 outreach → replenish list
/daily-cycle my-product 50   # Specify count
/evaluate my-product         # Improve strategy about once a week
```

---

## License

This plugin is provided under a proprietary license from SurpassOne Inc. See [LICENSE](../../LICENSE) for details.

- **Free tier:** Up to 1 project
- **Paid tier:** Unlimited projects. License keys can be purchased at https://leadace.ai

You will be prompted for a license key when running `/setup`. Skip if using the free tier.

---

## For Developers

### Plugin Structure

```
.claude-plugin/plugin.json   # Manifest
skills/                      # Slash commands (each directory contains SKILL.md)
scripts/                     # Shared scripts (DB initialization, query execution, etc.)
```

- See `skills/<name>/SKILL.md` for each skill's specification
- Detailed templates and guidelines are in `skills/<name>/references/`
- Use `${CLAUDE_PLUGIN_ROOT}` to reference the plugin root from scripts

### DB Schema

Defined in `scripts/sales-db.sql`. Main tables: `projects`, `prospects`, `outreach_logs`, `responses`, `evaluations`.

### Local Development and Testing

```bash
# Launch Claude Code from this repository's directory and skills are auto-loaded
claude

# Or specify as a plugin from another project
claude --plugin-dir /path/to/this/repo
```
