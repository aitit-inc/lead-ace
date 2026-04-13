---
name: data-migration-v050
description: "Migrate existing data to the organizations table added in v0.5.0. Identifies and links corporate numbers for prospects with NULL organization_id. Temporary skill (scheduled for deletion in v0.6.0)."
argument-hint: "[--limit N]"
---

## Overview

v0.5.0 added the organizations table and made organization_id (corporate number FK) required in prospects.
This skill is a temporary skill to **migrate old data (prospects with NULL organization_id) to the new schema**.

Processes large record sets using batch parallel matching with sub-agents.

## Steps

### 0. Preflight

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/preflight.py data.db --migrate-only
```

### 1. Candidate Search

Search for corporate number candidates and save results to a file (to prevent main context bloat):

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/lookup_corporate_numbers.py data.db --limit <N> > /tmp/la_lookup.json 2>/dev/null
```

Use the user argument for `--limit` if provided; default is 5.

Retrieve only the count summary and report to the user (do not output the full JSON):

```bash
python3 -c "import json; d=json.load(open('/tmp/la_lookup.json')); print(f'searched={d[\"searched\"]}, found={d[\"candidates_found\"]}, not_found={d[\"not_found\"]}, errors={d[\"errors\"]}')"
```

### 2. Batch Split

Split both `candidates_found` and `not_found` into batch files of **20 each**:

```bash
python3 -c "
import json, math
data = json.load(open('/tmp/la_lookup.json'))
targets = [d for d in data['details'] if d['status'] in ('candidates_found', 'not_found')]
bs = 20
for i in range(0, len(targets), bs):
    with open(f'/tmp/la_batch_{i//bs}.json', 'w') as f:
        json.dump(targets[i:i+bs], f, ensure_ascii=False)
print(f'{len(targets)} prospects -> {math.ceil(len(targets)/bs)} batches')
"
```

### 3. Batch Matching (parallel execution with sub-agents)

Launch a sub-agent for each batch file using the **Agent tool**.
**Issue multiple Agent tool calls within a single message to run independent batches in parallel.**

Pass the following template to each sub-agent as a prompt, replacing `<BATCH_FILE>` with the actual path:

---

**↓ Sub-agent Prompt Template ↓**

```
Process a corporate number matching batch.

## Input
Read <BATCH_FILE> using the Read tool to get the JSON array.
Each entry is one of:
- candidates_found: {prospect_id, name, website_url, status: "candidates_found", candidates: [{number, name, reading, address}]}
- not_found: {prospect_id, name, website_url, status: "not_found"}

## Processing Steps

### A. candidates_found entries

#### Auto-confirm (no web investigation needed)
If there is only 1 candidate and **all** of the following apply, confirm it directly:
- The candidate's legal name and the prospect's name are essentially identical (full-width/half-width, legal entity type position differences are acceptable)
- The legal entity type is not inconsistent with the prospect's industry (e.g., if the prospect is a school but the candidate is a stock company → inconsistent)

#### Needs investigation
If auto-confirm is not possible, investigate as follows:
1. Confirm the prospect's website via fetch_url.py:
   python3 ${CLAUDE_PLUGIN_ROOT}/scripts/fetch_url.py --url "<website_url>" --prompt "Extract this organization's official name, industry, and location"
2. Conduct additional investigation via WebSearch as needed

#### Determination
- **Confirm**: Legal name and industry are consistent → add to confirmed
- **Skip**: Cannot determine or candidate is unrelated → add to skipped

### B. not_found entries

Prospects not found in NTA search. Try to identify the corporate number in the following order:

1. **WebSearch**: Search for "<prospect name> corporate number" or "<prospect name> company profile" to find the corporate number or official legal name
2. **fetch_url.py**: Get the official name from the prospect's website_url, then WebSearch again
3. If the corporate number is found → add to confirmed
4. If not found → add to skipped (briefly note what was tried in reason)

## Output
After processing, return the following JSON structure **as text**:

{
  "confirmed": [
    {
      "prospect_id": 42,
      "corporate_number": "1234567890123",
      "organization_name": "Use the candidate's name as-is",
      "address": "Use the candidate's address as-is"
    }
  ],
  "skipped": [
    {"prospect_id": 99, "status": "not_applicable", "reason": "Sole proprietor"}
  ]
}

### Field notes (confirmed)
- organization_name: Use the candidate's name from the NTA public site as-is
- name (optional): Only add if changing prospects.name. Example: if organization_name="School Corp. XYZ" and prospect is individual school → name="XYZ Vocational School"
- department (optional): Only add if setting a department

### Field notes (skipped)
- status: "not_applicable" (corporate number does not exist: sole proprietor, no legal entity, foreign company, etc.) or "unresolvable" (searched but could not identify: many with same name, site inaccessible, etc. — retryable later)
- reason: Skip reason (briefly)

### Notes
- fetch_url.py uses Jina Reader (20 RPM limit). Handle errors when fetching many pages
- Process auto-confirmable ones first, then group those needing investigation for efficiency
```

**↑ Sub-agent Prompt Template ↑**

---

### 4. Aggregate Results and Update DB

Combine the `confirmed` arrays from all sub-agents and bulk update via `link_organization.py`:

```bash
echo '<merged_json>' | python3 ${CLAUDE_PLUGIN_ROOT}/scripts/link_organization.py data.db
```

### 5. Mark Skipped Records

Combine the `skipped` arrays from all sub-agents and mark them to prevent re-searching via `mark_org_lookup_status.py`.

```bash
echo '<skipped_json>' | python3 ${CLAUDE_PLUGIN_ROOT}/scripts/mark_org_lookup_status.py data.db
```

Each object in the JSON array:

```json
{"prospect_id": 99, "status": "not_applicable", "reason": "Sole proprietor — no corporate number"}
```

Status values:
- `not_applicable` — Corporate number does not exist (sole proprietor, no legal entity, foreign company, etc.)
- `unresolvable` — Searched but could not identify (many with same name, site inaccessible, etc. — retryable later)

### 6. Results Report

Report to the user:

- Number confirmed and updated
- Number skipped (not_applicable / unresolvable breakdown)
- Remaining unmigreted count:

```bash
python3 -c "import sqlite3; c=sqlite3.connect('data.db'); print(c.execute('SELECT COUNT(*) FROM prospects WHERE organization_id IS NULL').fetchone()[0])"
```
