#!/usr/bin/env python3
"""Atomic send log recording script

Usage (email send mode):
  python3 send_and_log.py <db_path> --project <id> --prospect-id <id> \
    --account <email> --to <email> --subject <subject> \
    [--body <text> | --body-file <path>] [--from <alias>] [--cc <emails>]

Usage (log-only mode - for forms/SNS):
  python3 send_and_log.py <db_path> --project <id> --prospect-id <id> \
    --log-only --channel <form|sns_twitter|sns_linkedin> \
    --subject <subject> [--body <text> | --body-file <path>] \
    [--status <sent|failed>] [--error-message <msg>]

Email send mode: sends email via gog send and records the result in the DB.
Log-only mode: no sending; records log + updates status in a single transaction.

Output: JSON
  {"status": "sent"|"failed"|"skipped", "outreach_log_id": N, "error_message": null|"..."}
  skipped: send was skipped because a successful send to this prospect already exists

Exit code: 0 = success, 1 = failure (log recorded), 2 = script error
"""

from __future__ import annotations

import argparse
import sqlite3
import subprocess
import sys
from typing import Literal, TypedDict

from sales_db import error_exit, get_connection, print_json  # pyright: ignore[reportMissingModuleSource]


# ---------------------------------------------------------------------------
# Type definitions
# ---------------------------------------------------------------------------

# Script output status (DB values + skipped)
SendStatus = Literal["sent", "failed", "skipped"]


class SendResult(TypedDict):
    status: SendStatus
    outreach_log_id: int
    error_message: str | None


# ---------------------------------------------------------------------------
# Processing functions
# ---------------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Atomic send log recording. Email send or log-only mode.",
    )
    _ = parser.add_argument("db_path", help="Path to the SQLite database")
    _ = parser.add_argument("--project", required=True, help="Project ID")
    _ = parser.add_argument("--prospect-id", type=int, required=True, help="Prospect ID")
    _ = parser.add_argument("--subject", required=True, help="Email subject")
    body_group = parser.add_mutually_exclusive_group()
    _ = body_group.add_argument("--body", help="Email body (for short bodies)")
    _ = body_group.add_argument("--body-file", help="Path to body file (for long bodies)")
    # Email send mode
    _ = parser.add_argument("--account", help="Sender email address (gog --account)")
    _ = parser.add_argument("--to", dest="to_addr", help="Recipient email address")
    _ = parser.add_argument("--from", dest="from_addr", help="Sender alias (gog --from)")
    _ = parser.add_argument("--cc", help="CC addresses (comma-separated)")
    # Log-only mode
    _ = parser.add_argument("--log-only", action="store_true", help="Record log and update status only; do not send")
    _ = parser.add_argument("--channel", help="Channel name (required in log-only mode: form/sns_twitter/sns_linkedin)")
    _ = parser.add_argument("--status", default="sent", choices=["sent", "failed"], help="Status to record (log-only mode, default: sent)")
    _ = parser.add_argument("--error-message", help="Error message (log-only + status=failed)")
    return parser


def read_body(body: str | None, body_file: str | None) -> str:
    """Get the message body for sending."""
    if body is not None:
        return body
    if body_file is not None:
        with open(body_file, encoding="utf-8") as f:
            return f.read()
    return ""


def send_email(
    account: str,
    to_addr: str,
    subject: str,
    body: str | None,
    body_file: str | None,
    from_addr: str | None,
    cc: str | None,
) -> tuple[bool, str | None]:
    """Run gog send and return (success flag, error message)."""
    cmd = [
        "gog", "send", "--json", "--no-input",
        "--account", account,
        "--to", to_addr,
        "--subject", subject,
    ]

    if body is not None:
        cmd.extend(["--body", body])
    elif body_file is not None:
        cmd.extend(["--body-file", body_file])

    if from_addr is not None:
        cmd.extend(["--from", from_addr])

    if cc is not None:
        cmd.extend(["--cc", cc])

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    except subprocess.TimeoutExpired:
        return False, "gog send timed out (60 seconds)"
    except FileNotFoundError:
        return False, "gog command not found"

    if result.returncode == 0:
        return True, None

    error = result.stderr.strip() or result.stdout.strip() or f"exit code {result.returncode}"
    return False, error


def check_already_attempted(
    conn: sqlite3.Connection,
    project_id: str,
    prospect_id: int,
) -> tuple[int | None, str]:
    """Return the outreach_log ID and reason for the same project+prospect if already sent or failed today.

    Returns:
        (outreach_log_id, reason) — ID and reason if should skip, otherwise (None, "")
    """
    # Check for already-sent (regardless of date)
    row = conn.execute(
        "SELECT id FROM outreach_logs"
        " WHERE project_id = ? AND prospect_id = ? AND status = 'sent'"
        " LIMIT 1",
        (project_id, prospect_id),
    ).fetchone()
    if row is not None:
        return int(row[0]), "already_sent"

    # Check for today's failure (prevent same-day retry)
    row = conn.execute(
        "SELECT id FROM outreach_logs"
        " WHERE project_id = ? AND prospect_id = ? AND status = 'failed'"
        " AND DATE(sent_at) = DATE('now')"
        " LIMIT 1",
        (project_id, prospect_id),
    ).fetchone()
    if row is not None:
        return int(row[0]), "failed_today"

    return None, ""


def record_result(
    conn: sqlite3.Connection,
    project_id: str,
    prospect_id: int,
    channel: str,
    subject: str,
    body_text: str,
    success: bool,
    error_message: str | None,
) -> int:
    """Record the send result in the DB. Executed in a single transaction."""
    status = "sent" if success else "failed"

    insert_sql = (
        "INSERT INTO outreach_logs"
        + " (project_id, prospect_id, channel, subject, body, status, error_message)"
        + " VALUES (?, ?, ?, ?, ?, ?, ?)"
    )
    cursor = conn.execute(
        insert_sql,
        (project_id, prospect_id, channel, subject, body_text, status, error_message),
    )
    log_id = cursor.lastrowid
    if log_id is None:
        raise RuntimeError("Could not get lastrowid after INSERT")

    # Update project_prospects status only on successful send
    if success:
        update_sql = (
            "UPDATE project_prospects SET status = 'contacted', updated_at = datetime('now', 'localtime')"
            + " WHERE project_id = ? AND prospect_id = ?"
        )
        cursor_upd = conn.execute(update_sql, (project_id, prospect_id))
        if cursor_upd.rowcount == 0:
            print(
                f"WARNING: No matching row in project_prospects (project_id={project_id}, prospect_id={prospect_id})",
                file=sys.stderr,
            )

    conn.commit()
    return log_id


def main() -> None:
    args = build_parser().parse_args()

    db_path: str = args.db_path
    project_id: str = args.project
    prospect_id: int = args.prospect_id
    subject: str = args.subject
    body: str | None = args.body
    body_file: str | None = args.body_file
    log_only: bool = args.log_only

    # Get body text (for DB recording)
    body_text = read_body(body, body_file)

    # Dedup check: do not approach prospects already successfully sent or failed today
    conn = get_connection(db_path)
    existing_log_id, skip_reason = check_already_attempted(conn, project_id, prospect_id)
    if existing_log_id is not None:
        conn.close()
        skipped: SendResult = {
            "status": "skipped",
            "outreach_log_id": existing_log_id,
            "error_message": skip_reason,
        }
        print_json(skipped)
        return

    if log_only:
        # Log-only mode (for forms/SNS)
        channel: str = args.channel
        if not channel:
            error_exit("--channel is required in --log-only mode")
        success = args.status == "sent"
        error_message: str | None = args.error_message
    else:
        # Email send mode
        channel = "email"
        account: str | None = args.account
        to_addr: str | None = args.to_addr
        if not account or not to_addr:
            error_exit("--account and --to are required in email send mode")
        if not body and not body_file:
            error_exit("--body or --body-file is required")
        success, error_message = send_email(
            account=account,
            to_addr=to_addr,
            subject=subject,
            body=body,
            body_file=body_file,
            from_addr=args.from_addr,
            cc=args.cc,
        )

    # Record to DB (conn was obtained during the dedup check)
    try:
        log_id = record_result(
            conn, project_id, prospect_id, channel, subject, body_text, success, error_message,
        )
    except Exception as e:
        conn.rollback()
        error_exit(f"DB record failed: {e}")
    finally:
        conn.close()

    result: SendResult = {
        "status": "sent" if success else "failed",
        "outreach_log_id": log_id,
        "error_message": error_message,
    }
    print_json(result)

    if not success:
        sys.exit(1)


if __name__ == "__main__":
    main()
