#!/usr/bin/env python3
"""Atomic response recording script

Usage:
  python3 record_response.py <db_path> --project <id> --prospect-id <id> \
    --outreach-log-id <id> --channel <channel> --content <text> \
    --sentiment <positive|neutral|negative> \
    --response-type <reply|auto_reply|bounce|meeting_request|scheduling_confirmation|rejection> \
    [--new-status <responded|rejected|inactive>] \
    [--do-not-contact --dnc-reason <reason>]

Executes the following in a single transaction:
1. Record the response in the responses table
2. (If specified) Update the project_prospects status
3. (If specified) Update the do_not_contact flag and notes in prospects

Output: JSON
  {"status": "recorded"|"skipped", "response_id": N,
   "status_updated": true|false, "do_not_contact_set": true|false}

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

RecordStatus = Literal["recorded", "skipped"]

ALLOWED_NEW_STATUSES = ("responded", "rejected", "inactive")


class RecordResult(TypedDict):
    status: RecordStatus
    response_id: int
    status_updated: bool
    do_not_contact_set: bool


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Atomic response recording. responses INSERT + status update + do_not_contact setting.",
    )
    _ = parser.add_argument("db_path", help="Path to the SQLite database")
    _ = parser.add_argument("--project", required=True, help="Project ID")
    _ = parser.add_argument("--prospect-id", type=int, required=True, help="Prospect ID")
    _ = parser.add_argument("--outreach-log-id", type=int, required=True, help="outreach_logs.id to link to")
    _ = parser.add_argument("--channel", required=True, help="Reply channel (email/form/sns_twitter/sns_linkedin)")
    _ = parser.add_argument("--content", required=True, help="Reply content")
    _ = parser.add_argument(
        "--sentiment", required=True,
        choices=["positive", "neutral", "negative"],
        help="Sentiment analysis result",
    )
    _ = parser.add_argument("--response-type", required=True, help="Response type (reply/auto_reply/bounce/meeting_request/scheduling_confirmation/rejection)")
    _ = parser.add_argument(
        "--new-status",
        choices=list(ALLOWED_NEW_STATUSES),
        help="New status for project_prospects (responded/rejected/inactive)",
    )
    _ = parser.add_argument("--do-not-contact", action="store_true", help="Set the do_not_contact flag")
    _ = parser.add_argument("--dnc-reason", help="Reason for do_not_contact (required with --do-not-contact)")
    return parser


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

def validate_outreach_log(
    conn: sqlite3.Connection,
    outreach_log_id: int,
    project_id: str,
    prospect_id: int,
) -> None:
    """Verify that the outreach_log_id exists and matches the given project/prospect."""
    row = conn.execute(
        "SELECT id FROM outreach_logs WHERE id = ? AND project_id = ? AND prospect_id = ?",
        (outreach_log_id, project_id, prospect_id),
    ).fetchone()
    if row is None:
        error_exit(
            f"outreach_log_id {outreach_log_id} not found or does not match"
            f" project_id={project_id} / prospect_id={prospect_id}"
        )


def check_duplicate_response(
    conn: sqlite3.Connection,
    outreach_log_id: int,
    response_type: str,
) -> int | None:
    """Return the existing record ID for the same outreach_log_id + response_type, if any."""
    row = conn.execute(
        "SELECT id FROM responses WHERE outreach_log_id = ? AND response_type = ?",
        (outreach_log_id, response_type),
    ).fetchone()
    if row is not None:
        return int(row[0])
    return None


# ---------------------------------------------------------------------------
# DB operations
# ---------------------------------------------------------------------------

def record(
    conn: sqlite3.Connection,
    project_id: str,
    prospect_id: int,
    outreach_log_id: int,
    channel: str,
    content: str,
    sentiment: str,
    response_type: str,
    new_status: str | None,
    do_not_contact: bool,
    dnc_reason: str | None,
) -> RecordResult:
    """Record the response and update status and do_not_contact as needed."""

    # 1. INSERT responses
    cursor = conn.execute(
        "INSERT INTO responses (outreach_log_id, channel, content, sentiment, response_type)"
        " VALUES (?, ?, ?, ?, ?)",
        (outreach_log_id, channel, content, sentiment, response_type),
    )
    response_id = cursor.lastrowid
    if response_id is None:
        raise RuntimeError("Could not get lastrowid after INSERT")

    # 2. UPDATE project_prospects.status (only if specified)
    status_updated = False
    if new_status is not None:
        cursor_upd = conn.execute(
            "UPDATE project_prospects SET status = ?, updated_at = datetime('now', 'localtime')"
            " WHERE project_id = ? AND prospect_id = ?",
            (new_status, project_id, prospect_id),
        )
        status_updated = cursor_upd.rowcount > 0

    # 3. UPDATE prospects.do_not_contact (only if specified)
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

    return RecordResult(
        status="recorded",
        response_id=response_id,
        status_updated=status_updated,
        do_not_contact_set=dnc_set,
    )


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    args = build_parser().parse_args()

    project_id: str = args.project
    prospect_id: int = args.prospect_id
    outreach_log_id: int = args.outreach_log_id
    channel: str = args.channel
    content: str = args.content
    sentiment: str = args.sentiment
    response_type: str = args.response_type
    new_status: str | None = args.new_status
    do_not_contact: bool = args.do_not_contact
    dnc_reason: str | None = args.dnc_reason

    # Validation
    if do_not_contact and not dnc_reason:
        error_exit("--dnc-reason is required with --do-not-contact")

    conn = get_connection(args.db_path)

    try:
        # Verify outreach_log_id exists
        validate_outreach_log(conn, outreach_log_id, project_id, prospect_id)

        # Duplicate check
        existing_id = check_duplicate_response(conn, outreach_log_id, response_type)
        if existing_id is not None:
            skipped: RecordResult = {
                "status": "skipped",
                "response_id": existing_id,
                "status_updated": False,
                "do_not_contact_set": False,
            }
            print_json(skipped)
            return

        # 記録実行
        result = record(
            conn, project_id, prospect_id, outreach_log_id,
            channel, content, sentiment, response_type,
            new_status, do_not_contact, dnc_reason,
        )
        print_json(result)

    except Exception as e:
        conn.rollback()
        error_exit(f"Error during recording: {e}", code=2)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
