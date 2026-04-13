#!/usr/bin/env python3
"""Prospect status update script (unreachable / inactive only)

Usage:
  python3 update_status.py <db_path> --project <id> --prospect-id <id> \
    --status <unreachable|inactive> \
    [--do-not-contact --dnc-reason <reason>]

Use send_and_log.py to update to contacted, and record_response.py for responded/rejected.
This script only handles unreachable/inactive.

Output: JSON
  {"status": "updated"|"skipped", "previous_status": "...",
   "new_status": "...", "do_not_contact_set": true|false}

Exit code: 0 = success, 1 = validation error, 2 = script error
"""

from __future__ import annotations

import argparse
import sqlite3
from typing import Literal, TypedDict

from sales_db import error_exit, get_connection, print_json


# ---------------------------------------------------------------------------
# Type definitions
# ---------------------------------------------------------------------------

ResultStatus = Literal["updated", "skipped"]

ALLOWED_STATUSES = ("unreachable", "inactive")


class UpdateResult(TypedDict):
    status: ResultStatus
    previous_status: str
    new_status: str
    do_not_contact_set: bool


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Update prospect status to unreachable / inactive. "
        "Use send_and_log.py for contacted, record_response.py for responded/rejected.",
    )
    _ = parser.add_argument("db_path", help="Path to the SQLite database")
    _ = parser.add_argument("--project", required=True, help="Project ID")
    _ = parser.add_argument("--prospect-id", type=int, required=True, help="Prospect ID")
    _ = parser.add_argument(
        "--status", required=True,
        choices=list(ALLOWED_STATUSES),
        help="Target status (unreachable/inactive only)",
    )
    _ = parser.add_argument("--do-not-contact", action="store_true", help="Set the do_not_contact flag")
    _ = parser.add_argument("--dnc-reason", help="Reason for do_not_contact (required with --do-not-contact)")
    return parser


# ---------------------------------------------------------------------------
# DB operations
# ---------------------------------------------------------------------------

def update(
    conn: sqlite3.Connection,
    project_id: str,
    prospect_id: int,
    new_status: str,
    do_not_contact: bool,
    dnc_reason: str | None,
) -> UpdateResult:
    """Update status and set do_not_contact as needed."""

    # Get current status
    row = conn.execute(
        "SELECT status FROM project_prospects WHERE project_id = ? AND prospect_id = ?",
        (project_id, prospect_id),
    ).fetchone()
    if row is None:
        error_exit(
            f"No matching row in project_prospects (project_id={project_id}, prospect_id={prospect_id})"
        )
    previous_status: str = row[0]

    # Idempotency check: skip if already the same status
    if previous_status == new_status:
        return UpdateResult(
            status="skipped",
            previous_status=previous_status,
            new_status=new_status,
            do_not_contact_set=False,
        )

    # 1. UPDATE project_prospects.status
    conn.execute(
        "UPDATE project_prospects SET status = ?, updated_at = datetime('now', 'localtime')"
        " WHERE project_id = ? AND prospect_id = ?",
        (new_status, project_id, prospect_id),
    )

    # 2. UPDATE prospects.do_not_contact (only if specified)
    dnc_set = False
    if do_not_contact and dnc_reason is not None:
        conn.execute(
            "UPDATE prospects SET do_not_contact = 1,"
            " notes = CASE WHEN notes IS NOT NULL AND notes != ''"
            " THEN notes || CHAR(10) || ? ELSE ? END,"
            " updated_at = datetime('now', 'localtime')"
            " WHERE id = ?",
            (dnc_reason, dnc_reason, prospect_id),
        )
        dnc_set = True

    conn.commit()

    return UpdateResult(
        status="updated",
        previous_status=previous_status,
        new_status=new_status,
        do_not_contact_set=dnc_set,
    )


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    args = build_parser().parse_args()

    project_id: str = args.project
    prospect_id: int = args.prospect_id
    new_status: str = args.status
    do_not_contact: bool = args.do_not_contact
    dnc_reason: str | None = args.dnc_reason

    # Validation
    if do_not_contact and not dnc_reason:
        error_exit("--dnc-reason is required with --do-not-contact")

    conn = get_connection(args.db_path)

    try:
        result = update(conn, project_id, prospect_id, new_status, do_not_contact, dnc_reason)
        print_json(result)
    except SystemExit:
        raise
    except Exception as e:
        conn.rollback()
        error_exit(f"Error during update: {e}", code=2)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
