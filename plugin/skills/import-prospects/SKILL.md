---
name: import-prospects
description: "Use when the user asks to \"import prospects\", \"upload a list\", \"bring my existing customer list\", or has tabular contact data (CSV / Excel / SQLite / text) to load into a project. Converts the source to LeadAce's canonical CSV and uploads it."
argument-hint: "<project-name> <input-file> [skip|overwrite]"
allowed-tools:
  - Bash
  - Read
  - Write
  - AskUserQuestion
  - mcp__plugin_lead-ace_api__list_projects
  - mcp__plugin_lead-ace_api__import_prospects_from_csv
---

# Import Prospects - Bring Your Own List

A skill that imports existing prospect / contact lists (CSV, Excel, SQLite, plain text, etc.) into a LeadAce project. The MCP server only accepts a **canonical CSV** (specific columns), so the LLM here is responsible for reading the user's arbitrary file, mapping it to the canonical schema, writing the canonical CSV, and uploading it.

## Inputs

- `$0` — project name (required). Must already exist; create one with `/setup` first.
- `$1` — path to the source file (required). Any tabular format works (CSV, TSV, XLSX, XLS, ODS, SQLite, plain text with consistent delimiters).
- `$2` — dedup policy: `skip` (default) or `overwrite`. With `skip` existing rows are left alone; with `overwrite` matched rows have their fields refreshed and are re-linked to this project.

## Canonical CSV schema

| Column | Required | Notes |
|---|---|---|
| `organizationDomain` | yes | Apex domain, e.g. `acme.com` |
| `organizationName` | yes | |
| `organizationWebsiteUrl` | yes | Must be a full URL |
| `name` | yes | Prospect display name (often the org name or department) |
| `overview` | yes | One-paragraph description of the prospect |
| `websiteUrl` | yes | Prospect-specific URL (often == organizationWebsiteUrl) |
| `matchReason` | yes | Why this prospect is a target — used by `/strategy` and `/build-list` |
| `contactName` | no | |
| `department` | no | |
| `industry` | no | |
| `email` | no\* | |
| `contactFormUrl` | no\* | |
| `formType` | no | One of `google_forms`, `native_html`, `wordpress_cf7`, `iframe_embed`, `with_captcha` |
| `snsAccounts.x` | no\* | |
| `snsAccounts.linkedin` | no\* | |
| `snsAccounts.instagram` | no\* | |
| `snsAccounts.facebook` | no\* | |
| `notes` | no | |
| `priority` | no | Integer 1-5, default 3 |

\* At least **one** of `email`, `contactFormUrl`, or any `snsAccounts.*` is required per row.

Maximum 1000 data rows per import. Split larger files into multiple calls.

## Steps

### 1. Resolve the project

If `$0` is provided, use it as `PROJECT_NAME`. Otherwise call `mcp__plugin_lead-ace_api__list_projects`:
- exactly one project → use it
- multiple → ask via `AskUserQuestion`
- none → abort: "No projects yet. Run `/setup <project-name>` first."

### 2. Read the source file

If `$1` is empty, abort and ask the user for a file path.

Inspect the file by extension:
- `.csv` / `.tsv` / `.txt` — `Read` directly
- `.xlsx` / `.xls` / `.ods` — convert to CSV via `Bash` using whatever the user's environment has (`python3 -c "import pandas; pandas.read_excel('$1').to_csv('/tmp/leadace_import_src.csv', index=False)"` is a reasonable default; `ssconvert` from gnumeric works too). If conversion is impossible, tell the user the install hint and abort.
- `.sqlite` / `.db` — `sqlite3 $1 .schema` to see tables, ask the user which table to use (`AskUserQuestion`), then `sqlite3 -header -csv $1 'SELECT * FROM <table>;'`
- Anything else — try `Read` and let the LLM infer the structure

Read enough rows to understand the schema (first ~50 rows is plenty). Do not attempt to read multi-MB files in one shot.

### 3. Map columns to the canonical schema

For each source column, decide what canonical column it corresponds to. Do not invent data:
- If `organizationDomain` is missing but you have an email or website URL, derive the apex domain (e.g. `https://blog.acme.com/foo` → `acme.com`).
- If `organizationWebsiteUrl` is missing, derive `https://` + `organizationDomain`.
- If `websiteUrl` is missing, fall back to `organizationWebsiteUrl`.
- If `overview` is missing, synthesise a one-line description from available fields (industry, name, role) — never leave it blank.
- If `matchReason` is missing, ask the user once for a default ("Why is this list a fit for this project?") and apply it to every row.
- If a row has none of email / contactFormUrl / snsAccounts.* — drop it and report it in the per-row error summary.

If the source has columns you cannot place anywhere, ignore them — do not try to widen the schema.

### 4. Confirm with the user before uploading

Show the user:
- the source path and row count detected
- the column mapping you inferred (source column → canonical column)
- any rows you are dropping and why

Ask via `AskUserQuestion` whether to proceed. If the user wants tweaks, iterate.

### 5. Write the canonical CSV

Write the canonical CSV to `/tmp/leadace_import_<project>_<timestamp>.csv` using `Write`. Use proper CSV quoting:
- Fields containing `,`, `"`, or newlines must be wrapped in `"..."`.
- A literal `"` inside a quoted field is doubled (`""`).

Header row must be exactly the canonical column names (case-sensitive).

### 6. Pick the dedup policy

If `$2` is `skip` or `overwrite`, use it directly. Otherwise ask via `AskUserQuestion`:
- `skip` (default, safer) — existing prospects untouched
- `overwrite` — matched prospects get their fields refreshed AND re-linked to this project

### 7. Upload

`Read` the canonical CSV file back into a string and call:

```
mcp__plugin_lead-ace_api__import_prospects_from_csv
  projectId: PROJECT_NAME
  csvText: <full CSV including header>
  dedupPolicy: skip | overwrite
```

### 8. Report

Surface the counts the tool returns:
- `inserted` — newly created
- `overwritten` — existing prospects updated (only with `overwrite`)
- `skipped` — duplicates / `do_not_contact` / plan limit
- `errors` — rows that failed validation

For non-zero `skipped` or `errors`, summarise the top reasons. If the free plan limit was hit, advise the user to upgrade or delete unused projects.

Leave the canonical CSV at `/tmp/leadace_import_*.csv` so the user can re-run with a different policy if needed.
