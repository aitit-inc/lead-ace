#!/usr/bin/env python3
"""Script to link existing prospects to organizations records

For existing prospects with a NULL organization_id, confirms the corporate number
and performs an upsert into the organizations table + updates prospects.organization_id.

Usage:
  echo '<json_array>' | python3 link_organization.py <db_path>

Each object in the JSON array:
  prospect_id (required): prospect ID to link
  corporate_number (required): corporate number (13 digits)
  organization_name (required): official entity name (as listed on the NTA publication site)
  address (optional): address (as listed on the NTA publication site)
  name (optional): specify to update prospects.name
  department (optional): specify to update prospects.department

Output: JSON
  {"updated": N, "errors": N, "details": [...]}
"""

from __future__ import annotations

import argparse
import json
import sys
from typing import TypedDict

from sales_db import error_exit, get_connection, print_json, upsert_organization  # pyright: ignore[reportMissingModuleSource]


# ---------------------------------------------------------------------------
# Type definitions
# ---------------------------------------------------------------------------

class _LinkEntryOptional(TypedDict, total=False):
    """Optional fields for LinkEntry."""
    address: str
    name: str
    department: str


class LinkEntry(_LinkEntryOptional):
    """Each entry in the input JSON array."""
    prospect_id: int
    corporate_number: str
    organization_name: str


class EntryDetail(TypedDict, total=False):
    """Processing result for each entry."""
    index: int
    prospect_id: int
    status: str  # "updated" | "error"
    message: str


class ResultSummary(TypedDict):
    """Overall processing result."""
    updated: int
    errors: int
    details: list[EntryDetail]


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

REQUIRED_FIELDS = ("prospect_id", "corporate_number", "organization_name")


# ---------------------------------------------------------------------------
# Main processing
# ---------------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Link a corporate number to an existing prospect and upsert into organizations. Reads JSON from stdin.",
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
        data: list[LinkEntry] = json.loads(raw)
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
            missing = [f for f in REQUIRED_FIELDS if not entry.get(f)]
            if missing:
                detail["status"] = "error"
                detail["message"] = f"Missing required fields: {', '.join(missing)}"
                result["errors"] += 1
                result["details"].append(detail)
                continue

            prospect_id: int = entry["prospect_id"]
            corporate_number: str = entry["corporate_number"]
            organization_name: str = entry["organization_name"]
            address: str | None = entry.get("address")

            # Verify prospect exists
            row = conn.execute(
                "SELECT id, name, website_url, industry, overview, organization_id"
                " FROM prospects WHERE id = ?",
                (prospect_id,),
            ).fetchone()
            if row is None:
                detail["status"] = "error"
                detail["message"] = f"prospect_id={prospect_id} not found"
                result["errors"] += 1
                result["details"].append(detail)
                continue

            if row["organization_id"] is not None:
                detail["status"] = "error"
                detail["message"] = (
                    f"prospect_id={prospect_id} already has organization_id="
                    f"{row['organization_id']} set"
                )
                result["errors"] += 1
                result["details"].append(detail)
                continue

            # Upsert into organizations
            upsert_organization(
                conn,
                corporate_number=corporate_number,
                name=organization_name,
                website_url=row["website_url"],
                industry=row["industry"],
                overview=row["overview"],
                address=address,
            )

            # Update prospects.organization_id
            update_fields: list[str] = ["organization_id = ?"]
            update_params: list[str | int] = [corporate_number]

            new_name = entry.get("name")
            if new_name:
                update_fields.append("name = ?")
                update_params.append(new_name)

            new_dept = entry.get("department")
            if new_dept:
                update_fields.append("department = ?")
                update_params.append(new_dept)

            update_fields.append("updated_at = datetime('now', 'localtime')")
            update_params.append(prospect_id)

            conn.execute(
                f"UPDATE prospects SET {', '.join(update_fields)} WHERE id = ?",
                update_params,
            )
            conn.commit()

            detail["status"] = "updated"
            detail["prospect_id"] = prospect_id
            detail["message"] = (
                f"organization_id={corporate_number}"
                f" (entity name: {organization_name}) set"
            )
            result["updated"] += 1
            result["details"].append(detail)

    except Exception as e:
        error_exit(f"Unexpected error: {e}")
    finally:
        conn.close()

    print_json(result)


if __name__ == "__main__":
    main()
