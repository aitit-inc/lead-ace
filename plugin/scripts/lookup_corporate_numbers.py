#!/usr/bin/env python3
"""Script to search for corporate numbers for prospects that don't have one yet

Usage:
  python3 lookup_corporate_numbers.py <db_path> [--limit N]

Retrieves prospects with a NULL organization_id and searches for corporate number candidates
via check_corporate_number.py (NTA site search). Does not update the DB
(candidate confirmation is left to the LLM or a human).

Output: JSON
  {"searched": N, "candidates_found": N, "not_found": N, "details": [...]}
"""

from __future__ import annotations

import argparse
import re
import sqlite3
import subprocess
import sys
import time
import unicodedata
from typing import TypedDict

from check_corporate_number import SearchResult, search  # pyright: ignore[reportMissingModuleSource]
from sales_db import get_connection, print_json  # pyright: ignore[reportMissingModuleSource]


# ---------------------------------------------------------------------------
# Type definitions
# ---------------------------------------------------------------------------


class LookupDetail(TypedDict, total=False):
    prospect_id: int
    name: str
    website_url: str
    status: str  # "candidates_found" | "not_found" | "error"
    candidates: list[SearchResult]
    message: str


class LookupResult(TypedDict):
    searched: int
    candidates_found: int
    not_found: int
    errors: int
    details: list[LookupDetail]


# ---------------------------------------------------------------------------
# Corporate number search
# ---------------------------------------------------------------------------

_LEGAL_ENTITY_PATTERN = re.compile(
    r"(株式会社|有限会社|合同会社|一般社団法人|一般財団法人|公益社団法人|"
    r"公益財団法人|学校法人|社会福祉法人|医療法人|NPO法人|特定非営利活動法人)"
)


def _filter_results(results: list[SearchResult]) -> list[SearchResult]:
    """Remove candidates with an empty name (parse failures)."""
    return [c for c in results if c["name"].strip()]


def search_candidates(name: str) -> list[SearchResult]:
    """Search the NTA Corporate Number Publication Site for corporate number candidates.

    Does not automatically select a candidate — only returns a list.
    Confirmation is left to the LLM or a human.

    Search strategy (progressive fallback):
    1. Strip legal entity suffix and search (e.g. "株式会社ABC" → "ABC")
    2. If 0 results, trim the last space-delimited token and retry (e.g. "早稲田大学 キャリアセンター" → "早稲田大学")
    3. If still 0 results, trim one more token and retry
    """
    search_name = unicodedata.normalize("NFKC", name).strip()
    clean_name = _LEGAL_ENTITY_PATTERN.sub("", search_name).strip()

    # 1. Search with full name
    try:
        candidates = _filter_results(search(clean_name)["results"])
    except (RuntimeError, subprocess.TimeoutExpired):
        return []

    if candidates:
        return candidates

    # 2. Retry by trimming the last space-delimited token (up to 2 times)
    current = clean_name
    for _ in range(2):
        if " " not in current and "　" not in current:
            break
        # Strip the trailing full-width or half-width space-separated token
        current = re.split(r"[\s　]+", current)
        current = " ".join(current[:-1]).strip() if len(current) > 1 else current[0]
        if not current:
            break
        print(f"    Retry: searching with '{current}'...", file=sys.stderr)
        try:
            candidates = _filter_results(search(current)["results"])
        except (RuntimeError, subprocess.TimeoutExpired):
            continue
        if candidates:
            return candidates

    return []


# ---------------------------------------------------------------------------
# Main processing
# ---------------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Search the NTA Corporate Number Publication Site for prospects without a corporate number.",
    )
    _ = parser.add_argument("db_path", help="Path to the SQLite database")
    _ = parser.add_argument(
        "--limit", type=int, default=20,
        help="Maximum number of prospects to search (default: 20; higher values take longer due to playwright-cli browser automation)",
    )
    return parser


def main() -> None:
    args = build_parser().parse_args()
    db_path: str = args.db_path
    limit: int = args.limit

    conn = get_connection(db_path)

    # Fetch prospects where organization_id is NULL and org_lookup_status is not set (one per name)
    cursor = conn.execute(
        "SELECT id, name, website_url"
        " FROM prospects"
        " WHERE organization_id IS NULL"
        "   AND (org_lookup_status IS NULL)"
        " GROUP BY name"
        " ORDER BY id ASC"
        " LIMIT ?",
        (limit,),
    )
    targets: list[sqlite3.Row] = cursor.fetchall()
    conn.close()

    if not targets:
        print("No prospects without a corporate number found.", file=sys.stderr)
        empty: LookupResult = {
            "searched": 0, "candidates_found": 0,
            "not_found": 0, "errors": 0, "details": [],
        }
        print_json(empty)
        return

    print(f"Targets to search: {len(targets)}", file=sys.stderr)

    result: LookupResult = {
        "searched": len(targets),
        "candidates_found": 0,
        "not_found": 0,
        "errors": 0,
        "details": [],
    }

    for i, row in enumerate(targets):
        prospect_id: int = row["id"]
        name: str = row["name"]

        print(f"  [{i + 1}/{len(targets)}] {name}...", file=sys.stderr, end=" ")

        detail = LookupDetail(
            prospect_id=prospect_id,
            name=name,
            website_url=row["website_url"],
        )

        try:
            candidates = search_candidates(name)
        except Exception as e:
            detail["status"] = "error"
            detail["message"] = str(e)
            result["errors"] += 1
            result["details"].append(detail)
            print("ERROR", file=sys.stderr)
            continue

        if candidates:
            detail["status"] = "candidates_found"
            detail["candidates"] = candidates
            detail["message"] = f"{len(candidates)} candidates found. Please review and confirm with LLM or manually."
            result["candidates_found"] += 1
            names = ", ".join(c["name"] for c in candidates[:3])
            print(f"→ {len(candidates)} found: {names}", file=sys.stderr)
        else:
            detail["status"] = "not_found"
            result["not_found"] += 1
            print("→ Not found", file=sys.stderr)

        result["details"].append(detail)

        # Interval between playwright-cli browser operations
        if i < len(targets) - 1:
            time.sleep(2)

    print_json(result)


if __name__ == "__main__":
    main()
