#!/usr/bin/env python3
"""Prospect duplicate check script

Checks in order from most reliable to least, and outputs matching candidates as JSON.
Check order:
  1. organizations corporate_number (O(1) PK)
  2. prospects email (O(1) UNIQUE INDEX)
  3. prospects contact_form_url (O(1) UNIQUE INDEX)
  4. SNS accounts
  5. Name match (fallback)
  6. Domain match (fallback)

Usage:
  check_duplicate.py <db_path> [options]

Options:
  --email <email>
  --sns <key> <value>
  --corporate-number <number>
  --name <name>
  --website-url <url>
  --contact-form-url <url>

Output: JSON array of DuplicateMatch objects
Exit code: 0 = match found, 1 = no match, 2 = error
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys

from sales_db import DuplicateMatch, extract_domain, get_connection, normalize_name  # pyright: ignore[reportMissingModuleSource]


def check_corporate_number(conn: sqlite3.Connection, number: str) -> list[DuplicateMatch]:
    """Search organizations → prospects by corporate number (O(1) PK lookup)."""
    # Check if it exists in organizations
    org = conn.execute(
        "SELECT corporate_number, name FROM organizations WHERE corporate_number = ?",
        (number,),
    ).fetchone()
    if org is None:
        # Even if not in organizations, it may exist in legacy prospects data
        cursor = conn.execute(
            "SELECT id, name FROM prospects WHERE organization_id = ?",
            (number,),
        )
        return [
            DuplicateMatch(
                match_type="EXACT_MATCH",
                prospect_id=row["id"],
                name=row["name"],
                reason=f"Corporate number match: {number}",
            )
            for row in cursor
        ]

    # Found in organizations → return linked prospects
    cursor = conn.execute(
        "SELECT id, name FROM prospects WHERE organization_id = ?",
        (number,),
    )
    results = [
        DuplicateMatch(
            match_type="EXACT_MATCH",
            prospect_id=row["id"],
            name=row["name"],
            reason=f"Corporate number match (entity: {org['name']}): {number}",
        )
        for row in cursor
    ]
    # Even if no prospects exist, org is present → return org_name to indicate duplicate
    if not results:
        results.append(
            DuplicateMatch(
                match_type="EXACT_MATCH",
                prospect_id=-1,  # org exists but no prospect registered yet
                name=str(org["name"]),
                reason=f"Corporate number match (organizations only): {number}",
            )
        )
    return results


def check_email(conn: sqlite3.Connection, email: str) -> list[DuplicateMatch]:
    """Exact email match check (O(1) via UNIQUE INDEX)."""
    cursor = conn.execute(
        "SELECT id, name FROM prospects WHERE email = ?",
        (email,),
    )
    return [
        DuplicateMatch(
            match_type="EXACT_MATCH",
            prospect_id=row["id"],
            name=row["name"],
            reason=f"Email match: {email}",
        )
        for row in cursor
    ]


def check_contact_form(conn: sqlite3.Connection, url: str) -> list[DuplicateMatch]:
    """Exact contact_form_url match check (O(1) via UNIQUE INDEX)."""
    cursor = conn.execute(
        "SELECT id, name FROM prospects WHERE contact_form_url = ?",
        (url,),
    )
    return [
        DuplicateMatch(
            match_type="EXACT_MATCH",
            prospect_id=row["id"],
            name=row["name"],
            reason=f"Contact form URL match: {url}",
        )
        for row in cursor
    ]


ALLOWED_SNS_KEYS = {"twitter", "x", "linkedin", "facebook", "instagram"}


def check_sns(conn: sqlite3.Connection, sns_key: str, sns_value: str) -> list[DuplicateMatch]:
    """Exact SNS account match check (uses json_extract)."""
    if sns_key not in ALLOWED_SNS_KEYS:
        return []
    cursor = conn.execute(
        "SELECT id, name FROM prospects "
        "WHERE sns_accounts IS NOT NULL "
        f"AND json_extract(sns_accounts, '$.{sns_key}') = ?",
        (sns_value,),
    )
    return [
        DuplicateMatch(
            match_type="EXACT_MATCH",
            prospect_id=row["id"],
            name=row["name"],
            reason=f"SNS match: {sns_key}={sns_value}",
        )
        for row in cursor
    ]


def check_name(conn: sqlite3.Connection, name: str) -> list[DuplicateMatch]:
    """Name match check (prioritizes organizations.normalized_name INDEX; falls back to full scan)."""
    normalized = normalize_name(name)

    # First, fast check using the organizations INDEX
    org_cursor = conn.execute(
        "SELECT o.corporate_number, o.name, p.id, p.name"
        " FROM organizations o"
        " LEFT JOIN prospects p ON o.corporate_number = p.organization_id"
        " WHERE o.normalized_name = ?",
        (normalized,),
    )
    results: list[DuplicateMatch] = []
    for row in org_cursor:
        if row["id"] is not None:
            results.append(
                DuplicateMatch(
                    match_type="EXACT_MATCH",
                    prospect_id=row["id"],
                    name=row["name"],
                    reason="Name match (via organizations)",
                )
            )
    if results:
        return results

    # Fallback: full scan for legacy data not in organizations
    cursor = conn.execute("SELECT id, name FROM prospects")
    return [
        DuplicateMatch(
            match_type="EXACT_MATCH",
            prospect_id=row["id"],
            name=row["name"],
            reason="Name match",
        )
        for row in cursor
        if normalize_name(row["name"]) == normalized
    ]


def check_website_domain(conn: sqlite3.Connection, url: str) -> list[DuplicateMatch]:
    """Website domain match check (prioritizes organizations.domain INDEX)."""
    domain = extract_domain(url)
    if not domain:
        return []

    # Fast check using the organizations INDEX
    org_cursor = conn.execute(
        "SELECT o.corporate_number, o.name, p.id, p.name"
        " FROM organizations o"
        " LEFT JOIN prospects p ON o.corporate_number = p.organization_id"
        " WHERE o.domain = ?",
        (domain,),
    )
    results: list[DuplicateMatch] = []
    for row in org_cursor:
        if row["id"] is not None:
            results.append(
                DuplicateMatch(
                    match_type="POSSIBLE_MATCH",
                    prospect_id=row["id"],
                    name=row["name"],
                    reason=f"Domain match (via organizations): {domain}",
                )
            )
    if results:
        return results

    # Fallback: full scan for legacy data not in organizations
    cursor = conn.execute(
        "SELECT id, name, website_url FROM prospects"
        " WHERE website_url IS NOT NULL",
    )
    return [
        DuplicateMatch(
            match_type="POSSIBLE_MATCH",
            prospect_id=row["id"],
            name=row["name"],
            reason=f"Domain match: {domain}",
        )
        for row in cursor
        if extract_domain(row["website_url"]) == domain
    ]


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Prospect duplicate check. Checks in order from most reliable, outputs matches as JSON.",
    )
    _ = parser.add_argument("db_path", help="Path to the SQLite database")
    _ = parser.add_argument("--email", help="Exact match check by email address")
    _ = parser.add_argument("--sns", nargs=2, metavar=("KEY", "VALUE"), help="Exact match check by SNS account (e.g. --sns x @account)")
    _ = parser.add_argument("--corporate-number", help="Exact match check by corporate number")
    _ = parser.add_argument("--name", help="Exact match check by name")
    _ = parser.add_argument("--website-url", help="Match check by website domain")
    _ = parser.add_argument("--contact-form-url", help="Exact match check by contact form URL")
    return parser


def main() -> None:
    args = build_parser().parse_args()

    conn = get_connection(args.db_path)
    matches: list[DuplicateMatch] = []

    try:
        if args.corporate_number:
            matches.extend(check_corporate_number(conn, args.corporate_number))

        if args.email:
            matches.extend(check_email(conn, args.email))

        if args.contact_form_url:
            matches.extend(check_contact_form(conn, args.contact_form_url))

        if args.sns:
            matches.extend(check_sns(conn, args.sns[0], args.sns[1]))

        if args.name:
            matches.extend(check_name(conn, args.name))

        if args.website_url:
            matches.extend(check_website_domain(conn, args.website_url))
    finally:
        conn.close()

    # Deduplicate (same prospect_id may match at multiple stages)
    seen: set[int] = set()
    unique_matches: list[DuplicateMatch] = []
    for m in matches:
        if m["prospect_id"] not in seen:
            seen.add(m["prospect_id"])
            unique_matches.append(m)

    if unique_matches:
        json.dump(unique_matches, sys.stdout, ensure_ascii=False, indent=2)
        print()
        sys.exit(0)
    else:
        sys.exit(1)


if __name__ == "__main__":
    main()
