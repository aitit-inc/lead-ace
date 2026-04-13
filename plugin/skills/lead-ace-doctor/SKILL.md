---
name: lead-ace-doctor
description: "Direct DB operations for emergencies. Use when DB fixes or investigations are needed that cannot be handled by dedicated scripts."
argument-hint: "<description of what needs fixing>"
---

## Overview

This skill is a **direct DB operation tool for emergencies and incident response only**. For normal operations, use the following dedicated scripts:

| Operation | Dedicated Script |
|---|---|
| Email sending + log recording | `send_and_log.py` |
| Reply recording + status update | `record_response.py` |
| Update to unreachable / inactive | `update_status.py` |
| Evaluation recording + priority update | `record_evaluation.py` |
| Bulk prospect registration | `add_prospects.py` |
| All READ queries | `sales_queries.py` |
| DB initialization + project registration | `init_db.py` |

## DB Schema

Before writing any SQL, read the following to understand the current schema:

- `${CLAUDE_PLUGIN_ROOT}/scripts/sales-db.sql` — Full current schema (table definitions, FKs, indexes, and triggers)

## Steps

### 0. Preflight

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/preflight.py data.db --migrate-only
```

### 1. Assess the Situation

Review the user's instructions and identify the SQL to execute. Verify the current state with SELECT as needed:

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/query_db.py data.db "<SELECT statement>" [params...]
```

### 2. Present Execution Plan

**Always present the SQL to the user** and confirm with AskUserQuestion before executing. Executing without confirmation is prohibited.

Present the following:
- SQL statement(s) to execute
- Number of records affected (verify with SELECT COUNT beforehand)
- Expected impact

### 3. Execute

Execute after user approval:

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/query_db.py data.db "<SQL statement>" [params...]
```

### 4. Verify Results

After execution, verify the affected records with SELECT and report the results to the user.

### 5. Suggest Prevention

If the same operation is likely to be needed again in the future, propose creating a dedicated script.
