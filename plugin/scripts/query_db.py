#!/usr/bin/env python3
"""SQL query execution script (supports parameter binding)

**This script is for the /docker skill only. Do not use from normal skills.**

For regular DB operations, use the dedicated scripts below:
- READ queries: sales_queries.py
- Email send + logging: send_and_log.py
- Response recording: record_response.py
- Status update: update_status.py
- Evaluation recording: record_evaluation.py
- Prospect registration: add_prospects.py
- DB initialization: init_db.py

Usage:
  query_db.py <db_path> <sql> [param1] [param2] ...

For SELECT: outputs result as a JSON array to stdout.
For INSERT: outputs {"last_id": <rowid>}.
For UPDATE/DELETE: outputs {"rows_affected": <count>}.

Parameters correspond in order to the ? placeholders in the SQL.
"""

from __future__ import annotations

import re
import sys

from sales_db import error_exit, get_connection, print_json, rows_to_dicts


def detect_stmt_type(sql: str) -> str:
    """Detect the SQL statement type, accounting for comments and WITH clauses."""
    # Strip line comments (-- ...)
    clean = re.sub(r"--[^\n]*", "", sql).strip().upper()
    if not clean:
        return "UNKNOWN"
    first = clean.split()[0]
    # Handle WITH ... SELECT case
    if first == "WITH":
        if "SELECT" in clean:
            return "SELECT"
        return "UNKNOWN"
    return first


def main() -> None:
    if len(sys.argv) < 3:
        error_exit("Usage: query_db.py <db_path> <sql> [param1] [param2] ...")

    db_path = sys.argv[1]
    sql = sys.argv[2]
    params = sys.argv[3:]

    conn = get_connection(db_path)
    try:
        cursor = conn.execute(sql, params)

        stmt_type = detect_stmt_type(sql)
        if stmt_type == "SELECT":
            rows = cursor.fetchall()
            print_json(rows_to_dicts(rows))
        elif stmt_type == "INSERT":
            conn.commit()
            print_json({"last_id": cursor.lastrowid})
        else:
            conn.commit()
            print_json({"rows_affected": cursor.rowcount})
    except Exception as e:
        error_exit(str(e))
    finally:
        conn.close()


if __name__ == "__main__":
    main()
