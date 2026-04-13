#!/usr/bin/env python3
"""Script to bulk-set org_lookup_status on prospects

Sets a status on prospects for which a corporate number was not found or does not exist,
so that lookup_corporate_numbers.py will not search them again.

Usage:
  echo '<json_array>' | python3 mark_org_lookup_status.py <db_path>

Each object in the JSON array:
  prospect_id (required): target prospect ID
  status (required): "not_applicable" | "unresolvable"
  reason (optional): reason for skipping (appended to notes)

Output: JSON
  {"updated": N, "errors": N, "details": [...]}
"""

from __future__ import annotations

import argparse
import json
import sys
from typing import Literal, TypedDict

from sales_db import error_exit, get_connection, print_json  # pyright: ignore[reportMissingModuleSource]


# ---------------------------------------------------------------------------
# Type definitions
# ---------------------------------------------------------------------------

OrgLookupStatus = Literal["not_applicable", "unresolvable"]
VALID_STATUSES: frozenset[str] = frozenset({"not_applicable", "unresolvable"})


class MarkEntry(TypedDict):
    """Each entry in the input JSON array."""
    prospect_id: int
    status: OrgLookupStatus


class _MarkEntryOptional(TypedDict, total=False):
    reason: str


class MarkEntryFull(MarkEntry, _MarkEntryOptional):
    """Input entry including the optional reason field."""
    pass


class EntryDetail(TypedDict, total=False):
    """Processing result for each entry."""
    index: int
    prospect_id: int
    result: str  # "updated" | "error"
    message: str


class ResultSummary(TypedDict):
    """Overall processing result."""
    updated: int
    errors: int
    details: list[EntryDetail]


# ---------------------------------------------------------------------------
# Main processing
# ---------------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Bulk-set org_lookup_status on prospects. Reads JSON from stdin.",
    )
    _ = parser.add_argument("db_path", help="Path to the SQLite database")
    return parser


def main() -> None:
    args = build_parser().parse_args()
    db_path: str = args.db_path

    raw = sys.stdin.read().strip()
    if not raw:
        error_exit("stdin is empty. Please provide a JSON array.")

    try:
        data: list[MarkEntryFull] = json.loads(raw)
    except json.JSONDecodeError as e:
        error_exit(f"JSON parse error: {e}")

    if not isinstance(data, list):  # type: ignore[reportUnnecessaryIsinstance]
        error_exit("Input must be a JSON array.")

    conn = get_connection(db_path)
    result = ResultSummary(updated=0, errors=0, details=[])

    try:
        for i, entry in enumerate(data):
            detail = EntryDetail(index=i, prospect_id=entry.get("prospect_id", 0))

            # Validation
            prospect_id = entry.get("prospect_id")
            status = entry.get("status")
            if not prospect_id or not status:
                detail["result"] = "error"
                detail["message"] = "prospect_id and status are required"
                result["errors"] += 1
                result["details"].append(detail)
                continue

            if status not in VALID_STATUSES:
                detail["result"] = "error"
                detail["message"] = f"status must be one of {VALID_STATUSES}: {status}"
                result["errors"] += 1
                result["details"].append(detail)
                continue

            # Verify prospect exists
            row = conn.execute(
                "SELECT id, org_lookup_status FROM prospects WHERE id = ?",
                (prospect_id,),
            ).fetchone()
            if row is None:
                detail["result"] = "error"
                detail["message"] = f"prospect_id={prospect_id} not found"
                result["errors"] += 1
                result["details"].append(detail)
                continue

            # Update
            reason = entry.get("reason")
            if reason:
                conn.execute(
                    "UPDATE prospects SET org_lookup_status = ?,"
                    " notes = CASE WHEN notes IS NULL THEN ? ELSE notes || char(10) || ? END,"
                    " updated_at = datetime('now', 'localtime')"
                    " WHERE id = ?",
                    (status, reason, reason, prospect_id),
                )
            else:
                conn.execute(
                    "UPDATE prospects SET org_lookup_status = ?,"
                    " updated_at = datetime('now', 'localtime')"
                    " WHERE id = ?",
                    (status, prospect_id),
                )
            conn.commit()

            detail["result"] = "updated"
            detail["prospect_id"] = prospect_id
            detail["message"] = f"org_lookup_status={status}"
            result["updated"] += 1
            result["details"].append(detail)

    except Exception as e:
        error_exit(f"Unexpected error: {e}")
    finally:
        conn.close()

    print_json(result)


if __name__ == "__main__":
    main()
