#!/usr/bin/env python3
"""Bulk prospect registration script

Usage:
  echo '<json_array>' | add_prospects.py <db_path> <project_id>

Reads a JSON array of prospect information from stdin and performs
duplicate checking then bulk DB registration.
Registers prospects (prospect master) and project_prospects (project linkage)
in a single transaction.

Each object in the JSON array:
  For prospects:
    name (required), overview (required), website_url (required),
    contact_name, corporate_number, industry, email, contact_form_url, form_type, sns_accounts
  For project_prospects:
    match_reason (required), priority (default: 3)
  Special:
    existing_prospect_id: specify an existing prospect_id to skip new registration and only link

Output: JSON
  {
    "added": N,
    "duplicates": N,
    "linked_existing": N,
    "errors": N,
    "details": [...]
  }
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from typing import TypedDict, cast

from check_duplicate import ALLOWED_SNS_KEYS  # pyright: ignore[reportMissingModuleSource]
from sales_db import DuplicateMatch, error_exit, extract_domain, get_connection, print_json, upsert_organization  # pyright: ignore[reportMissingModuleSource]


# ---------------------------------------------------------------------------
# Type definitions
# ---------------------------------------------------------------------------

class ProspectEntry(TypedDict, total=False):
    """Each entry in the input JSON array"""
    # For organizations (organization_name falls back to name if omitted)
    organization_name: str  # Legal entity name (may differ from prospect name, e.g. school corp vs school)
    # For prospects
    name: str  # Prospect name (school name, company name, etc.)
    contact_name: str
    department: str
    overview: str
    industry: str
    website_url: str
    country: str  # ISO 3166-1 alpha-2 (e.g., "JP", "US")
    email: str
    contact_form_url: str
    form_type: str
    sns_accounts: str | dict[str, str]
    do_not_contact: bool
    notes: str
    # For project_prospects
    match_reason: str
    priority: int
    # For linking an existing prospect
    existing_prospect_id: int


class PossibleMatch(TypedDict):
    prospect_id: int
    reason: str


class EntryDetail(TypedDict, total=False):
    """Processing result for each entry"""
    index: int
    name: str
    status: str  # "added" | "duplicate" | "linked_existing" | "error"
    prospect_id: int
    messages: list[str]
    match_detail: str
    project_linked: bool
    possible_matches: list[PossibleMatch]


class ResultSummary(TypedDict):
    """Result summary for bulk registration"""
    added: int
    duplicates: int
    linked_existing: int
    errors: int
    details: list[EntryDetail]


# ---------------------------------------------------------------------------
# 定数
# ---------------------------------------------------------------------------

PROSPECT_REQUIRED = ("name", "overview", "website_url")
PROJECT_PROSPECT_REQUIRED = ("match_reason",)


# ---------------------------------------------------------------------------
# Processing functions
# ---------------------------------------------------------------------------

def validate_entry(entry: ProspectEntry, index: int) -> list[str]:
    """Validate an entry. Returns a list of error messages."""
    errors: list[str] = []
    # Skip prospect-side required checks when existing_prospect_id is specified
    if not entry.get("existing_prospect_id"):
        for field in PROSPECT_REQUIRED:
            if not entry.get(field):
                errors.append(f"[{index}] Required field '{field}' is missing")
    for field in PROJECT_PROSPECT_REQUIRED:
        if not entry.get(field):
            errors.append(f"[{index}] Required field '{field}' is missing")
    return errors


def find_duplicates(conn: sqlite3.Connection, entry: ProspectEntry) -> list[DuplicateMatch]:
    """Check for duplicate entries. Uses domain as the organization anchor.

    1. Derive domain from website_url and look up in organizations
       - Unknown organization → no duplicates (return [])
       - Known organization → check for duplicates among its prospects
    2. Within the same organization, check via email / contact_form_url / SNS
       - email / contact_form_url also have global UNIQUE constraints at the DB level
    """
    website_url = entry.get("website_url")
    if not website_url:
        return []

    domain = extract_domain(website_url)
    org = conn.execute(
        "SELECT domain FROM organizations WHERE domain = ?",
        (domain,),
    ).fetchone()
    if org is None:
        return []  # Unknown organization → no duplicates

    matches: list[DuplicateMatch] = []

    email = entry.get("email")
    if email:
        for row in conn.execute(
            "SELECT id, name FROM prospects WHERE organization_id = ? AND email = ?",
            (domain, email),
        ):
            matches.append(DuplicateMatch(
                match_type="EXACT_MATCH",
                prospect_id=row["id"],
                name=row["name"],
                reason=f"Email match within same organization: {email}",
            ))

    contact_form_url = entry.get("contact_form_url")
    if contact_form_url:
        for row in conn.execute(
            "SELECT id, name FROM prospects"
            " WHERE organization_id = ? AND contact_form_url = ?",
            (domain, contact_form_url),
        ):
            matches.append(DuplicateMatch(
                match_type="EXACT_MATCH",
                prospect_id=row["id"],
                name=row["name"],
                reason=f"Form URL match within same organization: {contact_form_url}",
            ))

    sns_raw = entry.get("sns_accounts")
    if sns_raw is not None:
        sns: dict[str, str] = {}
        if isinstance(sns_raw, str):
            try:
                parsed: object = json.loads(sns_raw)
                if isinstance(parsed, dict):
                    sns = {str(k): str(v) for k, v in parsed.items()}
            except json.JSONDecodeError:
                pass
        else:
            sns = sns_raw
        for key, value in sns.items():
            if value and key in ALLOWED_SNS_KEYS:
                for row in conn.execute(
                    "SELECT id, name FROM prospects"
                    " WHERE organization_id = ?"
                    " AND sns_accounts IS NOT NULL"
                    f" AND json_extract(sns_accounts, '$.{key}') = ?",
                    (domain, value),
                ):
                    matches.append(DuplicateMatch(
                        match_type="EXACT_MATCH",
                        prospect_id=row["id"],
                        name=row["name"],
                        reason=f"SNS match within same organization: {key}={value}",
                    ))

    # Deduplicate (same prospect_id may match at multiple stages)
    seen: set[int] = set()
    unique: list[DuplicateMatch] = []
    for m in matches:
        if m["prospect_id"] not in seen:
            seen.add(m["prospect_id"])
            unique.append(m)

    return unique


def insert_prospect(conn: sqlite3.Connection, entry: ProspectEntry) -> int:
    """Insert one record into the prospects table and return the new ID.

    Also upserts to the organizations table using website_url as the domain key.
    organization_name falls back to name if not provided.
    """
    sns_val = entry.get("sns_accounts")
    sns_str: str | None = None
    if isinstance(sns_val, dict):
        sns_str = json.dumps(sns_val, ensure_ascii=False)
    elif isinstance(sns_val, str):
        sns_str = sns_val

    do_not_contact = 1 if entry.get("do_not_contact") else 0

    prospect_name = entry.get("name")
    website_url = entry.get("website_url")
    if not prospect_name or not website_url:
        raise ValueError(
            f"name and website_url are required (name={prospect_name})"
        )

    # Upsert to organizations (organization_name falls back to prospect name)
    org_name = entry.get("organization_name") or prospect_name
    domain = upsert_organization(
        conn,
        name=org_name,
        website_url=website_url,
        country=entry.get("country"),
        industry=entry.get("industry"),
        overview=entry.get("overview"),
    )

    sql = (
        "INSERT INTO prospects"
        " (name, contact_name, organization_id, department, overview, industry,"
        " website_url, email, contact_form_url, form_type, sns_accounts,"
        " do_not_contact, notes)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
    cursor = conn.execute(
        sql,
        (
            prospect_name,
            entry.get("contact_name"),
            domain,
            entry.get("department"),
            entry.get("overview"),
            entry.get("industry"),
            website_url,
            entry.get("email"),
            entry.get("contact_form_url"),
            entry.get("form_type"),
            sns_str,
            do_not_contact,
            entry.get("notes"),
        ),
    )
    row_id = cursor.lastrowid
    if row_id is None:
        raise RuntimeError("Could not get lastrowid after INSERT")
    return row_id


def link_project_prospect(
    conn: sqlite3.Connection,
    project_id: str,
    prospect_id: int,
    entry: ProspectEntry,
) -> bool:
    """Register a linkage in project_prospects. Returns False if already exists."""
    sql = (
        "INSERT OR IGNORE INTO project_prospects"
        + " (project_id, prospect_id, match_reason, priority) VALUES (?, ?, ?, ?)"
    )
    cursor = conn.execute(
        sql,
        (project_id, prospect_id, entry.get("match_reason"), entry.get("priority", 3)),
    )
    return cursor.rowcount > 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Bulk prospect registration. Reads a JSON array from stdin and performs "
            + "duplicate checking → prospect registration → project_prospects linkage in bulk."
        ),
    )
    _ = parser.add_argument("db_path", help="Path to the SQLite database")
    _ = parser.add_argument("project_id", help="Project ID")
    return parser


def main() -> None:
    args = build_parser().parse_args()
    db_path: str = args.db_path
    project_id: str = args.project_id

    try:
        raw_data: object = json.load(sys.stdin)
    except json.JSONDecodeError as e:
        error_exit(f"JSON parse error: {e}")

    if not isinstance(raw_data, list):
        error_exit("Input must be a JSON array")

    data = cast(list[ProspectEntry], raw_data)

    if not data:
        empty: ResultSummary = {
            "added": 0, "duplicates": 0, "linked_existing": 0,
            "errors": 0, "details": [],
        }
        print_json(empty)
        return

    conn = get_connection(db_path)

    results: ResultSummary = {
        "added": 0,
        "duplicates": 0,
        "linked_existing": 0,
        "errors": 0,
        "details": [],
    }

    try:
        for i, entry in enumerate(data):
            detail = EntryDetail(
                index=i,
                name=entry.get("name", ""),
            )

            # Validation
            errors = validate_entry(entry, i)
            if errors:
                detail["status"] = "error"
                detail["messages"] = errors
                results["errors"] += 1
                results["details"].append(detail)
                continue

            # --- When existing_prospect_id is specified ---
            existing_pid = entry.get("existing_prospect_id")
            if existing_pid is not None:
                linked = link_project_prospect(conn, project_id, existing_pid, entry)
                detail["status"] = "linked_existing"
                detail["prospect_id"] = existing_pid
                detail["project_linked"] = linked
                results["linked_existing"] += 1
                results["details"].append(detail)
                continue

            # --- Duplicate check ---
            matches = find_duplicates(conn, entry)
            exact = [m for m in matches if m["match_type"] == "EXACT_MATCH"]

            if exact:
                pid = exact[0]["prospect_id"]
                detail["status"] = "duplicate"
                detail["prospect_id"] = pid
                detail["match_detail"] = exact[0]["reason"]
                linked = link_project_prospect(conn, project_id, pid, entry)
                detail["project_linked"] = linked
                results["duplicates"] += 1
                results["details"].append(detail)
                continue

            # POSSIBLE_MATCH: register as new (weak signal)
            # Assumes the caller has already made a judgment
            if matches:
                detail["possible_matches"] = [
                    PossibleMatch(prospect_id=m["prospect_id"], reason=m["reason"])
                    for m in matches
                ]

            # --- New registration ---
            try:
                new_id = insert_prospect(conn, entry)
                _ = link_project_prospect(conn, project_id, new_id, entry)
                detail["status"] = "added"
                detail["prospect_id"] = new_id
                results["added"] += 1
            except Exception as e:
                detail["status"] = "error"
                detail["messages"] = [str(e)]
                results["errors"] += 1

            results["details"].append(detail)

        conn.commit()
    except Exception as e:
        conn.rollback()
        error_exit(f"Transaction failed: {e}")
    finally:
        conn.close()

    print_json(results)


if __name__ == "__main__":
    main()
